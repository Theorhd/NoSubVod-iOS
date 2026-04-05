pub mod auth;
pub mod chat;
pub mod download;
pub mod download_paths;
pub mod dto;
pub mod error;
pub mod extensions;
pub mod history;
pub mod http_utils;
pub mod middleware;
pub mod routes;
pub mod screenshare;
pub mod state;
pub mod twitch;
pub mod types;
pub mod url_utils;
pub mod validation;

use moka::future::Cache;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

#[cfg(not(debug_assertions))]
use axum_server::tls_rustls::RustlsConfig;
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use image::ImageEncoder;
use qrcode::QrCode;
#[cfg(not(debug_assertions))]
use rcgen::generate_simple_self_signed;
use tauri::AppHandle;
#[cfg(not(debug_assertions))]
use tauri::Manager;
use tokio::net::TcpListener;
use uuid::Uuid;

use download::DownloadManager;
use extensions::ExtensionManager;
use history::HistoryStore;
use routes::build_router;
use screenshare::ScreenShareService;
use state::ApiState;
use twitch::TwitchService;
use types::ServerInfo;

use error::AppResult;

pub const SERVER_PORT: u16 = 23400;
#[cfg(not(debug_assertions))]
pub const SERVER_HTTPS_PORT: u16 = 23401;

pub struct AppState {
    pub server_info: ServerInfo,
    pub api_state: ApiState,
}

impl AppState {
    pub fn new(app_data_dir: PathBuf) -> AppResult<Self> {
        let history = Arc::new(HistoryStore::load(app_data_dir.clone())?);
        let twitch = Arc::new(TwitchService::new());
        let download = Arc::new(DownloadManager::new());
        let screenshare = Arc::new(ScreenShareService::new());
        let extensions = Arc::new(ExtensionManager::new(app_data_dir.clone()));
        let logs_dir = app_data_dir.join("logs");

        // Initial scan for extensions (synchronous scan or spawn task)
        let ext_clone = extensions.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(e) = ext_clone.scan().await {
                eprintln!("[NoSubVOD] Extension scan error: {}", e);
            }
        });

        let ip = get_local_ipv4();
        let port = SERVER_PORT;
        // In dev mode the portal is served by Vite (port 5173) which proxies
        // /api calls to Axum. In release, Axum serves the portal directly.
        #[cfg(debug_assertions)]
        let portal_port = 5173u16;
        #[cfg(not(debug_assertions))]
        let portal_port = SERVER_HTTPS_PORT;

        #[cfg(debug_assertions)]
        let portal_scheme = "https";
        #[cfg(not(debug_assertions))]
        let portal_scheme = "https";

        // Generate a per-session authentication token to protect API endpoints
        let server_token = Uuid::new_v4().to_string().replace('-', "");

        let url = format!("{portal_scheme}://{ip}:{portal_port}?t={server_token}");
        let qrcode = generate_qr_data_url(&url);

        let server_info = ServerInfo {
            ip,
            port,
            url,
            qrcode,
        };

        let oauth = Arc::new(auth::OAuthStateStore::new());

        let download_cache = Cache::builder()
            .time_to_live(Duration::from_secs(5))
            .max_capacity(1)
            .build();

        let segment_cache = Cache::builder()
            .time_to_live(Duration::from_secs(15))
            .weigher(
                |_key: &String, value: &crate::server::state::CachedSegment| {
                    value.body.len().min(u32::MAX as usize) as u32
                },
            )
            .max_capacity(32 * 1024 * 1024)
            .build();

        let api_state = ApiState {
            twitch,
            history,
            download,
            screenshare,
            extensions,
            oauth,
            logs_dir,
            server_token,
            app_handle: None,
            download_cache,
            segment_cache,
        };

        Ok(Self {
            server_info,
            api_state,
        })
    }
}

fn get_local_ipv4() -> String {
    local_ip_address::local_ip()
        .ok()
        .and_then(|ip| match ip {
            std::net::IpAddr::V4(v4) => Some(v4.to_string()),
            _ => None,
        })
        .unwrap_or_else(|| "127.0.0.1".to_string())
}

fn generate_qr_data_url(data: &str) -> String {
    let Ok(code) = QrCode::new(data.as_bytes()) else {
        return String::new();
    };

    let image = code
        .render::<image::Luma<u8>>()
        .quiet_zone(true)
        .max_dimensions(400, 400)
        .build();

    let mut buffer: Vec<u8> = Vec::new();
    let encoder = image::codecs::png::PngEncoder::new(&mut buffer);
    if encoder
        .write_image(
            image.as_raw(),
            image.width(),
            image.height(),
            image::ExtendedColorType::L8,
        )
        .is_err()
    {
        return String::new();
    }

    format!("data:image/png;base64,{}", B64.encode(&buffer))
}

pub async fn start_server(state: Arc<AppState>, app: AppHandle) {
    // Resolve portal dist directory in release (bundled resources first).
    let portal_dist = resolve_portal_dist(&app);

    let mut api_state = state.api_state.clone();
    api_state.app_handle = Some(app.clone());

    let router = build_router(api_state, portal_dist.clone());
    let http_addr = std::net::SocketAddr::from(([0, 0, 0, 0], SERVER_PORT));

    #[cfg(not(debug_assertions))]
    {
        let https_router = router.clone();
        match ensure_or_create_tls_files(&app, &state.server_info.ip) {
            Ok((cert_path, key_path)) => {
                tauri::async_runtime::spawn(async move {
                    start_https_server(https_router, cert_path, key_path).await;
                });
            }
            Err(e) => {
                eprintln!("[NoSubVOD] Failed to initialize TLS files: {e}");
            }
        }
    }

    match TcpListener::bind(http_addr).await {
        Ok(listener) => {
            eprintln!("[NoSubVOD] HTTP server listening on {http_addr}");
            #[cfg(not(debug_assertions))]
            match &portal_dist {
                Some(path) => eprintln!("[NoSubVOD] Serving portal from {}", path.display()),
                None => eprintln!("[NoSubVOD] Portal static files not found in bundle resources"),
            }
            if let Err(e) = axum::serve(listener, router).await {
                eprintln!("[NoSubVOD] Server error: {e}");
            }
        }
        Err(e) => {
            eprintln!("[NoSubVOD] Failed to bind port {SERVER_PORT}: {e}");
        }
    }
}

#[cfg(not(debug_assertions))]
fn ensure_or_create_tls_files(app: &AppHandle, ip: &str) -> Result<(PathBuf, PathBuf), String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Unable to resolve app data directory: {e}"))?;

    let tls_dir = app_data_dir.join("tls");
    std::fs::create_dir_all(&tls_dir)
        .map_err(|e| format!("Unable to create TLS directory {}: {e}", tls_dir.display()))?;

    let cert_path = tls_dir.join("portal-cert.pem");
    let key_path = tls_dir.join("portal-key.pem");

    let mut subject_alt_names = vec!["localhost".to_string(), "127.0.0.1".to_string()];
    if ip != "127.0.0.1" {
        subject_alt_names.push(ip.to_string());
    }

    let certified = generate_simple_self_signed(subject_alt_names)
        .map_err(|e| format!("Unable to generate self-signed TLS certificate: {e}"))?;

    // Always rewrite cert/key on startup so we don't get stuck with stale or
    // corrupted PEM files from a previous install/run.
    std::fs::write(&cert_path, certified.cert.pem())
        .map_err(|e| format!("Unable to write certificate {}: {e}", cert_path.display()))?;
    std::fs::write(&key_path, certified.key_pair.serialize_pem())
        .map_err(|e| format!("Unable to write private key {}: {e}", key_path.display()))?;

    Ok((cert_path, key_path))
}

#[cfg(not(debug_assertions))]
async fn start_https_server(router: axum::Router, cert_path: PathBuf, key_path: PathBuf) {
    let https_addr = std::net::SocketAddr::from(([0, 0, 0, 0], SERVER_HTTPS_PORT));

    let cert_path_for_log = cert_path.clone();
    let key_path_for_log = key_path.clone();

    let config = match RustlsConfig::from_pem_file(cert_path, key_path).await {
        Ok(config) => config,
        Err(e) => {
            eprintln!(
                "[NoSubVOD] Failed to build rustls config from cert={} key={}: {e}",
                cert_path_for_log.display(),
                key_path_for_log.display()
            );
            return;
        }
    };

    eprintln!("[NoSubVOD] HTTPS server listening on {https_addr}");
    if let Err(e) = axum_server::bind_rustls(https_addr, config)
        .serve(router.into_make_service())
        .await
    {
        eprintln!("[NoSubVOD] HTTPS server error: {e}");
    }
}

fn resolve_portal_dist(_app: &AppHandle) -> Option<PathBuf> {
    #[cfg(debug_assertions)]
    {
        None
    }
    #[cfg(not(debug_assertions))]
    {
        let mut candidates: Vec<PathBuf> = Vec::new();

        if let Ok(resource_dir) = _app.path().resource_dir() {
            candidates.push(resource_dir.join("portal"));
            candidates.push(resource_dir.join("dist").join("portal"));
            candidates.push(resource_dir.join("_up_").join("portal"));
            candidates.push(resource_dir.join("_up_").join("dist").join("portal"));
        }

        if let Ok(exe) = std::env::current_exe() {
            if let Some(exe_dir) = exe.parent() {
                candidates.push(exe_dir.join("portal"));
                candidates.push(exe_dir.join("resources").join("portal"));
                candidates.push(exe_dir.join("resources").join("dist").join("portal"));
                candidates.push(exe_dir.join("_up_").join("portal"));
                candidates.push(exe_dir.join("_up_").join("dist").join("portal"));
            }
        }

        candidates
            .into_iter()
            .find(|path| path.join("index.html").exists())
    }
}
