use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::{Duration, Instant};

use futures::stream::{self, StreamExt};
use moka::future::Cache;
use once_cell::sync::Lazy;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tauri::async_runtime;
use tokio::sync::RwLock;
use tracing::{debug, error, instrument, warn};
use uuid::Uuid;

use super::http_utils::{get_text_checked, get_text_with_direct_fallback};
use super::types::{
    ExperienceSettings, HistoryEntry, LiveBroadcaster, LiveGame, LiveStream, LiveStreamsPage,
    SubEntry, UserInfo, Vod,
};
use super::url_utils::{extract_origin, resolve_url};

use super::error::{AppError, AppResult};

// ── Proxy Manager for Automatic Adblocking ──────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyInfo {
    pub url: String,
    pub country: String,
    pub ping: u64,
}

pub struct ProxyManager {
    client: Client,
    proxies: Arc<RwLock<Vec<ProxyInfo>>>,
    last_refresh: Arc<RwLock<Option<Instant>>>,
    current_proxy: Arc<RwLock<Option<ProxyInfo>>>,
    /// Ensures only ONE refresh runs at a time regardless of concurrent callers
    refresh_lock: Arc<tokio::sync::Mutex<()>>,
}

impl Default for ProxyManager {
    fn default() -> Self {
        Self::new()
    }
}

impl ProxyManager {
    pub fn new() -> Self {
        let client = Client::builder()
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
            .timeout(Duration::from_secs(10))
            .build()
            .unwrap_or_else(|_| Client::new());

        Self {
            client,
            proxies: Arc::new(RwLock::new(Vec::new())),
            last_refresh: Arc::new(RwLock::new(None)),
            current_proxy: Arc::new(RwLock::new(None)),
            refresh_lock: Arc::new(tokio::sync::Mutex::new(())),
        }
    }

    pub async fn get_all_proxies(&self) -> Vec<ProxyInfo> {
        self.proxies.read().await.clone()
    }

    pub async fn get_current_proxy(&self) -> Option<ProxyInfo> {
        self.current_proxy.read().await.clone()
    }

    pub async fn get_proxy(&self, mode: &str, manual_url: Option<&str>) -> Option<String> {
        if mode == "manual" {
            return manual_url.map(|s| s.to_string());
        }

        let should_refresh = {
            let last = self.last_refresh.read().await;
            last.is_none() || last.unwrap().elapsed() > Duration::from_secs(3600)
        };

        if should_refresh {
            // Acquire the mutex — if another refresh is already running, wait for it
            // instead of launching a duplicate scan.
            let _guard = self.refresh_lock.lock().await;
            // Re-check after acquiring — another task may have refreshed while we waited
            let still_needed = {
                let last = self.last_refresh.read().await;
                last.is_none() || last.unwrap().elapsed() > Duration::from_secs(3600)
            };
            if still_needed {
                let _ = self.refresh_proxies().await;
            }
        }

        let proxies = self.proxies.read().await;
        if proxies.is_empty() {
            return None;
        }

        // Return existing current proxy if still in valid list
        {
            let curr = self.current_proxy.read().await;
            if let Some(ref p) = *curr {
                if proxies.iter().any(|x| x.url == p.url) {
                    return Some(p.url.clone());
                }
            }
        }

        // Pick best ping (list is already sorted by refresh_proxies)
        let best = proxies[0].clone();
        {
            let mut curr = self.current_proxy.write().await;
            *curr = Some(best.clone());
        }
        Some(best.url)
    }

    // ── Refresh: collect ALL sources in parallel, merge, probe concurrently, sort by latency ──

    async fn refresh_proxies(&self) -> AppResult<()> {
        // Launch all sources concurrently — proxyscrape + 3 GitHub lists in parallel
        let (scrape_api, scrape_gh) =
            tokio::join!(self.scrape_proxyscrape(), self.scrape_github_proxy_lists(),);

        let mut candidates: Vec<(String, String)> = Vec::new();

        match scrape_api {
            Ok(entries) => {
                eprintln!("[adblock] proxyscrape: {} candidates", entries.len());
                candidates.extend(entries);
            }
            Err(e) => eprintln!("[adblock] proxyscrape error: {e}"),
        }
        match scrape_gh {
            Ok(urls) => {
                eprintln!("[adblock] github lists: {} candidates", urls.len());
                for url in urls {
                    candidates.push((url, "?".to_string()));
                }
            }
            Err(e) => eprintln!("[adblock] github lists error: {e}"),
        }

        // Extra fallback only if both returned nothing
        if candidates.is_empty() {
            return Err(AppError::Internal(
                "No proxy candidates found from any source".to_string(),
            ));
        }

        // Deduplicate, keeping first occurrence (which preserves country tag)
        let mut seen = HashSet::new();
        candidates.retain(|(url, _)| seen.insert(url.clone()));

        eprintln!("[adblock] {} unique candidates to probe", candidates.len());

        if candidates.is_empty() {
            return Err(AppError::Internal(
                "No proxy candidates found from any source".to_string(),
            ));
        }

        // Probe ALL candidates concurrently — no sequential bottleneck
        let candidates: Vec<_> = candidates.into_iter().take(150).collect();
        let mut set = tokio::task::JoinSet::new();

        for (url, country) in candidates {
            set.spawn(async move {
                let ping = Self::probe_proxy(&url).await;
                (url, country, ping)
            });
        }

        let mut working: Vec<ProxyInfo> = Vec::new();
        while let Some(result) = set.join_next().await {
            if let Ok((url, country, Some(ping))) = result {
                working.push(ProxyInfo { url, country, ping });
            }
        }

        eprintln!(
            "[adblock] {}/{} proxies passed probe",
            working.len(),
            seen.len()
        );

        if working.is_empty() {
            return Err(AppError::Internal(
                "No working proxies after probing".to_string(),
            ));
        }

        // Sort by ascending latency so the selector always shows best proxy first
        working.sort_by_key(|p| p.ping);
        {
            let mut p = self.proxies.write().await;
            *p = working;
        }
        {
            let mut last = self.last_refresh.write().await;
            *last = Some(Instant::now());
        }

        Ok(())
    }

    // ── Proxy probe ──────────────────────────────────────────────────────────
    //
    // Uses a plain HTTP target so we never need SSL CONNECT support.
    // Free HTTP proxies reliably forward plain HTTP but often refuse to tunnel
    // HTTPS (CONNECT), which caused 0/N pass rates.
    // Any 2xx/3xx/4xx from the target means the proxy forwarded the request.

    async fn probe_proxy(proxy_url: &str) -> Option<u64> {
        let Ok(proxy) = reqwest::Proxy::http(proxy_url) else {
            return None;
        };
        let Ok(client) = Client::builder()
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
            .timeout(Duration::from_secs(6))
            .proxy(proxy)
            .build()
        else {
            return None;
        };

        let start = Instant::now();
        // Plain HTTP endpoint — lightweight, always reachable, requires no CONNECT
        let result = tokio::time::timeout(
            Duration::from_secs(6),
            client.get("http://api.ipify.org/").send(),
        )
        .await;

        match result {
            // Any response (even 4xx) proves proxy forwarded the packet
            Ok(Ok(resp)) if !resp.status().is_server_error() => {
                Some(start.elapsed().as_millis() as u64)
            }
            _ => None,
        }
    }

    // ── Scrapers ──────────────────────────────────────────────────────────────

    /// proxyscrape.com v2 — no country/timeout filter, maximises candidate count
    async fn scrape_proxyscrape(&self) -> Result<Vec<(String, String)>, String> {
        let url = "https://api.proxyscrape.com/v2/?request=displayproxies\
&protocol=http&timeout=10000&country=all&ssl=all&anonymity=all&simplified=true";
        let resp = self
            .client
            .get(url)
            .header("Accept", "text/plain")
            .send()
            .await
            .map_err(|e| format!("proxyscrape request failed: {e}"))?;

        if !resp.status().is_success() {
            return Err(format!("proxyscrape HTTP {}", resp.status()));
        }

        let text = resp.text().await.map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for line in text.lines() {
            let raw = line.trim();
            if raw.is_empty() || raw.starts_with('#') {
                continue;
            }
            if raw.contains(':') && !raw.contains(' ') {
                out.push((format!("http://{raw}"), "?".to_string()));
            }
        }
        Ok(out)
    }

    /// Raw GitHub proxy lists as last-resort fallback
    async fn scrape_github_proxy_lists(&self) -> Result<Vec<String>, String> {
        let sources = [
            "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt",
            "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt",
            "https://raw.githubusercontent.com/clarketm/proxy-list/master/proxy-list-raw.txt",
        ];

        let mut out = Vec::new();
        for source in sources {
            let Ok(resp) = self.client.get(source).send().await else {
                continue;
            };
            let Ok(text) = resp.text().await else {
                continue;
            };
            for line in text.lines() {
                let raw = line.trim();
                if raw.is_empty() || raw.starts_with('#') {
                    continue;
                }
                if raw.starts_with("http://") || raw.starts_with("socks") {
                    out.push(raw.to_string());
                } else if raw.contains(':') && !raw.contains(' ') {
                    out.push(format!("http://{raw}"));
                }
                if out.len() >= 300 {
                    break;
                }
            }
            if out.len() >= 300 {
                break;
            }
        }

        if out.is_empty() {
            return Err("No proxies in GitHub lists".to_string());
        }
        Ok(out)
    }
}

// ── Shared Twitch service state ────────────────────────────────────────────────

pub struct TwitchService {
    /// Specialized client with Android TV User-Agent for GQL and playback APIs
    android_tv_client: Client,
    /// Shared client for general API and OAuth requests (Twitch Helix, token exchange, etc.)
    shared_client: Client,
    /// Automatic proxy manager
    proxy_manager: Arc<ProxyManager>,
    /// Cache for proxy clients (proxy_url -> Client)
    proxy_clients: Arc<tokio::sync::RwLock<HashMap<String, Client>>>,

    // Specialized type-safe caches
    user_cache: Cache<String, UserInfo>,
    vod_cache: Cache<String, Vec<Vod>>,
    live_stream_cache: Cache<String, Option<LiveStream>>,
    live_page_cache: Cache<String, LiveStreamsPage>,
    related_channels_cache: Cache<String, Vec<String>>,
    generic_value_cache: Cache<String, Value>,
    master_playlist_cache: Cache<String, String>,

    /// Short-lived cache for variant proxy targets (UUID -> sanitized URL).
    variant_cache: Cache<String, String>,
}

const LIVE_STATUS_CONCURRENCY: usize = 12;
const RELATED_CHANNELS_CONCURRENCY: usize = 8;
const TRENDING_GAMES_CONCURRENCY: usize = 8;
const TRENDING_CHANNELS_CONCURRENCY: usize = 10;

impl Default for TwitchService {
    fn default() -> Self {
        Self::new()
    }
}

const ANDROID_TV_UA: &str = "Mozilla/5.0 (Linux; Android 9; SHIELD Android TV Build/PPR1.180610.011; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/68.0.3440.70 Mobile Safari/537.36";
const ANDROID_TV_CLIENT_ID: &str = "ue6666qo983tsx6so1t0vnawi233wa";

impl TwitchService {
    pub fn new() -> Self {
        let android_tv_client = Client::builder()
            .user_agent(ANDROID_TV_UA)
            .timeout(Duration::from_secs(15))
            .build()
            .unwrap_or_else(|_| Client::new());

        let shared_client = Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .unwrap_or_else(|_| Client::new());

        Self {
            android_tv_client,
            shared_client,
            proxy_manager: Arc::new(ProxyManager::new()),
            proxy_clients: Arc::new(tokio::sync::RwLock::new(HashMap::new())),
            user_cache: Cache::builder()
                .max_capacity(500)
                .time_to_live(Duration::from_secs(3600))
                .build(),
            vod_cache: Cache::builder()
                .max_capacity(200)
                .time_to_live(Duration::from_secs(600))
                .build(),
            live_stream_cache: Cache::builder()
                .max_capacity(500)
                .time_to_live(Duration::from_secs(20))
                .build(),
            live_page_cache: Cache::builder()
                .max_capacity(100)
                .time_to_live(Duration::from_secs(30))
                .build(),
            related_channels_cache: Cache::builder()
                .max_capacity(200)
                .time_to_live(Duration::from_secs(86400))
                .build(),
            generic_value_cache: Cache::builder()
                .max_capacity(100)
                .time_to_live(Duration::from_secs(120))
                .build(),
            master_playlist_cache: Cache::builder()
                .max_capacity(600)
                .time_to_live(Duration::from_secs(120))
                .build(),
            variant_cache: Cache::builder()
                .max_capacity(8000)
                .time_to_live(Duration::from_secs(21600))
                .build(),
        }
    }

    pub fn shared_client(&self) -> &Client {
        &self.shared_client
    }

    pub async fn get_all_proxies(&self) -> Vec<ProxyInfo> {
        self.proxy_manager.get_all_proxies().await
    }

    pub async fn get_current_proxy(&self) -> Option<ProxyInfo> {
        self.proxy_manager.get_current_proxy().await
    }

    pub fn refresh_adblock_proxy_state(&self) {
        // try_lock: if a refresh is already in flight, skip — avoids N parallel scans
        // when the Settings page polls every 5 s.
        if let Ok(_lock) = self.proxy_manager.refresh_lock.try_lock() {
            let proxy_manager = self.proxy_manager.clone();
            async_runtime::spawn(async move {
                let _ = proxy_manager.get_proxy("auto", None).await;
            });
        }
    }

    async fn get_client(&self, settings: &ExperienceSettings) -> Client {
        if !settings.adblock_enabled {
            return self.android_tv_client.clone();
        }

        let mode = settings.adblock_proxy_mode.as_deref().unwrap_or("auto");
        let manual_url = settings.adblock_proxy.as_deref();

        let proxy_url = self.proxy_manager.get_proxy(mode, manual_url).await;

        let Some(proxy) = proxy_url else {
            return self.android_tv_client.clone();
        };

        {
            let clients = self.proxy_clients.read().await;
            if let Some(c) = clients.get(&proxy) {
                return c.clone();
            }
        }

        let mut clients = self.proxy_clients.write().await;
        if let Some(c) = clients.get(&proxy) {
            return c.clone();
        }

        let new_client = match reqwest::Proxy::all(&proxy) {
            Ok(proxy_cfg) => Client::builder()
                .user_agent(ANDROID_TV_UA)
                .timeout(Duration::from_secs(15))
                .proxy(proxy_cfg)
                .build()
                .unwrap_or_else(|_| self.android_tv_client.clone()),
            Err(_) => self.android_tv_client.clone(),
        };

        clients.insert(proxy, new_client.clone());
        new_client
    }

    async fn fetch_segment_with_fallback(
        &self,
        target_url: &str,
        preferred_client: &Client,
    ) -> AppResult<reqwest::Response> {
        let attempts = [
            ("preferred", preferred_client.clone()),
            ("android_tv", self.android_tv_client.clone()),
            ("shared", self.shared_client.clone()),
        ];

        let mut last_error: Option<AppError> = None;

        for (idx, (label, client)) in attempts.into_iter().enumerate() {
            match client.get(target_url).send().await {
                Ok(response) if response.status().is_success() => {
                    if idx > 0 {
                        warn!(
                            stage = label,
                            "Recovered segment fetch with fallback client"
                        );
                    }
                    return Ok(response);
                }
                Ok(response) => {
                    let status = response.status();
                    warn!(
                        stage = label,
                        %status,
                        "Segment upstream returned non-success status"
                    );
                    last_error = Some(AppError::TwitchApi(format!(
                        "Segment upstream returned {status}"
                    )));
                }
                Err(fetch_error) => {
                    warn!(
                        stage = label,
                        error = %fetch_error,
                        "Segment fetch attempt failed"
                    );
                    last_error = Some(AppError::from(fetch_error));
                }
            }
        }

        Err(last_error.unwrap_or_else(|| {
            AppError::Internal("Segment fetch failed after all fallbacks".to_string())
        }))
    }

    #[instrument(skip(self, settings), fields(proxy_id = %proxy_id))]
    pub async fn proxy_segment(
        &self,
        proxy_id: &str,
        settings: &ExperienceSettings,
    ) -> AppResult<reqwest::Response> {
        debug!("Proxying media segment");
        let target_url = resolve_variant_proxy_target(&self.variant_cache, proxy_id).await?;

        let client = self.get_client(settings).await;

        self.fetch_segment_with_fallback(&target_url, &client)
            .await
            .map_err(|e| {
                error!(error = %e, "Failed to proxy segment");
                e
            })
    }

    pub async fn proxy_segment_url(
        &self,
        target_url: &str,
        settings: &ExperienceSettings,
    ) -> AppResult<reqwest::Response> {
        debug!("Proxying media segment via direct URL query");
        let target_url = validate_variant_target_url(target_url)?;
        let client = self.get_client(settings).await;

        self.fetch_segment_with_fallback(&target_url, &client)
            .await
            .map_err(|e| {
                error!(error = %e, "Failed to proxy segment by URL");
                e
            })
    }

    // ── GQL helpers ──────────────────────────────────────────────────────────

    async fn gql_post(&self, body: &str) -> AppResult<Value> {
        let resp = self
            .android_tv_client
            .post("https://gql.twitch.tv/gql")
            .header("Client-Id", ANDROID_TV_CLIENT_ID)
            .header("Accept", "application/json")
            .header("Content-Type", "application/json")
            .body(body.to_string())
            .send()
            .await?;

        if !resp.status().is_success() {
            return Err(AppError::TwitchApi(format!(
                "Twitch API HTTP {}",
                resp.status()
            )));
        }

        resp.json::<Value>().await.map_err(AppError::from)
    }
}

// ── Free utility functions ────────────────────────────────────────────────────

fn gql_escape(value: &str) -> String {
    // JSON-encode and strip surrounding quotes
    serde_json::to_string(value)
        .map(|s| s[1..s.len() - 1].to_string())
        .unwrap_or_else(|_| value.to_string())
}

fn create_serving_id() -> String {
    Uuid::new_v4().to_string().replace('-', "")
}

fn create_simple_hash(value: &str) -> String {
    let mut hash: i32 = 0;
    for (i, ch) in value.chars().enumerate() {
        if i >= 10000 {
            break;
        }
        hash = hash
            .wrapping_shl(5)
            .wrapping_sub(hash)
            .wrapping_add(ch as i32);
    }
    hash.unsigned_abs().to_string()
}

fn clamp(value: f64, min: f64, max: f64) -> f64 {
    value.max(min).min(max)
}

fn parse_timecode_seconds(value: &Value) -> Option<f64> {
    if let Some(v) = value.as_f64() {
        return Some(v);
    }

    if let Some(v) = value.as_i64() {
        return Some(v as f64);
    }

    let raw = value.as_str()?.trim();
    if raw.is_empty() {
        return None;
    }

    if let Ok(v) = raw.parse::<f64>() {
        return Some(v);
    }

    let mut total = 0.0;
    let mut units = 0_i32;
    for part in raw.split(':').rev() {
        let unit = part.trim().parse::<f64>().ok()?;
        total += unit * 60_f64.powi(units);
        units += 1;
    }

    if units == 0 {
        return None;
    }

    Some(total)
}

fn normalize_language(language: Option<&str>) -> String {
    language.unwrap_or("").trim().to_lowercase()
}

fn get_watch_weight(entry: &HistoryEntry) -> f64 {
    if entry.duration <= 0.0 {
        return clamp(entry.timecode / 1800.0, 0.05, 1.0);
    }
    clamp(entry.timecode / entry.duration, 0.05, 1.0)
}

fn parse_vod_url_info(seek_previews_url: &str) -> AppResult<(String, String)> {
    let after_scheme = seek_previews_url
        .find("//")
        .map(|i| &seek_previews_url[i + 2..])
        .ok_or_else(|| AppError::BadRequest("No '//' found in URL".to_string()))?;

    let domain_end = after_scheme
        .find('/')
        .ok_or_else(|| AppError::BadRequest("No path separator found".to_string()))?;
    let domain = after_scheme[..domain_end].to_string();
    let path = &after_scheme[domain_end..];

    let parts: Vec<&str> = path.split('/').collect();
    let storyboard_idx = parts
        .iter()
        .position(|p| p.contains("storyboards"))
        .ok_or_else(|| AppError::BadRequest("Cannot find storyboards in URL".to_string()))?;

    if storyboard_idx == 0 {
        return Err(AppError::BadRequest("storyboards at root".to_string()));
    }

    let vod_special_id = parts[storyboard_idx - 1].to_string();
    if vod_special_id.is_empty() {
        return Err(AppError::BadRequest("Empty vodSpecialID".to_string()));
    }

    Ok((domain, vod_special_id))
}

fn build_stream_url(
    domain: &str,
    vod_special_id: &str,
    res_key: &str,
    vod_id: &str,
    broadcast_type: &str,
    days_diff: f64,
    channel_login: &str,
) -> String {
    if broadcast_type == "highlight" {
        return format!("https://{domain}/{vod_special_id}/{res_key}/highlight-{vod_id}.m3u8");
    }
    if broadcast_type == "upload" && days_diff > 7.0 {
        return format!(
            "https://{domain}/{channel_login}/{vod_id}/{vod_special_id}/{res_key}/index-dvr.m3u8"
        );
    }
    format!("https://{domain}/{vod_special_id}/{res_key}/index-dvr.m3u8")
}

fn quality_bandwidth_bps(res_key: &str, fps: u32, resolution: &str) -> u64 {
    match res_key {
        // "chunked" is the source quality for Twitch VODs.
        "chunked" => 8_500_000,
        "1080p60" => 6_000_000,
        "720p60" => 4_500_000,
        "480p30" => 1_600_000,
        "360p30" => 900_000,
        "160p30" => 250_000,
        _ => {
            let height = resolution
                .split('x')
                .nth(1)
                .and_then(|v| v.parse::<u32>().ok())
                .unwrap_or(720);

            // Conservative fallback so unknown labels still sort correctly in ABR.
            match (height, fps) {
                (h, f) if h >= 1080 && f >= 50 => 6_000_000,
                (h, _) if h >= 1080 => 4_500_000,
                (h, f) if h >= 720 && f >= 50 => 4_000_000,
                (h, _) if h >= 720 => 2_800_000,
                (h, _) if h >= 480 => 1_600_000,
                (h, _) if h >= 360 => 900_000,
                _ => 300_000,
            }
        }
    }
}

// ── Variant proxy validation ──────────────────────────────────────────────────

fn validate_variant_target_url(url: &str) -> AppResult<String> {
    let parsed =
        reqwest::Url::parse(url).map_err(|_| AppError::BadRequest("Invalid URL".to_string()))?;

    if parsed.scheme() != "https" {
        return Err(AppError::BadRequest(
            "Only HTTPS URLs are allowed".to_string(),
        ));
    }

    let hostname = parsed.host_str().unwrap_or("").to_lowercase();

    let allowed_suffixes = [".ttvnw.net", ".twitch.tv", ".jtvnw.net", ".cloudfront.net"];
    let allowed_exact = ["ttvnw.net", "twitch.tv", "jtvnw.net", "cloudfront.net"];

    let is_allowed = allowed_exact.contains(&hostname.as_str())
        || allowed_suffixes.iter().any(|s| hostname.ends_with(s));

    if !is_allowed {
        return Err(AppError::BadRequest(format!("Disallowed host: {hostname}")));
    }

    let path = parsed.path().to_lowercase();

    let is_live_hls = path.contains("/api/channel/hls/") && path.ends_with(".m3u8");
    let is_vod_path = path.starts_with("/vod/");
    let is_chunked = path.starts_with("/chunked/");
    let is_m3u8 = path.ends_with(".m3u8");
    let is_media_segment = [
        ".ts", ".m4s", ".mp4", ".aac", ".mp3", ".vtt", ".webvtt", ".key",
    ]
    .iter()
    .any(|ext| path.ends_with(ext));

    if !is_live_hls && !is_vod_path && !is_chunked && !is_m3u8 && !is_media_segment {
        return Err(AppError::BadRequest("Disallowed target path".to_string()));
    }

    // Keep original query parameters after host/path validation.
    // Twitch variant and segment URLs can require dynamic parameters not known in advance.
    Ok(parsed.to_string())
}

fn urlencoding_simple(s: &str) -> String {
    // Minimal percent-encoding for query string values
    let mut out = String::new();
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'.' || b == b'~' {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{:02X}", b));
        }
    }
    out
}

async fn rewrite_tag_uri_with_proxy(line: &str, base_url: &str, token: &str) -> String {
    if !line.contains("URI=\"") {
        return line.to_string();
    }

    let mut result = String::new();
    let mut cursor = 0usize;

    while cursor < line.len() {
        if let Some(start_rel) = line[cursor..].find("URI=\"") {
            let start = cursor + start_rel;
            let value_start = start + 5;

            result.push_str(&line[cursor..value_start]);

            if let Some(end_rel) = line[value_start..].find('"') {
                let value_end = value_start + end_rel;
                let uri = &line[value_start..value_end];

                let abs_url = if uri.starts_with("http://") || uri.starts_with("https://") {
                    uri.to_string()
                } else {
                    resolve_url(uri, &extract_origin(base_url), base_url).into_owned()
                };

                let rewritten = match validate_variant_target_url(&abs_url) {
                    Ok(sanitized) => {
                        let encoded = urlencoding::encode(&sanitized);
                        format!("/api/stream/variant.ts?url={encoded}&t={}", token)
                    }
                    Err(_) => abs_url,
                };

                result.push_str(&rewritten);
                cursor = value_end;
                continue;
            }
        }

        result.push_str(&line[cursor..]);
        break;
    }

    result
}

// ── Quality check helper ──────────────────────────────────────────────────────

async fn is_valid_quality(client: &Client, url: &str) -> Option<String> {
    let resp = tokio::time::timeout(Duration::from_secs(12), client.get(url).send())
        .await
        .ok()?
        .ok()?;

    if !resp.status().is_success() {
        return None;
    }

    let text = resp.text().await.ok()?;

    if text.contains(".ts") {
        return Some("avc1.4D001E".to_string());
    }

    if text.contains(".mp4") {
        let init_url = url.replace("index-dvr.m3u8", "init-0.mp4");
        let codec = if let Ok(Ok(init_resp)) =
            tokio::time::timeout(Duration::from_secs(12), client.get(&init_url).send()).await
        {
            if let Ok(body) = init_resp.text().await {
                if body.contains("hev1") {
                    "hev1.1.6.L93.B0".to_string()
                } else {
                    "avc1.4D001E".to_string()
                }
            } else {
                "hev1.1.6.L93.B0".to_string()
            }
        } else {
            "hev1.1.6.L93.B0".to_string()
        };
        return Some(codec);
    }

    None
}

// ── Variant proxy storage helpers ────────────────────────────────────────────

async fn register_variant_proxy_target(
    variant_cache: &Cache<String, String>,
    target_url: &str,
) -> AppResult<String> {
    let sanitized = validate_variant_target_url(target_url)?;

    let target_key = {
        let mut hasher = Sha256::new();
        hasher.update(sanitized.as_bytes());
        let digest = hasher.finalize();
        format!("variant_target_{:x}", digest)
    };

    if let Some(existing_id) = variant_cache.get(&target_key).await {
        if RE_UUID_V4.is_match(existing_id.trim()) {
            let proxy_key = format!("variant_proxy_{}", existing_id.trim());
            if variant_cache.get(&proxy_key).await.is_some() {
                return Ok(existing_id.trim().to_string());
            }
        }
    }

    let proxy_id = Uuid::new_v4().to_string();
    variant_cache
        .insert(format!("variant_proxy_{proxy_id}"), sanitized)
        .await;
    variant_cache.insert(target_key, proxy_id.clone()).await;

    Ok(proxy_id)
}

static RE_UUID_V4: Lazy<regex::Regex> = Lazy::new(|| {
    regex::Regex::new(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
        .unwrap()
});

static RE_TWITCH_LOGIN: Lazy<regex::Regex> =
    Lazy::new(|| regex::Regex::new(r"^[a-z0-9_]{2,25}$").unwrap());

static RE_VOD_ID_SAFE: Lazy<regex::Regex> =
    Lazy::new(|| regex::Regex::new(r"^[a-zA-Z0-9_-]+$").unwrap());

async fn resolve_variant_proxy_target(
    variant_cache: &Cache<String, String>,
    proxy_id: &str,
) -> AppResult<String> {
    let normalized = proxy_id.trim();
    if !RE_UUID_V4.is_match(normalized) {
        return Err(AppError::BadRequest("Invalid variant proxy id".to_string()));
    }

    variant_cache
        .get(&format!("variant_proxy_{normalized}"))
        .await
        .ok_or_else(|| AppError::NotFound("Variant proxy target not found or expired".to_string()))
}

async fn fetch_variant_playlist_text(
    primary_client: &Client,
    fallback_client: &Client,
    shared_client: &Client,
    url: &str,
) -> AppResult<String> {
    match get_text_with_direct_fallback(primary_client, fallback_client, url, "variant").await {
        Ok(text) => Ok(text),
        Err(primary_error) => {
            eprintln!(
                "[adblock] variant fallback (android-tv) failed ({primary_error}), retrying shared client"
            );
            get_text_checked(shared_client, url).await
        }
    }
}

async fn rewrite_master_with_proxy(
    master: &str,
    _host: &str,
    source_master_url: &str,
    variant_cache: &Cache<String, String>,
    token: &str,
) -> String {
    let origin = extract_origin(source_master_url);
    let mut lines: Vec<String> = master
        .split('\n')
        .map(|l| l.trim_end_matches('\r').to_string())
        .collect();

    for line_entry in lines.iter_mut() {
        let line = line_entry.trim().to_string();
        if line.is_empty() {
            continue;
        }

        if line.starts_with('#') && line.contains("URI=\"") {
            // Rewrite URI="..." references
            let new_line = line.clone();
            // Find all URI="..." occurrences
            let mut result = String::new();
            let mut cursor = 0;
            while cursor < new_line.len() {
                if let Some(start) = new_line[cursor..].find("URI=\"") {
                    let abs_start = cursor + start + 5; // after URI="
                    if let Some(end_offset) = new_line[abs_start..].find('"') {
                        let uri = &new_line[abs_start..abs_start + end_offset];
                        let abs_url = resolve_url(uri, &origin, source_master_url);
                        let proxy_url =
                            match register_variant_proxy_target(variant_cache, &abs_url).await {
                                Ok(pid) => format!(
                                    "/api/stream/variant.m3u8?id={}&t={}",
                                    urlencoding_simple(&pid),
                                    token
                                ),
                                Err(_) => abs_url.into_owned(),
                            };
                        result.push_str(&new_line[cursor..abs_start]);
                        result.push_str(&proxy_url);
                        cursor = abs_start + end_offset;
                        continue;
                    }
                }
                result.push_str(&new_line[cursor..]);
                break;
            }
            if !result.is_empty() {
                *line_entry = result;
            }
        } else if !line.starts_with('#') {
            let abs_url = resolve_url(&line, &origin, source_master_url);
            if let Ok(proxy_id) = register_variant_proxy_target(variant_cache, &abs_url).await {
                *line_entry = format!(
                    "/api/stream/variant.m3u8?id={}&t={}",
                    urlencoding_simple(&proxy_id),
                    token
                );
            }
        }
    }

    lines.join("\n")
}

// ── Scored VOD for recommendations ───────────────────────────────────────────

#[derive(Clone)]
struct ScoredVod {
    vod: Vod,
    score: f64,
}

struct PreferenceProfile {
    game_scores: HashMap<String, f64>,
    channel_scores: HashMap<String, f64>,
    language_scores: HashMap<String, f64>,
}

fn build_preference_profile(
    history: &HashMap<String, HistoryEntry>,
    watched_vods: &[Vod],
    subs: &[SubEntry],
) -> PreferenceProfile {
    let mut game_scores: HashMap<String, f64> = HashMap::new();
    let mut channel_scores: HashMap<String, f64> = HashMap::new();
    let mut language_scores: HashMap<String, f64> = HashMap::new();

    let history_by_id: HashMap<&str, &HistoryEntry> =
        history.iter().map(|(k, v)| (k.as_str(), v)).collect();

    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as f64;

    for vod in watched_vods {
        let Some(entry) = history_by_id.get(vod.id.as_str()) else {
            continue;
        };

        let watch_weight = get_watch_weight(entry);
        let age_ms = now_ms - entry.updated_at as f64;
        let recency_penalty = clamp(
            1.0 - age_ms / (1000.0 * 60.0 * 60.0 * 24.0 * 45.0),
            0.35,
            1.0,
        );
        let weighted = watch_weight * recency_penalty;

        if let Some(game) = &vod.game {
            if !game.name.is_empty() {
                *game_scores.entry(game.name.clone()).or_insert(0.0) += weighted;
            }
        }

        if let Some(owner) = &vod.owner {
            let login = owner.login.to_lowercase();
            if !login.is_empty() {
                *channel_scores.entry(login).or_insert(0.0) += weighted;
            }
        }

        let lang = normalize_language(vod.language.as_deref());
        if !lang.is_empty() {
            *language_scores.entry(lang).or_insert(0.0) += weighted;
        }
    }

    for sub in subs {
        let login = sub.login.to_lowercase();
        *channel_scores.entry(login).or_insert(0.0) += 1.75;
    }

    let fr_score = language_scores.get("fr").copied().unwrap_or(0.0);
    if fr_score < 1.2 {
        language_scores.insert("fr".to_string(), fr_score + 1.2);
    }

    PreferenceProfile {
        game_scores,
        channel_scores,
        language_scores,
    }
}

fn score_candidate_vod(
    vod: &Vod,
    profile: &PreferenceProfile,
    subs_set: &std::collections::HashSet<String>,
) -> f64 {
    // ── Quality gate ──────────────────────────────────────────────────────────
    // VODs under 10 minutes or with very few views are ranked near-zero.
    let length_secs = vod.length_seconds as f64;
    let length_factor = if length_secs < 60.0 {
        // Under 1 min → essentially invisible
        0.01
    } else if length_secs < 600.0 {
        // 1–10 min: quadratic ramp capped at 0.18
        let ratio = (length_secs - 60.0) / 540.0; // 0..1 over [1min, 10min]
        0.01 + 0.17 * ratio * ratio
    } else if length_secs < 1800.0 {
        // 10–30 min: linear ramp from 0.18 to 1.0
        0.18 + 0.82 * (length_secs - 600.0) / 1200.0
    } else {
        1.0
    };

    let view_factor = if vod.view_count == 0 {
        0.04
    } else if vod.view_count < 5 {
        0.04 + 0.46 * (vod.view_count as f64 / 5.0)
    } else if vod.view_count < 50 {
        0.5 + 0.5 * (vod.view_count as f64 / 50.0)
    } else {
        1.0
    };

    // If quality gate blocks strongly, bail early to save computation
    let quality = length_factor * view_factor;
    if quality < 0.05 {
        return quality;
    }

    // ── Signal computation ────────────────────────────────────────────────────
    let game_name = vod.game.as_ref().map(|g| g.name.as_str()).unwrap_or("");
    let channel_login = vod
        .owner
        .as_ref()
        .map(|o| o.login.to_lowercase())
        .unwrap_or_default();
    let language = normalize_language(vod.language.as_deref());

    // Popularity signal: log-scaled, mild influence to avoid pure viral bias
    let popularity = (vod.view_count as f64 + 10.0).log10() * 1.15;

    // Personalisation signals
    let game_affinity = profile.game_scores.get(game_name).copied().unwrap_or(0.0) * 2.1;
    let channel_affinity = profile
        .channel_scores
        .get(channel_login.as_str())
        .copied()
        .unwrap_or(0.0)
        * 2.4;
    let lang_affinity = profile
        .language_scores
        .get(language.as_str())
        .copied()
        .unwrap_or(0.0)
        * 1.15;

    // Boosts
    let fr_boost = if language == "fr" { 2.3 } else { 0.0 };
    let sub_boost = if subs_set.contains(&channel_login) {
        3.2
    } else {
        0.0
    };

    // Recency signal: VODs older than ~19 days score 0 here
    let vod_age_days = chrono_days_since_str(&vod.created_at);
    let recency = clamp(2.1 - vod_age_days / 9.0, 0.0, 2.1);

    // Diversity bonus: slightly reward content from niche/low-count channels
    // by not artificially boosting already-popular ones beyond their popularity signal.
    // (Achieved implicitly: game_affinity is bounded by profile scores, not raw view counts.)

    let base_score = popularity
        + game_affinity
        + channel_affinity
        + lang_affinity
        + fr_boost
        + sub_boost
        + recency;

    base_score * quality
}

fn chrono_days_since_str(date_str: &str) -> f64 {
    // Parse ISO 8601 date string and return days since then
    // Using a simple approach since we don't have chrono
    let now_secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs_f64();

    if let Ok(ts) = parse_iso8601_to_epoch(date_str) {
        let diff_secs = (now_secs - ts).max(0.0);
        clamp(diff_secs / 86400.0, 0.0, 60.0)
    } else {
        0.0
    }
}

fn parse_iso8601_to_epoch(s: &str) -> Result<f64, ()> {
    // Minimal ISO 8601 parser for "2024-01-15T10:30:00Z" style dates
    // Format: "YYYY-MM-DDTHH:MM:SSZ" or "YYYY-MM-DDTHH:MM:SS.mmmZ"
    let s = s.trim_end_matches('Z');
    let date_time: Vec<&str> = s.splitn(2, 'T').collect();
    if date_time.len() != 2 {
        return Err(());
    }
    let date_parts: Vec<u32> = date_time[0]
        .split('-')
        .filter_map(|p| p.parse().ok())
        .collect();
    if date_parts.len() != 3 {
        return Err(());
    }
    let time_str = date_time[1].split('.').next().unwrap_or("0:0:0");
    let time_parts: Vec<u32> = time_str.split(':').filter_map(|p| p.parse().ok()).collect();
    if time_parts.len() != 3 {
        return Err(());
    }

    // Approximate: days from epoch using simple calculation
    let (y, m, d) = (
        date_parts[0] as i64,
        date_parts[1] as i64,
        date_parts[2] as i64,
    );
    let (h, min, sec) = (
        time_parts[0] as i64,
        time_parts[1] as i64,
        time_parts[2] as i64,
    );

    // Days from 1970-01-01 using Gregorian calendar
    let days = days_from_civil(y, m, d);
    let epoch_secs = days * 86400 + h * 3600 + min * 60 + sec;
    Ok(epoch_secs as f64)
}

fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe - 719468
}

fn interleave_localized_feed(
    candidates: Vec<ScoredVod>,
    foreign_ratio: f64,
    max_items: usize,
) -> Vec<Vod> {
    let (mut french, mut foreign): (Vec<ScoredVod>, Vec<ScoredVod>) = candidates
        .into_iter()
        .partition(|v| normalize_language(v.vod.language.as_deref()) == "fr");

    french.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    foreign.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let mut feed: Vec<ScoredVod> = Vec::with_capacity(max_items);
    let mut fi = 0usize;
    let mut foi = 0usize;
    let mut foreign_added = 0usize;

    while feed.len() < max_items && (fi < french.len() || foi < foreign.len()) {
        let last_four: Vec<bool> = feed
            .iter()
            .rev()
            .take(4)
            .map(|v| normalize_language(v.vod.language.as_deref()) == "fr")
            .collect();

        let french_streak = last_four.len() == 4 && last_four.iter().all(|&b| b);
        let foreign_streak = !last_four.is_empty() && last_four.iter().all(|&b| !b);
        let target_foreign = ((feed.len() + 1) as f64 * foreign_ratio).floor() as usize;

        let should_pick_foreign = !foreign_streak
            && foi < foreign.len()
            && (foreign_added < target_foreign || fi >= french.len() || french_streak);

        if should_pick_foreign {
            feed.push(foreign[foi].clone());
            foi += 1;
            foreign_added += 1;
        } else if fi < french.len() {
            feed.push(french[fi].clone());
            fi += 1;
        } else if foi < foreign.len() {
            feed.push(foreign[foi].clone());
            foi += 1;
            foreign_added += 1;
        }
    }

    feed.into_iter().map(|sv| sv.vod).collect()
}

// ── Public API ────────────────────────────────────────────────────────────────

impl TwitchService {
    pub async fn fetch_game_vods(
        &self,
        game_name: &str,
        languages: Option<Vec<String>>,
        first: usize,
    ) -> Vec<Vod> {
        let cache_key = format!(
            "game_vods_{}_{:?}_{}",
            create_simple_hash(game_name),
            languages,
            first
        );
        if let Some(cached) = self.vod_cache.get(&cache_key).await {
            return cached;
        }

        let lang_filter = languages
            .as_ref()
            .map(|langs| {
                let json = serde_json::to_string(langs).unwrap_or_default();
                format!(", languages: {json}")
            })
            .unwrap_or_default();

        let query = format!(
            r#"{{"query":"query {{ game(name: \"{}\") {{ videos(first: {}{}) {{ edges {{ node {{ id, title, lengthSeconds, previewThumbnailURL(width: 320, height: 180), createdAt, viewCount, broadcastType, language, game {{ name }}, owner {{ login, displayName, profileImageURL(width: 50) }} }} }} }} }} }}"}}"#,
            gql_escape(game_name),
            first,
            lang_filter
        );

        let result = match self.gql_post(&query).await {
            Ok(data) => data["data"]["game"]["videos"]["edges"]
                .as_array()
                .map(|arr| {
                    arr.iter()
                        .filter_map(|e| {
                            let vod = serde_json::from_value::<Vod>(e["node"].clone()).ok()?;
                            if vod.is_valid() {
                                Some(vod)
                            } else {
                                None
                            }
                        })
                        .collect()
                })
                .unwrap_or_default(),
            Err(_) => vec![],
        };

        if !result.is_empty() {
            self.vod_cache.insert(cache_key, result.clone()).await;
        }
        result
    }

    /// Paginated category VODs: returns (vods, next_cursor, has_more)
    pub async fn fetch_category_vods_page(
        &self,
        game_name: &str,
        game_id: Option<&str>,
        first: usize,
        after: Option<&str>,
    ) -> (Vec<Vod>, Option<String>, bool) {
        let safe_first = first.clamp(4, 50);
        let escaped = gql_escape(game_name);
        let safe_game_id = game_id.unwrap_or("").trim().to_string();
        let safe_after = after.unwrap_or("").trim().to_string();

        let after_clause = if safe_after.is_empty() {
            String::new()
        } else {
            let esc = serde_json::to_string(&safe_after).unwrap_or_default();
            format!(", after: {esc}")
        };

        let query_by_name = || {
            format!(
                r#"{{"query":"query {{ game(name: \"{escaped}\") {{ videos(first: {safe_first}{after_clause}) {{ edges {{ cursor node {{ id, title, lengthSeconds, previewThumbnailURL(width: 320, height: 180), createdAt, viewCount, broadcastType, language, game {{ name }}, owner {{ login, displayName, profileImageURL(width: 50) }} }} }} pageInfo {{ hasNextPage }} }} }} }}"}}"#
            )
        };

        let data = if !safe_game_id.is_empty() {
            let escaped_id = gql_escape(&safe_game_id);
            let query_by_id = format!(
                r#"{{"query":"query {{ game(id: \"{escaped_id}\") {{ videos(first: {safe_first}{after_clause}) {{ edges {{ cursor node {{ id, title, lengthSeconds, previewThumbnailURL(width: 320, height: 180), createdAt, viewCount, broadcastType, language, game {{ name }}, owner {{ login, displayName, profileImageURL(width: 50) }} }} }} pageInfo {{ hasNextPage }} }} }} }}"}}"#
            );

            match self.gql_post(&query_by_id).await {
                Ok(by_id) if !by_id["data"]["game"].is_null() => by_id,
                _ => match self.gql_post(&query_by_name()).await {
                    Ok(by_name) => by_name,
                    Err(_) => return (vec![], None, false),
                },
            }
        } else {
            match self.gql_post(&query_by_name()).await {
                Ok(by_name) => by_name,
                Err(_) => return (vec![], None, false),
            }
        };

        let edges = match data["data"]["game"]["videos"]["edges"].as_array() {
            Some(a) => a.clone(),
            None => return (vec![], None, false),
        };

        let vods: Vec<Vod> = edges
            .iter()
            .filter_map(|e| {
                let vod = serde_json::from_value::<Vod>(e["node"].clone()).ok()?;
                if vod.is_valid() {
                    Some(vod)
                } else {
                    None
                }
            })
            .collect();

        let last_cursor = edges
            .last()
            .and_then(|e| e["cursor"].as_str())
            .map(|s| s.to_string());
        let has_next = data["data"]["game"]["videos"]["pageInfo"]["hasNextPage"]
            .as_bool()
            .unwrap_or(false);

        (vods, if has_next { last_cursor } else { None }, has_next)
    }

    pub async fn fetch_game_vods_by_name(&self, game_name: &str, first: usize) -> Vec<Vod> {
        let (fr_first, global_pool) = tokio::join!(
            self.fetch_game_vods(game_name, Some(vec!["fr".to_string()]), first),
            self.fetch_game_vods(game_name, None, first),
        );

        let mut deduped: HashMap<String, Vod> = HashMap::new();
        for vod in fr_first.into_iter().chain(global_pool) {
            if !vod.id.is_empty() && !deduped.contains_key(&vod.id) {
                deduped.insert(vod.id.clone(), vod);
            }
        }

        deduped.into_values().take(first).collect()
    }

    pub async fn fetch_watched_vod_metadata(&self, vod_ids: &[String]) -> Vec<Vod> {
        if vod_ids.is_empty() {
            return vec![];
        }

        let safe_ids: Vec<&str> = vod_ids
            .iter()
            .map(|id| id.trim())
            .filter(|id| !id.is_empty() && id.chars().all(|c| c.is_ascii_digit()))
            .take(30)
            .collect();

        if safe_ids.is_empty() {
            return vec![];
        }

        let fields = r#"id, title, lengthSeconds, previewThumbnailURL(width: 320, height: 180), createdAt, viewCount, broadcastType, language, game { name }, owner { login, displayName, profileImageURL(width: 50) }"#;
        let query_body = safe_ids
            .iter()
            .enumerate()
            .map(|(i, id)| format!(r#"v{i}: video(id: \"{id}\") {{ {fields} }}"#))
            .collect::<Vec<_>>()
            .join(" ");

        let body = format!(r#"{{"query":"query {{ {query_body} }}"}}"#);
        let Ok(data) = self.gql_post(&body).await else {
            return vec![];
        };

        let payload = data["data"].as_object().cloned().unwrap_or_default();
        payload
            .values()
            .filter_map(|v| {
                let vod = serde_json::from_value::<Vod>(v.clone()).ok()?;
                if vod.is_valid() {
                    Some(vod)
                } else {
                    None
                }
            })
            .collect()
    }

    pub async fn fetch_vods_by_ids(&self, vod_ids: Vec<String>) -> Vec<Vod> {
        self.fetch_watched_vod_metadata(&vod_ids).await
    }

    pub async fn fetch_top_live_categories(&self) -> AppResult<Vec<serde_json::Value>> {
        let cache_key = "top_live_categories".to_string();
        if let Some(cached) = self.generic_value_cache.get(&cache_key).await {
            return serde_json::from_value(cached).map_err(AppError::from);
        }

        let body = r#"{"query":"query { topGames(first: 5) { edges { node { id name boxArtURL(width: 80, height: 107) } } } }"}"#.to_string();
        let data = self.gql_post(&body).await?;

        let categories: Vec<serde_json::Value> = data["data"]["topGames"]["edges"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|e| {
                        let node = &e["node"];
                        if node.is_null() {
                            return None;
                        }
                        Some(serde_json::json!({
                            "id": node["id"].as_str().unwrap_or(""),
                            "name": node["name"].as_str().unwrap_or(""),
                            "boxArtURL": node["boxArtURL"].as_str().unwrap_or(""),
                        }))
                    })
                    .collect()
            })
            .unwrap_or_default();

        let val = serde_json::to_value(&categories).unwrap_or_default();
        self.generic_value_cache.insert(cache_key, val).await;
        Ok(categories)
    }

    pub async fn fetch_live_streams_by_category(
        &self,
        category_name: &str,
        first: usize,
        after: Option<&str>,
    ) -> AppResult<LiveStreamsPage> {
        let safe_first = first.clamp(4, 48);
        let safe_after = after.unwrap_or("").trim().to_string();
        let escaped_name = gql_escape(category_name);
        let cache_key = format!(
            "live_cat_{}_{}_{safe_first}",
            create_simple_hash(category_name),
            if safe_after.is_empty() {
                "first"
            } else {
                &safe_after
            }
        );

        if let Some(cached) = self.live_page_cache.get(&cache_key).await {
            return Ok(cached);
        }

        let pagination = if safe_after.is_empty() {
            String::new()
        } else {
            // safe_after might contain base64, which is fine, but we must escape it for the GraphQL string literal
            let escaped = gql_escape(&safe_after);
            format!(r#", after: \"{escaped}\""#)
        };

        let body = format!(
            r#"{{"query":"query {{ game(name: \"{escaped_name}\") {{ streams(first: {safe_first}{pagination}) {{ edges {{ cursor node {{ id title viewersCount previewImageURL(width: 640, height: 360) createdAt language broadcaster {{ id login displayName profileImageURL(width: 70) }} }} }} pageInfo {{ hasNextPage }} }} }} }}"}}"#
        );

        let data = self.gql_post(&body).await?;
        let edges = match data["data"]["game"]["streams"]["edges"].as_array() {
            Some(a) => a.clone(),
            None => {
                return Ok(LiveStreamsPage {
                    items: vec![],
                    next_cursor: None,
                    has_more: false,
                })
            }
        };

        let game_name = category_name.to_string();
        let items: Vec<LiveStream> = edges
            .iter()
            .filter_map(|edge| {
                let node = &edge["node"];
                if node.is_null() || node["broadcaster"]["login"].is_null() {
                    return None;
                }
                Some(LiveStream {
                    id: node["id"].as_str().unwrap_or("").to_string(),
                    title: node["title"].as_str().unwrap_or("Live stream").to_string(),
                    preview_image_url: node["previewImageURL"].as_str().unwrap_or("").to_string(),
                    viewer_count: node["viewersCount"].as_u64().unwrap_or(0),
                    language: node["language"].as_str().map(|s| s.to_string()),
                    started_at: node["createdAt"].as_str().unwrap_or("").to_string(),
                    broadcaster: LiveBroadcaster {
                        id: node["broadcaster"]["id"].as_str().unwrap_or("").to_string(),
                        login: node["broadcaster"]["login"]
                            .as_str()
                            .unwrap_or("")
                            .to_string(),
                        display_name: node["broadcaster"]["displayName"]
                            .as_str()
                            .unwrap_or("")
                            .to_string(),
                        profile_image_url: node["broadcaster"]["profileImageURL"]
                            .as_str()
                            .unwrap_or("")
                            .to_string(),
                    },
                    game: Some(LiveGame {
                        id: None,
                        name: game_name.clone(),
                        box_art_url: None,
                    }),
                })
            })
            .collect();

        let last_cursor = edges
            .last()
            .and_then(|e| e["cursor"].as_str())
            .map(|s| s.to_string());
        let has_next = data["data"]["game"]["streams"]["pageInfo"]["hasNextPage"]
            .as_bool()
            .unwrap_or(false);

        let page = LiveStreamsPage {
            items,
            next_cursor: if has_next { last_cursor.clone() } else { None },
            has_more: has_next && last_cursor.is_some(),
        };

        self.live_page_cache.insert(cache_key, page.clone()).await;
        Ok(page)
    }

    pub async fn search_live_streams_by_query(
        &self,
        query: &str,
        first: usize,
    ) -> AppResult<LiveStreamsPage> {
        let safe_first = first.clamp(4, 48);
        let escaped_q = gql_escape(query);
        let cache_key = format!("live_search_{}_{}", create_simple_hash(query), safe_first);

        if let Some(cached) = self.live_page_cache.get(&cache_key).await {
            return Ok(cached);
        }

        // Search by category name (game streams) + channel name search in parallel
        let cat_body = format!(
            r#"{{"query":"query {{ game(name: \"{escaped_q}\") {{ streams(first: {safe_first}) {{ edges {{ cursor node {{ id title viewersCount previewImageURL(width: 640, height: 360) createdAt language broadcaster {{ id login displayName profileImageURL(width: 70) }} }} }} pageInfo {{ hasNextPage }} }} }} }}"}}"#
        );
        let chan_body = format!(
            r#"{{"query":"query {{ searchFor(userQuery: \"{escaped_q}\", target: {{ index: \"CHANNEL\" }}, first: {safe_first}) {{ results {{ item {{ ... on User {{ id login displayName profileImageURL(width: 70) stream {{ id title viewersCount previewImageURL(width: 640, height: 360) createdAt language game {{ id name }} }} }} }} }} }} }}"}}"#
        );

        let (cat_result, chan_result) =
            tokio::join!(self.gql_post(&cat_body), self.gql_post(&chan_body));

        let mut items: Vec<LiveStream> = Vec::new();
        let mut seen_ids: std::collections::HashSet<String> = std::collections::HashSet::new();

        if let Ok(data) = cat_result {
            let game_name = query.to_string();
            if let Some(edges) = data["data"]["game"]["streams"]["edges"].as_array() {
                for edge in edges {
                    let node = &edge["node"];
                    if node.is_null() || node["broadcaster"]["login"].is_null() {
                        continue;
                    }
                    let id = node["id"].as_str().unwrap_or("").to_string();
                    if id.is_empty() || seen_ids.contains(&id) {
                        continue;
                    }
                    seen_ids.insert(id.clone());
                    items.push(LiveStream {
                        id,
                        title: node["title"].as_str().unwrap_or("Live stream").to_string(),
                        preview_image_url: node["previewImageURL"]
                            .as_str()
                            .unwrap_or("")
                            .to_string(),
                        viewer_count: node["viewersCount"].as_u64().unwrap_or(0),
                        language: node["language"].as_str().map(|s| s.to_string()),
                        started_at: node["createdAt"].as_str().unwrap_or("").to_string(),
                        broadcaster: LiveBroadcaster {
                            id: node["broadcaster"]["id"].as_str().unwrap_or("").to_string(),
                            login: node["broadcaster"]["login"]
                                .as_str()
                                .unwrap_or("")
                                .to_string(),
                            display_name: node["broadcaster"]["displayName"]
                                .as_str()
                                .unwrap_or("")
                                .to_string(),
                            profile_image_url: node["broadcaster"]["profileImageURL"]
                                .as_str()
                                .unwrap_or("")
                                .to_string(),
                        },
                        game: Some(LiveGame {
                            id: None,
                            name: game_name.clone(),
                            box_art_url: None,
                        }),
                    });
                }
            }
        }

        if let Ok(data) = chan_result {
            if let Some(results) = data["data"]["searchFor"]["results"].as_array() {
                for result in results {
                    let user = &result["item"];
                    if user.is_null() || user["stream"].is_null() {
                        continue;
                    }
                    let stream = &user["stream"];
                    let id = stream["id"].as_str().unwrap_or("").to_string();
                    if id.is_empty() || seen_ids.contains(&id) {
                        continue;
                    }
                    seen_ids.insert(id.clone());
                    let game = if stream["game"].is_null() {
                        None
                    } else {
                        Some(LiveGame {
                            id: stream["game"]["id"].as_str().map(|s| s.to_string()),
                            name: stream["game"]["name"].as_str().unwrap_or("").to_string(),
                            box_art_url: None,
                        })
                    };
                    items.push(LiveStream {
                        id,
                        title: stream["title"]
                            .as_str()
                            .unwrap_or("Live stream")
                            .to_string(),
                        preview_image_url: stream["previewImageURL"]
                            .as_str()
                            .unwrap_or("")
                            .to_string(),
                        viewer_count: stream["viewersCount"].as_u64().unwrap_or(0),
                        language: stream["language"].as_str().map(|s| s.to_string()),
                        started_at: stream["createdAt"].as_str().unwrap_or("").to_string(),
                        broadcaster: LiveBroadcaster {
                            id: user["id"].as_str().unwrap_or("").to_string(),
                            login: user["login"].as_str().unwrap_or("").to_string(),
                            display_name: user["displayName"].as_str().unwrap_or("").to_string(),
                            profile_image_url: user["profileImageURL"]
                                .as_str()
                                .unwrap_or("")
                                .to_string(),
                        },
                        game,
                    });
                }
            }
        }

        items.sort_by(|a, b| b.viewer_count.cmp(&a.viewer_count));

        let page = LiveStreamsPage {
            has_more: false,
            next_cursor: None,
            items,
        };
        self.live_page_cache.insert(cache_key, page.clone()).await;
        Ok(page)
    }

    pub async fn fetch_user_info(&self, username: &str) -> AppResult<UserInfo> {
        let cache_key = format!("user_{username}");
        if let Some(cached) = self.user_cache.get(&cache_key).await {
            return Ok(cached);
        }

        let body = format!(
            r#"{{"query":"query {{ user(login: \"{}\") {{ id, login, displayName, profileImageURL(width: 300) }} }}"}}"#,
            gql_escape(username)
        );

        let data = self.gql_post(&body).await?;
        let user_val = data["data"]["user"].clone();
        if user_val.is_null() {
            return Err(AppError::NotFound("User not found".to_string()));
        }

        let user: UserInfo = serde_json::from_value(user_val).map_err(AppError::from)?;
        self.user_cache.insert(cache_key, user.clone()).await;
        Ok(user)
    }

    pub async fn fetch_related_channels(&self, login: &str, first: usize) -> Vec<String> {
        let cache_key = format!("related_channels_{login}");
        if let Some(cached) = self.related_channels_cache.get(&cache_key).await {
            return cached;
        }

        let query = format!(
            r#"{{"query":"query {{ user(login: \"{}\") {{ relatedLiveChannels(first: {}) {{ edges {{ node {{ login }} }} }} }} }}"}}"#,
            gql_escape(login),
            first
        );

        let Ok(data) = self.gql_post(&query).await else {
            return vec![];
        };

        let result: Vec<String> = data["data"]["user"]["relatedLiveChannels"]["edges"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|e| e["node"]["login"].as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default();

        if !result.is_empty() {
            self.related_channels_cache
                .insert(cache_key, result.clone())
                .await;
        }
        result
    }

    pub async fn fetch_user_vods(&self, username: &str) -> AppResult<Vec<Vod>> {
        let cache_key = format!("vods_{username}");
        if let Some(cached) = self.vod_cache.get(&cache_key).await {
            return Ok(cached);
        }

        let body = format!(
            r#"{{"query":"query {{ user(login: \"{}\") {{ videos(first: 30) {{ edges {{ node {{ id, title, lengthSeconds, previewThumbnailURL(width: 320, height: 180), createdAt, viewCount, broadcastType, language, game {{ name }}, owner {{ login, displayName, profileImageURL(width: 50) }} }} }} }} }} }}"}}"#,
            gql_escape(username)
        );

        let data = self.gql_post(&body).await?;
        if data["data"]["user"].is_null() {
            return Err(AppError::NotFound("User not found".to_string()));
        }

        let vods: Vec<Vod> = data["data"]["user"]["videos"]["edges"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|e| {
                        let vod = serde_json::from_value::<Vod>(e["node"].clone()).ok()?;
                        if vod.is_valid() {
                            Some(vod)
                        } else {
                            None
                        }
                    })
                    .collect()
            })
            .unwrap_or_default();

        self.vod_cache.insert(cache_key, vods.clone()).await;
        Ok(vods)
    }

    pub async fn fetch_user_live_stream(&self, username: &str) -> AppResult<Option<LiveStream>> {
        let login = username.trim().to_lowercase();
        if login.is_empty() {
            return Ok(None);
        }

        let cache_key = format!("live_user_{login}");
        if let Some(cached) = self.live_stream_cache.get(&cache_key).await {
            return Ok(cached);
        }

        let body = format!(
            r#"{{"query":"query {{ user(login: \"{}\") {{ id login displayName profileImageURL(width: 70) stream {{ id title viewersCount previewImageURL(width: 640, height: 360) createdAt language game {{ id name boxArtURL(width: 110, height: 147) }} }} }} }}"}}"#,
            gql_escape(&login)
        );

        let data = self.gql_post(&body).await?;
        let user = &data["data"]["user"];

        if user.is_null() || data["data"]["user"]["stream"].is_null() {
            self.live_stream_cache.insert(cache_key, None).await;
            return Ok(None);
        }

        let stream = &user["stream"];
        let live = LiveStream {
            id: stream["id"].as_str().unwrap_or("").to_string(),
            title: stream["title"]
                .as_str()
                .unwrap_or("Live stream")
                .to_string(),
            preview_image_url: stream["previewImageURL"].as_str().unwrap_or("").to_string(),
            viewer_count: stream["viewersCount"].as_u64().unwrap_or(0),
            language: stream["language"].as_str().map(|s| s.to_string()),
            started_at: stream["createdAt"].as_str().unwrap_or("").to_string(),
            broadcaster: LiveBroadcaster {
                id: user["id"].as_str().unwrap_or("").to_string(),
                login: user["login"].as_str().unwrap_or(&login).to_string(),
                display_name: user["displayName"].as_str().unwrap_or(&login).to_string(),
                profile_image_url: user["profileImageURL"].as_str().unwrap_or("").to_string(),
            },
            game: if stream["game"].is_null() {
                None
            } else {
                Some(LiveGame {
                    id: stream["game"]["id"].as_str().map(|s| s.to_string()),
                    name: stream["game"]["name"].as_str().unwrap_or("").to_string(),
                    box_art_url: stream["game"]["boxArtURL"].as_str().map(|s| s.to_string()),
                })
            },
        };

        self.live_stream_cache
            .insert(cache_key, Some(live.clone()))
            .await;
        Ok(Some(live))
    }

    pub async fn fetch_live_status_by_logins(
        &self,
        logins: Vec<String>,
    ) -> HashMap<String, LiveStream> {
        let normalized: Vec<String> = {
            let mut seen = std::collections::HashSet::new();
            logins
                .into_iter()
                .map(|l| l.trim().to_lowercase())
                .filter(|l| !l.is_empty() && RE_TWITCH_LOGIN.is_match(l) && seen.insert(l.clone()))
                .take(80)
                .collect()
        };

        if normalized.is_empty() {
            return HashMap::new();
        }

        let mut sorted = normalized.clone();
        sorted.sort();
        let cache_key = format!("live_status_{}", create_simple_hash(&sorted.join("|")));

        if let Some(cached) = self.generic_value_cache.get(&cache_key).await {
            return serde_json::from_value(cached).unwrap_or_default();
        }

        let mut result: HashMap<String, LiveStream> = HashMap::new();
        let results = stream::iter(normalized.iter().cloned())
            .map(|login| async move {
                let res = self.fetch_user_live_stream(&login).await;
                (login, res)
            })
            .buffer_unordered(LIVE_STATUS_CONCURRENCY)
            .collect::<Vec<_>>()
            .await;

        for (login, res) in results {
            if let Ok(Some(stream)) = res {
                result.insert(login, stream);
            }
        }

        let val = serde_json::to_value(&result).unwrap_or_default();
        self.generic_value_cache.insert(cache_key, val).await;
        result
    }

    pub async fn search_channels(&self, query: &str) -> AppResult<Vec<UserInfo>> {
        let body = format!(
            r#"{{"query":"query {{ searchFor(userQuery: \"{}\", platform: \"web\") {{ channels {{ edges {{ item {{ ... on User {{ id, login, displayName, profileImageURL(width: 300) }} }} }} }} }} }}"}}"#,
            gql_escape(query)
        );

        let data = self.gql_post(&body).await?;
        let edges = data["data"]["searchFor"]["channels"]["edges"]
            .as_array()
            .cloned()
            .unwrap_or_default();

        let users = edges
            .iter()
            .filter_map(|e| serde_json::from_value::<UserInfo>(e["item"].clone()).ok())
            .filter(|u| !u.login.is_empty())
            .collect();
        Ok(users)
    }

    pub async fn search_global_content(&self, query: &str) -> AppResult<Value> {
        let body = format!(
            r#"{{"query":"query {{ searchFor(userQuery: \"{}\", platform: \"web\") {{ channels {{ edges {{ item {{ ... on User {{ id, login, displayName, profileImageURL(width: 300), stream {{ id title viewersCount previewImageURL(width: 640, height: 360) }}, __typename }} }} }} }}, games {{ edges {{ item {{ ... on Game {{ id, name, boxArtURL(width: 150, height: 200), __typename }} }} }} }} }} }}"}}"#,
            gql_escape(query)
        );

        let data = self.gql_post(&body).await?;
        let channels: Vec<Value> = data["data"]["searchFor"]["channels"]["edges"]
            .as_array()
            .map(|a| a.iter().map(|e| e["item"].clone()).collect())
            .unwrap_or_default();
        let games: Vec<Value> = data["data"]["searchFor"]["games"]["edges"]
            .as_array()
            .map(|a| a.iter().map(|e| e["item"].clone()).collect())
            .unwrap_or_default();

        let mut combined = games;
        combined.extend(channels);
        combined.retain(|v| !v.is_null());
        Ok(Value::Array(combined))
    }

    pub async fn fetch_video_chat(
        &self,
        vod_id: &str,
        offset: f64,
        limit: usize,
    ) -> AppResult<Value> {
        let safe_limit = limit.clamp(20, 100);
        let body = format!(
            r#"{{"query":"query {{ video(id: \"{}\") {{ comments(first: {}, contentOffsetSeconds: {}) {{ edges {{ node {{ id, commenter {{ displayName, login, profileImageURL(width: 50) }}, message {{ fragments {{ text, emote {{ id, setID }} }} }}, contentOffsetSeconds, createdAt }} }}, pageInfo {{ hasNextPage }} }} }} }}"}}"#,
            gql_escape(vod_id),
            safe_limit,
            offset.floor() as i64
        );

        let data = self.gql_post(&body).await?;
        let comments = &data["data"]["video"]["comments"];
        if comments.is_null() {
            return Ok(serde_json::json!({"messages": [], "hasNextPage": false}));
        }

        let messages: Vec<Value> = comments["edges"]
            .as_array()
            .map(|arr| arr.iter().map(|e| e["node"].clone()).collect())
            .unwrap_or_default();

        Ok(serde_json::json!({
            "messages": messages,
            "hasNextPage": comments["pageInfo"]["hasNextPage"].as_bool().unwrap_or(false)
        }))
    }

    pub async fn search_video_chat(
        &self,
        vod_id: &str,
        keyword: &str,
        max_messages: usize,
    ) -> AppResult<Value> {
        let keyword_lower = keyword.to_lowercase();
        let mut results = Vec::new();
        let mut cursor: Option<String> = None;
        let mut total_checked = 0;
        let max_to_check = 1000; // Limit total messages scanned to prevent timeout

        loop {
            let cursor_str = cursor
                .as_ref()
                .map(|c| format!(", cursor: \"{}\"", c))
                .unwrap_or_default();
            let body = format!(
                r#"{{"query":"query {{ video(id: \"{}\") {{ comments{} {{ edges {{ node {{ id, commenter {{ displayName, login, profileImageURL(width: 50) }}, message {{ fragments {{ text }} }}, contentOffsetSeconds }} }}, pageInfo {{ hasNextPage, endCursor }} }} }} }}"}}"#,
                gql_escape(vod_id),
                cursor_str
            );

            let data = self.gql_post(&body).await?;
            let comments = &data["data"]["video"]["comments"];
            if comments.is_null() {
                break;
            }

            if let Some(edges) = comments["edges"].as_array() {
                for edge in edges {
                    total_checked += 1;
                    let node = &edge["node"];
                    let message_text = node["message"]["fragments"]
                        .as_array()
                        .map(|arr| {
                            arr.iter()
                                .filter_map(|f| f["text"].as_str())
                                .collect::<String>()
                        })
                        .unwrap_or_default();

                    if message_text.to_lowercase().contains(&keyword_lower) {
                        results.push(serde_json::json!({
                            "id": node["id"],
                            "commenter": node["commenter"],
                            "message": message_text,
                            "contentOffsetSeconds": node["contentOffsetSeconds"]
                        }));
                    }

                    if results.len() >= max_messages || total_checked >= max_to_check {
                        break;
                    }
                }
            }

            let page_info = &comments["pageInfo"];
            let has_next = page_info["hasNextPage"].as_bool().unwrap_or(false);
            cursor = page_info["endCursor"].as_str().map(|s| s.to_string());

            if !has_next || results.len() >= max_messages || total_checked >= max_to_check {
                break;
            }
        }

        Ok(serde_json::json!({
            "results": results,
            "totalChecked": total_checked
        }))
    }

    pub async fn fetch_video_markers(&self, vod_id: &str) -> AppResult<Value> {
        let escaped_vod_id = gql_escape(vod_id);

        // Query 1: game-change moments (stable source for chapter-like entries).
        let moments_body = format!(
            r#"{{"query":"query {{ video(id: \"{}\") {{ momentsConnection {{ edges {{ node {{ id, type, positionMilliseconds, details {{ ... on GameChangeMomentDetails {{ game {{ id, displayName, boxArtURL(width: 150, height: 200) }} }} }} }} }} }} }} }}"}}"#,
            escaped_vod_id
        );

        // Query 2: legacy stream markers (can be missing depending on schema/VOD).
        let markers_body = format!(
            r#"{{"query":"query {{ video(id: \"{}\") {{ markers {{ id, displayTime, description, type }} }} }}"}}"#,
            escaped_vod_id
        );

        let client = self
            .android_tv_client
            .post("https://gql.twitch.tv/gql")
            .header("Client-Id", "kimne78kx3ncx6brgo4mv6wki5h1ko")
            .header("Accept", "application/json")
            .header("Content-Type", "application/json");

        let moments_data = client
            .try_clone()
            .ok_or_else(|| AppError::Internal("Failed to clone GQL request builder".to_string()))?
            .body(moments_body)
            .send()
            .await?
            .json::<Value>()
            .await?;

        let markers_data = client
            .body(markers_body)
            .send()
            .await?
            .json::<Value>()
            .await?;

        if let Some(errors) = moments_data["errors"].as_array() {
            debug!("momentsConnection returned {} GraphQL errors", errors.len());
        }
        if let Some(errors) = markers_data["errors"].as_array() {
            debug!("markers returned {} GraphQL errors", errors.len());
        }

        let mut all_markers = Vec::new();

        // 1) Game changes from momentsConnection.
        if let Some(edges) = moments_data["data"]["video"]["momentsConnection"]["edges"].as_array()
        {
            for edge in edges {
                let node = &edge["node"];
                if node.is_null() {
                    continue;
                }

                let marker_type = node["type"].as_str().unwrap_or("MOMENT");
                let pos_ms = parse_timecode_seconds(&node["positionMilliseconds"]).unwrap_or(0.0);
                let pos_seconds = pos_ms / 1000.0;
                if !pos_seconds.is_finite() || pos_seconds < 0.0 {
                    continue;
                }

                let game = &node["details"]["game"];
                let description = game["displayName"]
                    .as_str()
                    .or_else(|| node["description"].as_str())
                    .unwrap_or("Chapitre");

                all_markers.push(serde_json::json!({
                    "id": node["id"],
                    "displayTime": pos_seconds,
                    "description": description,
                    "type": marker_type,
                    "url": game["boxArtURL"].as_str(),
                }));
            }
        }

        // 2) Legacy markers (displayTime can be number OR time string).
        if let Some(markers) = markers_data["data"]["video"]["markers"].as_array() {
            for marker in markers {
                let Some(display_time) = parse_timecode_seconds(&marker["displayTime"]) else {
                    continue;
                };

                if !display_time.is_finite() || display_time < 0.0 {
                    continue;
                }

                all_markers.push(serde_json::json!({
                    "id": marker["id"],
                    "displayTime": display_time,
                    "description": marker["description"].as_str().unwrap_or("Marqueur"),
                    "type": marker["type"].as_str().unwrap_or("MARKER"),
                    "url": Value::Null,
                }));
            }
        }

        all_markers.sort_by(|a, b| {
            let ta = a["displayTime"].as_f64().unwrap_or(0.0);
            let tb = b["displayTime"].as_f64().unwrap_or(0.0);
            ta.partial_cmp(&tb).unwrap_or(std::cmp::Ordering::Equal)
        });

        // Dedup markers too close in time to avoid duplicates between moments and markers.
        all_markers.dedup_by(|a, b| {
            (a["displayTime"].as_f64().unwrap_or(0.0) - b["displayTime"].as_f64().unwrap_or(0.0))
                .abs()
                < 1.0
        });

        Ok(Value::Array(all_markers))
    }

    pub async fn fetch_live_streams(
        &self,
        first: usize,
        after: Option<&str>,
    ) -> AppResult<LiveStreamsPage> {
        let safe_first = first.clamp(8, 48);
        let safe_after = after.unwrap_or("").trim().to_string();
        let cache_key = format!(
            "live_streams_{safe_first}_{}",
            if safe_after.is_empty() {
                "first"
            } else {
                &safe_after
            }
        );

        if let Some(cached) = self.live_page_cache.get(&cache_key).await {
            return Ok(cached);
        }

        let pagination = if safe_after.is_empty() {
            String::new()
        } else {
            // safe_after might contain base64, which is fine, but we must escape it for the GraphQL string literal
            let escaped = gql_escape(&safe_after);
            format!(r#", after: \"{escaped}\""#)
        };

        let body = format!(
            r#"{{"query":"query {{ streams(first: {safe_first}{pagination}) {{ edges {{ cursor node {{ id title type viewersCount previewImageURL(width: 640, height: 360) createdAt language game {{ id name boxArtURL(width: 110, height: 147) }} broadcaster {{ id login displayName profileImageURL(width: 70) }} }} }} pageInfo {{ hasNextPage }} }} }}"}}"#
        );

        let data = self.gql_post(&body).await?;
        let edges = match data["data"]["streams"]["edges"].as_array() {
            Some(a) => a.clone(),
            None => {
                return Ok(LiveStreamsPage {
                    items: vec![],
                    next_cursor: None,
                    has_more: false,
                })
            }
        };

        let items: Vec<LiveStream> = edges
            .iter()
            .filter_map(|edge| {
                let node = &edge["node"];
                if node.is_null() || node["broadcaster"]["login"].is_null() {
                    return None;
                }
                let game = if node["game"].is_null() {
                    None
                } else {
                    Some(LiveGame {
                        id: node["game"]["id"].as_str().map(|s| s.to_string()),
                        name: node["game"]["name"].as_str().unwrap_or("").to_string(),
                        box_art_url: node["game"]["boxArtURL"].as_str().map(|s| s.to_string()),
                    })
                };
                Some(LiveStream {
                    id: node["id"].as_str().unwrap_or("").to_string(),
                    title: node["title"].as_str().unwrap_or("Live stream").to_string(),
                    preview_image_url: node["previewImageURL"].as_str().unwrap_or("").to_string(),
                    viewer_count: node["viewersCount"].as_u64().unwrap_or(0),
                    language: node["language"].as_str().map(|s| s.to_string()),
                    started_at: node["createdAt"].as_str().unwrap_or("").to_string(),
                    broadcaster: LiveBroadcaster {
                        id: node["broadcaster"]["id"].as_str().unwrap_or("").to_string(),
                        login: node["broadcaster"]["login"]
                            .as_str()
                            .unwrap_or("")
                            .to_string(),
                        display_name: node["broadcaster"]["displayName"]
                            .as_str()
                            .unwrap_or("")
                            .to_string(),
                        profile_image_url: node["broadcaster"]["profileImageURL"]
                            .as_str()
                            .unwrap_or("")
                            .to_string(),
                    },
                    game,
                })
            })
            .collect();

        let last_cursor = edges
            .last()
            .and_then(|e| e["cursor"].as_str())
            .map(|s| s.to_string());
        let has_next = data["data"]["streams"]["pageInfo"]["hasNextPage"]
            .as_bool()
            .unwrap_or(false);

        let page = LiveStreamsPage {
            items,
            next_cursor: if has_next { last_cursor.clone() } else { None },
            has_more: has_next && last_cursor.is_some(),
        };

        self.live_page_cache.insert(cache_key, page.clone()).await;
        Ok(page)
    }

    pub async fn fetch_trending_vods(
        &self,
        history: Vec<HistoryEntry>,
        subs: Vec<String>,
    ) -> AppResult<Vec<Vod>> {
        let fingerprint = create_simple_hash(&{
            let h: Vec<_> = history
                .iter()
                .map(|e| {
                    format!(
                        "{},{},{},{}",
                        e.vod_id,
                        e.timecode as i64,
                        e.duration as i64,
                        e.updated_at / (1000 * 60 * 10)
                    )
                })
                .collect();
            let s_subs: Vec<_> = {
                let mut v: Vec<_> = subs.iter().map(|s| s.to_lowercase()).collect();
                v.sort();
                v
            };
            format!("{}|{}", h.join(";"), s_subs.join(","))
        });

        let cache_key = format!("trending_vods_{fingerprint}");
        if let Some(cached) = self.vod_cache.get(&cache_key).await {
            return Ok(cached);
        }

        let watched_ids: Vec<String> = history.iter().map(|e| e.vod_id.clone()).collect();
        let watched_vods = self.fetch_watched_vod_metadata(&watched_ids).await;

        // Convert optimized inputs back to what build_preference_profile expects if needed,
        // or update build_preference_profile.
        // Looking at build_preference_profile, it expects &HashMap and &[SubEntry].
        // I will update build_preference_profile to be more flexible or adapt here.

        let history_map: HashMap<String, HistoryEntry> =
            history.into_iter().map(|e| (e.vod_id.clone(), e)).collect();
        let subs_entries: Vec<SubEntry> = subs
            .iter()
            .map(|login| SubEntry {
                login: login.clone(),
                display_name: String::new(),
                profile_image_url: String::new(),
            })
            .collect();

        let profile = build_preference_profile(&history_map, &watched_vods, &subs_entries);
        let subs_set: HashSet<String> = subs.iter().map(|s| s.to_lowercase()).collect();

        // ── Step 1: Expand source candidates ──

        // Top 5 games
        let mut top_games: Vec<String> = {
            let mut entries: Vec<_> = profile.game_scores.iter().collect();
            entries.sort_by(|a, b| b.1.partial_cmp(a.1).unwrap_or(std::cmp::Ordering::Equal));
            entries.iter().take(4).map(|(k, _)| (*k).clone()).collect()
        };
        if !top_games.iter().any(|g| g == "Just Chatting") {
            top_games.push("Just Chatting".to_string());
        }
        top_games.dedup();
        top_games.truncate(5);

        // Top 5 most-watched channels
        let top_channels: Vec<String> = {
            let mut entries: Vec<_> = profile.channel_scores.iter().collect();
            entries.sort_by(|a, b| b.1.partial_cmp(a.1).unwrap_or(std::cmp::Ordering::Equal));
            entries.iter().take(5).map(|(k, _)| (*k).clone()).collect()
        };

        // Fetch related channels for top channels
        let related_results = stream::iter(top_channels.iter().cloned())
            .map(|channel| async move { self.fetch_related_channels(&channel, 3).await })
            .buffer_unordered(RELATED_CHANNELS_CONCURRENCY)
            .collect::<Vec<_>>()
            .await;
        let mut related_channels_set: HashSet<String> = HashSet::new();
        for res in related_results {
            for ch in res {
                let login = ch.to_lowercase();
                if !subs_set.contains(&login) && !profile.channel_scores.contains_key(&login) {
                    related_channels_set.insert(login);
                }
            }
        }

        // ── Step 2: Fetch all candidate VODs concurrently ──

        let mut game_inputs: Vec<(String, Option<Vec<String>>)> = Vec::new();
        for game in &top_games {
            game_inputs.push((game.clone(), Some(vec!["fr".to_string()])));
            game_inputs.push((game.clone(), None));
        }

        let mut channels_to_fetch: HashSet<String> = HashSet::new();
        for sub in subs.iter().take(20) {
            channels_to_fetch.insert(sub.to_lowercase());
        }
        for ch in &top_channels {
            channels_to_fetch.insert(ch.clone());
        }
        for ch in &related_channels_set {
            channels_to_fetch.insert(ch.clone());
        }

        let game_results =
            stream::iter(game_inputs.into_iter())
                .map(|(game, lang_filter)| async move {
                    self.fetch_game_vods(&game, lang_filter, 40).await
                })
                .buffer_unordered(TRENDING_GAMES_CONCURRENCY)
                .collect::<Vec<_>>()
                .await;

        let channel_results = stream::iter(channels_to_fetch.into_iter())
            .map(|login| async move { self.fetch_user_vods(&login).await })
            .buffer_unordered(TRENDING_CHANNELS_CONCURRENCY)
            .collect::<Vec<_>>()
            .await;

        let all_candidates: Vec<Vod> = game_results
            .into_iter()
            .flatten()
            .chain(channel_results.into_iter().flatten().flatten())
            .collect();

        let mut deduped: HashMap<String, Vod> = HashMap::new();
        for vod in all_candidates {
            if !vod.id.is_empty() && !deduped.contains_key(&vod.id) {
                deduped.insert(vod.id.clone(), vod);
            }
        }

        // ── Step 3: Scoring and Diversity pass ──

        let mut scored: Vec<ScoredVod> = deduped
            .into_values()
            .map(|vod| {
                let score = score_candidate_vod(&vod, &profile, &subs_set);
                ScoredVod { vod, score }
            })
            .collect();
        scored.sort_by(|a, b| {
            b.score
                .partial_cmp(&a.score)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        scored.truncate(400);

        // Diversity pass
        {
            let mut channel_count: HashMap<String, usize> = HashMap::new();
            scored.retain(|sv| {
                let login = sv
                    .vod
                    .owner
                    .as_ref()
                    .map(|o| o.login.to_lowercase())
                    .unwrap_or_default();

                let is_favorite =
                    subs_set.contains(&login) || profile.channel_scores.contains_key(&login);
                let is_related = related_channels_set.contains(&login);

                let max_slots = if is_favorite {
                    4
                } else if is_related {
                    3
                } else {
                    2
                };

                let count = channel_count.entry(login).or_insert(0);
                if *count < max_slots {
                    *count += 1;
                    true
                } else {
                    false
                }
            });
        }

        let total_lang_weight: f64 = profile.language_scores.values().sum();
        let foreign_weight: f64 = profile
            .language_scores
            .iter()
            .filter(|(k, _)| k.as_str() != "fr")
            .map(|(_, v)| *v)
            .sum();
        let foreign_affinity = if total_lang_weight > 0.0 {
            foreign_weight / total_lang_weight
        } else {
            0.0
        };
        let foreign_ratio = clamp(0.16 + foreign_affinity * 0.35, 0.16, 0.4);

        let feed = interleave_localized_feed(scored, foreign_ratio, 120);

        self.vod_cache.insert(cache_key, feed.clone()).await;
        Ok(feed)
    }

    pub async fn generate_master_playlist(
        &self,
        vod_id: &str,
        _host: &str,
        settings: &ExperienceSettings,
        server_token: &str,
    ) -> AppResult<String> {
        let cache_key = format!("master:{}:{}", vod_id.trim(), server_token.trim());
        if let Some(cached) = self.master_playlist_cache.get(&cache_key).await {
            return Ok(cached);
        }

        let safe_vod_id = gql_escape(vod_id.trim());
        if !RE_VOD_ID_SAFE.is_match(vod_id.trim()) {
            return Err(AppError::BadRequest("Invalid VOD identifier".to_string()));
        }

        if let Ok((playback_value, playback_sig)) =
            self.fetch_vod_playback_token(vod_id, settings).await
        {
            let random_p = rand_u32() % 1_000_000;
            let source_url = format!(
                "https://usher.ttvnw.net/vod/{}.m3u8?allow_source=true&allow_audio_only=true&playlist_include_framerate=true&player_backend=mediaplayer&player=twitchweb&p={random_p}&nauth={}&nauthsig={}",
                urlencoding_simple(vod_id.trim()),
                urlencoding_simple(&playback_value),
                urlencoding_simple(&playback_sig)
            );

            let client = self.get_client(settings).await;
            match get_text_with_direct_fallback(
                &client,
                &self.android_tv_client,
                &source_url,
                "vod master",
            )
            .await
            {
                Ok(master) => {
                    let rewritten = rewrite_master_with_proxy(
                        &master,
                        _host,
                        &source_url,
                        &self.variant_cache,
                        server_token,
                    )
                    .await;

                    self.master_playlist_cache
                        .insert(cache_key.clone(), rewritten.clone())
                        .await;

                    return Ok(rewritten);
                }
                Err(error) => {
                    eprintln!(
                        "[vod] usher master request failed ({error}), falling back to inferred quality URLs"
                    );
                }
            }
        } else {
            eprintln!("[vod] failed to fetch VOD playback token, using inferred quality URLs");
        }

        let body = format!(
            r#"{{"query":"query {{ video(id: \"{safe_vod_id}\") {{ broadcastType, createdAt, seekPreviewsURL, owner {{ login }} }} }}"}}"#
        );

        let data = self.gql_post(&body).await?;

        let vod_data = &data["data"]["video"];
        if vod_data.is_null() {
            return Err(AppError::NotFound("Video not found".to_string()));
        }

        let seek_previews_url = vod_data["seekPreviewsURL"]
            .as_str()
            .ok_or_else(|| AppError::Internal("Missing seekPreviewsURL".to_string()))?;
        let channel_login = vod_data["owner"]["login"]
            .as_str()
            .ok_or_else(|| AppError::Internal("Missing owner.login".to_string()))?;
        let broadcast_type = vod_data["broadcastType"]
            .as_str()
            .unwrap_or("archive")
            .to_lowercase();
        let created_at = vod_data["createdAt"].as_str().unwrap_or("");

        let (domain, vod_special_id) = parse_vod_url_info(seek_previews_url)?;

        let days_diff = chrono_days_since_str(created_at);

        let resolutions: Vec<(&str, &str, u32)> = vec![
            ("chunked", "1920x1080", 60),
            ("1080p60", "1920x1080", 60),
            ("720p60", "1280x720", 60),
            ("480p30", "854x480", 30),
            ("360p30", "640x360", 30),
            ("160p30", "284x160", 30),
        ];

        let serving_id = create_serving_id();
        let mut playlist = format!(
            "#EXTM3U\n#EXT-X-TWITCH-INFO:ORIGIN=\"s3\",B=\"false\",REGION=\"EU\",USER-IP=\"127.0.0.1\",SERVING-ID=\"{serving_id}\",CLUSTER=\"cloudfront_vod\",USER-COUNTRY=\"BE\",MANIFEST-CLUSTER=\"cloudfront_vod\""
        );
        let mut inserted_variants = 0usize;

        let mut probe_set = tokio::task::JoinSet::new();

        for (index, (res_key, resolution, fps)) in resolutions.iter().enumerate() {
            let stream_url = build_stream_url(
                &domain,
                &vod_special_id,
                res_key,
                safe_vod_id.as_str(),
                &broadcast_type,
                days_diff,
                channel_login,
            );

            let android_tv_client = self.android_tv_client.clone();
            let shared_client = self.shared_client.clone();
            let res_key = (*res_key).to_string();
            let resolution = (*resolution).to_string();
            let fps = *fps;

            probe_set.spawn(async move {
                let codec = match is_valid_quality(&android_tv_client, &stream_url).await {
                    Some(c) => Some(c),
                    None => is_valid_quality(&shared_client, &stream_url).await,
                };

                (index, res_key, resolution, fps, stream_url, codec)
            });
        }

        type ProbedVariant = (String, String, u32, String, String);

        let mut probed_variants: Vec<Option<ProbedVariant>> = vec![None; resolutions.len()];

        while let Some(joined) = probe_set.join_next().await {
            if let Ok((index, res_key, resolution, fps, stream_url, Some(codec))) = joined {
                probed_variants[index] = Some((res_key, resolution, fps, stream_url, codec));
            }
        }

        for (res_key, resolution, fps, stream_url, codec) in probed_variants.into_iter().flatten() {
            let quality = if res_key == "chunked" {
                "source".to_string()
            } else {
                res_key.to_string()
            };
            let enabled = if res_key == "chunked" { "YES" } else { "NO" };

            let proxy_id =
                match register_variant_proxy_target(&self.variant_cache, &stream_url).await {
                    Ok(id) => id,
                    Err(_) => continue,
                };
            let proxy_url = format!(
                "/api/stream/variant.m3u8?id={}&t={}",
                urlencoding_simple(&proxy_id),
                server_token
            );
            let bandwidth = quality_bandwidth_bps(&res_key, fps, &resolution);

            playlist.push_str(&format!(
                "\n#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID=\"{quality}\",NAME=\"{quality}\",AUTOSELECT={enabled},DEFAULT={enabled}\n#EXT-X-STREAM-INF:BANDWIDTH={bandwidth},CODECS=\"{codec},mp4a.40.2\",RESOLUTION={resolution},VIDEO=\"{quality}\",FRAME-RATE={fps}\n{proxy_url}"
            ));
            inserted_variants += 1;
        }

        if inserted_variants == 0 {
            return Err(AppError::NotFound(
                "No playable VOD qualities available for this video".to_string(),
            ));
        }

        self.master_playlist_cache
            .insert(cache_key, playlist.clone())
            .await;

        Ok(playlist)
    }

    pub async fn generate_live_master_playlist(
        &self,
        channel_login: &str,
        _host: &str,
        settings: &ExperienceSettings,
        server_token: &str,
    ) -> AppResult<String> {
        let token = self
            .fetch_live_playback_token(channel_login, settings)
            .await?;
        let random_p = rand_u32() % 1_000_000;

        let params = format!(
            "allow_source=true&allow_audio_only=true&fast_bread=true&playlist_include_framerate=true&player_backend=mediaplayer&player=twitchweb&p={random_p}&sig={}&token={}",
            urlencoding_simple(&token.1),
            urlencoding_simple(&token.0)
        );

        let source_url = format!(
            "https://usher.ttvnw.net/api/channel/hls/{}.m3u8?{params}",
            urlencoding_simple(channel_login)
        );

        let client = self.get_client(settings).await;

        let master = get_text_with_direct_fallback(
            &client,
            &self.android_tv_client,
            &source_url,
            "live master",
        )
        .await?;

        Ok(rewrite_master_with_proxy(
            &master,
            _host,
            &source_url,
            &self.variant_cache,
            server_token,
        )
        .await)
    }

    async fn fetch_vod_playback_token(
        &self,
        vod_id: &str,
        settings: &ExperienceSettings,
    ) -> AppResult<(String, String)> {
        let sanitized_vod_id = vod_id.trim();
        if sanitized_vod_id.is_empty() || !RE_VOD_ID_SAFE.is_match(sanitized_vod_id) {
            return Err(AppError::BadRequest("Invalid VOD identifier".to_string()));
        }

        let build_body = |platform: &str| {
            serde_json::json!({
                "operationName": "PlaybackAccessToken_Template",
                "query": format!(
                    "query PlaybackAccessToken_Template($vodID: ID!) {{ videoPlaybackAccessToken(id: $vodID, params: {{platform: \"{}\", playerBackend: \"mediaplayer\", playerType: \"site\"}}) {{ value signature }} }}",
                    platform
                ),
                "variables": { "vodID": sanitized_vod_id }
            })
        };

        let device_id = create_device_id();
        let session_id = create_serving_id();

        let primary_body = build_body("web");
        let ios_fallback_body = build_body("ios");

        let client = self.get_client(settings).await;

        let make_req = |c: &Client, body: &Value| {
            let mut r = c
                .post("https://gql.twitch.tv/gql")
                .header("Client-Id", "kimne78kx3ncx6brgo4mv6wki5h1ko")
                .header("X-Device-Id", &device_id)
                .header("Client-Session-Id", &session_id);

            if settings.adblock_enabled {
                r = r.header("Client-Adblock-Extension", "ttv-lol-pro");
            }
            r.json(body)
        };

        let mut data_opt: Option<Value> = None;

        if let Ok(resp) = make_req(&client, &primary_body).send().await {
            if resp.status().is_success() {
                if let Ok(json) = resp.json::<Value>().await {
                    if !json["data"]["videoPlaybackAccessToken"].is_null() {
                        data_opt = Some(json);
                    }
                }
            }
        }

        if data_opt.is_none() && settings.adblock_enabled {
            if let Ok(resp) = make_req(&client, &ios_fallback_body).send().await {
                if resp.status().is_success() {
                    if let Ok(json) = resp.json::<Value>().await {
                        if !json["data"]["videoPlaybackAccessToken"].is_null() {
                            data_opt = Some(json);
                        }
                    }
                }
            }
        }

        let data = match data_opt {
            Some(d) => d,
            None => {
                let resp = self
                    .android_tv_client
                    .post("https://gql.twitch.tv/gql")
                    .header("Client-Id", "kimne78kx3ncx6brgo4mv6wki5h1ko")
                    .header("X-Device-Id", &device_id)
                    .header("Client-Session-Id", &session_id)
                    .json(&primary_body)
                    .send()
                    .await?;

                if !resp.status().is_success() {
                    return Err(AppError::Internal(format!(
                        "Failed to fetch VOD playback token ({})",
                        resp.status()
                    )));
                }
                resp.json().await?
            }
        };

        let token = &data["data"]["videoPlaybackAccessToken"];
        if token.is_null() {
            return Err(AppError::Internal(
                "Missing videoPlaybackAccessToken in response".to_string(),
            ));
        }

        let value = if token["value"].is_string() {
            token["value"].as_str().unwrap_or_default().to_string()
        } else {
            token["value"].to_string()
        };

        let sig = if token["signature"].is_string() {
            token["signature"].as_str().unwrap_or_default().to_string()
        } else {
            token["signature"].to_string()
        };

        if value.is_empty() || value == "null" || sig.is_empty() || sig == "null" {
            return Err(AppError::Internal(
                "Missing VOD token value or signature".to_string(),
            ));
        }

        Ok((value, sig))
    }

    async fn fetch_live_playback_token(
        &self,
        channel_login: &str,
        settings: &ExperienceSettings,
    ) -> AppResult<(String, String)> {
        let build_body = |platform: &str| {
            serde_json::json!({
                "operationName": "PlaybackAccessToken_Template",
                "query": format!("query PlaybackAccessToken_Template($login: String!) {{ streamPlaybackAccessToken(channelName: $login, params: {{platform: \"{}\", playerBackend: \"mediaplayer\", playerType: \"site\"}}) {{ value signature }} }}", platform),
                "variables": { "login": channel_login }
            })
        };

        let device_id = create_device_id();
        let session_id = create_serving_id();

        let primary_body = build_body("web");
        let ios_fallback_body = build_body("ios");

        let client = self.get_client(settings).await;

        let make_req = |c: &Client, body: &Value| {
            let mut r = c
                .post("https://gql.twitch.tv/gql")
                .header("Client-Id", "kimne78kx3ncx6brgo4mv6wki5h1ko")
                .header("X-Device-Id", &device_id)
                .header("Client-Session-Id", &session_id);

            if settings.adblock_enabled {
                r = r.header("Client-Adblock-Extension", "ttv-lol-pro");
            }
            r.json(body)
        };

        let mut data_opt: Option<Value> = None;

        if let Ok(resp) = make_req(&client, &primary_body).send().await {
            if resp.status().is_success() {
                if let Ok(json) = resp.json::<Value>().await {
                    if !json["data"]["streamPlaybackAccessToken"].is_null() {
                        data_opt = Some(json);
                    }
                }
            }
        }

        if data_opt.is_none() && settings.adblock_enabled {
            if let Ok(resp) = make_req(&client, &ios_fallback_body).send().await {
                if resp.status().is_success() {
                    if let Ok(json) = resp.json::<Value>().await {
                        if !json["data"]["streamPlaybackAccessToken"].is_null() {
                            data_opt = Some(json);
                        }
                    }
                }
            }
        }

        let data = match data_opt {
            Some(d) => d,
            None => {
                let resp = self
                    .android_tv_client
                    .post("https://gql.twitch.tv/gql")
                    .header("Client-Id", "kimne78kx3ncx6brgo4mv6wki5h1ko")
                    .header("X-Device-Id", &device_id)
                    .header("Client-Session-Id", &session_id)
                    .json(&primary_body)
                    .send()
                    .await?;

                if !resp.status().is_success() {
                    return Err(AppError::Internal(format!(
                        "Failed to fetch live playback token ({})",
                        resp.status()
                    )));
                }
                resp.json().await?
            }
        };

        let token = &data["data"]["streamPlaybackAccessToken"];

        if token.is_null() {
            return Err(AppError::Internal(
                "Missing streamPlaybackAccessToken in response".to_string(),
            ));
        }

        let value = if token["value"].is_string() {
            token["value"].as_str().unwrap_or_default().to_string()
        } else {
            token["value"].to_string()
        };

        let sig = if token["signature"].is_string() {
            token["signature"].as_str().unwrap_or_default().to_string()
        } else {
            token["signature"].to_string()
        };

        if value.is_empty() || value == "null" || sig.is_empty() || sig == "null" {
            return Err(AppError::Internal(
                "Missing token value or signature".to_string(),
            ));
        }

        Ok((value, sig))
    }

    pub async fn proxy_variant_playlist(
        &self,
        proxy_id: &str,
        settings: &ExperienceSettings,
        token: &str,
    ) -> AppResult<String> {
        let target_url = resolve_variant_proxy_target(&self.variant_cache, proxy_id).await?;

        let client = self.get_client(settings).await;

        let mut body = fetch_variant_playlist_text(
            &client,
            &self.android_tv_client,
            &self.shared_client,
            &target_url,
        )
        .await?;

        body = filter_live_playlist(&body);
        body = body.replace("-unmuted", "-muted");

        let base_url = target_url
            .rfind('/')
            .map(|i| &target_url[..=i])
            .unwrap_or(&target_url)
            .to_string();

        let mut lines = Vec::new();
        for line in body.split('\n') {
            let l = line
                .trim_end_matches('\r')
                .strip_prefix('\u{feff}')
                .unwrap_or_else(|| line.trim_end_matches('\r'));
            if l.is_empty() || l.starts_with('#') {
                if l.contains("URI=\"") {
                    lines.push(rewrite_tag_uri_with_proxy(l, &base_url, token).await);
                } else {
                    lines.push(l.to_string());
                }
                continue;
            }

            let abs_url = if !l.starts_with("http") {
                resolve_url(l, &extract_origin(&base_url), &base_url).into_owned()
            } else {
                l.to_string()
            };

            match validate_variant_target_url(&abs_url) {
                Ok(sanitized) => {
                    let encoded = urlencoding::encode(&sanitized);
                    lines.push(format!("/api/stream/variant.ts?url={encoded}&t={}", token));
                }
                Err(_) => lines.push(abs_url),
            }
        }

        Ok(lines.join("\n"))
    }
}

fn create_device_id() -> String {
    let id = Uuid::new_v4().to_string().replace('-', "");
    id[..32].to_string()
}

fn filter_live_playlist(body: &str) -> String {
    let lines: Vec<&str> = body.lines().collect();
    let mut filtered = Vec::new();
    let mut skipping_ad = false;

    for line in lines {
        let l = line.trim();

        if l.starts_with("#EXT-X-TWITCH-AD")
            || l.starts_with("#EXT-X-AD")
            || l.starts_with("#EXT-X-TWITCH-CONTENT-TYPE:ad")
            || l.contains("AD-DURATION")
        {
            skipping_ad = true;
            continue;
        }

        if skipping_ad {
            if l.starts_with("#EXT-X-TWITCH-CONTENT-TYPE:live") {
                skipping_ad = false;
                filtered.push("#EXT-X-DISCONTINUITY");
                filtered.push(line);
                continue;
            }
            if !l.starts_with('#') {
                continue;
            }
            if l.starts_with("#EXTINF") || l.starts_with("#EXT-X-DISCONTINUITY") {
                continue;
            }
        }

        if l.starts_with("#EXT-X-TWITCH-TOTAL-AD-DURATION")
            || l.starts_with("#EXT-X-TWITCH-ELAPSED-SECS")
            || l.starts_with("#EXT-X-TWITCH-ROUTING-ID")
        {
            continue;
        }

        if !skipping_ad {
            filtered.push(line);
        }
    }
    filtered.join("\n")
}

fn rand_u32() -> u32 {
    let id = Uuid::new_v4();
    let bytes = id.as_bytes();
    u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]])
}
