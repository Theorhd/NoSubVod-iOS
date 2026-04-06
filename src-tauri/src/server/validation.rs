use axum::http::header;

/// Returns true if the string looks like a valid VOD / numeric ID.
pub fn is_valid_id(s: &str) -> bool {
    !s.is_empty() && s.len() <= 20 && s.chars().all(|c| c.is_ascii_digit())
}

/// Returns true if the string looks like a valid Twitch login/username.
pub fn is_valid_login(s: &str) -> bool {
    !s.is_empty() && s.len() <= 25 && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
}

pub fn is_ios_family_request(headers: &axum::http::HeaderMap) -> bool {
    let ua = headers
        .get(header::USER_AGENT)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_lowercase();

    if ua.contains("iphone") || ua.contains("ipad") || ua.contains("ipod") {
        return true;
    }

    if ua.contains("macintosh") && ua.contains("mobile") {
        return true;
    }

    let platform = headers
        .get("sec-ch-ua-platform")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_lowercase();

    platform.contains("ios")
}

pub fn is_legacy_ios_request(headers: &axum::http::HeaderMap) -> bool {
    if !is_ios_family_request(headers) {
        return false;
    }

    let ua = headers
        .get(header::USER_AGENT)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_lowercase();

    // iOS UA examples:
    // - "CPU iPhone OS 17_4 like Mac OS X"
    // - "CPU OS 12_5 like Mac OS X"
    let version_anchor = if let Some(idx) = ua.find("iphone os ") {
        Some((idx, "iphone os "))
    } else {
        ua.find("cpu os ").map(|idx| (idx, "cpu os "))
    };

    let Some((start, marker)) = version_anchor else {
        return false;
    };

    let version_start = start + marker.len();
    let version_slice = &ua[version_start..];
    let major = version_slice
        .split(|c: char| !c.is_ascii_digit())
        .next()
        .and_then(|s| s.parse::<u32>().ok());

    matches!(major, Some(v) if v < 14)
}

pub fn filter_hevc_variants_for_ios(master_playlist: &str) -> String {
    let mut output: Vec<&str> = Vec::new();
    let mut lines = master_playlist.lines().peekable();

    while let Some(line) = lines.next() {
        let trimmed = line.trim();

        if trimmed.starts_with("#EXT-X-STREAM-INF") {
            let lowered = trimmed.to_lowercase();
            let is_hevc = lowered.contains("codecs=\"")
                && (lowered.contains("hvc1") || lowered.contains("hev1"));

            if is_hevc {
                let _ = lines.next();
                continue;
            }
        }

        output.push(line);
    }

    output.join("\n")
}

fn extract_resolution_height(stream_inf_line: &str) -> Option<u32> {
    let marker = "RESOLUTION=";
    let index = stream_inf_line.find(marker)?;
    let rest = &stream_inf_line[index + marker.len()..];
    let value = rest.split([',', ' ']).next().unwrap_or_default();
    let mut dims = value.split(['x', 'X']);
    let _width = dims.next()?;
    let height_part = dims.next()?;
    let height_digits: String = height_part
        .chars()
        .take_while(|c| c.is_ascii_digit())
        .collect();
    if height_digits.is_empty() {
        return None;
    }
    height_digits.parse::<u32>().ok()
}

fn extract_quoted_attr(line: &str, key: &str) -> Option<String> {
    let marker = format!("{key}=\"");
    let start = line.find(&marker)? + marker.len();
    let tail = &line[start..];
    let end = tail.find('"')?;
    Some(tail[..end].to_string())
}

fn set_unquoted_attr_value(line: &str, key: &str, value: &str) -> String {
    let marker = format!("{key}=");
    if let Some(start) = line.find(&marker) {
        let value_start = start + marker.len();
        let tail = &line[value_start..];
        let value_end = tail.find(',').unwrap_or(tail.len());

        let mut updated = String::with_capacity(line.len() + value.len());
        updated.push_str(&line[..value_start]);
        updated.push_str(value);
        updated.push_str(&tail[value_end..]);
        return updated;
    }

    format!("{line},{key}={value}")
}

pub fn ensure_video_media_default(master_playlist: &str) -> String {
    let mut lines: Vec<String> = master_playlist.lines().map(ToString::to_string).collect();
    if lines.is_empty() {
        return master_playlist.to_string();
    }

    let video_media_indices: Vec<usize> = lines
        .iter()
        .enumerate()
        .filter_map(|(index, line)| {
            let trimmed = line.trim();
            if trimmed.starts_with("#EXT-X-MEDIA") && trimmed.contains("TYPE=VIDEO") {
                Some(index)
            } else {
                None
            }
        })
        .collect();

    if video_media_indices.is_empty() {
        return master_playlist.to_string();
    }

    let mut changed = false;

    for (position, index) in video_media_indices.into_iter().enumerate() {
        let desired = if position == 0 { "YES" } else { "NO" };

        let mut updated = set_unquoted_attr_value(&lines[index], "DEFAULT", desired);
        updated = set_unquoted_attr_value(&updated, "AUTOSELECT", desired);

        if updated != lines[index] {
            lines[index] = updated;
            changed = true;
        }
    }

    if !changed {
        return master_playlist.to_string();
    }

    lines.join("\n")
}

pub fn preferred_quality_height(raw: Option<&str>) -> Option<u32> {
    let value = raw?.trim().to_ascii_lowercase();
    if value.is_empty() || value == "auto" {
        return None;
    }

    if value == "chunked" || value == "source" {
        return Some(1080);
    }

    if let Ok(height) = value.parse::<u32>() {
        return Some(height);
    }

    let maybe_digits = value
        .split(|c: char| !c.is_ascii_digit())
        .find(|part| !part.is_empty())?;

    maybe_digits.parse::<u32>().ok()
}

#[derive(Clone)]
struct VariantRef {
    stream_inf_index: usize,
    uri_index: usize,
    height: u32,
    group_id: Option<String>,
}

fn select_variant_index(variants: &[VariantRef], target_height: u32) -> usize {
    let mut exact: Option<usize> = None;
    let mut best_lower: Option<(usize, u32)> = None;
    let mut best_upper: Option<(usize, u32)> = None;

    for (index, variant) in variants.iter().enumerate() {
        let height = variant.height;
        if height == 0 {
            continue;
        }

        if height == target_height {
            exact = Some(index);
            break;
        }

        if height < target_height {
            match best_lower {
                Some((_, best_height)) if best_height >= height => {}
                _ => best_lower = Some((index, height)),
            }
        } else {
            match best_upper {
                Some((_, best_height)) if best_height <= height => {}
                _ => best_upper = Some((index, height)),
            }
        }
    }

    exact
        .or_else(|| best_lower.map(|(index, _)| index))
        .or_else(|| best_upper.map(|(index, _)| index))
        .unwrap_or(0)
}

pub fn lock_master_playlist_to_height(master_playlist: &str, target_height: u32) -> String {
    if target_height == 0 {
        return master_playlist.to_string();
    }

    let lines: Vec<String> = master_playlist.lines().map(ToString::to_string).collect();
    if lines.is_empty() {
        return master_playlist.to_string();
    }

    let mut variants: Vec<VariantRef> = Vec::new();
    let mut index = 0usize;

    while index < lines.len() {
        let line = lines[index].trim();
        if line.starts_with("#EXT-X-STREAM-INF") {
            let mut uri_index: Option<usize> = None;
            let mut scan = index + 1;

            while scan < lines.len() {
                let next_line = lines[scan].trim();
                if next_line.is_empty() {
                    scan += 1;
                    continue;
                }

                if next_line.starts_with('#') {
                    if next_line.starts_with("#EXT-X-STREAM-INF") {
                        break;
                    }
                    scan += 1;
                    continue;
                }

                uri_index = Some(scan);
                break;
            }

            if let Some(uri_idx) = uri_index {
                variants.push(VariantRef {
                    stream_inf_index: index,
                    uri_index: uri_idx,
                    height: extract_resolution_height(line).unwrap_or(0),
                    group_id: extract_quoted_attr(line, "VIDEO")
                        .or_else(|| extract_quoted_attr(line, "GROUP-ID"))
                        .or_else(|| extract_quoted_attr(line, "NAME")),
                });
                index = uri_idx + 1;
                continue;
            }
        }

        index += 1;
    }

    if variants.len() <= 1 {
        return master_playlist.to_string();
    }

    let selected_index = select_variant_index(&variants, target_height);
    let selected = &variants[selected_index];

    let mut skip_line = vec![false; lines.len()];
    let mut removed_group_ids: Vec<String> = Vec::new();

    for (index, variant) in variants.iter().enumerate() {
        if index == selected_index {
            continue;
        }
        skip_line[variant.stream_inf_index] = true;
        skip_line[variant.uri_index] = true;
        if let Some(group_id) = &variant.group_id {
            removed_group_ids.push(group_id.clone());
        }
    }

    let mut output: Vec<&str> = Vec::new();
    for (index, line) in lines.iter().enumerate() {
        if skip_line[index] {
            continue;
        }

        let trimmed = line.trim();
        if trimmed.starts_with("#EXT-X-MEDIA") {
            let should_remove = removed_group_ids.iter().any(|group_id| {
                trimmed.contains(&format!("GROUP-ID=\"{group_id}\""))
                    || trimmed.contains(&format!("NAME=\"{group_id}\""))
            });
            if should_remove {
                continue;
            }
        }

        output.push(line.as_str());
    }

    // Keep at least one valid stream entry; fallback to original playlist if filtering became inconsistent.
    let has_stream_inf = output
        .iter()
        .any(|line| line.trim().starts_with("#EXT-X-STREAM-INF"));
    if !has_stream_inf {
        return master_playlist.to_string();
    }

    // Ensure we did not accidentally remove the selected variant references.
    let selected_stream_line = lines[selected.stream_inf_index].as_str();
    let selected_uri_line = lines[selected.uri_index].as_str();
    let has_selected_stream = output.contains(&selected_stream_line);
    let has_selected_uri = output.contains(&selected_uri_line);
    if !has_selected_stream || !has_selected_uri {
        return master_playlist.to_string();
    }

    output.join("\n")
}

pub fn cap_master_playlist_to_max_height(master_playlist: &str, max_height: u32) -> String {
    if max_height == 0 {
        return master_playlist.to_string();
    }

    let lines: Vec<String> = master_playlist.lines().map(ToString::to_string).collect();
    if lines.is_empty() {
        return master_playlist.to_string();
    }

    let mut variants: Vec<VariantRef> = Vec::new();
    let mut index = 0usize;

    while index < lines.len() {
        let line = lines[index].trim();
        if line.starts_with("#EXT-X-STREAM-INF") {
            let mut uri_index: Option<usize> = None;
            let mut scan = index + 1;

            while scan < lines.len() {
                let next_line = lines[scan].trim();
                if next_line.is_empty() {
                    scan += 1;
                    continue;
                }

                if next_line.starts_with('#') {
                    if next_line.starts_with("#EXT-X-STREAM-INF") {
                        break;
                    }
                    scan += 1;
                    continue;
                }

                uri_index = Some(scan);
                break;
            }

            if let Some(uri_idx) = uri_index {
                variants.push(VariantRef {
                    stream_inf_index: index,
                    uri_index: uri_idx,
                    height: extract_resolution_height(line).unwrap_or(0),
                    group_id: extract_quoted_attr(line, "VIDEO")
                        .or_else(|| extract_quoted_attr(line, "GROUP-ID"))
                        .or_else(|| extract_quoted_attr(line, "NAME")),
                });
                index = uri_idx + 1;
                continue;
            }
        }

        index += 1;
    }

    if variants.len() <= 1 {
        return master_playlist.to_string();
    }

    let mut skip_line = vec![false; lines.len()];
    let mut removed_group_ids: Vec<String> = Vec::new();
    let mut removed_any = false;

    for variant in &variants {
        if variant.height > 0 && variant.height > max_height {
            skip_line[variant.stream_inf_index] = true;
            skip_line[variant.uri_index] = true;
            removed_any = true;
            if let Some(group_id) = &variant.group_id {
                removed_group_ids.push(group_id.clone());
            }
        }
    }

    if !removed_any {
        return master_playlist.to_string();
    }

    let mut output: Vec<&str> = Vec::new();
    for (index, line) in lines.iter().enumerate() {
        if skip_line[index] {
            continue;
        }

        let trimmed = line.trim();
        if trimmed.starts_with("#EXT-X-MEDIA") {
            let should_remove = removed_group_ids.iter().any(|group_id| {
                trimmed.contains(&format!("GROUP-ID=\"{group_id}\""))
                    || trimmed.contains(&format!("NAME=\"{group_id}\""))
            });
            if should_remove {
                continue;
            }
        }

        output.push(line.as_str());
    }

    let has_stream_inf = output
        .iter()
        .any(|line| line.trim().starts_with("#EXT-X-STREAM-INF"));
    if !has_stream_inf {
        return master_playlist.to_string();
    }

    output.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderMap;

    #[test]
    fn test_is_valid_id() {
        assert!(is_valid_id("1234567890"));
        assert!(is_valid_id("1"));
        assert!(!is_valid_id(""));
        assert!(!is_valid_id("123a456"));
        assert!(!is_valid_id("123456789012345678901")); // 21 chars
    }

    #[test]
    fn test_is_valid_login() {
        assert!(is_valid_login("twitch_user"));
        assert!(is_valid_login("user123"));
        assert!(is_valid_login("A_B_C"));
        assert!(!is_valid_login(""));
        assert!(!is_valid_login("user-name"));
        assert!(!is_valid_login("user name"));
        assert!(!is_valid_login("a".repeat(26).as_str()));
    }

    #[test]
    fn test_is_ios_family_request() {
        let mut headers = HeaderMap::new();
        headers.insert(header::USER_AGENT, "Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1".parse().unwrap());
        assert!(is_ios_family_request(&headers));

        let mut headers = HeaderMap::new();
        headers.insert(header::USER_AGENT, "Mozilla/5.0 (iPad; CPU OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1".parse().unwrap());
        assert!(is_ios_family_request(&headers));

        let mut headers = HeaderMap::new();
        headers.insert("sec-ch-ua-platform", "iOS".parse().unwrap());
        assert!(is_ios_family_request(&headers));

        let mut headers = HeaderMap::new();
        headers.insert(header::USER_AGENT, "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36".parse().unwrap());
        assert!(!is_ios_family_request(&headers));
    }

    #[test]
    fn test_is_legacy_ios_request() {
        let mut legacy_headers = HeaderMap::new();
        legacy_headers.insert(
            header::USER_AGENT,
            "Mozilla/5.0 (iPhone; CPU iPhone OS 12_4 like Mac OS X) AppleWebKit/605.1.15"
                .parse()
                .unwrap(),
        );
        assert!(is_legacy_ios_request(&legacy_headers));

        let mut modern_headers = HeaderMap::new();
        modern_headers.insert(
            header::USER_AGENT,
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15"
                .parse()
                .unwrap(),
        );
        assert!(!is_legacy_ios_request(&modern_headers));

        let mut desktop_headers = HeaderMap::new();
        desktop_headers.insert(
            header::USER_AGENT,
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
                .parse()
                .unwrap(),
        );
        assert!(!is_legacy_ios_request(&desktop_headers));
    }

    #[test]
    fn test_filter_hevc_variants_for_ios() {
        let playlist = r#"#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=1280000,CODECS="avc1.42e01e,mp4a.40.2"
chunklist_w109.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2560000,CODECS="hvc1.1.6.L93.B0,mp4a.40.2"
chunklist_w110.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=640000,CODECS="hev1.1.6.L93.B0,mp4a.40.2"
chunklist_w111.m3u8
"#;
        let filtered = filter_hevc_variants_for_ios(playlist);
        assert!(filtered.contains("chunklist_w109.m3u8"));
        assert!(!filtered.contains("chunklist_w110.m3u8"));
        assert!(!filtered.contains("chunklist_w111.m3u8"));
        assert!(filtered.contains("avc1.42e01e"));
    }

    #[test]
    fn test_preferred_quality_height() {
        assert_eq!(preferred_quality_height(Some("auto")), None);
        assert_eq!(preferred_quality_height(Some("1080")), Some(1080));
        assert_eq!(preferred_quality_height(Some("720p60")), Some(720));
        assert_eq!(preferred_quality_height(Some("chunked")), Some(1080));
    }

    #[test]
    fn test_lock_master_playlist_to_height() {
        let playlist = r#"#EXTM3U
#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="1080p",NAME="1080p",AUTOSELECT=YES,DEFAULT=YES
#EXT-X-STREAM-INF:BANDWIDTH=8500000,RESOLUTION=1920x1080,VIDEO="1080p"
/api/stream/variant.m3u8?id=1080
#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="720p60",NAME="720p60",AUTOSELECT=NO,DEFAULT=NO
#EXT-X-STREAM-INF:BANDWIDTH=4500000,RESOLUTION=1280x720,VIDEO="720p60"
/api/stream/variant.m3u8?id=720
#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="480p30",NAME="480p30",AUTOSELECT=NO,DEFAULT=NO
#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=854x480,VIDEO="480p30"
/api/stream/variant.m3u8?id=480
"#;

        let locked = lock_master_playlist_to_height(playlist, 720);
        assert!(locked.contains("RESOLUTION=1280x720"));
        assert!(!locked.contains("RESOLUTION=1920x1080"));
        assert!(!locked.contains("RESOLUTION=854x480"));
        assert!(locked.contains("id=720"));
        assert!(!locked.contains("id=1080"));
        assert!(!locked.contains("id=480"));
    }

    #[test]
    fn test_cap_master_playlist_to_max_height() {
        let playlist = r#"#EXTM3U
#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="1080p",NAME="1080p",AUTOSELECT=YES,DEFAULT=YES
#EXT-X-STREAM-INF:BANDWIDTH=8500000,RESOLUTION=1920x1080,VIDEO="1080p"
/api/stream/variant.m3u8?id=1080
#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="720p60",NAME="720p60",AUTOSELECT=NO,DEFAULT=NO
#EXT-X-STREAM-INF:BANDWIDTH=4500000,RESOLUTION=1280x720,VIDEO="720p60"
/api/stream/variant.m3u8?id=720
#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="480p30",NAME="480p30",AUTOSELECT=NO,DEFAULT=NO
#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=854x480,VIDEO="480p30"
/api/stream/variant.m3u8?id=480
"#;

        let capped = cap_master_playlist_to_max_height(playlist, 720);
        assert!(!capped.contains("RESOLUTION=1920x1080"));
        assert!(capped.contains("RESOLUTION=1280x720"));
        assert!(capped.contains("RESOLUTION=854x480"));
        assert!(!capped.contains("id=1080"));
        assert!(capped.contains("id=720"));
        assert!(capped.contains("id=480"));
    }

    #[test]
    fn test_ensure_video_media_default_promotes_first_entry() {
        let playlist = r#"#EXTM3U
#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="720p60",NAME="720p60",AUTOSELECT=NO,DEFAULT=NO
#EXT-X-STREAM-INF:BANDWIDTH=4500000,RESOLUTION=1280x720,VIDEO="720p60"
/api/stream/variant.m3u8?id=720
#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="480p30",NAME="480p30",AUTOSELECT=NO,DEFAULT=NO
#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=854x480,VIDEO="480p30"
/api/stream/variant.m3u8?id=480
"#;

        let normalized = ensure_video_media_default(playlist);
        assert!(
            normalized.contains("GROUP-ID=\"720p60\",NAME=\"720p60\",AUTOSELECT=YES,DEFAULT=YES")
        );
        assert!(normalized.contains("GROUP-ID=\"480p30\",NAME=\"480p30\",AUTOSELECT=NO,DEFAULT=NO"));
    }
}
