use bytes::Bytes;
use moka::future::Cache;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::AppHandle;

use super::{
    auth::OAuthStateStore, download::DownloadManager, dto::DownloadedFile,
    extensions::ExtensionManager, history::HistoryStore, screenshare::ScreenShareService,
    twitch::TwitchService,
};

// ── Application state shared across all routes ─────────────────────────────────

#[derive(Clone)]
pub struct CachedSegment {
    pub content_type: Option<String>,
    pub body: Bytes,
}

#[derive(Clone)]
pub struct ApiState {
    pub twitch: Arc<TwitchService>,
    pub history: Arc<HistoryStore>,
    pub download: Arc<DownloadManager>,
    pub screenshare: Arc<ScreenShareService>,
    pub extensions: Arc<ExtensionManager>,
    pub oauth: Arc<OAuthStateStore>,
    pub logs_dir: PathBuf,
    /// Per-session token required for API access (prevents unauthorized LAN access).
    pub server_token: String,
    pub app_handle: Option<AppHandle>,
    /// Cache for the downloads list (short TTL to avoid frequent disk scans)
    pub download_cache: Cache<String, Vec<DownloadedFile>>,
    /// Very small in-memory cache for frequently re-requested tiny media chunks.
    pub segment_cache: Cache<String, CachedSegment>,
}
