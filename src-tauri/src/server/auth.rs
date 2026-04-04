use std::collections::HashMap;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::RwLock;

use once_cell::sync::Lazy;

use axum::{
    extract::{Query, State},
    response::{Html, IntoResponse, Redirect, Response},
    Json,
};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use tracing::{info, instrument};

use super::state::ApiState;
use super::types::SubEntry;

// ── CONFIGURE YOUR TWITCH APP HERE ─────────────────────────────────────────────
// 1. Register your app at https://dev.twitch.tv/console/apps
// 2. Add this redirect URI: http://localhost:23400/api/auth/twitch/callback
// 3. Required scopes: user:read:follows user:write:chat
// 4. Set TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET in src-tauri/.env (see .env.example)
pub static TWITCH_CLIENT_ID: Lazy<String> = Lazy::new(|| {
    std::env::var("TWITCH_CLIENT_ID")
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| {
            option_env!("TWITCH_CLIENT_ID")
                .unwrap_or_default()
                .trim()
                .to_string()
        })
});
pub static TWITCH_CLIENT_SECRET: Lazy<String> = Lazy::new(|| {
    std::env::var("TWITCH_CLIENT_SECRET")
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| {
            option_env!("TWITCH_CLIENT_SECRET")
                .unwrap_or_default()
                .trim()
                .to_string()
        })
});

const REDIRECT_URI: &str = "http://localhost:23400/api/auth/twitch/callback";
const SCOPES: &str = "user:read:follows user:write:chat";

// ── In-memory OAuth pending state ──────────────────────────────────────────────

pub struct PendingOAuth {
    pub code_verifier: String,
    pub created_at: u64,
}

#[derive(Clone)]
pub struct OAuthStateStore {
    /// Maps state token → PendingOAuth for in-flight OAuth requests.
    pub pending: Arc<RwLock<HashMap<String, PendingOAuth>>>,
}

impl Default for OAuthStateStore {
    fn default() -> Self {
        Self::new()
    }
}

impl OAuthStateStore {
    pub fn new() -> Self {
        Self {
            pending: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Remove entries older than 10 minutes.
    pub async fn cleanup_expired(&self) {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let mut pending = self.pending.write().await;
        // Keep only those created within the last 600 seconds (10 mins)
        pending.retain(|_, v| now.saturating_sub(v.created_at) < 600);
    }
}

// ── PKCE helpers ───────────────────────────────────────────────────────────────

fn random_string(len: usize) -> String {
    use uuid::Uuid;
    let mut s = String::new();
    while s.len() < len {
        s.push_str(&Uuid::new_v4().to_string().replace('-', ""));
    }
    s.truncate(len);
    s
}

fn base64url(data: &[u8]) -> String {
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    use base64::Engine;
    URL_SAFE_NO_PAD.encode(data)
}

fn pkce_challenge(verifier: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(verifier.as_bytes());
    base64url(&hasher.finalize())
}

// ── Shared HTML helper ─────────────────────────────────────────────────────────

fn close_tab_html(msg: &str, success: bool) -> Html<String> {
    let (icon, color) = if success {
        ("✓", "#4ade80")
    } else {
        ("✗", "#ff4a4a")
    };
    let status = if success { "success" } else { "error" };
    Html(format!(
        r#"<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
        body{{background:#0e0e10;color:#efeff1;font-family:Inter,Helvetica,sans-serif;
                display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center;padding:16px;box-sizing:border-box}}
        .icon{{font-size:3rem;margin-bottom:12px}}.msg{{color:{color};font-size:1rem;max-width:420px;line-height:1.5}}
                .hint{{opacity:.85;font-size:.9rem;margin-top:10px;max-width:420px}}
                .btn{{margin-top:14px;background:#2f81f7;color:#fff;border:none;border-radius:8px;padding:10px 14px;font-size:.95rem}}
        </style></head><body><div><div class="icon">{icon}</div><p class="msg">{msg}</p></div>
                <p class="hint">Si cette fenetre ne se ferme pas automatiquement, revenez a NoSubVOD via le bouton "Terminer" de Safari.</p>
                <button class="btn" id="nsv-close">Fermer</button>
                <script>
                (function() {{
                    const payload = {{ type: "nsv:twitch-auth", status: "{status}", at: Date.now() }};
                    try {{
                        if (window.opener && !window.opener.closed) {{
                            window.opener.postMessage(payload, "*");
                        }}
                    }} catch (_err) {{}}
                    try {{
                        localStorage.setItem("nsv_twitch_oauth_status", JSON.stringify(payload));
                    }} catch (_err) {{}}

                    const closeNow = function () {{
                        try {{ window.close(); }} catch (_err) {{}}
                    }};

                    const button = document.getElementById("nsv-close");
                    if (button) {{
                        button.addEventListener("click", closeNow);
                    }}

                    setTimeout(closeNow, 1800);
                }})();
                </script></body></html>"#
    ))
}

fn client_not_configured() -> Response {
    (
        axum::http::StatusCode::SERVICE_UNAVAILABLE,
        Json(serde_json::json!({
            "error": "Twitch OAuth Client credentials not configured. \
                      Crée src-tauri/.env avec TWITCH_CLIENT_ID=ton_id et TWITCH_CLIENT_SECRET=ton_secret \
                      (voir src-tauri/.env.example et https://dev.twitch.tv/console/apps)"
        })),
    )
        .into_response()
}

fn twitch_client_configured() -> bool {
    !TWITCH_CLIENT_ID.trim().is_empty() && !TWITCH_CLIENT_SECRET.trim().is_empty()
}

async fn build_twitch_auth_url(state: &ApiState) -> Result<String, Response> {
    if !twitch_client_configured() {
        return Err(client_not_configured());
    }

    // Proactive cleanup
    state.oauth.cleanup_expired().await;

    let state_token = random_string(32);
    let code_verifier = random_string(64);
    let challenge = pkce_challenge(&code_verifier);

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    state.oauth.pending.write().await.insert(
        state_token.clone(),
        PendingOAuth {
            code_verifier,
            created_at: now,
        },
    );

    let auth_url = format!(
        "https://id.twitch.tv/oauth2/authorize\
         ?client_id={client_id}\
         &redirect_uri={redirect}\
         &response_type=code\
         &scope={scopes}\
         &state={state}\
         &code_challenge={challenge}\
         &code_challenge_method=S256",
        client_id = TWITCH_CLIENT_ID.as_str(),
        redirect = urlencoding::encode(REDIRECT_URI),
        scopes = urlencoding::encode(SCOPES),
        state = state_token,
        challenge = challenge,
    );

    Ok(auth_url)
}

// ── Route handlers ─────────────────────────────────────────────────────────────

/// GET /api/auth/twitch/start
/// Returns { authUrl } — frontend opens this URL in a new tab.
pub async fn handle_auth_start(State(state): State<ApiState>) -> Response {
    match build_twitch_auth_url(&state).await {
        Ok(auth_url) => Json(serde_json::json!({ "authUrl": auth_url })).into_response(),
        Err(err_response) => err_response,
    }
}

/// GET /api/auth/twitch/begin
/// Immediately redirects to Twitch OAuth so frontend can open this endpoint
/// synchronously in a separate Safari sheet/window.
pub async fn handle_auth_begin(State(state): State<ApiState>) -> Response {
    match build_twitch_auth_url(&state).await {
        Ok(auth_url) => Redirect::temporary(&auth_url).into_response(),
        Err(err_response) => err_response,
    }
}

#[derive(Deserialize)]
pub struct CallbackQuery {
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
}

use crate::server::error::{AppError, AppResult};

/// GET /api/auth/twitch/callback  (Twitch redirects here after user approves)
#[instrument(skip(state, q), fields(state_token = q.state))]
pub async fn handle_auth_callback(
    Query(q): Query<CallbackQuery>,
    State(state): State<ApiState>,
) -> Response {
    info!("Received Twitch OAuth callback");

    // Proactive cleanup
    state.oauth.cleanup_expired().await;

    if let Some(err) = q.error {
        let desc = q.error_description.unwrap_or_default();
        return close_tab_html(
            &format!("Twitch a refusé la connexion : {err} — {desc}"),
            false,
        )
        .into_response();
    }

    let (code, state_token) = match (q.code, q.state) {
        (Some(c), Some(s)) => (c, s),
        _ => return close_tab_html("Paramètres OAuth manquants.", false).into_response(),
    };

    let code_verifier = {
        let mut pending = state.oauth.pending.write().await;
        match pending.remove(&state_token) {
            Some(p) => p.code_verifier,
            None => {
                return close_tab_html(
                    "État OAuth invalide ou expiré. Reconnecte-toi depuis les Settings.",
                    false,
                )
                .into_response()
            }
        }
    };

    // ── Exchange authorization code for access token ────────────────────────
    let client = state.twitch.shared_client().clone();
    let token_res: Result<reqwest::Response, reqwest::Error> = client
        .post("https://id.twitch.tv/oauth2/token")
        .form(&[
            ("client_id", TWITCH_CLIENT_ID.as_str()),
            ("client_secret", TWITCH_CLIENT_SECRET.as_str()),
            ("grant_type", "authorization_code"),
            ("code", code.as_str()),
            ("redirect_uri", REDIRECT_URI),
            ("code_verifier", code_verifier.as_str()),
        ])
        .send()
        .await;

    let access_token = match token_res {
        Ok(r) if r.status().is_success() => match r.json::<serde_json::Value>().await {
            Ok(body) => match body.get("access_token").and_then(|v| v.as_str()) {
                Some(t) => t.to_string(),
                None => {
                    return close_tab_html("Pas de token dans la réponse Twitch.", false)
                        .into_response()
                }
            },
            Err(e) => {
                return close_tab_html(&format!("Réponse invalide : {e}"), false).into_response()
            }
        },
        Ok(r) => {
            let status = r.status();
            let body = r.text().await.unwrap_or_default();
            return close_tab_html(&format!("Erreur Twitch {status}: {body}"), false)
                .into_response();
        }
        Err(e) => return close_tab_html(&format!("Erreur réseau : {e}"), false).into_response(),
    };

    // ── Fetch user profile ──────────────────────────────────────────────────
    let user_res: Result<reqwest::Response, reqwest::Error> = client
        .get("https://api.twitch.tv/helix/users")
        .header("Authorization", format!("Bearer {access_token}"))
        .header("Client-Id", TWITCH_CLIENT_ID.as_str())
        .send()
        .await;

    let (user_id, user_login, user_display_name, user_avatar) = match user_res {
        Ok(r) if r.status().is_success() => {
            let body: serde_json::Value = r.json().await.unwrap_or_default();
            match body
                .get("data")
                .and_then(|d| d.as_array())
                .and_then(|a| a.first())
            {
                Some(u) => (
                    u.get("id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    u.get("login")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    u.get("display_name")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    u.get("profile_image_url")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                ),
                None => {
                    return close_tab_html("Impossible de récupérer le profil utilisateur.", false)
                        .into_response()
                }
            }
        }
        _ => {
            return close_tab_html("Impossible de récupérer le profil utilisateur.", false)
                .into_response()
        }
    };

    // ── Persist ─────────────────────────────────────────────────────────────
    let _ = state.history.set_twitch_token(Some(access_token)).await;
    let _ = state
        .history
        .update_twitch_account(
            user_id,
            user_login.clone(),
            user_display_name.clone(),
            user_avatar,
        )
        .await;

    // Auto-import follows if the setting is enabled
    let settings = state.history.get_settings().await;
    if settings.twitch_import_follows {
        if let Some(token) = state.history.get_twitch_token().await {
            if let Some(uid) = settings.twitch_user_id {
                tokio::spawn({
                    let state = state.clone();
                    async move {
                        let _ = import_followed_channels(
                            &token,
                            &uid,
                            state.twitch.shared_client(),
                            &state,
                        )
                        .await;
                    }
                });
            }
        }
    }

    close_tab_html(
        &format!(
            "Connecté en tant que {user_display_name} (@{user_login})\nCette fenêtre va se fermer automatiquement."
        ),
        true,
    )
    .into_response()
}

/// GET /api/auth/twitch/status
pub async fn handle_auth_status(State(state): State<ApiState>) -> impl IntoResponse {
    let settings = state.history.get_settings().await;
    let linked = settings
        .twitch_user_id
        .as_ref()
        .map(|s| !s.is_empty())
        .unwrap_or(false);

    Json(serde_json::json!({
        "linked": linked,
        "clientConfigured": twitch_client_configured(),
        "userId": settings.twitch_user_id,
        "userLogin": settings.twitch_user_login,
        "userDisplayName": settings.twitch_user_display_name,
        "userAvatar": settings.twitch_user_avatar,
        "importFollows": settings.twitch_import_follows,
    }))
}

/// DELETE /api/auth/twitch
pub async fn handle_auth_unlink(State(state): State<ApiState>) -> AppResult<Response> {
    state.history.set_twitch_token(None).await?;
    state.history.clear_twitch_account().await?;
    Ok(Json(serde_json::json!({ "ok": true })).into_response())
}

#[derive(Deserialize)]
pub struct ImportFollowsBody {
    pub save: Option<bool>,
}

/// POST /api/auth/twitch/import-follows
/// Body: { save?: bool }  — if save==true, also persists the "auto-import" setting.
pub async fn handle_auth_import_follows(
    State(state): State<ApiState>,
    Json(body): Json<ImportFollowsBody>,
) -> AppResult<Response> {
    let (token, user_id) = {
        let settings = state.history.get_settings().await;
        let token = state.history.get_twitch_token().await;
        (token, settings.twitch_user_id)
    };

    let (Some(access_token), Some(uid)) = (token, user_id) else {
        return Err(AppError::Unauthorized(
            "Not linked to a Twitch account".to_string(),
        ));
    };

    if body.save.unwrap_or(false) {
        state.history.update_import_follows_setting(true).await?;
    }

    let imported =
        import_followed_channels(&access_token, &uid, state.twitch.shared_client(), &state).await;
    Ok(Json(serde_json::json!({ "imported": imported })).into_response())
}

/// PUT /api/auth/twitch/import-follows-setting
#[derive(Deserialize)]
pub struct ImportFollowsSettingBody {
    pub enabled: bool,
}

pub async fn handle_auth_set_import_follows(
    State(state): State<ApiState>,
    Json(body): Json<ImportFollowsSettingBody>,
) -> AppResult<Response> {
    state
        .history
        .update_import_follows_setting(body.enabled)
        .await?;
    Ok(Json(serde_json::json!({ "ok": true })).into_response())
}

// ── Follow importer ────────────────────────────────────────────────────────────

pub async fn import_followed_channels(
    access_token: &str,
    user_id: &str,
    client: &reqwest::Client,
    state: &ApiState,
) -> usize {
    let mut cursor: Option<String> = None;
    // (broadcaster_id, login, display_name)
    let mut all_channels: Vec<(String, String, String)> = Vec::new();

    // ── Page through all followed channels ──────────────────────────────────
    loop {
        let mut url =
            format!("https://api.twitch.tv/helix/channels/followed?user_id={user_id}&first=100");
        if let Some(ref c) = cursor {
            url.push_str(&format!("&after={c}"));
        }

        let body: serde_json::Value = match client
            .get(&url)
            .header("Authorization", format!("Bearer {access_token}"))
            .header("Client-Id", TWITCH_CLIENT_ID.as_str())
            .send()
            .await
        {
            Ok(r) if r.status().is_success() => r.json().await.unwrap_or_default(),
            _ => break,
        };

        let channels = body
            .get("data")
            .and_then(|d| d.as_array())
            .cloned()
            .unwrap_or_default();

        if channels.is_empty() {
            break;
        }

        for ch in &channels {
            let id = ch
                .get("broadcaster_id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let login = ch
                .get("broadcaster_login")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_lowercase();
            let dname = ch
                .get("broadcaster_name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            if !login.is_empty() {
                all_channels.push((id, login, dname));
            }
        }

        cursor = body
            .get("pagination")
            .and_then(|p| p.get("cursor"))
            .and_then(|c| c.as_str())
            .map(String::from);

        if cursor.is_none() {
            break;
        }
    }

    // ── Batch-fetch avatars (up to 100 IDs per request) ─────────────────────
    let mut total = 0usize;

    for chunk in all_channels.chunks(100) {
        let ids_param = chunk
            .iter()
            .map(|(id, _, _)| format!("id={id}"))
            .collect::<Vec<_>>()
            .join("&");

        let user_map: HashMap<String, String> = match client
            .get(format!("https://api.twitch.tv/helix/users?{ids_param}"))
            .header("Authorization", format!("Bearer {access_token}"))
            .header("Client-Id", TWITCH_CLIENT_ID.as_str())
            .send()
            .await
        {
            Ok(r) if r.status().is_success() => {
                let body: serde_json::Value = r.json().await.unwrap_or_default();
                body.get("data")
                    .and_then(|d| d.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|u| {
                                let id = u.get("id")?.as_str()?.to_string();
                                let avatar = u.get("profile_image_url")?.as_str()?.to_string();
                                Some((id, avatar))
                            })
                            .collect()
                    })
                    .unwrap_or_default()
            }
            _ => HashMap::new(),
        };

        for (broadcaster_id, login, display_name) in chunk {
            let avatar = user_map.get(broadcaster_id).cloned().unwrap_or_default();
            let _ = state
                .history
                .add_sub(SubEntry {
                    login: login.clone(),
                    display_name: display_name.clone(),
                    profile_image_url: avatar,
                })
                .await;
            total += 1;
        }
    }

    total
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_random_string() {
        let s1 = random_string(32);
        let s2 = random_string(32);
        assert_eq!(s1.len(), 32);
        assert_eq!(s2.len(), 32);
        assert_ne!(s1, s2);
    }

    #[test]
    fn test_pkce_challenge() {
        let verifier = "test_verifier_string_that_is_long_enough_for_pkce";
        let challenge = pkce_challenge(verifier);
        // Sha256 of "test_verifier_string_that_is_long_enough_for_pkce" is:
        // f6c7b9...
        // base64url encoded should not contain + or / or =
        assert!(!challenge.contains('+'));
        assert!(!challenge.contains('/'));
        assert!(!challenge.contains('='));
        assert!(!challenge.is_empty());
    }

    #[tokio::test]
    async fn test_oauth_state_cleanup() {
        let store = OAuthStateStore::new();
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        {
            let mut pending = store.pending.write().await;
            // Valid entry (1 min old)
            pending.insert(
                "valid".to_string(),
                PendingOAuth {
                    code_verifier: "v1".to_string(),
                    created_at: now - 60,
                },
            );
            // Expired entry (11 mins old)
            pending.insert(
                "expired".to_string(),
                PendingOAuth {
                    code_verifier: "v2".to_string(),
                    created_at: now - 660,
                },
            );
        }

        store.cleanup_expired().await;

        let pending = store.pending.read().await;
        assert!(pending.contains_key("valid"));
        assert!(!pending.contains_key("expired"));
    }
}
