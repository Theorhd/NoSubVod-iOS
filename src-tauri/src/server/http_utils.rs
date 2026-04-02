use super::error::{AppError, AppResult};
use reqwest::Client;

pub async fn get_text_checked(client: &Client, url: &str) -> AppResult<String> {
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("GET {url}: {e}")))?;

    if !resp.status().is_success() {
        return Err(AppError::Internal(format!(
            "HTTP {} for {url}",
            resp.status().as_u16()
        )));
    }

    resp.text()
        .await
        .map_err(|e| AppError::Internal(format!("Reading response from {url}: {e}")))
}

pub async fn get_bytes_checked(client: &Client, url: &str) -> AppResult<bytes::Bytes> {
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("GET {url}: {e}")))?;

    if !resp.status().is_success() {
        return Err(AppError::Internal(format!(
            "HTTP {} for {url}",
            resp.status().as_u16()
        )));
    }

    resp.bytes()
        .await
        .map_err(|e| AppError::Internal(format!("Reading bytes from {url}: {e}")))
}

pub async fn get_text_with_direct_fallback(
    primary_client: &Client,
    fallback_client: &Client,
    url: &str,
    context: &str,
) -> AppResult<String> {
    match primary_client.get(url).send().await {
        Ok(resp) if resp.status().is_success() => resp
            .text()
            .await
            .map_err(|e| AppError::Internal(e.to_string())),
        Ok(resp) => {
            eprintln!(
                "[adblock] proxy returned HTTP {} for {context}, retrying direct",
                resp.status()
            );
            get_text_checked(fallback_client, url).await
        }
        Err(error) => {
            eprintln!("[adblock] proxy error for {context} ({error}), retrying direct");
            get_text_checked(fallback_client, url).await
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{routing::get, Router};
    use tokio::net::TcpListener;

    #[test]
    fn get_text_checked_signature_is_send_safe() {
        fn assert_send<T: Send>(_: &T) {}
        let client = Client::new();
        let fut = get_text_checked(&client, "https://example.com");
        assert_send(&fut);
        std::mem::drop(fut);
    }

    async fn spawn_test_server() -> String {
        let app = Router::new()
            .route("/text", get(|| async { "hello world" }))
            .route("/bytes", get(|| async { vec![1u8, 2, 3] }))
            .route(
                "/error",
                get(|| async { axum::http::StatusCode::INTERNAL_SERVER_ERROR }),
            );

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        format!("http://127.0.0.1:{}", port)
    }

    #[tokio::test]
    async fn test_get_text_checked_success() {
        let base_url = spawn_test_server().await;
        let client = Client::new();
        let res = get_text_checked(&client, &format!("{}/text", base_url))
            .await
            .unwrap();
        assert_eq!(res, "hello world");
    }

    #[tokio::test]
    async fn test_get_text_checked_http_error() {
        let base_url = spawn_test_server().await;
        let client = Client::new();
        let res = get_text_checked(&client, &format!("{}/error", base_url)).await;
        assert!(res.is_err());
        if let Err(AppError::Internal(msg)) = res {
            assert!(msg.contains("HTTP 500"));
        } else {
            panic!("Expected AppError::Internal");
        }
    }

    #[tokio::test]
    async fn test_get_bytes_checked_success() {
        let base_url = spawn_test_server().await;
        let client = Client::new();
        let res = get_bytes_checked(&client, &format!("{}/bytes", base_url))
            .await
            .unwrap();
        assert_eq!(res.as_ref(), &[1, 2, 3]);
    }

    #[tokio::test]
    async fn test_get_bytes_checked_http_error() {
        let base_url = spawn_test_server().await;
        let client = Client::new();
        let res = get_bytes_checked(&client, &format!("{}/error", base_url)).await;
        assert!(res.is_err());
    }

    #[tokio::test]
    async fn test_get_text_with_direct_fallback_primary_success() {
        let base_url = spawn_test_server().await;
        let primary_client = Client::new();
        let fallback_client = Client::new();

        let res = get_text_with_direct_fallback(
            &primary_client,
            &fallback_client,
            &format!("{}/text", base_url),
            "test_context",
        )
        .await
        .unwrap();

        assert_eq!(res, "hello world");
    }
}
