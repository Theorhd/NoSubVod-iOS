use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use futures::stream::{self, StreamExt};
use reqwest::Client;
use serde::Serialize;
use tokio::io::{AsyncWriteExt, BufWriter};
use tokio::sync::RwLock;
use tracing::{info, instrument};

use super::http_utils::{get_bytes_checked, get_text_checked};
use super::url_utils::{extract_origin, resolve_url};
use crate::server::error::AppError;

// ── Public types ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub enum DownloadStatus {
    Queued,
    Downloading,
    Finished,
    Error(String),
}

#[derive(Debug, Clone, Serialize)]
pub struct DownloadProgress {
    #[serde(rename = "vodId")]
    pub vod_id: Arc<str>,
    pub title: Arc<str>,
    pub status: DownloadStatus,
    pub progress: f64,        // 0.0 – 100.0
    pub current_time: String, // "HH:MM:SS" of content downloaded so far
    pub total_duration: f64,  // seconds
}

// ── Manager ───────────────────────────────────────────────────────────────────

pub type ActiveDownloads = Arc<RwLock<HashMap<Arc<str>, Arc<RwLock<DownloadProgress>>>>>;

const MAX_TRACKED_DOWNLOADS: usize = 256;

pub struct DownloadManager {
    /// Granular locking: the map itself is RwLocked, and each progress entry is also RwLocked.
    pub active_downloads: ActiveDownloads,
}

impl Default for DownloadManager {
    fn default() -> Self {
        Self::new()
    }
}

use crate::server::error::AppResult;

impl DownloadManager {
    pub fn new() -> Self {
        Self {
            active_downloads: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Start a download entirely in Rust – no ffmpeg required.
    ///
    /// `m3u8_url`    – URL of the HLS master playlist (served by the local proxy).
    /// `output_path` – destination file path (should end in `.ts`).
    /// `start_time` / `end_time` – optional clip window in seconds.
    #[allow(clippy::too_many_arguments)]
    #[instrument(skip(self), fields(vod_id = %vod_id_raw, title = %title_raw))]
    pub async fn start_download(
        &self,
        vod_id_raw: String,
        title_raw: String,
        m3u8_url: String,
        output_path: String,
        start_time: Option<f64>,
        end_time: Option<f64>,
        total_duration: f64,
    ) -> AppResult<()> {
        let vod_id: Arc<str> = Arc::from(vod_id_raw);
        let title: Arc<str> = Arc::from(title_raw);

        info!(
            vod_id = %vod_id,
            "Starting download task for VOD"
        );
        let progress = DownloadProgress {
            vod_id: vod_id.clone(),
            title: title.clone(),
            status: DownloadStatus::Queued,
            progress: 0.0,
            current_time: "00:00:00".to_string(),
            total_duration,
        };
        let progress_arc = Arc::new(RwLock::new(progress));

        self.active_downloads.write().await.retain(|_, progress| {
            if let Ok(lock) = progress.try_read() {
                !matches!(
                    lock.status,
                    DownloadStatus::Finished | DownloadStatus::Error(_)
                )
            } else {
                true
            }
        });

        {
            let mut lock = self.active_downloads.write().await;
            if !lock.contains_key(&vod_id) && lock.len() >= MAX_TRACKED_DOWNLOADS {
                return Err(AppError::BadRequest(
                    "Too many tracked downloads, clear finished items first".to_string(),
                ));
            }
            lock.insert(vod_id.clone(), progress_arc.clone());
        }

        let active_downloads = self.active_downloads.clone();
        let vod_id_task = vod_id.clone();

        tokio::spawn(async move {
            let client_res = Client::builder().timeout(Duration::from_secs(60)).build();

            let client = match client_res {
                Ok(c) => c,
                Err(e) => {
                    set_error(&active_downloads, &vod_id_task, e.to_string()).await;
                    return;
                }
            };

            // Derive the server origin from the master URL so we can resolve
            // relative paths returned by the proxy ("/api/stream/variant.ts?id=…").
            let origin = extract_origin(&m3u8_url);

            // ── Step 1: master playlist → best variant URL ────────────────────
            let master_text = match get_text_checked(&client, &m3u8_url).await {
                Ok(t) => t,
                Err(e) => {
                    set_error(&active_downloads, &vod_id_task, e.to_string()).await;
                    return;
                }
            };

            let variant_url = match best_variant_url(&master_text, &origin, &m3u8_url) {
                Some(u) => u,
                None => {
                    set_error(
                        &active_downloads,
                        &vod_id_task,
                        "No playable quality found in master playlist".to_string(),
                    )
                    .await;
                    return;
                }
            };

            // ── Step 2: variant playlist → segment list ───────────────────────
            let variant_text = match get_text_checked(&client, &variant_url).await {
                Ok(t) => t,
                Err(e) => {
                    set_error(&active_downloads, &vod_id_task, e.to_string()).await;
                    return;
                }
            };

            let all_segments = parse_segments(&variant_text, &origin, &variant_url);
            if all_segments.is_empty() {
                set_error(
                    &active_downloads,
                    &vod_id_task,
                    "Variant playlist contains no segments".to_string(),
                )
                .await;
                return;
            }

            // ── Step 3: filter by [start_time, end_time] ──────────────────────
            let clip_duration = match (start_time, end_time) {
                (Some(s), Some(e)) if e > s => e - s,
                _ => total_duration,
            };

            let segments = filter_segments_by_time(&all_segments, start_time, end_time);
            let total_segments = segments.len();

            if total_segments == 0 {
                set_error(
                    &active_downloads,
                    &vod_id_task,
                    "No segments match the requested time range".to_string(),
                )
                .await;
                return;
            }

            // ── Step 4: create output file ────────────────────────────────────
            let raw_file = match tokio::fs::File::create(&output_path).await {
                Ok(f) => f,
                Err(e) => {
                    set_error(
                        &active_downloads,
                        &vod_id_task,
                        format!("Cannot create output file '{output_path}': {e}"),
                    )
                    .await;
                    return;
                }
            };
            let mut file = BufWriter::new(raw_file);

            {
                let mut lock = progress_arc.write().await;
                lock.status = DownloadStatus::Downloading;
            }

            // ── Step 5: download segments (up to 4 in parallel, in order) ─────
            const CONCURRENCY: usize = 4;
            let mut elapsed_secs: f64 = 0.0;
            let mut segments_done: usize = 0;
            let mut last_reported_prog: f64 = 0.0;

            let mut seg_iter = segments.into_iter().peekable();

            'outer: while seg_iter.peek().is_some() {
                let batch: Vec<Segment> = seg_iter.by_ref().take(CONCURRENCY).collect();

                // Segments already have Arc<str> for URLs
                let batch_urls: Vec<Arc<str>> = batch.iter().map(|s| s.url.clone()).collect();
                let results: Vec<AppResult<bytes::Bytes>> =
                    stream::iter(batch_urls.into_iter().map(|url| {
                        let client = client.clone();
                        async move { get_bytes_checked(&client, &url).await }
                    }))
                    .buffered(CONCURRENCY)
                    .collect()
                    .await;

                for (seg, result) in batch.iter().zip(results) {
                    match result {
                        Err(e) => {
                            set_error(
                                &active_downloads,
                                &vod_id_task,
                                format!("Segment download failed ({}): {}", seg.url, e),
                            )
                            .await;
                            let _ = tokio::fs::remove_file(&output_path).await;
                            break 'outer;
                        }
                        Ok(data) => {
                            if let Err(e) = file.write_all(&data).await {
                                set_error(
                                    &active_downloads,
                                    &vod_id_task,
                                    format!("Write error: {e}"),
                                )
                                .await;
                                let _ = tokio::fs::remove_file(&output_path).await;
                                break 'outer;
                            }

                            elapsed_secs += seg.duration;
                            segments_done += 1;

                            let prog =
                                (segments_done as f64 / total_segments as f64 * 100.0).min(100.0);

                            // Throttle progress updates to reduce lock contention: update every 1% or at the end.
                            if (prog - last_reported_prog).abs() >= 1.0
                                || segments_done == total_segments
                            {
                                last_reported_prog = prog;
                                let content_secs =
                                    (start_time.unwrap_or(0.0) + elapsed_secs).min(clip_duration);
                                let h = (content_secs / 3600.0) as u32;
                                let m = ((content_secs % 3600.0) / 60.0) as u32;
                                let s = (content_secs % 60.0) as u32;

                                let mut lock = progress_arc.write().await;
                                lock.progress = prog;
                                lock.current_time = format!("{h:02}:{m:02}:{s:02}");
                            }
                        }
                    }
                }
            }

            // Only mark Finished if we actually completed all segments.
            if segments_done == total_segments {
                let _ = file.flush().await;
                let mut lock = progress_arc.write().await;
                lock.status = DownloadStatus::Finished;
                lock.progress = 100.0;
            }
        });

        Ok(())
    }

    pub async fn get_all_downloads(&self) -> Vec<DownloadProgress> {
        let lock = self.active_downloads.read().await;
        let mut results = Vec::with_capacity(lock.len());
        for p_arc in lock.values() {
            results.push(p_arc.read().await.clone());
        }
        results
    }

    pub async fn clear_finished(&self) {
        let mut lock = self.active_downloads.write().await;
        let mut to_remove = Vec::new();

        for (id, p_arc) in lock.iter() {
            let p = p_arc.read().await;
            if matches!(
                p.status,
                DownloadStatus::Finished | DownloadStatus::Error(_)
            ) {
                to_remove.push(id.clone());
            }
        }

        for id in to_remove {
            lock.remove(&id);
        }
    }
}

// ── Helper types ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
struct Segment {
    url: Arc<str>,
    duration: f64,
}

// ── M3U8 parsing ─────────────────────────────────────────────────────────────

/// Return the absolute URL of the highest-bandwidth variant stream.
fn best_variant_url(master: &str, origin: &str, master_url: &str) -> Option<String> {
    let mut best: Option<(u64, String)> = None;
    let lines: Vec<&str> = master.lines().collect();
    let mut i = 0;
    while i < lines.len() {
        let line = lines[i].trim();
        if line.starts_with("#EXT-X-STREAM-INF:") {
            let bw = parse_bandwidth(line);
            if let Some(url_line) = lines.get(i + 1) {
                let url_line = url_line.trim();
                if !url_line.is_empty() && !url_line.starts_with('#') {
                    let abs = resolve_url(url_line, origin, master_url).into_owned();
                    if best.is_none() || bw > best.as_ref().unwrap().0 {
                        best = Some((bw, abs));
                    }
                }
            }
        }
        i += 1;
    }
    best.map(|(_, u)| u)
}

/// Parse BANDWIDTH= from an EXT-X-STREAM-INF tag line.
fn parse_bandwidth(tag: &str) -> u64 {
    tag.split([',', ':'])
        .find(|p| p.trim().starts_with("BANDWIDTH="))
        .and_then(|p| p.split('=').nth(1))
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(0)
}

/// Parse all #EXTINF segments from a variant playlist.
/// Ad segments (Twitch-specific tags) are silently skipped.
fn parse_segments(playlist: &str, origin: &str, base_url: &str) -> Vec<Segment> {
    let mut segments = Vec::new();
    let mut pending_duration: Option<f64> = None;
    let mut skipping_ad = false;

    for line in playlist.lines() {
        let l = line.trim();

        // Detect Twitch ad blocks
        if l.starts_with("#EXT-X-TWITCH-AD")
            || l.starts_with("#EXT-X-AD")
            || l.starts_with("#EXT-X-TWITCH-CONTENT-TYPE:ad")
            || l.contains("AD-DURATION")
        {
            skipping_ad = true;
            continue;
        }
        if skipping_ad {
            if l.starts_with("#EXT-X-TWITCH-CONTENT-TYPE:live")
                || l.starts_with("#EXT-X-TWITCH-CONTENT-TYPE:video")
            {
                skipping_ad = false;
            } else {
                continue;
            }
        }

        if let Some(rest) = l.strip_prefix("#EXTINF:") {
            // e.g. "#EXTINF:6.006000,"
            let dur_str = rest.split(',').next().unwrap_or("0");
            pending_duration = dur_str.parse::<f64>().ok();
        } else if !l.is_empty() && !l.starts_with('#') {
            let dur = pending_duration.take().unwrap_or(0.0);
            segments.push(Segment {
                url: Arc::from(resolve_url(l, origin, base_url).as_ref()),
                duration: dur,
            });
        }
    }
    segments
}

/// Keep only segments whose playback window overlaps [start_time, end_time].
fn filter_segments_by_time(
    segs: &[Segment],
    start_time: Option<f64>,
    end_time: Option<f64>,
) -> Vec<Segment> {
    if start_time.is_none() && end_time.is_none() {
        return segs.to_vec();
    }
    let start = start_time.unwrap_or(0.0);
    let end = end_time.unwrap_or(f64::MAX);
    let mut result = Vec::new();
    let mut cursor: f64 = 0.0;
    for seg in segs {
        let seg_end = cursor + seg.duration;
        if seg_end > start && cursor < end {
            result.push(seg.clone());
        }
        cursor = seg_end;
        if cursor >= end {
            break;
        }
    }
    result
}

// ── Error helper ──────────────────────────────────────────────────────────────

async fn set_error(downloads: &ActiveDownloads, vod_id: &Arc<str>, msg: String) {
    eprintln!("[download] error for {vod_id}: {msg}");
    let lock = downloads.read().await;
    if let Some(p_arc) = lock.get(vod_id) {
        let mut p = p_arc.write().await;
        p.status = DownloadStatus::Error(msg);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_bandwidth() {
        assert_eq!(
            parse_bandwidth("#EXT-X-STREAM-INF:BANDWIDTH=1280000,CODECS=\"avc1.42e01e\""),
            1280000
        );
        assert_eq!(
            parse_bandwidth("#EXT-X-STREAM-INF:CODECS=\"avc1\",BANDWIDTH=500"),
            500
        );
        assert_eq!(parse_bandwidth("#EXT-X-STREAM-INF:NOBANDWIDTH"), 0);
    }

    #[test]
    fn test_best_variant_url() {
        let master = r#"#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=1000
low.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=5000
high.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2500
mid.m3u8
"#;
        let best = best_variant_url(master, "http://localhost", "http://localhost/master.m3u8");
        assert_eq!(best, Some("http://localhost/high.m3u8".to_string()));
    }

    #[test]
    fn test_parse_segments() {
        let variant = r#"#EXTM3U
#EXTINF:10.0,
seg1.ts
#EXT-X-TWITCH-AD-START
#EXTINF:5.0,
ad.ts
#EXT-X-TWITCH-CONTENT-TYPE:live
#EXTINF:10.0,
seg2.ts
"#;
        let segments = parse_segments(variant, "http://localhost", "http://localhost/variant.m3u8");
        assert_eq!(segments.len(), 2);
        assert_eq!(segments[0].duration, 10.0);
        assert!(segments[0].url.contains("seg1.ts"));
        assert_eq!(segments[1].duration, 10.0);
        assert!(segments[1].url.contains("seg2.ts"));
    }

    #[test]
    fn test_filter_segments_by_time() {
        let segs = vec![
            Segment {
                url: Arc::from("s1"),
                duration: 10.0,
            },
            Segment {
                url: Arc::from("s2"),
                duration: 10.0,
            },
            Segment {
                url: Arc::from("s3"),
                duration: 10.0,
            },
        ];

        // [0-10], [10-20], [20-30]

        // Keep all
        assert_eq!(filter_segments_by_time(&segs, None, None).len(), 3);

        // Clip [5, 15] -> should keep s1 (ends at 10) and s2 (starts at 10)
        let filtered = filter_segments_by_time(&segs, Some(5.0), Some(15.0));
        assert_eq!(filtered.len(), 2);
        assert_eq!(filtered[0].url.as_ref(), "s1");
        assert_eq!(filtered[1].url.as_ref(), "s2");

        // Clip [15, 25] -> should keep s2 and s3
        let filtered = filter_segments_by_time(&segs, Some(15.0), Some(25.0));
        assert_eq!(filtered.len(), 2);
        assert_eq!(filtered[0].url.as_ref(), "s2");
        assert_eq!(filtered[1].url.as_ref(), "s3");

        // Clip [25, 35] -> should keep s3
        let filtered = filter_segments_by_time(&segs, Some(25.0), Some(35.0));
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].url.as_ref(), "s3");
    }
}
