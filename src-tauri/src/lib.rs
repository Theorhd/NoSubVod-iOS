#[cfg(not(test))]
mod commands;
#[cfg(not(test))]
pub mod server;

#[cfg(test)]
pub mod server {
    pub const SERVER_PORT: u16 = 23400;
    pub mod auth;
    pub mod chat;
    pub mod download;
    pub mod download_paths;
    pub mod dto;
    pub mod error;
    pub mod extensions;
    pub mod history;
    pub mod http_utils;
    pub mod screenshare;
    pub mod state;
    pub mod twitch;
    pub mod types;
    pub mod url_utils;
    pub mod validation;
}

#[cfg(not(test))]
use std::sync::Arc;
#[cfg(not(test))]
use tauri::Manager;
#[cfg(not(test))]
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[cfg(not(test))]
use server::AppState;

#[cfg(not(test))]
fn init_tracing() {
    let _ = tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "nosubvod_ios_lib=debug,tower_http=debug".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .try_init();
}

#[cfg(not(test))]
fn init_rustls_crypto_provider() {
    // rustls 0.23 may require explicit provider installation when both
    // providers are enabled through the dependency graph.
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    let _ = rustls::crypto::ring::default_provider().install_default();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
#[cfg(not(test))]
pub fn run() {
    // Load .env from the directory next to the binary (src-tauri/ in dev)
    dotenvy::dotenv().ok();
    init_tracing();
    init_rustls_crypto_provider();

    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init());

    builder = builder.setup(|app| {
        // Shared state is initialized on every platform so frontend can use
        // invoke-based APIs even when no HTTP server is running.
        let app_data_dir = app
            .path()
            .app_data_dir()
            .map_err(|e| tauri::Error::from(std::io::Error::other(e.to_string())))?;

        let state = Arc::new(
            AppState::new(app_data_dir)
                .map_err(|e| tauri::Error::from(std::io::Error::other(e.to_string())))?,
        );
        app.manage(state.clone());

        // ── Start Axum HTTP server used by the iOS webview ───────────────────
        let app_handle = app.handle().clone();
        tauri::async_runtime::spawn(async move {
            server::start_server(state, app_handle).await;
        });

        Ok(())
    });

    let builder = builder.invoke_handler(tauri::generate_handler![
        commands::internal_api_request,
        commands::proxy_remote_request,
        commands::scan_local_servers,
        commands::get_server_info,
        commands::start_download,
        commands::start_live_chat_polling,
        commands::poll_live_chat,
        commands::stop_live_chat_polling
    ]);

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
pub fn run() {}

#[cfg(test)]
#[ctor::ctor]
fn init_tests() {
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    let _ = rustls::crypto::ring::default_provider().install_default();
}
