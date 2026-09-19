use std::fs;
use std::path::PathBuf;

use base64::Engine;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{Emitter, Manager, Webview};
use tauri_plugin_updater::Update;

static CACHE_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
const MAX_BYTES: usize = 512 * 1024 * 1024;

#[derive(Serialize, Deserialize)]
struct CacheRecord {
    version: String,
    signature: String,
    url: String,
    sha256: String,
}

fn paths(version: &str) -> Result<(PathBuf, PathBuf), String> {
    crate::update_versions::parse(version).ok_or("Invalid update version")?;
    let root = crate::paths::app_data_root().join("updates");
    if root.is_symlink() {
        return Err("Update cache must not be a symlink".into());
    }
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    Ok((
        root.join(format!("signed-{version}.download")),
        root.join(format!("signed-{version}.json")),
    ))
}

fn verify(data: &[u8], signature: &str, key: &str) -> Result<(), String> {
    let decode = |value: &str| -> Result<String, String> {
        String::from_utf8(
            base64::engine::general_purpose::STANDARD
                .decode(value)
                .map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())
    };
    let key = minisign_verify::PublicKey::decode(&decode(key)?).map_err(|e| e.to_string())?;
    let signature =
        minisign_verify::Signature::decode(&decode(signature)?).map_err(|e| e.to_string())?;
    key.verify(data, &signature, true)
        .map_err(|e| format!("App update signature verification failed: {e}"))
}

fn public_key(webview: &Webview) -> Result<String, String> {
    let value = webview
        .config()
        .plugins
        .0
        .get("updater")
        .cloned()
        .ok_or("Updater configuration missing")?;
    let config: tauri_plugin_updater::Config =
        serde_json::from_value(value).map_err(|e| e.to_string())?;
    Ok(config.pubkey)
}

fn cached(update: &Update, key: &str) -> Result<Option<Vec<u8>>, String> {
    let (data_path, metadata_path) = paths(&update.version)?;
    if !data_path.exists() || !metadata_path.exists() {
        return Ok(None);
    }
    if data_path.is_symlink() || metadata_path.is_symlink() {
        return Err("Invalid signed cache path".into());
    }
    if fs::metadata(&metadata_path)
        .map_err(|e| e.to_string())?
        .len()
        > 64 * 1024
    {
        return Err("Signed update metadata too large".into());
    }
    let metadata: CacheRecord =
        serde_json::from_slice(&fs::read(metadata_path).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    if metadata.version != update.version
        || metadata.signature != update.signature
        || metadata.url != update.download_url.as_str()
    {
        return Ok(None);
    }
    if fs::metadata(&data_path).map_err(|e| e.to_string())?.len() > MAX_BYTES as u64 {
        return Err("Cached update too large".into());
    }
    let data = fs::read(data_path).map_err(|e| e.to_string())?;
    if hex::encode(Sha256::digest(&data)) != metadata.sha256 {
        return Err("Cached update checksum mismatch".into());
    }
    verify(&data, &update.signature, key)?;
    Ok(Some(data))
}

#[tauri::command]
pub async fn app_update_signed_download(webview: Webview, rid: u32) -> Result<(), String> {
    let _guard = CACHE_LOCK
        .try_lock()
        .map_err(|_| "App update already in progress")?;
    let update = webview
        .resources_table()
        .get::<Update>(rid)
        .map_err(|e| e.to_string())?;
    if !crate::update_versions::newer(&update.current_version, &update.version) {
        return Err("App update is not newer than installed version".into());
    }
    let key = public_key(&webview)?;
    if cached(&update, &key)?.is_some() {
        return Ok(());
    }
    let mut received = 0u64;
    let mut last_event = std::time::Instant::now();
    let data = update.download(|size, total| {
        received += size as u64;
        if last_event.elapsed() >= std::time::Duration::from_millis(150) {
            let _ = webview.emit("app://update-progress", serde_json::json!({"version":update.version,"phase":"downloading","bytesDownloaded":received,"totalBytes":total,"percent":total.filter(|v| *v > 0).map(|v| received as f64 * 100.0 / v as f64)}));
            last_event = std::time::Instant::now();
        }
    }, || {}).await.map_err(|e| e.to_string())?;
    if data.len() > MAX_BYTES {
        return Err("App update too large".into());
    }
    verify(&data, &update.signature, &key)?;
    let (data_path, metadata_path) = paths(&update.version)?;
    crate::store_lock::write_bytes_atomic(&data_path, &data)?;
    crate::store_lock::write_bytes_atomic(
        &metadata_path,
        &serde_json::to_vec(&CacheRecord {
            version: update.version.clone(),
            signature: update.signature.clone(),
            url: update.download_url.to_string(),
            sha256: hex::encode(Sha256::digest(data)),
        })
        .map_err(|e| e.to_string())?,
    )
}

#[tauri::command]
pub async fn app_update_signed_cached(webview: Webview, rid: u32) -> Result<bool, String> {
    let update = webview
        .resources_table()
        .get::<Update>(rid)
        .map_err(|e| e.to_string())?;
    Ok(cached(&update, &public_key(&webview)?)?.is_some())
}

#[tauri::command]
pub async fn app_update_signed_install(webview: Webview, rid: u32) -> Result<(), String> {
    let _guard = CACHE_LOCK
        .try_lock()
        .map_err(|_| "App update already in progress")?;
    let update = webview
        .resources_table()
        .get::<Update>(rid)
        .map_err(|e| e.to_string())?;
    if !crate::update_versions::newer(env!("CARGO_PKG_VERSION"), &update.version) {
        return Err("App update is not newer than the installed version".into());
    }
    let data = cached(&update, &public_key(&webview)?)?
        .ok_or("App update has not finished downloading")?;
    tauri::async_runtime::spawn_blocking(move || update.install(data).map_err(|e| e.to_string()))
        .await
        .map_err(|e| e.to_string())?
}
