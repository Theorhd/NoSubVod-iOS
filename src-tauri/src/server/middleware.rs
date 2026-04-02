use axum::{extract::State, middleware::Next, response::Response};

#[cfg(not(debug_assertions))]
use axum::{
    http::{header, StatusCode},
    response::IntoResponse,
    Json,
};

use super::state::ApiState;

/// Validates requests carry a valid server token via the `X-NSV-Token` header
/// or `t` query parameter. Rejects unauthorized requests with 401.
#[cfg(debug_assertions)]
pub async fn auth_middleware(
    State(_state): State<ApiState>,
    req: axum::extract::Request,
    next: Next,
) -> Response {
    next.run(req).await
}

/// Validates requests carry a valid server token via the `X-NSV-Token` header
/// or `t` query parameter. Rejects unauthorized requests with 401.
#[cfg(not(debug_assertions))]
pub async fn auth_middleware(
    State(state): State<ApiState>,
    req: axum::extract::Request,
    next: Next,
) -> Response {
    let header_device_id = req
        .headers()
        .get("x-nsv-device-id")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.trim())
        .filter(|s| !s.is_empty() && s.len() <= 128)
        .filter(|s| {
            s.chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        })
        .map(|s| s.to_string());

    let user_agent = req
        .headers()
        .get(header::USER_AGENT)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| s.chars().take(240).collect::<String>());

    let client_ip = req
        .headers()
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .map(|raw| raw.split(',').next().unwrap_or("").trim().to_string())
        .filter(|s| !s.is_empty());

    let token_from_header = req
        .headers()
        .get("x-nsv-token")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    let token_from_query = req.uri().query().and_then(|q| {
        q.split('&').find_map(|pair| {
            let mut parts = pair.splitn(2, '=');
            if parts.next() == Some("t") {
                parts.next().map(|v| v.to_string())
            } else {
                None
            }
        })
    });

    let query_device_id = req
        .uri()
        .query()
        .and_then(|q| {
            q.split('&').find_map(|pair| {
                let mut parts = pair.splitn(2, '=');
                if parts.next() == Some("d") {
                    parts
                        .next()
                        .and_then(|v| urlencoding::decode(v).ok())
                        .map(|v| v.into_owned())
                } else {
                    None
                }
            })
        })
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty() && s.len() <= 128)
        .filter(|s| {
            s.chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        });

    let device_id = header_device_id.or(query_device_id);

    let provided = token_from_header.or(token_from_query);

    let token_ok = provided.as_deref() == Some(&state.server_token);
    let device_trusted = if token_ok {
        false
    } else if let Some(id) = device_id.as_deref() {
        state.history.is_device_trusted(id).await
    } else {
        false
    };

    if !token_ok && !device_trusted {
        return (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({ "error": "Unauthorized" })),
        )
            .into_response();
    }

    if let Some(id) = device_id.as_deref() {
        let _ = state
            .history
            .mark_device_seen(id, client_ip, user_agent)
            .await;
    }

    next.run(req).await
}

pub async fn security_headers_middleware(req: axum::extract::Request, next: Next) -> Response {
    let path = req.uri().path().to_string();
    let mut response = next.run(req).await;
    let headers = response.headers_mut();
    headers.insert("x-content-type-options", "nosniff".parse().unwrap());

    // Extensions need to be embeddable in iframes within the portal.
    if path.starts_with("/api/extensions/") {
        headers.insert("x-frame-options", "SAMEORIGIN".parse().unwrap());
    } else {
        headers.insert("x-frame-options", "DENY".parse().unwrap());
    }

    headers.insert("x-xss-protection", "1; mode=block".parse().unwrap());
    headers.insert("referrer-policy", "no-referrer".parse().unwrap());
    headers.insert(
        "permissions-policy",
        "camera=(), microphone=(), geolocation=(), interest-cohort=()"
            .parse()
            .unwrap(),
    );
    headers.insert("cache-control", "no-store, private".parse().unwrap());
    response
}
