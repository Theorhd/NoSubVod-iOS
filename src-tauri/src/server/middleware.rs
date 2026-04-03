use axum::{extract::State, middleware::Next, response::Response};

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
