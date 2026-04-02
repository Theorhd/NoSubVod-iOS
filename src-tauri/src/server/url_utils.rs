use std::borrow::Cow;

pub fn extract_origin(url: &str) -> Cow<'_, str> {
    if let Some(sep) = url.find("://") {
        let after = &url[sep + 3..];
        let end = after.find('/').unwrap_or(after.len());
        return Cow::Owned(format!("{}://{}", &url[..sep], &after[..end]));
    }

    Cow::Borrowed(url)
}

pub fn resolve_url<'a>(raw: &'a str, origin: &str, base_url: &str) -> Cow<'a, str> {
    let raw = raw.trim();

    if raw.starts_with("http://") || raw.starts_with("https://") {
        return Cow::Borrowed(raw);
    }

    if raw.starts_with('/') {
        return Cow::Owned(format!("{origin}{raw}"));
    }

    let base_dir = base_url
        .rfind('/')
        .map(|index| &base_url[..=index])
        .unwrap_or(base_url);

    Cow::Owned(format!("{base_dir}{raw}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_origin_with_port() {
        let origin = extract_origin("https://example.com:8443/path/file.m3u8");
        assert_eq!(origin, "https://example.com:8443");
    }

    #[test]
    fn extracts_origin_without_path() {
        let origin = extract_origin("https://example.com");
        assert_eq!(origin, "https://example.com");
    }

    #[test]
    fn extracts_origin_without_protocol_returns_original() {
        let origin = extract_origin("example.com/path/file.m3u8");
        assert_eq!(origin, "example.com/path/file.m3u8");
    }

    #[test]
    fn resolves_absolute_url_without_changes() {
        let url = resolve_url(
            "https://cdn.example.com/live/stream.m3u8",
            "https://host.local",
            "https://host.local/master.m3u8",
        );
        assert_eq!(url, "https://cdn.example.com/live/stream.m3u8");
    }

    #[test]
    fn resolves_http_absolute_url_without_changes() {
        let url = resolve_url(
            "http://cdn.example.com/live/stream.m3u8",
            "https://host.local",
            "https://host.local/master.m3u8",
        );
        assert_eq!(url, "http://cdn.example.com/live/stream.m3u8");
    }

    #[test]
    fn resolves_root_relative_url_from_origin() {
        let url = resolve_url(
            "/vod/segment.ts",
            "https://host.local",
            "https://host.local/path/master.m3u8",
        );
        assert_eq!(url, "https://host.local/vod/segment.ts");
    }

    #[test]
    fn resolves_relative_url_from_base_directory() {
        let url = resolve_url(
            "chunked/index.m3u8",
            "https://host.local",
            "https://host.local/api/vod/master.m3u8",
        );
        assert_eq!(url, "https://host.local/api/vod/chunked/index.m3u8");
    }

    #[test]
    fn resolves_relative_url_when_base_has_no_slash() {
        let url = resolve_url("index.m3u8", "https://host.local", "master.m3u8");
        assert_eq!(url, "master.m3u8index.m3u8");
    }
}
