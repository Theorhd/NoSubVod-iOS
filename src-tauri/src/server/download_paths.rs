use std::path::PathBuf;

pub fn fix_sandbox_path(path: &str) -> String {
    if !path.contains("/Containers/Data/Application/") {
        return path.to_string();
    }

    let default_dir = dirs::download_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();

    if default_dir.contains("/Containers/Data/Application/") {
        let parts: Vec<&str> = default_dir.split("/Containers/Data/Application/").collect();
        if parts.len() == 2 {
            let right_parts: Vec<&str> = parts[1].split('/').collect();
            if !right_parts.is_empty() {
                let current_uuid = right_parts[0];

                let old_parts: Vec<&str> = path.split("/Containers/Data/Application/").collect();
                if old_parts.len() == 2 {
                    let old_right: Vec<&str> = old_parts[1].split('/').collect();
                    if !old_right.is_empty() {
                        let old_uuid = old_right[0];
                        return path.replace(old_uuid, current_uuid);
                    }
                }
            }
        }
    }
    path.to_string()
}

pub fn resolve_download_dir(local_path: Option<String>, network_path: Option<String>) -> String {
    let path = local_path.or(network_path);
    if let Some(p) = path {
        return fix_sandbox_path(&p);
    }
    dirs::download_dir()
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_else(|| ".".to_string())
}

pub fn build_master_m3u8_url(port: u16, vod_id: &str, quality: &str) -> String {
    if quality.is_empty() || quality == "best" {
        format!("http://127.0.0.1:{port}/api/vod/{vod_id}/master.m3u8")
    } else {
        format!("http://127.0.0.1:{port}/api/vod/{vod_id}/master.m3u8?quality={quality}&qualityMode=lock")
    }
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
        let dir = resolve_download_dir(Some("/custom/path".to_string()), None);
        assert_eq!(dir, "/custom/path");
    }

    #[test]
    fn resolves_default_download_dir() {
        let dir = resolve_download_dir(None, None);
        assert!(!dir.is_empty());
    }

    #[test]
    fn builds_master_playlist_url() {
        let url = build_master_m3u8_url(23455, "123456789", "best");
        assert_eq!(url, "http://127.0.0.1:23455/api/vod/123456789/master.m3u8");

        let url_quality = build_master_m3u8_url(23455, "123456789", "720p");
        assert_eq!(
            url_quality,
            "http://127.0.0.1:23455/api/vod/123456789/master.m3u8?quality=720p&qualityMode=lock"
        );
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
