use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ── Server info ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerInfo {
    pub ip: String,
    pub port: u16,
    pub url: String,
    pub qrcode: String,
}

// ── Twitch types ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserInfo {
    pub id: String,
    pub login: String,
    #[serde(rename = "displayName")]
    pub display_name: String,
    #[serde(rename = "profileImageURL")]
    pub profile_image_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VodGame {
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VodOwner {
    pub login: String,
    #[serde(rename = "displayName")]
    pub display_name: String,
    #[serde(rename = "profileImageURL")]
    pub profile_image_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Vod {
    pub id: String,
    pub title: String,
    #[serde(rename = "lengthSeconds")]
    pub length_seconds: u64,
    #[serde(rename = "previewThumbnailURL")]
    pub preview_thumbnail_url: String,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "viewCount")]
    pub view_count: u64,
    #[serde(rename = "broadcastType")]
    pub broadcast_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    pub game: Option<VodGame>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub owner: Option<VodOwner>,
}

impl Vod {
    pub fn is_valid(&self) -> bool {
        // Filter out instant VODs/streams:
        // 1. Check if it's currently recording or upcoming (if broadcastType is present)
        if let Some(ref bt) = self.broadcast_type {
            let bt_lower = bt.to_lowercase();
            if bt_lower == "live" || bt_lower == "upcoming" || bt_lower == "current_archiving" {
                return false;
            }
        }

        // 2. Check for missing or placeholder thumbnails
        let thumb = &self.preview_thumbnail_url;
        if thumb.is_empty() || thumb.contains("404_preview") || thumb.contains("recording") {
            return false;
        }

        // 3. Heuristic: VODs without a proper length or view count might be early recordings
        if self.length_seconds == 0 {
            return false;
        }

        // 4. Reject very short VODs (< 3m30s = 210s) — likely stream artifacts or clip-like entries
        if self.length_seconds < 210 {
            return false;
        }

        true
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LiveGame {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub name: String,
    #[serde(rename = "boxArtURL", skip_serializing_if = "Option::is_none")]
    pub box_art_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LiveBroadcaster {
    pub id: String,
    pub login: String,
    #[serde(rename = "displayName")]
    pub display_name: String,
    #[serde(rename = "profileImageURL")]
    pub profile_image_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LiveStream {
    pub id: String,
    pub title: String,
    #[serde(rename = "previewImageURL")]
    pub preview_image_url: String,
    #[serde(rename = "viewerCount")]
    pub viewer_count: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    #[serde(rename = "startedAt")]
    pub started_at: String,
    pub broadcaster: LiveBroadcaster,
    pub game: Option<LiveGame>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LiveStreamsPage {
    pub items: Vec<LiveStream>,
    #[serde(rename = "nextCursor")]
    pub next_cursor: Option<String>,
    #[serde(rename = "hasMore")]
    pub has_more: bool,
}

pub type LiveStatusMap = HashMap<String, LiveStream>;

// ── Persistence ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryEntry {
    #[serde(rename = "vodId")]
    pub vod_id: String,
    pub timecode: f64,
    pub duration: f64,
    #[serde(rename = "updatedAt")]
    pub updated_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryVodEntry {
    #[serde(flatten)]
    pub entry: HistoryEntry,
    pub vod: Option<Vod>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WatchlistEntry {
    #[serde(rename = "vodId")]
    pub vod_id: String,
    pub title: String,
    #[serde(rename = "previewThumbnailURL")]
    pub preview_thumbnail_url: String,
    #[serde(rename = "lengthSeconds")]
    pub length_seconds: u64,
    #[serde(rename = "addedAt", default)]
    pub added_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubEntry {
    pub login: String,
    #[serde(rename = "displayName")]
    pub display_name: String,
    #[serde(rename = "profileImageURL")]
    pub profile_image_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrustedDevice {
    #[serde(rename = "deviceId")]
    pub device_id: String,
    #[serde(rename = "firstSeenAt")]
    pub first_seen_at: u64,
    #[serde(rename = "lastSeenAt")]
    pub last_seen_at: u64,
    #[serde(rename = "lastIp", default)]
    pub last_ip: Option<String>,
    #[serde(rename = "userAgent", default)]
    pub user_agent: Option<String>,
    #[serde(default)]
    pub trusted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ExperienceSettings {
    #[serde(rename = "oneSync")]
    pub one_sync: bool,
    #[serde(rename = "adblockEnabled", default)]
    pub adblock_enabled: bool,
    #[serde(rename = "adblockProxy", default)]
    pub adblock_proxy: Option<String>,
    #[serde(rename = "adblockProxyMode", default)]
    pub adblock_proxy_mode: Option<String>, // "auto" or "manual"
    #[serde(rename = "defaultVideoQuality", default)]
    pub default_video_quality: Option<String>,
    #[serde(rename = "minVideoQuality", default)]
    pub min_video_quality: Option<String>,
    #[serde(rename = "preferredVideoQuality", default)]
    pub preferred_video_quality: Option<String>,
    #[serde(rename = "downloadLocalPath", default)]
    pub download_local_path: Option<String>,
    #[serde(rename = "downloadNetworkSharedPath", default)]
    pub download_network_shared_path: Option<String>,
    // Twitch linked account (public info — token stored separately in PersistedData)
    #[serde(
        rename = "twitchUserId",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub twitch_user_id: Option<String>,
    #[serde(
        rename = "twitchUserLogin",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub twitch_user_login: Option<String>,
    #[serde(
        rename = "twitchUserDisplayName",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub twitch_user_display_name: Option<String>,
    #[serde(
        rename = "twitchUserAvatar",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub twitch_user_avatar: Option<String>,
    #[serde(rename = "twitchImportFollows", default)]
    pub twitch_import_follows: bool,
    #[serde(rename = "launchAtLogin", default)]
    pub launch_at_login: bool,
    #[serde(rename = "autoUpdate", default)]
    pub auto_update: bool,
    #[serde(rename = "enabledExtensions", default)]
    pub enabled_extensions: Vec<String>,
}

/// Root of the persisted JSON file.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PersistedData {
    #[serde(default)]
    pub history: HashMap<String, HistoryEntry>,
    #[serde(default)]
    pub watchlist: Vec<WatchlistEntry>,
    #[serde(default)]
    pub subs: Vec<SubEntry>,
    #[serde(default)]
    pub settings: ExperienceSettings,
    #[serde(rename = "trustedDevices", default)]
    pub trusted_devices: Vec<TrustedDevice>,
    /// OAuth access token — stored in JSON but never sent to the frontend via /api/settings.
    #[serde(
        rename = "twitchToken",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub twitch_token: Option<String>,
}
