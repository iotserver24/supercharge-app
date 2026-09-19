//! Check for newer App releases on GitHub (manual fallback path).
//!
//! Prefer the Tauri updater plugin (`updater` module) when updater signing
//! configuration is present — that path downloads, verifies, installs, and
//! relaunches. This module remains for:
//! - Local / unsigned builds (plugin not registered)
//! - Linux `.deb` / `.rpm` installs (in-place update unsupported)
//! - Settings → About "open release page" fallback
//!
//! Strategy:
//! 1. GitHub REST `GET /repos/.../releases/latest` (rich payload: body, assets).
//! 2. On API failure (rate limit 403/429, network, etc.) fall back to following
//!    `https://github.com/.../releases/latest` redirect and parsing the tag
//!    from the final URL — no API quota, works on shared IPs.

use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;

const DEFAULT_RELEASES_API_URL: &str =
    "https://api.github.com/repos/iotserver24/supercharge-app/releases?per_page=100";
const DEFAULT_RELEASES_HTML_URL: &str = "https://github.com/iotserver24/supercharge-app/releases";
const DEFAULT_RELEASES_PAGE: &str = "https://github.com/iotserver24/supercharge-app/releases";
const SUPERCHARGE_RELEASES_API_ENV: &str = "SUPERCHARGE_APP_RELEASES_URL";
const SUPERCHARGE_RELEASES_HTML_ENV: &str = "SUPERCHARGE_APP_RELEASES_HTML_URL";
const LEGACY_RELEASES_API_ENV: &str = "GROK_APP_RELEASES_URL";
const LEGACY_RELEASES_HTML_ENV: &str = "GROK_APP_RELEASES_HTML_URL";
const SUPERCHARGE_REPOSITORY_URL: &str = "https://github.com/iotserver24/supercharge-app";

const CONNECT_TIMEOUT: Duration = Duration::from_secs(12);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(20);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdateCheck {
    pub current_version: String,
    pub latest_version: String,
    pub update_available: bool,
    pub release_name: Option<String>,
    pub html_url: String,
    pub published_at: Option<String>,
    pub body: Option<String>,
    /// Download asset names on the release (for UI hints; not auto-fetched).
    pub asset_names: Vec<String>,
    /// Best-effort direct installer URL for this platform (if assets list one).
    pub download_url: Option<String>,
    pub download_name: Option<String>,
    #[serde(default)]
    pub release_found: bool,
    pub checksum_url: Option<String>,
    pub published_sha256: Option<String>,
    #[serde(default)]
    pub install_supported: bool,
}

/// Strip optional `v` / `V` prefix and parse `major.minor.patch` (extra suffix ignored).
pub fn parse_semver(raw: &str) -> Option<(u64, u64, u64)> {
    let s = raw.trim().trim_start_matches(['v', 'V']);
    if s.is_empty() {
        return None;
    }
    // Drop pre-release / build metadata: 1.2.3-beta.1+meta → 1.2.3
    let core = s.split(['-', '+']).next().unwrap_or(s);
    let mut parts = core.split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next().unwrap_or("0").parse().ok()?;
    let patch = parts.next().unwrap_or("0").parse().ok()?;
    Some((major, minor, patch))
}

/// True when `remote` is a higher semver than `current`.
pub fn is_remote_newer(current: &str, remote: &str) -> bool {
    crate::update_versions::newer(current, remote)
}

fn current_os() -> &'static str {
    if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else {
        "linux"
    }
}

fn current_arch() -> &'static str {
    if cfg!(target_arch = "aarch64") {
        "aarch64"
    } else {
        "x86_64"
    }
}

fn is_skipped_release_asset(lower_name: &str) -> bool {
    lower_name.ends_with(".sig")
        || lower_name == "sha256sums"
        || lower_name.contains("sha256")
        || lower_name.ends_with(".json")
        || lower_name.contains(".app.tar.gz")
        || lower_name.contains("nsis.zip")
}

fn is_stable_installer_name(lower_name: &str) -> bool {
    lower_name.starts_with("supercharge_mac_")
        || lower_name.starts_with("supercharge_windows_")
        || lower_name.starts_with("supercharge_linux_")
}

fn desktop_version(tag: &str) -> Option<String> {
    let version = tag
        .trim()
        .strip_prefix("app-v")
        .or_else(|| tag.trim().strip_prefix("desktop-v"))
        .or_else(|| tag.trim().strip_prefix("supercharge-app-v"))
        .unwrap_or(tag.trim())
        .trim_start_matches(['v', 'V']);
    crate::update_versions::parse(version).map(|_| version.to_string())
}

fn desktop_asset(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    matches!(
        lower.as_str(),
        "supercharge-app-linux-x86_64" | "supercharge-app-linux-aarch64"
    ) || ((lower.starts_with("supercharge_") || lower.starts_with("supercharge-"))
        && [
            ".dmg",
            ".appimage",
            ".deb",
            ".rpm",
            "-setup.exe",
            ".msi",
            ".app.tar.gz",
        ]
        .iter()
        .any(|suffix| lower.ends_with(suffix)))
}

fn platform_matches(name: &str, os: &str, arch: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    let arm = lower.contains("aarch64") || lower.contains("arm64");
    if arm != (arch == "aarch64") {
        return false;
    }
    match os {
        "macos" => lower.ends_with(".dmg"),
        "windows" => lower.ends_with("-setup.exe") || lower.ends_with(".msi"),
        _ => {
            lower.ends_with(".appimage")
                || lower.ends_with(".deb")
                || lower.ends_with(".rpm")
                || lower == format!("supercharge-app-linux-{arch}")
        }
    }
}

fn prefer_tokens(os: &str, arch: &str) -> &'static [&'static str] {
    match (os, arch) {
        ("macos", "aarch64") => &["aarch64", "arm64", "apple-silicon", ".dmg", "macos"],
        ("macos", _) => &["x64", "x86_64", ".dmg", "macos"],
        ("windows", _) => &["-setup.exe", "setup.exe", ".msi", "x64", "windows", ".exe"],
        _ => &[".appimage", "appimage", ".deb", "linux"],
    }
}

/// Pick a user-facing installer (DMG / setup.exe / AppImage), not updater archives.
fn pick_platform_asset_for(
    os: &str,
    arch: &str,
    assets: Option<&Vec<Value>>,
) -> (Option<String>, Option<String>) {
    let Some(arr) = assets else {
        return (None, None);
    };
    let prefer = prefer_tokens(os, arch);
    let mut best: Option<(usize, String, String)> = None; // score, name, url
    for a in arr {
        let name = match a.get("name").and_then(|n| n.as_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };
        let url = match a.get("browser_download_url").and_then(|u| u.as_str()) {
            Some(u) if u.starts_with("https://") => u.to_string(),
            _ => continue,
        };
        let lower = name.to_ascii_lowercase();
        if is_skipped_release_asset(&lower)
            || !desktop_asset(&name)
            || !platform_matches(&name, os, arch)
        {
            continue;
        }
        let mut score = if lower == format!("supercharge-app-linux-{arch}") {
            500
        } else {
            1
        };
        for (i, token) in prefer.iter().enumerate() {
            if lower.contains(token) {
                score += 100 - i;
            }
        }
        // Prefer non-portable on Windows when both match.
        if os == "windows" && lower.contains("portable") {
            score = score.saturating_sub(30);
        }
        // Prefer Supercharge stable aliases over versioned twins.
        if is_stable_installer_name(&lower) {
            score = score.saturating_add(20);
        }
        if score == 0 {
            continue;
        }
        match &best {
            None => best = Some((score, name, url)),
            Some((s, _, _)) if score > *s => best = Some((score, name, url)),
            _ => {}
        }
    }
    match best {
        Some((_, n, u)) => (Some(u), Some(n)),
        None => (None, None),
    }
}

fn pick_platform_asset(assets: Option<&Vec<Value>>) -> (Option<String>, Option<String>) {
    pick_platform_asset_for(current_os(), current_arch(), assets)
}

/// Map GitHub `/releases/latest` JSON into [`AppUpdateCheck`].
pub fn parse_github_release(current_version: &str, v: &Value) -> Result<AppUpdateCheck, String> {
    let tag = v
        .get("tag_name")
        .and_then(|x| x.as_str())
        .ok_or_else(|| "release missing tag_name".to_string())?
        .trim();
    if tag.is_empty() {
        return Err("empty tag_name".into());
    }
    let html_url = v
        .get("html_url")
        .and_then(|x| x.as_str())
        .filter(|s| !s.is_empty())
        .unwrap_or(DEFAULT_RELEASES_PAGE)
        .to_string();
    let release_name = v
        .get("name")
        .and_then(|x| x.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());
    let published_at = v
        .get("published_at")
        .and_then(|x| x.as_str())
        .map(|s| s.to_string());
    let body = v
        .get("body")
        .and_then(|x| x.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let assets = v.get("assets").and_then(|a| a.as_array());
    let asset_names = assets
        .map(|arr| {
            arr.iter()
                .filter_map(|a| {
                    a.get("name")
                        .and_then(|n| n.as_str())
                        .map(|s| s.to_string())
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let (download_url, download_name) = pick_platform_asset(assets);

    let latest_version = desktop_version(tag).ok_or("invalid desktop release version")?;
    let release_found = assets.is_some_and(|items| {
        items.iter().any(|asset| {
            asset
                .get("name")
                .and_then(Value::as_str)
                .is_some_and(desktop_asset)
        })
    });
    if !release_found {
        return Err("release contains no desktop app package".into());
    }
    let update_available = is_remote_newer(current_version, &latest_version);
    let checksum_url = assets
        .and_then(|items| {
            items
                .iter()
                .find(|asset| asset.get("name").and_then(Value::as_str) == Some("SHA256SUMS"))
        })
        .and_then(|asset| asset.get("browser_download_url").and_then(Value::as_str))
        .map(str::to_string);
    let published_sha256 = assets
        .and_then(|items| {
            items
                .iter()
                .find(|asset| asset.get("name").and_then(Value::as_str) == download_name.as_deref())
        })
        .and_then(|asset| asset.get("digest").and_then(Value::as_str))
        .and_then(|digest| digest.strip_prefix("sha256:"))
        .filter(|digest| digest.len() == 64 && digest.bytes().all(|b| b.is_ascii_hexdigit()))
        .map(str::to_ascii_lowercase);
    let install_supported = download_name
        .as_deref()
        .is_some_and(crate::app_update_package::can_install_asset);

    Ok(AppUpdateCheck {
        current_version: current_version.to_string(),
        latest_version,
        update_available,
        release_name,
        html_url,
        published_at,
        body,
        asset_names,
        download_url,
        download_name,
        release_found,
        checksum_url,
        published_sha256,
        install_supported,
    })
}

/// Extract `v0.1.7` / `0.1.7` from a releases tag URL or path.
///
/// Accepts:
/// - `https://github.com/iotserver24/supercharge-releases/releases/tag/v0.1.7`
/// - `.../releases/tag/v0.1.7?foo=1`
/// - `/iotserver24/supercharge-releases/releases/tag/0.1.7`
pub fn extract_tag_from_release_url(url: &str) -> Option<String> {
    let base = url.split(['?', '#']).next().unwrap_or(url);
    // Find `/releases/tag/<tag>`
    let marker = "/releases/tag/";
    let idx = base.find(marker)?;
    let after = &base[idx + marker.len()..];
    let tag = after
        .split('/')
        .next()
        .unwrap_or(after)
        .trim()
        .trim_end_matches('/');
    if tag.is_empty() {
        return None;
    }
    // Basic sanity: must look like a desktop version tag.
    desktop_version(tag)?;
    Some(tag.to_string())
}

fn build_check_from_tag(current_version: &str, tag: &str, html_url: &str) -> AppUpdateCheck {
    let latest_version = desktop_version(tag).unwrap_or_else(|| current_version.to_string());
    let update_available = is_remote_newer(current_version, &latest_version);
    let release_name = format!("v{latest_version}");
    AppUpdateCheck {
        current_version: current_version.to_string(),
        latest_version,
        update_available,
        release_name: Some(release_name),
        html_url: html_url.to_string(),
        published_at: None,
        body: None,
        asset_names: vec![],
        download_url: None,
        download_name: None,
        release_found: true,
        checksum_url: None,
        published_sha256: None,
        install_supported: false,
    }
}

fn is_allowed_update_url(raw: &str) -> bool {
    let Ok(url) = url::Url::parse(raw) else {
        return false;
    };
    if !url.username().is_empty() || url.password().is_some() {
        return false;
    }
    url.scheme() == "https"
        || (url.scheme() == "http"
            && matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "[::1]")))
}

fn format_http_error(status: u16, body: &str) -> String {
    let lower = body.to_ascii_lowercase();
    if status == 403 || status == 429 {
        if lower.contains("rate limit") {
            return format!(
                "GitHub API rate limit (HTTP {status}). Unauthenticated limit is 60/hour per IP — try again later, or open the release page."
            );
        }
        if !body.trim().is_empty() {
            // Prefer short message field when JSON
            if let Ok(v) = serde_json::from_str::<Value>(body) {
                if let Some(msg) = v.get("message").and_then(|m| m.as_str()) {
                    return format!("GitHub releases returned HTTP {status}: {msg}");
                }
            }
            let snippet: String = body.chars().take(160).collect();
            return format!("GitHub releases returned HTTP {status}: {snippet}");
        }
    }
    format!("GitHub releases returned HTTP {status}")
}

fn release_url_from_env(primary: &str, legacy: &str, default: &str) -> String {
    std::env::var(primary)
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            std::env::var(legacy)
                .ok()
                .filter(|value| !value.trim().is_empty())
        })
        .unwrap_or_else(|| default.to_string())
}

fn supercharge_user_agent(current_version: &str) -> String {
    format!("Supercharge/{current_version} (desktop; check-update; +{SUPERCHARGE_REPOSITORY_URL})")
}

fn http_client(user_agent: &str) -> Result<reqwest::Client, String> {
    crate::proxy::apply_to_reqwest(reqwest::Client::builder())
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(REQUEST_TIMEOUT)
        .user_agent(user_agent)
        .build()
        .map_err(|e| e.to_string())
}

/// Primary path: GitHub REST releases/latest.
async fn fetch_via_api(client: &reqwest::Client, url: &str) -> Result<Value, String> {
    let mut req = client
        .get(url)
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28");

    // Optional auth raises rate limit (5000/h). Never required for public repos.
    if url::Url::parse(url)
        .ok()
        .is_some_and(|url| url.host_str() == Some("api.github.com"))
    {
        if let Ok(token) = std::env::var("GITHUB_TOKEN").or_else(|_| std::env::var("GH_TOKEN")) {
            let token = token.trim();
            if !token.is_empty() {
                req = req.header("Authorization", format!("Bearer {token}"));
            }
        }
    }

    let res = req
        .send()
        .await
        .map_err(|e| format!("update check network: {e}"))?;

    let status = res.status();
    if !status.is_success() {
        let body = res.text().await.unwrap_or_default();
        return Err(format_http_error(status.as_u16(), &body));
    }

    res.json()
        .await
        .map_err(|e| format!("update check parse: {e}"))
}

fn resolve_location(base_host_hint: &str, loc: &str) -> String {
    if loc.starts_with("http://") || loc.starts_with("https://") {
        loc.to_string()
    } else if loc.starts_with('/') {
        // Relative Location on github.com
        if base_host_hint.starts_with("https://") || base_host_hint.starts_with("http://") {
            // Prefer scheme+host from the request URL when available.
            if let Ok(u) = url::Url::parse(base_host_hint) {
                if let Some(host) = u.host_str() {
                    return format!("{}://{}{}", u.scheme(), host, loc);
                }
            }
        }
        format!("https://github.com{loc}")
    } else {
        loc.to_string()
    }
}

/// Fallback: follow HTML `/releases/latest` → `/releases/tag/vX.Y.Z` (no API quota).
async fn fetch_via_html_redirect(
    client: &reqwest::Client,
    latest_url: &str,
    current_version: &str,
) -> Result<AppUpdateCheck, String> {
    let ua = supercharge_user_agent(current_version);

    // 1) Prefer Location header without downloading the HTML body.
    let client_nr = crate::proxy::apply_to_reqwest(reqwest::Client::builder())
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(REQUEST_TIMEOUT)
        .redirect(reqwest::redirect::Policy::none())
        .user_agent(&ua)
        .build()
        .map_err(|e| e.to_string())?;

    let res = client_nr
        .get(latest_url)
        .header("Accept", "text/html")
        .send()
        .await
        .map_err(|e| format!("update fallback network: {e}"))?;

    let status = res.status().as_u16();
    if let Some(loc) = res.headers().get(reqwest::header::LOCATION) {
        if let Ok(loc_s) = loc.to_str() {
            let absolute = resolve_location(latest_url, loc_s);
            if let Some(tag) = extract_tag_from_release_url(&absolute) {
                return Ok(build_check_from_tag(current_version, &tag, &absolute));
            }
        }
    }

    // 2) 200 body scan (proxies that rewrite redirects).
    if status == 200 {
        let body = res.text().await.unwrap_or_default();
        if let Some(idx) = body.find("/releases/tag/") {
            let slice: String = body[idx..].chars().take(80).collect();
            if let Some(tag) = extract_tag_from_release_url(&format!("https://github.com{slice}")) {
                let tag_path = if tag.starts_with('v') || tag.starts_with('V') {
                    tag.clone()
                } else {
                    format!("v{tag}")
                };
                let html = format!("{DEFAULT_RELEASES_PAGE}/tag/{tag_path}");
                return Ok(build_check_from_tag(current_version, &tag, &html));
            }
        }
    }

    // 3) Follow redirects; parse final URL.
    let res2 = client
        .get(latest_url)
        .header("Accept", "text/html")
        .send()
        .await
        .map_err(|e| format!("update fallback follow: {e}"))?;
    let final_url = res2.url().as_str().to_string();
    if let Some(tag) = extract_tag_from_release_url(&final_url) {
        return Ok(build_check_from_tag(current_version, &tag, &final_url));
    }

    Err(format!(
        "update fallback: could not parse latest tag (HTTP {status}, url={final_url})"
    ))
}

/// Query GitHub for the latest release and compare to this build.
pub fn select_desktop_release(current: &str, value: &Value) -> Result<AppUpdateCheck, String> {
    if !value.is_array() {
        return parse_github_release(current, value);
    }
    let mut best: Option<AppUpdateCheck> = None;
    for release in value.as_array().unwrap() {
        if release.get("draft").and_then(Value::as_bool) == Some(true)
            || release.get("prerelease").and_then(Value::as_bool) == Some(true)
        {
            continue;
        }
        let Ok(candidate) = parse_github_release(current, release) else {
            continue;
        };
        if best
            .as_ref()
            .is_none_or(|old| is_remote_newer(&old.latest_version, &candidate.latest_version))
        {
            best = Some(candidate);
        }
    }
    Ok(best.unwrap_or_else(|| AppUpdateCheck {
        current_version: current.into(),
        latest_version: current.into(),
        update_available: false,
        release_name: None,
        html_url: DEFAULT_RELEASES_PAGE.into(),
        published_at: None,
        body: None,
        asset_names: vec![],
        download_url: None,
        download_name: None,
        release_found: false,
        checksum_url: None,
        published_sha256: None,
        install_supported: false,
    }))
}

pub async fn check_app_update() -> Result<AppUpdateCheck, String> {
    let current = env!("CARGO_PKG_VERSION");
    let api_url = release_url_from_env(
        SUPERCHARGE_RELEASES_API_ENV,
        LEGACY_RELEASES_API_ENV,
        DEFAULT_RELEASES_API_URL,
    );
    let html_url = release_url_from_env(
        SUPERCHARGE_RELEASES_HTML_ENV,
        LEGACY_RELEASES_HTML_ENV,
        DEFAULT_RELEASES_HTML_URL,
    );

    if !is_allowed_update_url(&api_url) {
        return Err("update check URL must be https (or localhost for tests)".into());
    }
    if !is_allowed_update_url(&html_url) {
        return Err("update fallback URL must be https (or localhost for tests)".into());
    }

    let ua = supercharge_user_agent(current);
    let client = http_client(&ua)?;

    match fetch_via_api(&client, &api_url).await {
        Ok(v) => select_desktop_release(current, &v),
        Err(api_err) => {
            if html_url == DEFAULT_RELEASES_HTML_URL {
                return Err(api_err);
            }
            tracing::warn!(error = %api_err, "app update API failed; trying configured HTML fallback");
            match fetch_via_html_redirect(&client, &html_url, current).await {
                Ok(check) => Ok(check),
                Err(fallback_err) => Err(format!("{api_err} | {fallback_err}")),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn ignores_cli_releases_and_uses_the_highest_stable_desktop_version() {
        let releases = json!([
            {"tag_name":"v1.3.17", "assets":[gh_asset("supercharge-linux-x86_64"),gh_asset("supercharge-superagent-server-linux-x86_64")]},
            {"tag_name":"app-v0.2.37", "assets":[gh_asset("supercharge-app-linux-x86_64")]},
            {"tag_name":"app-v0.2.40", "draft":true, "assets":[gh_asset("supercharge-app-linux-x86_64")]},
            {"tag_name":"app-v0.2.39-beta.1", "prerelease":true, "assets":[gh_asset("supercharge-app-linux-x86_64")]},
            {"tag_name":"app-v0.2.36", "assets":[gh_asset("supercharge-app-linux-x86_64")]}
        ]);
        let found = select_desktop_release("0.2.36", &releases).unwrap();
        assert_eq!(found.latest_version, "0.2.37");
        assert!(found.update_available && found.release_found);
        let none = select_desktop_release("0.2.36", &json!([releases[0].clone()])).unwrap();
        assert!(!none.update_available && !none.release_found);
        assert_eq!(none.latest_version, "0.2.36");
    }

    #[test]
    fn rejects_cross_platform_cli_and_checksum_assets() {
        let assets = vec![
            gh_asset("supercharge-linux-x86_64"),
            gh_asset("Supercharge_0.2.37_x64-setup.exe"),
            gh_asset("Supercharge_0.2.37_aarch64.AppImage"),
            gh_asset("supercharge-app-linux-x86_64.sha256"),
        ];
        assert_eq!(
            pick_platform_asset_for("linux", "x86_64", Some(&assets)),
            (None, None)
        );
        assert!(!desktop_asset("supercharge-app-checksums.json"));
    }

    #[test]
    fn update_metadata_urls_require_real_loopback_for_http() {
        assert!(is_allowed_update_url("http://127.0.0.1:3210/releases"));
        assert!(!is_allowed_update_url(
            "http://127.0.0.1.evil.test/releases"
        ));
        assert!(!is_allowed_update_url(
            "http://localhost.evil.test/releases"
        ));
        assert!(!is_allowed_update_url(
            "https://user:pass@example.com/releases"
        ));
    }

    #[test]
    fn desktop_release_assets_are_matched_per_platform() {
        let assets = vec![
            gh_asset("Grok_0.2.36_x64-portable.zip"),
            gh_asset("Supercharge-0.2.36-1.x86_64.rpm"),
            gh_asset("Supercharge_0.2.36_aarch64.dmg"),
            gh_asset("Supercharge_0.2.36_amd64.AppImage"),
            gh_asset("Supercharge_0.2.36_amd64.deb"),
            gh_asset("Supercharge_0.2.36_x64-setup.exe"),
            gh_asset("Supercharge_0.2.36_x64.dmg"),
            gh_asset("Supercharge_aarch64.app.tar.gz"),
            gh_asset("SHA256SUMS"),
        ];
        let (linux_url, linux_name) = pick_platform_asset_for("linux", "x86_64", Some(&assets));
        assert_eq!(
            linux_name.as_deref(),
            Some("Supercharge_0.2.36_amd64.AppImage")
        );
        assert!(linux_url
            .unwrap()
            .ends_with("/Supercharge_0.2.36_amd64.AppImage"));
        let (win_url, win_name) = pick_platform_asset_for("windows", "x86_64", Some(&assets));
        assert_eq!(
            win_name.as_deref(),
            Some("Supercharge_0.2.36_x64-setup.exe")
        );
        let (mac_arm_url, mac_arm_name) =
            pick_platform_asset_for("macos", "aarch64", Some(&assets));
        assert_eq!(
            mac_arm_name.as_deref(),
            Some("Supercharge_0.2.36_aarch64.dmg")
        );
        let (mac_x64_url, mac_x64_name) = pick_platform_asset_for("macos", "x86_64", Some(&assets));
        assert_eq!(mac_x64_name.as_deref(), Some("Supercharge_0.2.36_x64.dmg"));
        assert!(mac_x64_url
            .unwrap()
            .ends_with("/Supercharge_0.2.36_x64.dmg"));
    }

    #[test]
    fn supercharge_release_env_precedes_legacy_env() {
        let _guard = crate::paths::APP_HOME_ENV_LOCK
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let primary = "SUPERCHARGE_APP_RELEASES_TEST_PRIMARY";
        let legacy = "SUPERCHARGE_APP_RELEASES_TEST_LEGACY";
        unsafe {
            std::env::set_var(primary, "https://primary.example/releases");
            std::env::set_var(legacy, "https://legacy.example/releases");
        }
        assert_eq!(
            release_url_from_env(primary, legacy, "https://default.example/releases"),
            "https://primary.example/releases"
        );
        unsafe {
            std::env::remove_var(primary);
        }
        assert_eq!(
            release_url_from_env(primary, legacy, "https://default.example/releases"),
            "https://legacy.example/releases"
        );
        unsafe {
            std::env::remove_var(legacy);
        }
    }

    #[test]
    fn update_user_agent_is_supercharge_branded() {
        let user_agent = supercharge_user_agent("1.2.3");
        assert!(user_agent.starts_with("Supercharge/1.2.3"));
        assert!(user_agent.contains("iotserver24/supercharge-app"));
        assert!(!user_agent.contains("GrokApp"));
        assert!(!user_agent.contains("grok-app"));
    }

    #[test]
    fn parse_semver_strips_v_and_prerelease() {
        assert_eq!(parse_semver("v0.1.5"), Some((0, 1, 5)));
        assert_eq!(parse_semver("0.1.5"), Some((0, 1, 5)));
        assert_eq!(parse_semver("1.2.3-beta.1"), Some((1, 2, 3)));
        assert_eq!(parse_semver("2.0"), Some((2, 0, 0)));
        assert!(parse_semver("").is_none());
        assert!(parse_semver("nope").is_none());
    }

    #[test]
    fn is_remote_newer_orders() {
        assert!(!is_remote_newer("0.1.5", "v0.1.5"));
        assert!(!is_remote_newer("0.1.5", "0.1.4"));
        assert!(is_remote_newer("0.1.5", "v0.1.6"));
        assert!(is_remote_newer("0.1.5", "0.2.0"));
        assert!(is_remote_newer("0.9.9", "1.0.0"));
        assert!(!is_remote_newer("bad", "0.1.0"));
    }

    #[test]
    fn parse_github_release_update_and_same() {
        let sample = json!({
            "tag_name": "v0.2.0",
            "name": "Supercharge v0.2.0",
            "html_url": "https://github.com/iotserver24/supercharge-releases/releases/tag/v0.2.0",
            "published_at": "2026-07-24T00:00:00Z",
            "body": "### Added\n- hello",
            "assets": [
                {"name": "Supercharge_0.2.0_aarch64.dmg"},
                {"name": "Supercharge_0.2.0_x64-setup.exe"}
            ]
        });
        let up = parse_github_release("0.1.5", &sample).unwrap();
        assert!(up.update_available);
        assert_eq!(up.latest_version, "0.2.0");
        assert_eq!(up.current_version, "0.1.5");
        assert_eq!(up.asset_names.len(), 2);
        assert!(up.body.as_deref().unwrap().contains("hello"));
        // Platform pick is compile-time; at least one of name/url fields is set or both None.
        assert_eq!(up.download_url.is_some(), up.download_name.is_some());

        let same = parse_github_release("0.2.0", &sample).unwrap();
        assert!(!same.update_available);
    }

    fn gh_asset(name: &str) -> Value {
        json!({
            "name": name,
            "browser_download_url": format!(
                "https://github.com/iotserver24/supercharge-releases/releases/download/v0.2.20/{name}"
            )
        })
    }

    #[test]
    fn pick_macos_intel_prefers_stable_dmg_over_arm_and_updater() {
        let assets = vec![
            gh_asset("Supercharge_0.2.20_x64.app.tar.gz"),
            gh_asset("Supercharge_0.2.20_aarch64.dmg"),
            gh_asset("Supercharge_mac_aarch64.dmg"),
            gh_asset("Supercharge_0.2.20_x64.dmg"),
            gh_asset("Supercharge_mac_x64.dmg"),
        ];
        let (url, name) = pick_platform_asset_for("macos", "x86_64", Some(&assets));
        assert_eq!(name.as_deref(), Some("Supercharge_mac_x64.dmg"));
        assert!(url.unwrap().ends_with("/Supercharge_mac_x64.dmg"));
    }

    #[test]
    fn pick_macos_arm_prefers_stable_dmg() {
        let assets = vec![
            gh_asset("Supercharge_0.2.20_aarch64.app.tar.gz"),
            gh_asset("Supercharge_0.2.20_x64.dmg"),
            gh_asset("Supercharge_mac_x64.dmg"),
            gh_asset("Supercharge_0.2.20_aarch64.dmg"),
            gh_asset("Supercharge_mac_aarch64.dmg"),
        ];
        let (url, name) = pick_platform_asset_for("macos", "aarch64", Some(&assets));
        assert_eq!(name.as_deref(), Some("Supercharge_mac_aarch64.dmg"));
        assert!(url.unwrap().ends_with("/Supercharge_mac_aarch64.dmg"));
    }

    #[test]
    fn pick_windows_prefers_stable_setup_over_portable() {
        let assets = vec![
            gh_asset("Supercharge_0.2.20_x64-portable.zip"),
            gh_asset("Supercharge_windows_x64-portable.zip"),
            gh_asset("Supercharge_0.2.20_x64-setup.exe"),
            gh_asset("Supercharge_windows_x64-setup.exe"),
            gh_asset("latest.json"),
            gh_asset("SHA256SUMS"),
        ];
        let (url, name) = pick_platform_asset_for("windows", "x86_64", Some(&assets));
        assert_eq!(name.as_deref(), Some("Supercharge_windows_x64-setup.exe"));
        assert!(url.unwrap().ends_with("/Supercharge_windows_x64-setup.exe"));
    }

    #[test]
    fn extract_tag_from_release_url_ok() {
        assert_eq!(
            extract_tag_from_release_url(
                "https://github.com/iotserver24/supercharge-releases/releases/tag/v0.1.7"
            )
            .as_deref(),
            Some("v0.1.7")
        );
        assert_eq!(
            extract_tag_from_release_url(
                "https://github.com/iotserver24/supercharge-releases/releases/tag/0.2.0?foo=1#sec"
            )
            .as_deref(),
            Some("0.2.0")
        );
        assert_eq!(
            extract_tag_from_release_url("/iotserver24/supercharge-releases/releases/tag/v1.0.0")
                .as_deref(),
            Some("v1.0.0")
        );
        assert!(extract_tag_from_release_url(
            "https://github.com/iotserver24/supercharge-releases/releases"
        )
        .is_none());
        assert!(extract_tag_from_release_url("https://example.com/nope").is_none());
    }

    #[test]
    fn format_http_error_rate_limit() {
        let msg = format_http_error(
            403,
            r#"{"message":"API rate limit exceeded for 1.2.3.4.","documentation_url":"https://docs.github.com"}"#,
        );
        assert!(msg.contains("rate limit"), "{msg}");
        assert!(msg.contains("403"), "{msg}");
    }

    #[test]
    fn build_check_from_tag_compares() {
        let c = build_check_from_tag(
            "0.1.5",
            "v0.1.7",
            "https://github.com/iotserver24/supercharge-releases/releases/tag/v0.1.7",
        );
        assert!(c.update_available);
        assert_eq!(c.latest_version, "0.1.7");
        assert!(c.asset_names.is_empty());
    }
}
