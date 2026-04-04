use std::path::{Path, PathBuf};

fn read_env_file_value(env_path: &Path, key: &str) -> Option<String> {
    let content = std::fs::read_to_string(env_path).ok()?;

    for raw_line in content.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }

        let line = line.strip_prefix("export ").unwrap_or(line);
        let Some((k, v)) = line.split_once('=') else {
            continue;
        };
        if k.trim() != key {
            continue;
        }

        let value = v.trim();
        let value = value
            .strip_prefix('"')
            .and_then(|s| s.strip_suffix('"'))
            .or_else(|| value.strip_prefix('\'').and_then(|s| s.strip_suffix('\'')))
            .unwrap_or(value)
            .trim();

        if value.is_empty() {
            return None;
        }

        return Some(value.replace(['\r', '\n'], ""));
    }

    None
}

fn emit_rustc_env_from_file(manifest_dir: &Path, key: &str) {
    let from_process = std::env::var(key)
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty());

    if let Some(value) = from_process {
        println!("cargo:rustc-env={key}={value}");
        return;
    }

    let env_path = manifest_dir.join(".env");
    if let Some(value) = read_env_file_value(&env_path, key) {
        println!("cargo:rustc-env={key}={value}");
    }
}

fn main() {
    let manifest_dir = PathBuf::from(
        std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR should be set by Cargo"),
    );

    println!("cargo:rerun-if-env-changed=TWITCH_CLIENT_ID");
    println!("cargo:rerun-if-env-changed=TWITCH_CLIENT_SECRET");
    println!("cargo:rerun-if-changed={}", manifest_dir.join(".env").display());

    emit_rustc_env_from_file(&manifest_dir, "TWITCH_CLIENT_ID");
    emit_rustc_env_from_file(&manifest_dir, "TWITCH_CLIENT_SECRET");

    // CI Rust quality jobs run without building frontend assets first.
    // Ensure configured asset/resource directories exist so tauri-build validation passes.
    let required_paths = [
        manifest_dir.join("../dist/renderer"),
        manifest_dir.join("../dist/portal"),
    ];
    for path in required_paths {
        if let Err(err) = std::fs::create_dir_all(&path) {
            panic!(
                "failed to create required build path {}: {err}",
                path.display()
            );
        }
    }

    tauri_build::build()
}
