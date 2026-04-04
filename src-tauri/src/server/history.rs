use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::async_runtime;
use tokio::sync::{Notify, RwLock};

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use rand::rngs::OsRng;
use rand::RngCore;
use sha2::{Digest, Sha256};

use super::error::{AppError, AppResult};
use super::types::{
    ExperienceSettings, HistoryEntry, PersistedData, SubEntry, TrustedDevice, WatchlistEntry,
};

const CURRENT_PERSISTED_SCHEMA_VERSION: u32 = 1;

// ── Token encryption helpers ───────────────────────────────────────────────────
// Uses a machine-specific key derived from the data dir path + a salt.
// Uses authenticated encryption (AES-256-GCM) with a per-token random nonce.
// This aims to protect tokens at rest against offline inspection.

fn derive_key(data_dir: &std::path::Path) -> Vec<u8> {
    let mut hasher = Sha256::new();
    hasher.update(b"NoSubVOD-token-key-v1");
    hasher.update(data_dir.to_string_lossy().as_bytes());
    // Add hostname for extra machine-specificity
    if let Ok(name) = std::env::var("COMPUTERNAME").or_else(|_| std::env::var("HOSTNAME")) {
        hasher.update(name.as_bytes());
    }
    hasher.finalize().to_vec()
}

fn backup_path_for(file_path: &Path) -> PathBuf {
    let file_name = file_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("history.json");
    file_path.with_file_name(format!("{file_name}.bak"))
}

fn temp_path_for(file_path: &Path) -> PathBuf {
    let file_name = file_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("history.json");
    file_path.with_file_name(format!("{file_name}.tmp"))
}

fn load_persisted_file(file_path: &Path) -> AppResult<Option<PersistedData>> {
    match std::fs::File::open(file_path) {
        Ok(file) => {
            let reader = std::io::BufReader::new(file);
            let data = serde_json::from_reader::<_, PersistedData>(reader)?;
            Ok(Some(data))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(AppError::Io(e)),
    }
}

fn load_with_backup(primary_path: &Path, backup_path: &Path) -> PersistedData {
    match load_persisted_file(primary_path) {
        Ok(Some(data)) => data,
        Ok(None) => match load_persisted_file(backup_path) {
            Ok(Some(backup_data)) => {
                eprintln!(
                    "[history] Primary store missing; restored from backup at {}",
                    backup_path.display()
                );
                backup_data
            }
            Ok(None) => PersistedData::default(),
            Err(err_backup) => {
                eprintln!(
                    "[history] Backup store load failed ({}): {:?}. Using defaults.",
                    backup_path.display(),
                    err_backup
                );
                PersistedData::default()
            }
        },
        Err(err_primary) => {
            eprintln!(
                "[history] Primary store load failed ({}): {:?}. Trying backup.",
                primary_path.display(),
                err_primary
            );
            match load_persisted_file(backup_path) {
                Ok(Some(backup_data)) => {
                    eprintln!(
                        "[history] Restored persisted state from backup at {}",
                        backup_path.display()
                    );
                    backup_data
                }
                Ok(None) => {
                    eprintln!(
                        "[history] No backup file found at {}. Using defaults.",
                        backup_path.display()
                    );
                    PersistedData::default()
                }
                Err(err_backup) => {
                    eprintln!(
                        "[history] Backup store load failed ({}): {:?}. Using defaults.",
                        backup_path.display(),
                        err_backup
                    );
                    PersistedData::default()
                }
            }
        }
    }
}

fn encrypt_token(token: &str, key: &[u8]) -> AppResult<String> {
    // Key must be 32 bytes for AES-256-GCM; derive_key guarantees this.
    let cipher_key = Key::<Aes256Gcm>::from_slice(key);
    let cipher = Aes256Gcm::new(cipher_key);

    // Generate a random 96-bit (12-byte) nonce for this token.
    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, token.as_bytes())
        .map_err(|_| AppError::Internal("Encryption failure".to_string()))?;

    // Store nonce || ciphertext, base64-encoded.
    let mut out = Vec::with_capacity(nonce_bytes.len() + ciphertext.len());
    out.extend_from_slice(&nonce_bytes);
    out.extend_from_slice(&ciphertext);

    Ok(B64.encode(&out))
}

fn decrypt_token(encoded: &str, key: &[u8]) -> Option<String> {
    let data = B64.decode(encoded).ok()?;

    // Must at least contain the 12-byte nonce.
    if data.len() < 12 {
        return None;
    }

    let (nonce_bytes, ciphertext) = data.split_at(12);
    let nonce = Nonce::from_slice(nonce_bytes);

    let cipher_key = Key::<Aes256Gcm>::from_slice(key);
    let cipher = Aes256Gcm::new(cipher_key);

    let plaintext = cipher.decrypt(nonce, ciphertext).ok()?;
    String::from_utf8(plaintext).ok()
}

// ── HistoryStore – wraps all persisted state ───────────────────────────────────

pub struct HistoryStore {
    data: Arc<RwLock<PersistedData>>,
    file_path: PathBuf,
    /// Encryption key derived from the data dir path
    token_key: Vec<u8>,
    /// Whether the data has changed since the last save
    dirty: Arc<AtomicBool>,
    /// Notifier to wake up the background saver task
    save_notifier: Arc<Notify>,
}

impl HistoryStore {
    /// Load from disk synchronously (file is small – safe to block on startup).
    pub fn load(data_dir: PathBuf) -> AppResult<Self> {
        let file_path = data_dir.join("history.json");
        let backup_path = backup_path_for(&file_path);
        let token_key = derive_key(&data_dir);

        let mut data = load_with_backup(&file_path, &backup_path);

        if data.schema_version == 0 {
            data.schema_version = CURRENT_PERSISTED_SCHEMA_VERSION;
        }

        // Decrypt token from disk format
        if let Some(ref encrypted) = data.twitch_token {
            data.twitch_token = decrypt_token(encrypted, &token_key);
        }

        let store = Self {
            data: Arc::new(RwLock::new(data)),
            file_path,
            token_key,
            dirty: Arc::new(AtomicBool::new(false)),
            save_notifier: Arc::new(Notify::new()),
        };

        store.spawn_background_saver();

        Ok(store)
    }

    fn spawn_background_saver(&self) {
        let data = self.data.clone();
        let file_path = self.file_path.clone();
        let token_key = self.token_key.clone();
        let dirty = self.dirty.clone();
        let notifier = self.save_notifier.clone();

        async_runtime::spawn(async move {
            loop {
                // Wait for a change
                notifier.notified().await;

                // Debounce: wait a bit before actually saving
                tokio::time::sleep(Duration::from_secs(3)).await;

                // Check if still dirty and save
                if dirty.swap(false, Ordering::SeqCst) {
                    if let Err(e) = Self::perform_save(&data, &file_path, &token_key).await {
                        eprintln!("[history] Failed to background save: {:?}", e);
                        // If save failed, put back the dirty flag so we try again later
                        dirty.store(true, Ordering::SeqCst);
                    }
                }
            }
        });
    }

    async fn perform_save(
        data_lock: &RwLock<PersistedData>,
        file_path: &Path,
        token_key: &[u8],
    ) -> AppResult<()> {
        let mut disk_data = data_lock.read().await.clone();
        disk_data.schema_version = CURRENT_PERSISTED_SCHEMA_VERSION;

        if let Some(parent) = file_path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }

        let file_path_clone = file_path.to_path_buf();
        let backup_path = backup_path_for(file_path);
        let temp_path = temp_path_for(file_path);
        let token_key_clone = token_key.to_vec();

        tokio::task::spawn_blocking(move || {
            // Move encryption inside the blocking task
            if let Some(ref plaintext) = disk_data.twitch_token {
                disk_data.twitch_token = Some(encrypt_token(plaintext, &token_key_clone)?);
            }

            let temp_file = std::fs::File::create(&temp_path)?;
            let mut writer = std::io::BufWriter::new(temp_file);
            serde_json::to_writer_pretty(&mut writer, &disk_data)?;
            writer.flush()?;
            writer.get_ref().sync_all()?;

            if file_path_clone.exists() {
                if let Err(copy_error) = std::fs::copy(&file_path_clone, &backup_path) {
                    eprintln!(
                        "[history] Failed to refresh backup {}: {}",
                        backup_path.display(),
                        copy_error
                    );
                }
            }

            #[cfg(target_os = "windows")]
            if file_path_clone.exists() {
                std::fs::remove_file(&file_path_clone)?;
            }

            std::fs::rename(&temp_path, &file_path_clone)?;
            Ok::<(), AppError>(())
        })
        .await
        .map_err(|e| AppError::Internal(e.to_string()))??;

        Ok(())
    }

    fn schedule_save(&self) {
        self.dirty.store(true, Ordering::SeqCst);
        self.save_notifier.notify_one();
    }

    // ── History ──────────────────────────────────────────────────────────────

    pub async fn get_all_history(&self) -> HashMap<String, HistoryEntry> {
        self.data.read().await.history.clone()
    }

    pub async fn get_history_paged(
        &self,
        offset: usize,
        limit: usize,
    ) -> (Vec<HistoryEntry>, usize) {
        let data = self.data.read().await;
        let total = data.history.len();
        if total == 0 || offset >= total || limit == 0 {
            return (Vec::new(), total);
        }

        let mut entries: Vec<HistoryEntry> = data.history.values().cloned().collect();

        // Partial sort: only sort what's needed for the current page
        let end = (offset + limit).min(total);
        let (prefix, nth, _) =
            entries.select_nth_unstable_by(end - 1, |a, b| b.updated_at.cmp(&a.updated_at));

        prefix.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));

        let mut head = Vec::with_capacity(prefix.len() + 1);
        head.extend(prefix.iter().cloned());
        head.push(nth.clone());

        let paginated = head.into_iter().skip(offset).take(limit).collect();

        (paginated, total)
    }

    pub async fn get_history_by_vod_id(&self, vod_id: &str) -> Option<HistoryEntry> {
        self.data.read().await.history.get(vod_id).cloned()
    }

    pub async fn update_history(
        &self,
        vod_id: &str,
        timecode: f64,
        duration: f64,
    ) -> AppResult<HistoryEntry> {
        let timecode = timecode.max(0.0);
        let updated_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| AppError::Internal(e.to_string()))?
            .as_millis() as u64;

        let entry = HistoryEntry {
            vod_id: vod_id.to_string(),
            timecode,
            duration,
            updated_at,
        };

        {
            let mut data = self.data.write().await;
            data.history.insert(vod_id.to_string(), entry.clone());
        }

        self.schedule_save();
        Ok(entry)
    }

    // ── Watchlist ────────────────────────────────────────────────────────────

    pub async fn get_watchlist(&self) -> Vec<WatchlistEntry> {
        self.data.read().await.watchlist.clone()
    }

    pub async fn get_watchlist_paged(
        &self,
        offset: usize,
        limit: usize,
    ) -> (Vec<WatchlistEntry>, usize) {
        let data = self.data.read().await;
        let total = data.watchlist.len();
        if total == 0 || offset >= total || limit == 0 {
            return (Vec::new(), total);
        }

        let mut entries = data.watchlist.clone();

        // Partial sort: newest first
        let end = (offset + limit).min(total);
        let (prefix, nth, _) =
            entries.select_nth_unstable_by(end - 1, |a, b| b.added_at.cmp(&a.added_at));
        prefix.sort_by(|a, b| b.added_at.cmp(&a.added_at));

        let mut head = Vec::with_capacity(prefix.len() + 1);
        head.extend(prefix.iter().cloned());
        head.push(nth.clone());

        let paginated = head.into_iter().skip(offset).take(limit).collect();

        (paginated, total)
    }

    pub async fn add_to_watchlist(&self, mut entry: WatchlistEntry) -> AppResult<WatchlistEntry> {
        let mut should_save = false;
        {
            let mut data = self.data.write().await;
            if !data.watchlist.iter().any(|w| w.vod_id == entry.vod_id) {
                entry.added_at = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map_err(|e| AppError::Internal(e.to_string()))?
                    .as_millis() as u64;
                data.watchlist.push(entry.clone());
                should_save = true;
            }
        }
        if should_save {
            self.schedule_save();
        }
        Ok(entry)
    }

    pub async fn remove_from_watchlist(&self, vod_id: &str) -> AppResult<()> {
        let mut should_save = false;
        {
            let mut data = self.data.write().await;
            let initial_len = data.watchlist.len();
            data.watchlist.retain(|w| w.vod_id != vod_id);
            if data.watchlist.len() != initial_len {
                should_save = true;
            }
        }
        if should_save {
            self.schedule_save();
        }
        Ok(())
    }

    // ── Settings ─────────────────────────────────────────────────────────────

    pub async fn get_settings(&self) -> ExperienceSettings {
        self.data.read().await.settings.clone()
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn update_settings(
        &self,
        one_sync: Option<bool>,
        adblock_enabled: Option<bool>,
        adblock_proxy: Option<Option<String>>,
        adblock_proxy_mode: Option<Option<String>>,
        default_video_quality: Option<Option<String>>,
        min_video_quality: Option<Option<String>>,
        preferred_video_quality: Option<Option<String>>,
        download_local_path: Option<Option<String>>,
        download_network_shared_path: Option<Option<String>>,
        launch_at_login: Option<bool>,
        auto_update: Option<bool>,
        enabled_extensions: Option<Vec<String>>,
    ) -> AppResult<ExperienceSettings> {
        {
            let mut data = self.data.write().await;
            if let Some(v) = one_sync {
                data.settings.one_sync = v;
            }
            if let Some(v) = adblock_enabled {
                data.settings.adblock_enabled = v;
            }
            if let Some(v) = adblock_proxy {
                data.settings.adblock_proxy = v;
            }
            if let Some(v) = adblock_proxy_mode {
                data.settings.adblock_proxy_mode = v;
            }
            if let Some(v) = default_video_quality {
                data.settings.default_video_quality = v;
            }
            if let Some(v) = min_video_quality {
                data.settings.min_video_quality = v;
            }
            if let Some(v) = preferred_video_quality {
                data.settings.preferred_video_quality = v;
            }
            if let Some(v) = download_local_path {
                data.settings.download_local_path = v;
            }
            if let Some(v) = download_network_shared_path {
                data.settings.download_network_shared_path = v;
            }
            if let Some(v) = launch_at_login {
                data.settings.launch_at_login = v;
            }
            if let Some(v) = auto_update {
                data.settings.auto_update = v;
            }
            if let Some(v) = enabled_extensions {
                data.settings.enabled_extensions = v;
            }
        }
        self.schedule_save();
        Ok(self.data.read().await.settings.clone())
    }

    // ── Subs ─────────────────────────────────────────────────────────────────

    pub async fn get_subs(&self) -> Vec<SubEntry> {
        self.data.read().await.subs.clone()
    }

    pub async fn get_subs_paged(&self, offset: usize, limit: usize) -> (Vec<SubEntry>, usize) {
        let data = self.data.read().await;
        let total = data.subs.len();
        if total == 0 || offset >= total || limit == 0 {
            return (Vec::new(), total);
        }

        let mut entries = data.subs.clone();

        // Partial sort: alphabetical by display_name
        let end = (offset + limit).min(total);
        let (prefix, nth, _) =
            entries.select_nth_unstable_by(end - 1, |a, b| a.display_name.cmp(&b.display_name));
        prefix.sort_by(|a, b| a.display_name.cmp(&b.display_name));

        let mut head = Vec::with_capacity(prefix.len() + 1);
        head.extend(prefix.iter().cloned());
        head.push(nth.clone());

        let paginated = head.into_iter().skip(offset).take(limit).collect();

        (paginated, total)
    }

    pub async fn add_sub(&self, entry: SubEntry) -> AppResult<SubEntry> {
        let login = entry.login.trim().to_lowercase();
        if login.is_empty() {
            return Err(AppError::BadRequest("Invalid sub login".to_string()));
        }

        let mut should_save = false;
        {
            let mut data = self.data.write().await;
            if !data.subs.iter().any(|s| s.login == login) {
                data.subs.push(SubEntry {
                    login: login.clone(),
                    display_name: entry.display_name.clone(),
                    profile_image_url: entry.profile_image_url.clone(),
                });
                should_save = true;
            }
        }
        if should_save {
            self.schedule_save();
        }
        Ok(entry)
    }

    pub async fn remove_sub(&self, login: &str) -> AppResult<()> {
        let login = login.trim().to_lowercase();
        let mut should_save = false;
        {
            let mut data = self.data.write().await;
            let initial_len = data.subs.len();
            data.subs.retain(|s| s.login != login);
            if data.subs.len() != initial_len {
                should_save = true;
            }
        }
        if should_save {
            self.schedule_save();
        }
        Ok(())
    }

    // ── Twitch token (kept server-side only, never serialised to API) ─────────

    pub async fn get_twitch_token(&self) -> Option<String> {
        self.data.read().await.twitch_token.clone()
    }

    pub async fn set_twitch_token(&self, token: Option<String>) -> AppResult<()> {
        {
            let mut data = self.data.write().await;
            data.twitch_token = token;
        }
        self.schedule_save();
        Ok(())
    }

    // ── Twitch linked account ─────────────────────────────────────────────────

    pub async fn update_twitch_account(
        &self,
        user_id: String,
        user_login: String,
        user_display_name: String,
        user_avatar: String,
    ) -> AppResult<()> {
        {
            let mut data = self.data.write().await;
            data.settings.twitch_user_id = Some(user_id);
            data.settings.twitch_user_login = Some(user_login);
            data.settings.twitch_user_display_name = Some(user_display_name);
            data.settings.twitch_user_avatar = Some(user_avatar);
        }
        self.schedule_save();
        Ok(())
    }

    pub async fn clear_twitch_account(&self) -> AppResult<()> {
        {
            let mut data = self.data.write().await;
            data.settings.twitch_user_id = None;
            data.settings.twitch_user_login = None;
            data.settings.twitch_user_display_name = None;
            data.settings.twitch_user_avatar = None;
        }
        self.schedule_save();
        Ok(())
    }

    /// Returns (top 35 history entries, all sub logins) for trending calculation.
    pub async fn get_trending_input(&self) -> (Vec<HistoryEntry>, Vec<String>) {
        let data = self.data.read().await;
        let mut history: Vec<HistoryEntry> = data.history.values().cloned().collect();
        let total = history.len();

        let count = 35.min(total);
        if count > 0 {
            let (prefix, _, _) =
                history.select_nth_unstable_by(count - 1, |a, b| b.updated_at.cmp(&a.updated_at));
            prefix.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
            history.truncate(count);
        }

        let subs = data.subs.iter().map(|s| s.login.clone()).collect();
        (history, subs)
    }

    pub async fn update_import_follows_setting(&self, value: bool) -> AppResult<()> {
        {
            let mut data = self.data.write().await;
            data.settings.twitch_import_follows = value;
        }
        self.schedule_save();
        Ok(())
    }

    // ── Trusted devices ─────────────────────────────────────────────────────

    pub async fn mark_device_seen(
        &self,
        device_id: &str,
        ip: Option<String>,
        ua: Option<String>,
    ) -> AppResult<()> {
        if device_id.trim().is_empty() {
            return Ok(());
        }

        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| AppError::Internal(e.to_string()))?
            .as_millis() as u64;

        let mut should_save = false;
        {
            let mut data = self.data.write().await;
            if let Some(existing) = data
                .trusted_devices
                .iter_mut()
                .find(|d| d.device_id == device_id)
            {
                let seen_gap_ms = now.saturating_sub(existing.last_seen_at);
                let ip_changed = existing.last_ip != ip;
                let ua_changed = existing.user_agent != ua;
                if seen_gap_ms >= 60_000 || ip_changed || ua_changed {
                    existing.last_seen_at = now;
                    existing.last_ip = ip;
                    existing.user_agent = ua;
                    should_save = true;
                }
            } else {
                data.trusted_devices.push(TrustedDevice {
                    device_id: device_id.to_string(),
                    first_seen_at: now,
                    last_seen_at: now,
                    last_ip: ip,
                    user_agent: ua,
                    trusted: false,
                });
                should_save = true;
            }
        }

        if should_save {
            self.schedule_save();
        }
        Ok(())
    }

    pub async fn get_trusted_devices(&self) -> Vec<TrustedDevice> {
        let mut devices = self.data.read().await.trusted_devices.clone();
        devices.sort_by(|a, b| b.last_seen_at.cmp(&a.last_seen_at));
        devices
    }

    pub async fn is_device_trusted(&self, device_id: &str) -> bool {
        if device_id.trim().is_empty() {
            return false;
        }

        self.data
            .read()
            .await
            .trusted_devices
            .iter()
            .any(|d| d.device_id == device_id && d.trusted)
    }

    pub async fn set_device_trusted(
        &self,
        device_id: &str,
        trusted: bool,
    ) -> AppResult<Option<TrustedDevice>> {
        if device_id.trim().is_empty() {
            return Ok(None);
        }

        let mut updated = None;
        {
            let mut data = self.data.write().await;
            if let Some(device) = data
                .trusted_devices
                .iter_mut()
                .find(|d| d.device_id == device_id)
            {
                device.trusted = trusted;
                updated = Some(device.clone());
            }
        }

        if updated.is_some() {
            self.schedule_save();
        }

        Ok(updated)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_token_encryption_roundtrip() {
        let dir = tempdir().unwrap();
        let key = derive_key(dir.path());
        let token = "my_secret_twitch_token_123";

        let encrypted = encrypt_token(token, &key).expect("Encryption failed");
        assert_ne!(token, encrypted);

        let decrypted = decrypt_token(&encrypted, &key).expect("Decryption failed");
        assert_eq!(token, decrypted);
    }

    #[test]
    fn test_token_decryption_failure() {
        let dir = tempdir().unwrap();
        let key = derive_key(dir.path());
        let wrong_key = derive_key(Path::new("somewhere_else"));
        let token = "secret";

        let encrypted = encrypt_token(token, &key).unwrap();
        let decrypted = decrypt_token(&encrypted, &wrong_key);
        assert!(decrypted.is_none());
    }

    #[tokio::test]
    async fn test_history_store_basic_ops() {
        let dir = tempdir().unwrap();
        let store = HistoryStore::load(dir.path().to_path_buf()).unwrap();

        // Test history update
        store.update_history("vod123", 10.5, 3600.0).await.unwrap();
        let history = store.get_history_by_vod_id("vod123").await.unwrap();
        assert_eq!(history.timecode, 10.5);
        assert_eq!(history.duration, 3600.0);

        // Test watchlist
        let entry = WatchlistEntry {
            vod_id: "vod456".to_string(),
            title: "Test VOD".to_string(),
            preview_thumbnail_url: "http://example.com/thumb.jpg".to_string(),
            length_seconds: 1200,
            added_at: 0,
        };
        store.add_to_watchlist(entry).await.unwrap();
        let watchlist = store.get_watchlist().await;
        assert_eq!(watchlist.len(), 1);
        assert_eq!(watchlist[0].vod_id, "vod456");

        store.remove_from_watchlist("vod456").await.unwrap();
        assert_eq!(store.get_watchlist().await.len(), 0);

        // Test subs
        let sub = SubEntry {
            login: "testuser".to_string(),
            display_name: "TestUser".to_string(),
            profile_image_url: "http://example.com/avatar.png".to_string(),
        };
        store.add_sub(sub).await.unwrap();
        let subs = store.get_subs().await;
        assert_eq!(subs.len(), 1);
        assert_eq!(subs[0].login, "testuser");
    }

    #[tokio::test]
    async fn test_history_pagination_offset_page_returns_item() {
        let dir = tempdir().unwrap();
        let store = HistoryStore::load(dir.path().to_path_buf()).unwrap();

        store.update_history("vod-a", 42.0, 120.0).await.unwrap();
        store.update_history("vod-b", 84.0, 240.0).await.unwrap();

        let (page, total) = store.get_history_paged(1, 1).await;
        assert_eq!(total, 2);
        assert_eq!(page.len(), 1);
    }

    #[tokio::test]
    async fn test_watchlist_pagination_offset_page_returns_item() {
        let dir = tempdir().unwrap();
        let store = HistoryStore::load(dir.path().to_path_buf()).unwrap();

        store
            .add_to_watchlist(WatchlistEntry {
                vod_id: "vod-a".to_string(),
                title: "A".to_string(),
                preview_thumbnail_url: "http://example.com/a.jpg".to_string(),
                length_seconds: 100,
                added_at: 0,
            })
            .await
            .unwrap();
        store
            .add_to_watchlist(WatchlistEntry {
                vod_id: "vod-b".to_string(),
                title: "B".to_string(),
                preview_thumbnail_url: "http://example.com/b.jpg".to_string(),
                length_seconds: 200,
                added_at: 0,
            })
            .await
            .unwrap();

        let (page, total) = store.get_watchlist_paged(1, 1).await;
        assert_eq!(total, 2);
        assert_eq!(page.len(), 1);
    }
}
