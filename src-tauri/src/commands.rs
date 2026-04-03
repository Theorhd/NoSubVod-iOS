#![cfg_attr(test, allow(dead_code))]

use axum::body::{to_bytes, Body};
use axum::http::{header, Method, Request};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, VecDeque};
use std::sync::Arc;
use tokio::sync::{Mutex, RwLock};
use tower::ServiceExt;
use twitch_irc::login::StaticLoginCredentials;
use twitch_irc::message::ServerMessage;
use twitch_irc::{ClientConfig, SecureTCPTransport, TwitchIRCClient};

use tauri::State;

use crate::server::download_paths::{
    build_master_m3u8_url, build_output_file_path, resolve_download_output_dir,
};
use crate::server::routes::build_router;
use crate::server::{types::ServerInfo, AppState};

const DOWNLOAD_STARTED_MESSAGE: &str = "Download started in background";

struct FfmpegDownloadJob {
    master_m3u8_url: String,
    output_file: String,
    start_time: Option<f64>,
    end_time: Option<f64>,
}

#[derive(Deserialize)]
pub struct InternalApiRequest {
    pub method: String,
    pub path: String,
    pub query: Option<String>,
    pub body: Option<String>,
    pub headers: Option<std::collections::HashMap<String, String>>,
}

#[derive(Serialize)]
pub struct InternalApiResponse {
    pub status: u16,
    pub body: String,
    pub is_base64: bool,
    pub content_type: Option<String>,
}

struct LiveChatPollingSession {
    queue: Arc<Mutex<VecDeque<Value>>>,
    task: tokio::task::JoinHandle<()>,
}

static LIVE_CHAT_SESSIONS: Lazy<RwLock<HashMap<String, LiveChatPollingSession>>> =
    Lazy::new(|| RwLock::new(HashMap::new()));

const LIVE_CHAT_BUFFER_LIMIT: usize = 500;
const LIVE_CHAT_BATCH_LIMIT: usize = 120;

async fn push_live_chat_event(queue: &Arc<Mutex<VecDeque<Value>>>, event: Value) {
    let mut guard = queue.lock().await;
    guard.push_back(event);
    while guard.len() > LIVE_CHAT_BUFFER_LIMIT {
        let _ = guard.pop_front();
    }
}

#[tauri::command]
pub async fn internal_api_request(
    request: InternalApiRequest,
    state: State<'_, Arc<AppState>>,
) -> Result<InternalApiResponse, String> {
    let mut path = request.path.trim().to_string();
    if path.is_empty() {
        path = "/".to_string();
    }
    if !path.starts_with('/') {
        path = format!("/{path}");
    }

    let uri = if let Some(query) = request.query.as_ref().filter(|q| !q.is_empty()) {
        format!("{path}?{query}")
    } else {
        path
    };

    let method = request
        .method
        .parse::<Method>()
        .map_err(|_| "Invalid HTTP method".to_string())?;

    let mut req_builder = Request::builder().method(method).uri(uri);

    // Internal bridge always authenticates against the current in-app session token.
    req_builder = req_builder.header("x-nsv-token", &state.api_state.server_token);

    if let Some(headers) = request.headers {
        for (key, value) in headers {
            let key_lower = key.to_ascii_lowercase();
            if key_lower == "host" || key_lower == "content-length" {
                continue;
            }
            req_builder = req_builder.header(key, value);
        }
    }

    let body = request.body.unwrap_or_default();
    let req = req_builder
        .body(Body::from(body))
        .map_err(|e| format!("Failed to build request: {e}"))?;

    let mut api_state = state.api_state.clone();
    api_state.app_handle = None;
    let router = build_router(api_state, None);

    let resp = router
        .oneshot(req)
        .await
        .map_err(|e| format!("Internal API dispatch failed: {e}"))?;

    let status = resp.status().as_u16();
    let content_type = resp
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    let body_bytes = to_bytes(resp.into_body(), usize::MAX)
        .await
        .map_err(|e| format!("Failed to read response body: {e}"))?;

    let content_type_ref = content_type
        .as_deref()
        .unwrap_or_default()
        .to_ascii_lowercase();
    let is_textual = content_type_ref.starts_with("text/")
        || content_type_ref.contains("json")
        || content_type_ref.contains("javascript")
        || content_type_ref.contains("xml")
        || content_type_ref.contains("mpegurl");

    let (body, is_base64) = if is_textual {
        (String::from_utf8_lossy(&body_bytes).to_string(), false)
    } else {
        (B64.encode(&body_bytes), true)
    };

    Ok(InternalApiResponse {
        status,
        body,
        is_base64,
        content_type,
    })
}

#[tauri::command]
pub async fn proxy_remote_request(
    server_url: String,
    method: String,
    path: String,
    query: Option<String>,
    headers: Option<HashMap<String, String>>,
    body: Option<String>,
) -> Result<InternalApiResponse, String> {
    let mut url = format!("{server_url}{path}");
    if let Some(q) = query.filter(|s| !s.is_empty()) {
        url = format!("{url}?{q}");
    }

    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .build()
        .map_err(|e| format!("Failed to build reqwest client: {e}"))?;

    let req_method = reqwest::Method::from_bytes(method.as_bytes())
        .map_err(|_| "Invalid HTTP method".to_string())?;

    let mut req_builder = client.request(req_method, &url);

    if let Some(h) = headers {
        for (k, v) in h {
            let key_lower = k.to_ascii_lowercase();
            if key_lower == "host" || key_lower == "content-length" {
                continue;
            }
            req_builder = req_builder.header(k, v);
        }
    }

    if let Some(b) = body {
        req_builder = req_builder.body(b);
    }

    let resp = req_builder
        .send()
        .await
        .map_err(|e| format!("Proxy request failed: {e}"))?;

    let status = resp.status().as_u16();
    let content_type = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    let body_bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("Failed to read proxy response body: {e}"))?;

    let content_type_ref = content_type
        .as_deref()
        .unwrap_or_default()
        .to_ascii_lowercase();
    let is_textual = content_type_ref.starts_with("text/")
        || content_type_ref.contains("json")
        || content_type_ref.contains("javascript")
        || content_type_ref.contains("xml")
        || content_type_ref.contains("mpegurl");

    let (body_str, is_base64) = if is_textual {
        (String::from_utf8_lossy(&body_bytes).to_string(), false)
    } else {
        (B64.encode(&body_bytes), true)
    };

    Ok(InternalApiResponse {
        status,
        body: body_str,
        is_base64,
        content_type,
    })
}

#[tauri::command]
pub async fn scan_local_servers() -> Result<Vec<String>, String> {
    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .timeout(std::time::Duration::from_millis(500))
        .build()
        .map_err(|e| format!("Failed to build reqwest client: {e}"))?;

    let local_ip =
        local_ip_address::local_ip().map_err(|e| format!("Could not get local IP: {:?}", e))?;

    let local_ip_str = local_ip.to_string();
    let parts: Vec<&str> = local_ip_str.split('.').collect();
    if parts.len() != 4 {
        return Ok(vec![]);
    }

    let prefix = format!("{}.{}.{}", parts[0], parts[1], parts[2]);
    let mut handles = vec![];

    for i in 1..=254 {
        let ip = format!("{}.{}", prefix, i);
        let url = format!("https://{}:23456/api/auth/twitch/status", ip);
        let client_clone = client.clone();

        handles.push(tokio::spawn(async move {
            if let Ok(resp) = client_clone.get(&url).send().await {
                if resp.status().is_success() {
                    return Some(format!("https://{}:23456", ip));
                }
            }
            None
        }));
    }

    let mut found_servers = vec![];
    for handle in handles {
        if let Ok(Some(server_url)) = handle.await {
            found_servers.push(server_url);
        }
    }

    Ok(found_servers)
}

#[tauri::command]
pub async fn start_live_chat_polling(live_id: String) -> Result<String, String> {
    let login = live_id.trim().to_lowercase();
    if login.is_empty() {
        return Err("Missing live login".to_string());
    }

    let queue = Arc::new(Mutex::new(VecDeque::<Value>::with_capacity(220)));
    let queue_for_task = queue.clone();

    let session_id = uuid::Uuid::new_v4().to_string();

    let task = tokio::spawn(async move {
        let config = ClientConfig::default();
        let (mut incoming_messages, client) =
            TwitchIRCClient::<SecureTCPTransport, StaticLoginCredentials>::new(config);

        if let Err(err) = client.join(login.clone()) {
            push_live_chat_event(
                &queue_for_task,
                json!({
                    "type": "system",
                    "message": format!("Live chat unavailable: {err}")
                }),
            )
            .await;
            return;
        }

        while let Some(message) = incoming_messages.recv().await {
            match message {
                ServerMessage::Privmsg(msg) => {
                    let color = msg
                        .name_color
                        .map(|c| format!("#{:02X}{:02X}{:02X}", c.r, c.g, c.b));

                    push_live_chat_event(
                        &queue_for_task,
                        json!({
                            "id": msg.message_id,
                            "type": "msg",
                            "displayName": msg.sender.name,
                            "color": color,
                            "message": msg.message_text,
                        }),
                    )
                    .await;
                }
                ServerMessage::ClearMsg(msg) => {
                    push_live_chat_event(
                        &queue_for_task,
                        json!({
                            "type": "clear_msg",
                            "id": msg.message_id,
                        }),
                    )
                    .await;
                }
                ServerMessage::ClearChat(_) => {
                    push_live_chat_event(&queue_for_task, json!({ "type": "clear_chat" })).await;
                }
                _ => {}
            }
        }
    });

    let mut sessions = LIVE_CHAT_SESSIONS.write().await;
    sessions.insert(session_id.clone(), LiveChatPollingSession { queue, task });

    Ok(session_id)
}

#[tauri::command]
pub async fn poll_live_chat(session_id: String) -> Result<Value, String> {
    let queue = {
        let sessions = LIVE_CHAT_SESSIONS.read().await;
        let Some(session) = sessions.get(&session_id) else {
            return Ok(json!({ "type": "batch", "messages": [] }));
        };
        session.queue.clone()
    };

    let mut guard = queue.lock().await;
    let mut messages = Vec::new();
    for _ in 0..LIVE_CHAT_BATCH_LIMIT {
        let Some(event) = guard.pop_front() else {
            break;
        };
        messages.push(event);
    }

    Ok(json!({
        "type": "batch",
        "messages": messages,
    }))
}

#[tauri::command]
pub async fn stop_live_chat_polling(session_id: String) -> Result<(), String> {
    let session = {
        let mut sessions = LIVE_CHAT_SESSIONS.write().await;
        sessions.remove(&session_id)
    };

    if let Some(session) = session {
        session.task.abort();
    }

    Ok(())
}

/// Returns current server info (IP, port, URL, QR code) to the renderer.
#[tauri::command]
pub async fn get_server_info(state: State<'_, Arc<AppState>>) -> Result<ServerInfo, String> {
    Ok(state.server_info.clone())
}

#[tauri::command]
pub async fn start_download(
    vod_id: String,
    quality: String,
    start_time: Option<f64>,
    end_time: Option<f64>,
    state: State<'_, Arc<AppState>>,
) -> Result<String, String> {
    let settings = state.api_state.history.get_settings().await;
    let out_dir = resolve_download_output_dir(settings.download_local_path);

    let job = FfmpegDownloadJob {
        master_m3u8_url: build_master_m3u8_url(state.server_info.port, &vod_id),
        output_file: build_output_file_path(&out_dir, &vod_id, &quality, "mp4"),
        start_time,
        end_time,
    };

    tauri::async_runtime::spawn(spawn_ffmpeg_download(job));

    Ok(DOWNLOAD_STARTED_MESSAGE.to_string())
}

fn clip_duration(start_time: Option<f64>, end_time: Option<f64>) -> Option<f64> {
    match (start_time, end_time) {
        (Some(start), Some(end)) if end > start => Some(end - start),
        _ => None,
    }
}

async fn spawn_ffmpeg_download(job: FfmpegDownloadJob) {
    let mut cmd = tokio::process::Command::new("ffmpeg");

    if let Some(start_time) = job.start_time {
        cmd.arg("-ss").arg(start_time.to_string());
    }

    cmd.arg("-i").arg(&job.master_m3u8_url);

    if let Some(duration) = clip_duration(job.start_time, job.end_time) {
        cmd.arg("-t").arg(duration.to_string());
    }

    cmd.arg("-c")
        .arg("copy")
        .arg("-bsf:a")
        .arg("aac_adtstoasc")
        .arg("-y")
        .arg(&job.output_file);

    match cmd.spawn() {
        Ok(mut child) => {
            let _ = child.wait().await;
        }
        Err(error) => {
            eprintln!("Failed to spawn ffmpeg: {error}");
        }
    }
}
