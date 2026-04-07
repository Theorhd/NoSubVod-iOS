use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Duration;

use futures::stream::{self, StreamExt};
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tauri_plugin_notification::NotificationExt;
use tokio::sync::RwLock;

use super::history::HistoryStore;
use super::twitch::TwitchService;
use super::types::{SubEntry, Vod};

const STARTUP_DELAY: Duration = Duration::from_secs(12);
const POLL_INTERVAL: Duration = Duration::from_secs(75);
const VOD_FETCH_CONCURRENCY: usize = 6;

#[derive(Debug, Clone, Default)]
struct SubNotificationCursor {
    primed: bool,
    last_live_id: Option<String>,
    last_vod_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
struct AppNotificationPayload {
    title: String,
    message: String,
}

#[derive(Clone)]
pub struct SubNotificationService {
    history: Arc<HistoryStore>,
    twitch: Arc<TwitchService>,
    app: AppHandle,
    cursors: Arc<RwLock<HashMap<String, SubNotificationCursor>>>,
}

impl SubNotificationService {
    pub fn spawn(history: Arc<HistoryStore>, twitch: Arc<TwitchService>, app: AppHandle) {
        let service = Self {
            history,
            twitch,
            app,
            cursors: Arc::new(RwLock::new(HashMap::new())),
        };

        tauri::async_runtime::spawn(async move {
            service.run().await;
        });
    }

    async fn run(self) {
        tokio::time::sleep(STARTUP_DELAY).await;

        loop {
            if let Err(error) = self.tick().await {
                tracing::warn!(error = %error, "Sub notification tick failed");
            }

            tokio::time::sleep(POLL_INTERVAL).await;
        }
    }

    async fn tick(&self) -> Result<(), String> {
        let all_subs = self.history.get_subs().await;
        let tracked_subs: Vec<SubEntry> = all_subs
            .into_iter()
            .filter(|entry| {
                entry.notifications.enabled && (entry.notifications.live || entry.notifications.vod)
            })
            .collect();

        if tracked_subs.is_empty() {
            self.cursors.write().await.clear();
            return Ok(());
        }

        let tracked_logins: HashSet<String> = tracked_subs
            .iter()
            .map(|entry| normalize_login(&entry.login))
            .collect();

        let live_targets: Vec<String> = tracked_subs
            .iter()
            .filter(|entry| entry.notifications.live)
            .map(|entry| normalize_login(&entry.login))
            .collect();

        let live_by_login = if live_targets.is_empty() {
            HashMap::new()
        } else {
            self.twitch.fetch_live_status_by_logins(live_targets).await
        };

        let vod_targets: Vec<String> = tracked_subs
            .iter()
            .filter(|entry| entry.notifications.vod)
            .map(|entry| normalize_login(&entry.login))
            .collect();

        let latest_vods_by_login = self.fetch_latest_vods(vod_targets).await;

        let mut cursors = self.cursors.write().await;
        for entry in &tracked_subs {
            let login = normalize_login(&entry.login);
            let cursor = cursors.entry(login.clone()).or_default();

            if !cursor.primed {
                if entry.notifications.live {
                    cursor.last_live_id = live_by_login.get(&login).map(|stream| stream.id.clone());
                }
                if entry.notifications.vod {
                    cursor.last_vod_id = latest_vods_by_login.get(&login).map(|vod| vod.id.clone());
                }
                cursor.primed = true;
                continue;
            }

            if entry.notifications.live {
                if let Some(stream) = live_by_login.get(&login) {
                    let has_changed = cursor.last_live_id.as_deref() != Some(stream.id.as_str());
                    if has_changed {
                        cursor.last_live_id = Some(stream.id.clone());
                        self.emit_notification(
                            "Live demarre",
                            format!(
                                "{} est en live: {}",
                                display_name_for(entry),
                                truncate_text(&stream.title, 100)
                            ),
                        );
                    }
                }
            }

            if entry.notifications.vod {
                if let Some(vod) = latest_vods_by_login.get(&login) {
                    let has_changed = cursor.last_vod_id.as_deref() != Some(vod.id.as_str());
                    if has_changed {
                        cursor.last_vod_id = Some(vod.id.clone());
                        self.emit_notification(
                            "Nouvelle VOD",
                            format!(
                                "{} vient de publier: {}",
                                display_name_for(entry),
                                truncate_text(&vod.title, 100)
                            ),
                        );
                    }
                }
            }
        }

        cursors.retain(|login, _| tracked_logins.contains(login));
        Ok(())
    }

    async fn fetch_latest_vods(&self, targets: Vec<String>) -> HashMap<String, Vod> {
        if targets.is_empty() {
            return HashMap::new();
        }

        let twitch = self.twitch.clone();

        stream::iter(targets.into_iter())
            .map(move |login| {
                let twitch = twitch.clone();
                async move {
                    match twitch.fetch_user_vods(&login).await {
                        Ok(vods) => (login, vods.into_iter().next()),
                        Err(_) => (login, None),
                    }
                }
            })
            .buffer_unordered(VOD_FETCH_CONCURRENCY)
            .filter_map(|(login, latest_vod)| async move {
                latest_vod.map(|vod| (normalize_login(&login), vod))
            })
            .collect::<HashMap<_, _>>()
            .await
    }

    fn emit_notification(&self, title: &str, message: String) {
        let payload = AppNotificationPayload {
            title: title.to_string(),
            message,
        };

        if let Err(error) = self
            .app
            .notification()
            .builder()
            .title(&payload.title)
            .body(&payload.message)
            .show()
        {
            tracing::warn!(error = %error, "Failed to show native notification");
        }

        if let Err(error) = self.app.emit("nsv-notification", payload) {
            tracing::warn!(error = %error, "Failed to emit app notification");
        }
    }
}

fn normalize_login(value: &str) -> String {
    value.trim().to_lowercase()
}

fn display_name_for(sub: &SubEntry) -> String {
    if sub.display_name.trim().is_empty() {
        sub.login.clone()
    } else {
        sub.display_name.clone()
    }
}

fn truncate_text(value: &str, max_len: usize) -> String {
    let trimmed = value.trim();
    let mut output = String::new();

    for (index, ch) in trimmed.chars().enumerate() {
        if index >= max_len {
            output.push_str("...");
            return output;
        }
        output.push(ch);
    }

    output
}
