use axum::extract::ws::WebSocket;
use serde::{Deserialize, Serialize};

use super::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ScreenShareSourceType {
    Browser,
    Application,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenShareSessionState {
    pub active: bool,
    pub session_id: Option<String>,
    pub source_type: Option<ScreenShareSourceType>,
    pub source_label: Option<String>,
    pub started_at: Option<u64>,
    pub interactive: bool,
    pub max_viewers: u8,
    pub current_viewers: u8,
    pub stream_ready: bool,
    pub stream_message: Option<String>,
}

impl Default for ScreenShareSessionState {
    fn default() -> Self {
        Self {
            active: false,
            session_id: None,
            source_type: None,
            source_label: None,
            started_at: None,
            interactive: false,
            max_viewers: 0,
            current_viewers: 0,
            stream_ready: false,
            stream_message: Some("ScreenShare host is disabled on iOS".to_string()),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartScreenShareRequest {
    pub source_type: ScreenShareSourceType,
    pub url: Option<String>,
    pub source_label: Option<String>,
}

#[derive(Clone, Default)]
pub struct ScreenShareService;

impl ScreenShareService {
    pub fn new() -> Self {
        Self
    }

    pub async fn get_state(&self) -> ScreenShareSessionState {
        ScreenShareSessionState::default()
    }

    pub async fn start(
        &self,
        _app_handle: Option<&tauri::AppHandle>,
        request: StartScreenShareRequest,
    ) -> AppResult<ScreenShareSessionState> {
        let _ = (&request.source_type, &request.url, &request.source_label);
        Err(AppError::BadRequest(
            "ScreenShare host mode is not supported on iOS".to_string(),
        ))
    }

    pub async fn stop(
        &self,
        _app_handle: Option<&tauri::AppHandle>,
    ) -> AppResult<ScreenShareSessionState> {
        Ok(ScreenShareSessionState::default())
    }

    pub async fn handle_socket(&self, mut socket: WebSocket) {
        use futures::StreamExt;

        while socket.next().await.is_some() {
            // Intentionally ignore messages when host mode is disabled.
        }
    }
}
