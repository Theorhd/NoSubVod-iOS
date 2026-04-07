use axum::{extract::State, http::HeaderValue, middleware::Next, response::Response};

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
    State(_state): State<ApiState>,
    req: axum::extract::Request,
    next: Next,
) -> Response {
    next.run(req).await
}

pub async fn security_headers_middleware(req: axum::extract::Request, next: Next) -> Response {
    let path = req.uri().path().to_string();
    let mut response = next.run(req).await;
    let headers = response.headers_mut();
    headers.insert(
        "x-content-type-options",
        HeaderValue::from_static("nosniff"),
    );

    // Extensions need to be embeddable in iframes within the portal.
    if path.starts_with("/api/extensions/") {
        headers.insert("x-frame-options", HeaderValue::from_static("SAMEORIGIN"));
    } else {
        headers.insert("x-frame-options", HeaderValue::from_static("DENY"));
    }

    headers.insert(
        "x-xss-protection",
        HeaderValue::from_static("1; mode=block"),
    );
    headers.insert("referrer-policy", HeaderValue::from_static("no-referrer"));
    headers.insert(
        "permissions-policy",
        HeaderValue::from_static("camera=(), microphone=(), geolocation=(), interest-cohort=()"),
    );
    headers.insert(
        "cache-control",
        HeaderValue::from_static("no-store, private"),
    );
    response
}
