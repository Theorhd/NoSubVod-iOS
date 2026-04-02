use serde::{Deserialize, Serialize};
use serde_json::Value;

// ── Query parameter structs ───────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct ChatQuery {
    pub offset: Option<f64>,
    pub keyword: Option<String>,
    pub limit: Option<usize>,
}

#[derive(Deserialize)]
pub struct SearchQuery {
    pub q: Option<String>,
}

#[derive(Deserialize)]
pub struct VariantProxyQuery {
    pub id: Option<String>,
    pub url: Option<String>,
}

#[derive(Deserialize)]
pub struct LiveQuery {
    pub limit: Option<String>,
    pub cursor: Option<String>,
    pub after: Option<String>,
}

#[derive(Deserialize)]
pub struct LiveStatusQuery {
    pub logins: Option<String>,
}

#[derive(Deserialize)]
pub struct PagedQuery {
    pub offset: Option<usize>,
    pub limit: Option<usize>,
}

#[derive(Deserialize)]
pub struct HistoryListQuery {
    pub limit: Option<String>,
    pub offset: Option<String>,
}

#[derive(Deserialize)]
pub struct SearchCategoryQuery {
    pub id: Option<String>,
    pub name: Option<String>,
    pub cursor: Option<String>,
    pub limit: Option<String>,
}

#[derive(Deserialize)]
pub struct LiveCategoryQuery {
    pub name: Option<String>,
    pub cursor: Option<String>,
    pub limit: Option<String>,
}

#[derive(Deserialize)]
pub struct LiveSearchQuery {
    pub q: Option<String>,
    pub limit: Option<String>,
}

// ── Request Body structs ───────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct TrustedDevicePatch {
    pub trusted: bool,
}

#[derive(Deserialize)]
pub struct SettingsPatch {
    #[serde(rename = "oneSync")]
    pub one_sync: Option<bool>,
    #[serde(rename = "adblockEnabled")]
    pub adblock_enabled: Option<bool>,
    #[serde(rename = "adblockProxy")]
    pub adblock_proxy: Option<Option<String>>,
    #[serde(rename = "adblockProxyMode")]
    pub adblock_proxy_mode: Option<Option<String>>,
    #[serde(rename = "defaultVideoQuality")]
    pub default_video_quality: Option<Option<String>>,
    #[serde(rename = "minVideoQuality")]
    pub min_video_quality: Option<Option<String>>,
    #[serde(rename = "preferredVideoQuality")]
    pub preferred_video_quality: Option<Option<String>>,
    #[serde(rename = "downloadLocalPath")]
    pub download_local_path: Option<Option<String>>,
    #[serde(rename = "downloadNetworkSharedPath")]
    pub download_network_shared_path: Option<Option<String>>,
    #[serde(rename = "launchAtLogin")]
    pub launch_at_login: Option<bool>,
    #[serde(rename = "autoUpdate")]
    pub auto_update: Option<bool>,
    #[serde(rename = "enabledExtensions")]
    pub enabled_extensions: Option<Vec<String>>,
}

#[derive(Deserialize)]
pub struct HistoryBody {
    #[serde(rename = "vodId")]
    pub vod_id: Option<String>,
    pub timecode: Option<f64>,
    pub duration: Option<f64>,
}

#[derive(Deserialize)]
pub struct ChatSendBody {
    pub message: String,
}

#[derive(Deserialize)]
pub struct DownloadRequest {
    #[serde(rename = "vodId")]
    pub vod_id: String,
    pub title: Option<String>,
    pub quality: String,
    #[serde(rename = "startTime")]
    pub start_time: Option<f64>,
    #[serde(rename = "endTime")]
    pub end_time: Option<f64>,
    pub duration: Option<f64>,
}

// ── Response structs ───────────────────────────────────────────────────────────

#[derive(Serialize, Clone)]
pub struct DownloadedFile {
    pub name: String,
    pub size: u64,
    pub url: String,
    pub metadata: Option<Value>,
}
