use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{info, warn};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtensionManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: Option<String>,
    pub author: Option<String>,
    pub entry: String, // Point d'entrée JS (ex: "index.js")
}

#[derive(Debug, Clone, Serialize)]
pub struct Extension {
    pub manifest: ExtensionManifest,
    pub path: PathBuf,
}

pub struct ExtensionManager {
    extensions_dir: PathBuf,
    extensions: Arc<RwLock<Vec<Extension>>>,
}

impl ExtensionManager {
    pub fn new(app_data_dir: PathBuf) -> Self {
        let extensions_dir = app_data_dir.join("extensions");
        if !extensions_dir.exists() {
            let _ = std::fs::create_dir_all(&extensions_dir);
        }

        Self {
            extensions_dir,
            extensions: Arc::new(RwLock::new(Vec::new())),
        }
    }

    pub async fn scan(&self) -> Result<(), String> {
        let mut loaded = Vec::new();
        let mut entries = tokio::fs::read_dir(&self.extensions_dir)
            .await
            .map_err(|e| e.to_string())?;

        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path();
            if path.is_dir() {
                let manifest_path = path.join("manifest.json");
                if manifest_path.exists() {
                    match self.load_manifest(&manifest_path).await {
                        Ok(manifest) => {
                            info!("Extension chargée: {} ({})", manifest.name, manifest.id);
                            loaded.push(Extension { manifest, path });
                        }
                        Err(e) => {
                            warn!("Échec du chargement du manifeste dans {:?}: {}", path, e);
                        }
                    }
                }
            }
        }

        let mut extensions = self.extensions.write().await;
        *extensions = loaded;
        Ok(())
    }

    async fn load_manifest(&self, path: &Path) -> Result<ExtensionManifest, String> {
        let content = tokio::fs::read_to_string(path)
            .await
            .map_err(|e| e.to_string())?;
        serde_json::from_str(&content).map_err(|e| e.to_string())
    }

    pub async fn list(&self) -> Vec<Extension> {
        self.extensions.read().await.clone()
    }

    pub async fn get_extension_path(&self, id: &str) -> Option<PathBuf> {
        let extensions = self.extensions.read().await;
        extensions
            .iter()
            .find(|e| e.manifest.id == id)
            .map(|e| e.path.clone())
    }
}
