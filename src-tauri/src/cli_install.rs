//! Install or update the Supercharge CLI from the public release repository.
//!
//! Release contract (kept in sync with `scripts/install.sh` / `install.ps1`):
//! - repository: `iotserver24/supercharge-releases`
//! - latest version: GitHub Releases API, then `releases/latest/download/version`
//! - asset: `supercharge-{os}-{arch}[.exe]`
//! - retained download: `~/.supercharge/downloads/supercharge-{version}-{os}-{arch}[.exe]`
//! - installed commands: `~/.local/bin/supercharge` and `~/.local/bin/sc`
//!
//! Trust chain:
//! - HTTPS only, restricted to the public repository endpoints and GitHub's release CDNs
//! - streaming SHA-256 of the downloaded bytes
//! - published checksum (`SHA256SUMS` or an asset sidecar) is verified when available;
//!   a mismatch always aborts
//! - strict missing-checksum mode: `SUPERCHARGE_CLI_REQUIRE_CHECKSUM=1`, overridable
//!   by Settings or `SUPERCHARGE_CLI_ALLOW_UNVERIFIED=1`
//! - size and `--version` gates before installation

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::Duration;

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter};
use tracing::{info, warn};

use crate::cli_probe;
use crate::process_util::{self, user_home};

const RELEASE_REPO: &str = "iotserver24/supercharge-releases";
const RELEASE_API_URL: &str =
    "https://api.github.com/repos/iotserver24/supercharge-releases/releases/latest";
const RELEASE_LATEST_BASE: &str =
    "https://github.com/iotserver24/supercharge-releases/releases/latest/download";
const RELEASE_DOWNLOAD_BASE: &str =
    "https://github.com/iotserver24/supercharge-releases/releases/download";
const RELEASE_REPO_URL: &str = "https://github.com/iotserver24/supercharge-releases";
const INSTALL_SCRIPT_BASE: &str =
    "https://raw.githubusercontent.com/iotserver24/supercharge-releases/main/scripts";
const RESOLVE_ATTEMPTS: u32 = 2;
const DOWNLOAD_ATTEMPTS: u32 = 2;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(20);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(600);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliInstallProgress {
    pub phase: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub percent: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bytes_downloaded: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mirror: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sha256: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliInstallResult {
    pub ok: bool,
    pub path: Option<String>,
    pub version: Option<String>,
    pub mirror_used: Option<String>,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sha256: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub checksum_verified: Option<bool>,
}

fn parsed_allowed_url(url: &str) -> Option<reqwest::Url> {
    let parsed = reqwest::Url::parse(url.trim()).ok()?;
    if parsed.scheme() != "https"
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.port_or_known_default() != Some(443)
        || url.contains("..")
    {
        return None;
    }
    Some(parsed)
}

/// True only for HTTPS URLs used by the public Supercharge release contract.
pub fn is_allowed_download_url(url: &str) -> bool {
    let Some(parsed) = parsed_allowed_url(url) else {
        return false;
    };
    let host = parsed.host_str().unwrap_or_default().to_ascii_lowercase();
    let path = parsed.path();

    match host.as_str() {
        "api.github.com" => path == "/repos/iotserver24/supercharge-releases/releases/latest",
        "github.com" => {
            path == "/iotserver24/supercharge-releases/releases/latest/download/version"
                || path.starts_with("/iotserver24/supercharge-releases/releases/download/v")
        }
        // GitHub release downloads redirect to signed, opaque paths on these hosts.
        "release-assets.githubusercontent.com" | "objects.githubusercontent.com" => true,
        _ => false,
    }
}

fn redirect_policy() -> reqwest::redirect::Policy {
    reqwest::redirect::Policy::custom(|attempt| {
        if attempt.previous().len() < 8 && is_allowed_download_url(attempt.url().as_str()) {
            attempt.follow()
        } else {
            attempt.stop()
        }
    })
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|e| format!("open for hash: {e}"))?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        use std::io::Read;
        let n = file.read(&mut buf).map_err(|e| format!("hash read: {e}"))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hex::encode(hasher.finalize()))
}

/// Parse a checksum file body for `filename` (GNU `sha256sum` or plain hex).
pub fn parse_checksum_for_file(body: &str, filename: &str) -> Option<String> {
    let want = filename.trim();
    for line in body.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let mut parts = line.split_whitespace();
        let hex_part = parts.next()?;
        if hex_part.len() != 64 || !hex_part.chars().all(|c| c.is_ascii_hexdigit()) {
            continue;
        }
        if let Some(name) = parts.next() {
            let name = name.trim_start_matches('*');
            if name == want || Path::new(name).file_name().and_then(|s| s.to_str()) == Some(want) {
                return Some(hex_part.to_ascii_lowercase());
            }
        } else {
            return Some(hex_part.to_ascii_lowercase());
        }
    }
    let text = body.trim();
    if text.len() == 64 && text.chars().all(|c| c.is_ascii_hexdigit()) {
        Some(text.to_ascii_lowercase())
    } else {
        None
    }
}

async fn fetch_published_checksum(
    client: &reqwest::Client,
    version: &str,
    artifact_name: &str,
) -> Option<String> {
    let base = release_base(version);
    let candidates = [
        format!("{base}/SHA256SUMS"),
        format!("{base}/{artifact_name}.sha256"),
        format!("{base}/{artifact_name}.sha256sum"),
    ];
    for url in candidates {
        if !is_allowed_download_url(&url) {
            continue;
        }
        match client.get(&url).send().await {
            Ok(resp)
                if resp.status().is_success() && is_allowed_download_url(resp.url().as_str()) =>
            {
                if let Ok(text) = resp.text().await {
                    if let Some(hash) = parse_checksum_for_file(&text, artifact_name) {
                        info!("cli_install: checksum for {artifact_name} from {url}");
                        return Some(hash);
                    }
                }
            }
            _ => {}
        }
    }
    None
}

fn emit(app: &AppHandle, progress: CliInstallProgress) {
    let _ = app.emit("setup://cli-install-progress", &progress);
}

fn progress(
    phase: &str,
    message: impl Into<String>,
    percent: Option<f64>,
    source: Option<String>,
    version: Option<String>,
) -> CliInstallProgress {
    CliInstallProgress {
        phase: phase.into(),
        message: message.into(),
        percent,
        bytes_downloaded: None,
        total_bytes: None,
        mirror: source,
        version,
        sha256: None,
    }
}

fn platform_triple() -> Result<(&'static str, &'static str), String> {
    let os = if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else {
        return Err("Unsupported OS for Supercharge auto-install".into());
    };
    let arch = if cfg!(target_arch = "aarch64") {
        "aarch64"
    } else if cfg!(target_arch = "x86_64") {
        "x86_64"
    } else {
        return Err("Unsupported CPU architecture for Supercharge auto-install".into());
    };
    Ok((os, arch))
}

fn artifact_name_for(os: &str, arch: &str) -> String {
    format!(
        "supercharge-{os}-{arch}{}",
        if os == "windows" { ".exe" } else { "" }
    )
}

fn http_client() -> Result<reqwest::Client, String> {
    crate::proxy::apply_to_reqwest(reqwest::Client::builder())
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(REQUEST_TIMEOUT)
        .user_agent(format!(
            "Supercharge/{} (desktop; cli-installer; +{RELEASE_REPO_URL})",
            env!("CARGO_PKG_VERSION")
        ))
        .redirect(redirect_policy())
        .build()
        .map_err(|e| e.to_string())
}

fn source_host(url: &str) -> String {
    reqwest::Url::parse(url)
        .ok()
        .and_then(|u| u.host_str().map(str::to_string))
        .unwrap_or_else(|| url.to_string())
}

fn normalize_version(raw: &str) -> Option<String> {
    let version = raw.trim().trim_start_matches(['v', 'V']);
    if version.is_empty() || version.contains("..") {
        return None;
    }

    // Match the public shell installer's contract:
    // X.Y.Z with an optional `-suffix` or `.suffix` made from ASCII version chars.
    let mut parts = version.splitn(3, '.');
    let major = parts.next()?;
    let minor = parts.next()?;
    let patch_and_suffix = parts.next()?;
    if major.is_empty()
        || minor.is_empty()
        || !major.bytes().all(|b| b.is_ascii_digit())
        || !minor.bytes().all(|b| b.is_ascii_digit())
    {
        return None;
    }
    let suffix_start = patch_and_suffix
        .find(['.', '-'])
        .unwrap_or(patch_and_suffix.len());
    let (patch, suffix) = patch_and_suffix.split_at(suffix_start);
    if patch.is_empty() || !patch.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    if !suffix.is_empty()
        && (suffix.len() == 1
            || !suffix[1..]
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-')))
    {
        return None;
    }
    Some(version.to_string())
}

fn parse_latest_release_version(body: &str) -> Result<String, String> {
    let value: serde_json::Value =
        serde_json::from_str(body).map_err(|e| format!("invalid GitHub release response: {e}"))?;
    let tag = value
        .get("tag_name")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "GitHub latest release response is missing tag_name".to_string())?;
    normalize_version(tag).ok_or_else(|| format!("invalid Supercharge release tag: {tag:?}"))
}

async fn fetch_text(client: &reqwest::Client, url: &str, label: &str) -> Result<String, String> {
    if !is_allowed_download_url(url) {
        return Err(format!("{label} URL not on allowlist: {url}"));
    }
    let response = client
        .get(url)
        .header(reqwest::header::ACCEPT, "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("{label} {url}: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("{label} {url}: HTTP {}", response.status()));
    }
    if !is_allowed_download_url(response.url().as_str()) {
        return Err(format!(
            "{label} redirected off allowlist: {}",
            response.url()
        ));
    }
    response.text().await.map_err(|e| format!("{label}: {e}"))
}

async fn resolve_version(
    app: &AppHandle,
    client: &reqwest::Client,
) -> Result<(String, String), String> {
    emit(
        app,
        progress(
            "resolving",
            "Resolving latest Supercharge release…",
            Some(0.0),
            None,
            None,
        ),
    );

    let sources = [
        (RELEASE_API_URL, "GitHub latest release API"),
        (
            "https://github.com/iotserver24/supercharge-releases/releases/latest/download/version",
            "GitHub release version asset",
        ),
    ];
    let mut errors = Vec::new();
    for (url, label) in sources {
        for attempt in 1..=RESOLVE_ATTEMPTS {
            emit(
                app,
                progress(
                    "resolving",
                    format!("Trying {label} (attempt {attempt}/{RESOLVE_ATTEMPTS})…"),
                    Some(2.0),
                    Some(url.into()),
                    None,
                ),
            );
            let result = fetch_text(client, url, "version lookup")
                .await
                .and_then(|body| {
                    if url == RELEASE_API_URL {
                        parse_latest_release_version(&body)
                    } else {
                        normalize_version(&body)
                            .ok_or_else(|| format!("invalid version pointer from {url}: {body:?}"))
                    }
                });
            match result {
                Ok(version) => {
                    info!("cli_install: resolved Supercharge {version} via {url}");
                    return Ok((version, url.to_string()));
                }
                Err(error) => {
                    warn!("cli_install version fail source={url} attempt={attempt}: {error}");
                    errors.push(error);
                    if attempt < RESOLVE_ATTEMPTS {
                        tokio::time::sleep(Duration::from_millis(400 * attempt as u64)).await;
                    }
                }
            }
        }
    }
    Err(format!(
        "Failed to resolve latest Supercharge version from {RELEASE_REPO}. {}",
        errors.last().cloned().unwrap_or_default()
    ))
}

fn release_base(version: &str) -> String {
    format!("{RELEASE_DOWNLOAD_BASE}/v{version}")
}

async fn download_to_file(
    app: &AppHandle,
    client: &reqwest::Client,
    url: &str,
    dest: &Path,
    version: &str,
) -> Result<(), String> {
    if !is_allowed_download_url(url) {
        return Err(format!("download URL not on allowlist: {url}"));
    }
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("download {url}: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("download {url}: HTTP {}", response.status()));
    }
    let final_url = response.url().to_string();
    if !is_allowed_download_url(&final_url) {
        return Err(format!("download redirected off allowlist: {final_url}"));
    }
    let total = response.content_length();
    let mut stream = response.bytes_stream();
    let mut file = fs::File::create(dest).map_err(|e| format!("create {}: {e}", dest.display()))?;
    let mut downloaded = 0u64;
    let mut last_emit = 0u64;
    let mut hasher = Sha256::new();

    emit(
        app,
        CliInstallProgress {
            phase: "downloading".into(),
            message: format!("Downloading from {}…", source_host(&final_url)),
            percent: Some(5.0),
            bytes_downloaded: Some(0),
            total_bytes: total,
            mirror: Some(url.into()),
            version: Some(version.into()),
            sha256: None,
        },
    );

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("download stream: {e}"))?;
        hasher.update(&chunk);
        file.write_all(&chunk)
            .map_err(|e| format!("write download: {e}"))?;
        downloaded += chunk.len() as u64;
        if downloaded.saturating_sub(last_emit) >= 256 * 1024 || total == Some(downloaded) {
            last_emit = downloaded;
            let percent = match total {
                Some(total) if total > 0 => 5.0 + (downloaded as f64 / total as f64) * 85.0,
                _ => 5.0 + (downloaded as f64 / (120.0 * 1024.0 * 1024.0)).min(1.0) * 85.0,
            };
            emit(
                app,
                CliInstallProgress {
                    phase: "downloading".into(),
                    message: format!("Downloading… {}", format_bytes_pair(downloaded, total)),
                    percent: Some(percent.min(90.0)),
                    bytes_downloaded: Some(downloaded),
                    total_bytes: total,
                    mirror: Some(url.into()),
                    version: Some(version.into()),
                    sha256: None,
                },
            );
        }
    }
    file.sync_all().map_err(|e| e.to_string())?;
    if downloaded == 0 {
        let _ = fs::remove_file(dest);
        return Err("Supercharge download produced an empty file".into());
    }
    if let Some(total) = total {
        if downloaded != total {
            let _ = fs::remove_file(dest);
            return Err(format!(
                "Supercharge download size mismatch: got {downloaded}, expected {total}"
            ));
        }
    }
    let _ = fs::write(
        dest.with_extension("sha256"),
        hex::encode(hasher.finalize()),
    );
    Ok(())
}

fn format_bytes_pair(done: u64, total: Option<u64>) -> String {
    match total {
        Some(total) => format!("{} / {}", format_bytes(done), format_bytes(total)),
        None => format_bytes(done),
    }
}

fn format_bytes(bytes: u64) -> String {
    const KB: f64 = 1024.0;
    const MB: f64 = KB * 1024.0;
    let value = bytes as f64;
    if value >= MB {
        format!("{:.1} MB", value / MB)
    } else if value >= KB {
        format!("{:.0} KB", value / KB)
    } else {
        format!("{bytes} B")
    }
}

fn verify_binary(path: &Path) -> Result<String, String> {
    if !path.is_file() {
        return Err(format!(
            "downloaded Supercharge binary is not a file: {}",
            path.display()
        ));
    }
    let metadata = fs::metadata(path).map_err(|e| format!("stat {}: {e}", path.display()))?;
    if metadata.len() < 1024 {
        return Err(format!(
            "downloaded Supercharge binary is too small ({} bytes): {}",
            metadata.len(),
            path.display()
        ));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = metadata.permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(path, permissions).map_err(|e| e.to_string())?;
    }
    let mut command = std::process::Command::new(path);
    command.arg("--version");
    process_util::apply_no_window_std(&mut command);
    let output = command
        .output()
        .map_err(|e| format!("failed to run downloaded Supercharge binary: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "downloaded Supercharge binary --version failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    let line = String::from_utf8_lossy(&output.stdout)
        .lines()
        .next()
        .unwrap_or("")
        .trim()
        .to_string();
    if line.is_empty() {
        Err("downloaded Supercharge binary returned an empty --version".into())
    } else {
        Ok(line)
    }
}

fn replace_with_copy(source: &Path, target: &Path) -> Result<(), String> {
    // Never follow an existing symlink and overwrite a target outside ~/.local/bin.
    if target
        .symlink_metadata()
        .map(|metadata| metadata.file_type().is_symlink())
        .unwrap_or(false)
    {
        fs::remove_file(target).map_err(|error| format!("remove {}: {error}", target.display()))?;
    }
    let old = PathBuf::from(format!("{}.old", target.display()));
    let _ = fs::remove_file(&old);
    if fs::copy(source, target).is_err() {
        let _ = fs::rename(target, &old);
        if let Err(error) = fs::copy(source, target) {
            let _ = fs::rename(&old, target);
            return Err(format!("install {}: {error}", target.display()));
        }
    }
    let _ = fs::remove_file(old);
    Ok(())
}

fn install_binary(download_path: &Path, version: &str) -> Result<PathBuf, String> {
    let home = user_home();
    let download_dir = home.join(".supercharge").join("downloads");
    let bin_dir = home.join(".local").join("bin");
    fs::create_dir_all(&download_dir).map_err(|e| e.to_string())?;
    fs::create_dir_all(&bin_dir).map_err(|e| e.to_string())?;

    let (os, arch) = platform_triple()?;
    let ext = if os == "windows" { ".exe" } else { "" };
    let final_download = download_dir.join(format!("supercharge-{version}-{os}-{arch}{ext}"));
    if final_download != download_path {
        let _ = fs::remove_file(&final_download);
        if fs::rename(download_path, &final_download).is_err() {
            fs::copy(download_path, &final_download)
                .map_err(|e| format!("retain downloaded Supercharge binary: {e}"))?;
            let _ = fs::remove_file(download_path);
        }
    }

    #[cfg(target_os = "windows")]
    {
        let supercharge = bin_dir.join("supercharge.exe");
        let alias = bin_dir.join("sc.exe");
        replace_with_copy(&final_download, &supercharge)?;
        replace_with_copy(&final_download, &alias)?;
        Ok(supercharge)
    }

    #[cfg(not(target_os = "windows"))]
    {
        use std::os::unix::fs::{symlink, PermissionsExt};

        let supercharge = bin_dir.join("supercharge");
        replace_with_copy(&final_download, &supercharge)?;
        let mut permissions = fs::metadata(&supercharge)
            .map_err(|e| e.to_string())?
            .permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&supercharge, permissions).map_err(|e| e.to_string())?;

        let alias = bin_dir.join("sc");
        let _ = fs::remove_file(&alias);
        symlink("supercharge", &alias).map_err(|e| format!("symlink sc: {e}"))?;
        Ok(supercharge)
    }
}

async fn download_release(
    app: &AppHandle,
    client: &reqwest::Client,
    version: &str,
) -> Result<(PathBuf, String, String), String> {
    let (os, arch) = platform_triple()?;
    let artifact_name = artifact_name_for(os, arch);
    let url = format!("{}/{artifact_name}", release_base(version));
    if !is_allowed_download_url(&url) {
        return Err(format!("release asset URL not on allowlist: {url}"));
    }

    let download_dir = user_home().join(".supercharge").join("downloads");
    fs::create_dir_all(&download_dir).map_err(|e| e.to_string())?;
    let temp_name = if cfg!(target_os = "windows") {
        format!(
            "supercharge-{version}-{os}-{arch}-{}.part.exe",
            std::process::id()
        )
    } else {
        format!(
            "supercharge-{version}-{os}-{arch}-{}.part",
            std::process::id()
        )
    };
    let temp_path = download_dir.join(temp_name);

    let mut errors = Vec::new();
    for attempt in 1..=DOWNLOAD_ATTEMPTS {
        emit(
            app,
            progress(
                "downloading",
                format!("GitHub release · attempt {attempt}/{DOWNLOAD_ATTEMPTS}"),
                Some(5.0),
                Some(url.clone()),
                Some(version.into()),
            ),
        );
        let _ = fs::remove_file(&temp_path);
        match download_to_file(app, client, &url, &temp_path, version).await {
            Ok(()) => return Ok((temp_path, url, artifact_name)),
            Err(error) => {
                warn!("cli_install download fail url={url}: {error}");
                errors.push(error);
                let _ = fs::remove_file(&temp_path);
                if attempt < DOWNLOAD_ATTEMPTS {
                    tokio::time::sleep(Duration::from_millis(500 * attempt as u64)).await;
                }
            }
        }
    }
    Err(format!(
        "Supercharge release download failed. Last error: {}. This platform may not be published yet; check {RELEASE_REPO_URL}/releases/tag/v{version}",
        errors.last().cloned().unwrap_or_else(|| "unknown".into())
    ))
}

/// Whether a published checksum is required when a release has none.
///
/// A checksum mismatch always fails. A missing checksum fails only when
/// `SUPERCHARGE_CLI_REQUIRE_CHECKSUM` is truthy and neither Settings nor
/// `SUPERCHARGE_CLI_ALLOW_UNVERIFIED` allows the unverified install.
pub fn require_published_checksum(allow_unverified: bool) -> bool {
    if env_flag_truthy("SUPERCHARGE_CLI_ALLOW_UNVERIFIED") || allow_unverified {
        return false;
    }
    env_flag_truthy("SUPERCHARGE_CLI_REQUIRE_CHECKSUM")
}

fn env_flag_truthy(name: &str) -> bool {
    std::env::var(name)
        .map(|value| {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            )
        })
        .unwrap_or(false)
}

/// Download the latest public Supercharge release and install it into `~/.local/bin`.
pub async fn install_cli_latest(
    app: AppHandle,
    allow_unverified: bool,
) -> Result<CliInstallResult, String> {
    let client = http_client()?;
    let (version, version_source) = resolve_version(&app, &client).await?;
    emit(
        &app,
        progress(
            "downloading",
            format!("Found Supercharge v{version}"),
            Some(4.0),
            Some(version_source),
            Some(version.clone()),
        ),
    );

    let (temp_path, asset_url, artifact_name) = download_release(&app, &client, &version).await?;
    let digest = sha256_file(&temp_path).unwrap_or_else(|_| {
        fs::read_to_string(temp_path.with_extension("sha256"))
            .unwrap_or_default()
            .trim()
            .to_string()
    });
    if digest.len() != 64 {
        let _ = fs::remove_file(&temp_path);
        return Err("failed to compute SHA-256 of downloaded Supercharge binary".into());
    }

    emit(
        &app,
        CliInstallProgress {
            phase: "verifying".into(),
            message: format!("SHA-256 {digest:.12}… — checking published checksum…"),
            percent: Some(91.0),
            bytes_downloaded: None,
            total_bytes: None,
            mirror: Some(asset_url.clone()),
            version: Some(version.clone()),
            sha256: Some(digest.clone()),
        },
    );

    let checksum_verified = match fetch_published_checksum(&client, &version, &artifact_name).await
    {
        Some(expected) => {
            if expected != digest {
                let _ = fs::remove_file(&temp_path);
                return Err(format!(
                    "SHA-256 mismatch for {artifact_name}: got {digest}, expected {expected}"
                ));
            }
            info!("cli_install: published checksum matched for {artifact_name}");
            true
        }
        None => {
            if require_published_checksum(allow_unverified) {
                let _ = fs::remove_file(&temp_path);
                return Err(format!(
                    "No published SHA-256 for {artifact_name}. Refusing install because \
                     SUPERCHARGE_CLI_REQUIRE_CHECKSUM is set. Enable ‘Allow unverified CLI \
                     install’ in Settings → Runtime, set SUPERCHARGE_CLI_ALLOW_UNVERIFIED=1, \
                     or unset SUPERCHARGE_CLI_REQUIRE_CHECKSUM. hash={digest}"
                ));
            }
            warn!(
                "cli_install: no published checksum for {artifact_name}; continuing with HTTPS allowlist + binary probe (hash={digest})"
            );
            false
        }
    };

    emit(
        &app,
        CliInstallProgress {
            phase: "verifying".into(),
            message: if checksum_verified {
                "Checksum OK — verifying Supercharge binary…".into()
            } else {
                "Verifying Supercharge binary…".into()
            },
            percent: Some(92.0),
            bytes_downloaded: None,
            total_bytes: None,
            mirror: Some(asset_url.clone()),
            version: Some(version.clone()),
            sha256: Some(digest.clone()),
        },
    );

    let version_line = match verify_binary(&temp_path) {
        Ok(version) => version,
        Err(error) => {
            let _ = fs::remove_file(&temp_path);
            return Err(error);
        }
    };

    emit(
        &app,
        CliInstallProgress {
            phase: "linking".into(),
            message: "Installing Supercharge to ~/.local/bin…".into(),
            percent: Some(96.0),
            bytes_downloaded: None,
            total_bytes: None,
            mirror: Some(asset_url.clone()),
            version: Some(version.clone()),
            sha256: Some(digest.clone()),
        },
    );

    let installed = install_binary(&temp_path, &version)?;
    let _ = fs::remove_file(temp_path.with_extension("sha256"));
    let probe = cli_probe::probe_cli(Some(installed.to_string_lossy().as_ref()));
    let path = probe.path.or_else(|| Some(installed.display().to_string()));
    let installed_version = probe.version.or(Some(version_line));

    emit(
        &app,
        CliInstallProgress {
            phase: "done".into(),
            message: format!(
                "Installed {} (sha256 {})",
                installed_version.as_deref().unwrap_or(&version),
                &digest[..12]
            ),
            percent: Some(100.0),
            bytes_downloaded: None,
            total_bytes: None,
            mirror: Some(asset_url.clone()),
            version: installed_version.clone(),
            sha256: Some(digest.clone()),
        },
    );

    Ok(CliInstallResult {
        ok: true,
        path,
        version: installed_version,
        mirror_used: Some(asset_url),
        message: "Supercharge installed".into(),
        sha256: Some(digest),
        checksum_verified: Some(checksum_verified),
    })
}

/// Public installer command and release documentation for manual fallback.
pub fn install_commands() -> serde_json::Value {
    #[cfg(target_os = "windows")]
    {
        serde_json::json!({
            "primary": format!("irm {INSTALL_SCRIPT_BASE}/install.ps1 | iex"),
            "shell": "powershell",
            "docsUrl": RELEASE_REPO_URL,
            "mirrors": [RELEASE_DOWNLOAD_BASE, RELEASE_LATEST_BASE],
        })
    }
    #[cfg(not(target_os = "windows"))]
    {
        serde_json::json!({
            "primary": format!("curl -fsSL {INSTALL_SCRIPT_BASE}/install.sh | bash"),
            "shell": "bash",
            "docsUrl": RELEASE_REPO_URL,
            "mirrors": [RELEASE_DOWNLOAD_BASE, RELEASE_LATEST_BASE],
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allowlist_accepts_public_release_contract() {
        assert!(is_allowed_download_url(RELEASE_API_URL));
        assert!(is_allowed_download_url(
            "https://github.com/iotserver24/supercharge-releases/releases/latest/download/version"
        ));
        assert!(is_allowed_download_url(
            "https://github.com/iotserver24/supercharge-releases/releases/download/v1.0.5/supercharge-macos-aarch64"
        ));
        assert!(is_allowed_download_url(
            "https://github.com/iotserver24/supercharge-releases/releases/download/v1.0.5/SHA256SUMS"
        ));
        assert!(is_allowed_download_url(
            "https://release-assets.githubusercontent.com/github-production-release-asset/123/abc?sp=r"
        ));
        assert!(is_allowed_download_url(
            "https://objects.githubusercontent.com/github-production-release-asset/foo"
        ));
    }

    #[test]
    fn allowlist_rejects_http_foreign_repo_and_traversal() {
        assert!(!is_allowed_download_url(
            "http://github.com/iotserver24/supercharge-releases/releases/latest/download/version"
        ));
        assert!(!is_allowed_download_url(
            "https://evil.example/supercharge-linux-x86_64"
        ));
        assert!(!is_allowed_download_url(
            "https://api.github.com/repos/other/supercharge-releases/releases/latest"
        ));
        assert!(!is_allowed_download_url(
            "https://github.com/other/supercharge-releases/releases/download/v1.0.5/supercharge-linux-x86_64"
        ));
        assert!(!is_allowed_download_url(
            "https://github.com/iotserver24/supercharge-releases/releases/download/v1.0.5/../secret"
        ));
        assert!(!is_allowed_download_url(
            "https://user:pass@github.com/iotserver24/supercharge-releases/releases/latest/download/version"
        ));
        assert!(!is_allowed_download_url(""));
        assert!(!is_allowed_download_url("ftp://github.com/file"));
    }

    #[test]
    fn release_versions_are_normalized_and_validated() {
        assert_eq!(normalize_version("v1.2.3\n").as_deref(), Some("1.2.3"));
        assert_eq!(
            normalize_version("1.2.3-beta.1").as_deref(),
            Some("1.2.3-beta.1")
        );
        assert!(normalize_version("latest").is_none());
        assert!(normalize_version("1.2").is_none());
        assert!(normalize_version("1.2.3/asset").is_none());
        assert!(normalize_version("1.2.3-..").is_none());

        assert_eq!(
            parse_latest_release_version(r#"{"tag_name":"v1.0.32"}"#).unwrap(),
            "1.0.32"
        );
        assert!(parse_latest_release_version(r#"{"name":"missing"}"#).is_err());
    }

    #[test]
    fn assets_match_public_release_names() {
        assert_eq!(
            artifact_name_for("linux", "x86_64"),
            "supercharge-linux-x86_64"
        );
        assert_eq!(
            artifact_name_for("macos", "aarch64"),
            "supercharge-macos-aarch64"
        );
        assert_eq!(
            artifact_name_for("windows", "x86_64"),
            "supercharge-windows-x86_64.exe"
        );
    }

    #[test]
    fn parse_checksum_gnu_sha256sum_format() {
        let body = "\
# comment
aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa  supercharge-macos-aarch64
bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb *other-file
";
        let hash = parse_checksum_for_file(body, "supercharge-macos-aarch64").unwrap();
        assert_eq!(
            hash,
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        );
    }

    #[test]
    fn parse_checksum_bare_hex() {
        let hex = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
        assert_eq!(
            parse_checksum_for_file(hex, "anything").as_deref(),
            Some(hex)
        );
    }

    #[test]
    fn parse_checksum_ignores_garbage_and_wrong_name() {
        assert!(parse_checksum_for_file("not a hash", "f").is_none());
        assert!(parse_checksum_for_file("abcd short", "f").is_none());
        let body = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa  wrong-name\n";
        assert!(parse_checksum_for_file(body, "right-name").is_none());
    }

    #[test]
    fn require_checksum_policy_uses_supercharge_flags() {
        static LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
        let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());

        std::env::remove_var("SUPERCHARGE_CLI_ALLOW_UNVERIFIED");
        std::env::remove_var("SUPERCHARGE_CLI_REQUIRE_CHECKSUM");
        assert!(!require_published_checksum(false));
        assert!(!require_published_checksum(true));

        std::env::set_var("SUPERCHARGE_CLI_REQUIRE_CHECKSUM", "1");
        assert!(require_published_checksum(false));
        assert!(!require_published_checksum(true));
        std::env::set_var("SUPERCHARGE_CLI_ALLOW_UNVERIFIED", "yes");
        assert!(!require_published_checksum(false));

        std::env::remove_var("SUPERCHARGE_CLI_REQUIRE_CHECKSUM");
        std::env::remove_var("SUPERCHARGE_CLI_ALLOW_UNVERIFIED");
    }

    #[test]
    fn manual_install_command_uses_public_supercharge_script() {
        let commands = install_commands();
        let primary = commands["primary"].as_str().unwrap();
        assert!(primary.contains(
            "raw.githubusercontent.com/iotserver24/supercharge-releases/main/scripts/install."
        ));
        assert_eq!(commands["docsUrl"], RELEASE_REPO_URL);
    }

    #[test]
    fn sha256_file_matches_stable_digest() {
        let dir = std::env::temp_dir().join(format!("supercharge-cli-hash-{}", std::process::id()));
        let _ = fs::create_dir_all(&dir);
        let path = dir.join("blob.bin");
        fs::write(&path, b"supercharge-cli-test-bytes").unwrap();
        let got = sha256_file(&path).unwrap();
        assert_eq!(got.len(), 64);
        assert!(got.chars().all(|c| c.is_ascii_hexdigit()));
        assert_eq!(got, sha256_file(&path).unwrap());
        let _ = fs::remove_dir_all(&dir);
    }
}
