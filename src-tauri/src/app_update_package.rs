use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter};

use crate::{app_update, update_versions};

const MAX_PACKAGE_BYTES: u64 = 512 * 1024 * 1024;
static UPDATE_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StagedAppUpdate {
    pub version: String,
    pub sha256: String,
    pub file_name: String,
    pub installed: bool,
}

fn update_dir() -> PathBuf {
    crate::paths::app_data_root().join("updates")
}

fn package_name(version: &str) -> Result<String, String> {
    update_versions::parse(version).ok_or("Invalid app update version")?;
    Ok(format!("supercharge-app-{version}.download"))
}

fn local_install_target() -> Option<PathBuf> {
    if !cfg!(target_os = "linux") {
        return None;
    }
    let expected = crate::process_util::user_home().join(".local/bin/supercharge-app");
    let executable = tauri::process::current_binary(&tauri::Env::default()).ok()?;
    if executable != expected || expected.is_symlink() {
        return None;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if fs::metadata(&expected).ok()?.uid() != unsafe { libc::geteuid() } {
            return None;
        }
    }
    Some(expected)
}

pub fn can_install_asset(name: &str) -> bool {
    let arch = std::env::consts::ARCH;
    name == format!("supercharge-app-linux-{arch}") && local_install_target().is_some()
}

pub fn package_url_allowed(raw: &str) -> bool {
    let Ok(url) = reqwest::Url::parse(raw) else {
        return false;
    };
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port_or_known_default() != Some(443)
    {
        return false;
    }
    match url.host_str() {
        Some("github.com") => url
            .path()
            .strip_prefix("/iotserver24/supercharge-app/releases/download/")
            .and_then(|path| path.split_once('/'))
            .is_some_and(|(tag, asset)| {
                !tag.is_empty() && !asset.is_empty() && !asset.contains('/')
            }),

        Some("release-assets.githubusercontent.com" | "objects.githubusercontent.com") => true,
        _ => false,
    }
}

fn client() -> Result<reqwest::Client, String> {
    crate::proxy::apply_to_reqwest(reqwest::Client::builder())
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(600))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() < 8 && package_url_allowed(attempt.url().as_str()) {
                attempt.follow()
            } else {
                attempt.stop()
            }
        }))
        .user_agent(format!(
            "Supercharge/{} desktop-updater",
            env!("CARGO_PKG_VERSION")
        ))
        .build()
        .map_err(|e| e.to_string())
}

fn hash_file(path: &Path) -> Result<String, String> {
    if path.is_symlink() {
        return Err("Update package must not be a symlink".into());
    }
    let mut file = fs::File::open(path).map_err(|e| e.to_string())?;
    if file.metadata().map_err(|e| e.to_string())?.len() > MAX_PACKAGE_BYTES {
        return Err("Update package is too large".into());
    }
    let mut hash = Sha256::new();
    let mut bytes = [0; 64 * 1024];
    loop {
        let count = file.read(&mut bytes).map_err(|e| e.to_string())?;
        if count == 0 {
            break;
        }
        hash.update(&bytes[..count]);
    }
    Ok(hex::encode(hash.finalize()))
}

fn read_staged() -> Result<Option<StagedAppUpdate>, String> {
    if update_dir().is_symlink() {
        return Err("Update directory must not be a symlink".into());
    }
    let path = update_dir().join("staged.json");
    if !path.exists() {
        return Ok(None);
    }
    if path.is_symlink() || fs::metadata(&path).map_err(|e| e.to_string())?.len() > 16 * 1024 {
        return Err("Invalid staged update record".into());
    }
    let record: StagedAppUpdate =
        serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    if !update_versions::newer(env!("CARGO_PKG_VERSION"), &record.version) {
        return Ok(None);
    }
    if record.file_name != package_name(&record.version)? {
        return Err("Invalid staged update filename".into());
    }
    let package = update_dir().join(&record.file_name);
    if !package.exists() {
        return Ok(None);
    }
    if hash_file(&package)? != record.sha256 {
        return Err("Cached app update checksum mismatch".into());
    }
    Ok(Some(record))
}

fn write_staged(record: &StagedAppUpdate) -> Result<(), String> {
    crate::store_lock::write_bytes_atomic(
        &update_dir().join("staged.json"),
        &serde_json::to_vec(record).map_err(|e| e.to_string())?,
    )
}

#[tauri::command]
pub async fn app_update_staged() -> Result<Option<StagedAppUpdate>, String> {
    tauri::async_runtime::spawn_blocking(read_staged)
        .await
        .map_err(|e| e.to_string())?
}

fn progress(app: &AppHandle, version: &str, phase: &str, received: u64, total: Option<u64>) {
    let _ = app.emit("app://update-progress", serde_json::json!({
        "version":version,"phase":phase,"bytesDownloaded":received,"totalBytes":total,
        "percent":total.filter(|value| *value > 0).map(|value| received as f64 * 100.0 / value as f64),
    }));
}

#[tauri::command]
pub async fn app_update_download(
    app: AppHandle,
    expected_version: String,
) -> Result<StagedAppUpdate, String> {
    let _guard = UPDATE_LOCK
        .try_lock()
        .map_err(|_| "An app update is already in progress")?;
    update_versions::parse(&expected_version).ok_or("Invalid app update version")?;
    if let Some(staged) = read_staged()? {
        if !update_versions::newer(&staged.version, &expected_version) {
            return Ok(staged);
        }
    }
    let release = app_update::check_app_update().await?;
    if release.latest_version != expected_version {
        return Err("The app release changed; check for updates again".into());
    }
    if !update_versions::needs_download(env!("CARGO_PKG_VERSION"), None, &release.latest_version) {
        return Err("This app version is already installed or newer".into());
    }
    let name = release
        .download_name
        .as_deref()
        .ok_or("No desktop package for this platform")?;
    if !can_install_asset(name) {
        return Err("This app package requires manual installation".into());
    }
    let url = release
        .download_url
        .as_deref()
        .ok_or("No app package URL")?;
    if !package_url_allowed(url) {
        return Err("App update URL is not trusted".into());
    }
    let client = client()?;
    let expected = if let Some(hash) = release.published_sha256 {
        hash
    } else {
        let checksum_url = release
            .checksum_url
            .as_deref()
            .ok_or("No published app checksum; refusing to install")?;
        if !package_url_allowed(checksum_url) {
            return Err("Checksum URL is not trusted".into());
        }
        let response = client
            .get(checksum_url)
            .send()
            .await
            .map_err(|e| e.to_string())?
            .error_for_status()
            .map_err(|e| e.to_string())?;
        let mut data = Vec::new();
        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| e.to_string())?;
            if data.len() + chunk.len() > 1024 * 1024 {
                return Err("Checksum manifest too large".into());
            }
            data.extend_from_slice(&chunk);
        }
        crate::cli_install::parse_checksum_for_file(&String::from_utf8_lossy(&data), name)
            .ok_or("Desktop package checksum not found")?
    };
    if expected.len() != 64 || !expected.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("Invalid published checksum".into());
    }
    let directory = update_dir();
    fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    if directory.is_symlink() {
        return Err("Update directory must not be a symlink".into());
    }
    let partial = directory.join(format!("{}.part", uuid::Uuid::new_v4()));
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&partial).map_err(|e| e.to_string())?;
    let result = async {
        let response = client
            .get(url)
            .send()
            .await
            .map_err(|e| e.to_string())?
            .error_for_status()
            .map_err(|e| e.to_string())?;
        let total = response.content_length();
        if total.is_some_and(|size| size > MAX_PACKAGE_BYTES) {
            return Err("App update is too large".to_string());
        }
        let mut received = 0u64;
        let mut hash = Sha256::new();
        let mut stream = response.bytes_stream();
        let mut last_event = std::time::Instant::now();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| e.to_string())?;
            received += chunk.len() as u64;
            if received > MAX_PACKAGE_BYTES {
                return Err("App update is too large".into());
            }
            file.write_all(&chunk).map_err(|e| e.to_string())?;
            hash.update(&chunk);
            if last_event.elapsed() > Duration::from_millis(150) {
                progress(&app, &expected_version, "downloading", received, total);
                last_event = std::time::Instant::now();
            }
        }
        file.sync_all().map_err(|e| e.to_string())?;
        if received < 1024 || hex::encode(hash.finalize()) != expected.to_ascii_lowercase() {
            return Err("App update checksum verification failed".into());
        }
        verify_linux_binary(&partial)?;
        let file_name = package_name(&expected_version)?;
        let destination = directory.join(&file_name);
        if destination.exists() && destination.is_symlink() {
            return Err("Invalid cached app package".into());
        }
        fs::rename(&partial, destination).map_err(|e| e.to_string())?;
        let record = StagedAppUpdate {
            version: expected_version.clone(),
            sha256: expected.to_ascii_lowercase(),
            file_name,
            installed: false,
        };
        write_staged(&record)?;
        progress(&app, &expected_version, "ready", received, total);
        Ok(record)
    }
    .await;
    if result.is_err() {
        let _ = fs::remove_file(partial);
    }
    result
}

fn verify_linux_binary(path: &Path) -> Result<(), String> {
    let mut header = [0; 20];
    fs::File::open(path)
        .and_then(|mut file| file.read_exact(&mut header))
        .map_err(|e| e.to_string())?;
    let machine = if cfg!(target_arch = "aarch64") {
        183
    } else {
        62
    };
    if &header[..4] != b"\x7fELF"
        || header[4] != 2
        || header[5] != 1
        || u16::from_le_bytes([header[18], header[19]]) != machine
    {
        return Err("Desktop package is not a compatible 64-bit Linux executable".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn app_update_install() -> Result<StagedAppUpdate, String> {
    let _guard = UPDATE_LOCK
        .try_lock()
        .map_err(|_| "An app update is already in progress")?;
    tauri::async_runtime::spawn_blocking(|| {
        let mut record = read_staged()?.ok_or("No downloaded app update is ready")?;
        let target =
            local_install_target().ok_or("This install location cannot be updated in place")?;
        let source = update_dir().join(&record.file_name);
        verify_linux_binary(&source)?;
        if record.installed && hash_file(&target)? == record.sha256 {
            return Ok(record);
        }
        let staged_target =
            target.with_file_name(format!(".supercharge-app-update-{}", uuid::Uuid::new_v4()));
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o755);
        }
        let mut out = options.open(&staged_target).map_err(|e| e.to_string())?;
        std::io::copy(
            &mut fs::File::open(source).map_err(|e| e.to_string())?,
            &mut out,
        )
        .map_err(|e| e.to_string())?;
        out.sync_all().map_err(|e| e.to_string())?;
        if hash_file(&staged_target)? != record.sha256 {
            let _ = fs::remove_file(staged_target);
            return Err("Staged app checksum mismatch".into());
        }
        let backup = update_dir().join("previous-app");
        if backup.is_symlink() {
            return Err("Invalid update backup path".into());
        }
        fs::copy(&target, backup).map_err(|e| format!("Cannot back up current app: {e}"))?;
        fs::rename(&staged_target, &target)
            .map_err(|e| format!("Cannot install app update: {e}"))?;
        record.installed = true;
        write_staged(&record)?;
        Ok(record)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn package_urls_are_limited_to_the_desktop_release_repository() {
        assert!(package_url_allowed(
            "https://github.com/iotserver24/supercharge-app/releases/download/v0.2.38/Supercharge_0.2.38_amd64.AppImage"
        ));
        for url in [
            "http://github.com/iotserver24/supercharge-app/releases/download/v1/test",
            "https://github.com/other/repo/releases/download/v1/test",
            "https://github.com.evil.test/iotserver24/supercharge-app/releases/download/v1/test",
            "https://user:pass@github.com/iotserver24/supercharge-app/releases/download/v1/test",
        ] {
            assert!(!package_url_allowed(url));
        }
    }
    #[test]
    fn cache_names_reject_paths_and_invalid_versions() {
        assert_eq!(
            package_name("0.2.37").unwrap(),
            "supercharge-app-0.2.37.download"
        );
        assert!(package_name("../../bad").is_err());
        assert!(package_name("latest").is_err());
    }
}
