use std::path::PathBuf;

pub fn resolve_download_output_dir(configured_path: Option<String>) -> String {
    configured_path.unwrap_or_else(|| {
        dirs::download_dir()
            .map(|path| path.to_string_lossy().to_string())
            .unwrap_or_else(|| ".".to_string())
    })
}

pub fn build_master_m3u8_url(port: u16, vod_id: &str) -> String {
    format!("http://127.0.0.1:{port}/api/vod/{vod_id}/master.m3u8")
}

pub fn build_output_file_base_path(out_dir: &str, vod_id: &str, quality: &str) -> String {
    let file_name = format!("{vod_id}_{quality}");
    PathBuf::from(out_dir)
        .join(file_name)
        .to_string_lossy()
        .to_string()
}

pub fn build_output_file_path(
    out_dir: &str,
    vod_id: &str,
    quality: &str,
    extension: &str,
) -> String {
    let clean_ext = extension.trim_start_matches('.');
    let file_name = format!("{vod_id}_{quality}.{clean_ext}");
    PathBuf::from(out_dir)
        .join(file_name)
        .to_string_lossy()
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_configured_download_dir() {
        let dir = resolve_download_output_dir(Some("/custom/path".to_string()));
        assert_eq!(dir, "/custom/path");
    }

    #[test]
    fn resolves_default_download_dir() {
        let dir = resolve_download_output_dir(None);
        assert!(!dir.is_empty());
    }

    #[test]
    fn builds_master_playlist_url() {
        let url = build_master_m3u8_url(23455, "123456789");
        assert_eq!(url, "http://127.0.0.1:23455/api/vod/123456789/master.m3u8");
    }

    #[test]
    fn builds_output_base_path() {
        let base = build_output_file_base_path("C:/downloads", "123", "720p");
        assert!(base.ends_with("123_720p"));
    }

    #[test]
    fn builds_output_file_path_with_extension() {
        let path = build_output_file_path("C:/downloads", "123", "chunked", "ts");
        assert!(path.ends_with("123_chunked.ts"));
    }

    #[test]
    fn trims_dot_from_extension() {
        let path = build_output_file_path("C:/downloads", "123", "chunked", ".mp4");
        assert!(path.ends_with("123_chunked.mp4"));
    }

    #[test]
    fn builds_output_file_path_handles_empty_quality() {
        let path = build_output_file_path("C:/downloads", "123", "", "ts");
        assert!(path.ends_with("123_.ts"));
    }
}
