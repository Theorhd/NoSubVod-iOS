use std::path::PathBuf;

fn main() {
    let manifest_dir = PathBuf::from(
        std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR should be set by Cargo"),
    );

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
