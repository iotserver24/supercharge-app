//! Isolated loopback HTTP server for plugin UI (GOAL D1 / D2).
//! Never share a port or token with `media_server`.

use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use axum::body::Body;
use axum::extract::{Path as AxumPath, State};
use axum::http::{header, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::Router;
use rand::RngCore;
use serde::Serialize;
use tokio::net::TcpListener;
use tokio::sync::oneshot;

/// Host origins allowed as iframe parents (not `'self'` — iframe is 127.0.0.1).
pub fn host_frame_ancestors() -> &'static [&'static str] {
    &[
        "http://localhost:1421",
        "https://localhost:1421",
        "tauri://localhost",
        "http://tauri.localhost",
        "https://tauri.localhost",
        "http://localhost",
        "https://localhost",
    ]
}

pub fn plugin_ui_csp() -> String {
    let ancestors = host_frame_ancestors().join(" ");
    format!(
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; \
img-src 'self' data: blob: http://127.0.0.1:*; connect-src 'self'; frame-ancestors {ancestors}"
    )
}

#[derive(Debug, Clone)]
pub struct PluginUiEntry {
    pub token: String,
    pub root: PathBuf,
}

#[derive(Debug, Default)]
pub struct PluginUiRegistry {
    plugins: HashMap<String, PluginUiEntry>,
}

impl PluginUiRegistry {
    pub fn upsert(&mut self, id: String, root: PathBuf) {
        if let Some(e) = self.plugins.get_mut(&id) {
            if e.root != root {
                e.root = root;
                e.token = random_token();
            }
            return;
        }
        self.plugins.insert(
            id,
            PluginUiEntry {
                token: random_token(),
                root,
            },
        );
    }

    pub fn retain(&mut self, ids: &[String]) {
        let keep: std::collections::HashSet<&str> = ids.iter().map(|s| s.as_str()).collect();
        self.plugins.retain(|k, _| keep.contains(k.as_str()));
    }

    pub fn get(&self, id: &str) -> Option<&PluginUiEntry> {
        self.plugins.get(id)
    }

    pub fn tokens(&self) -> HashMap<String, String> {
        self.plugins
            .iter()
            .map(|(k, v)| (k.clone(), v.token.clone()))
            .collect()
    }
}

#[derive(Clone)]
struct ServerState {
    registry: Arc<std::sync::RwLock<PluginUiRegistry>>,
}

pub struct PluginUiHandle {
    pub base_url: String,
    registry: Arc<std::sync::RwLock<PluginUiRegistry>>,
    shutdown: std::sync::Mutex<Option<oneshot::Sender<()>>>,
}

impl PluginUiHandle {
    pub fn upsert(&self, id: String, root: PathBuf) {
        self.registry.write().unwrap().upsert(id, root);
    }

    pub fn retain(&self, ids: &[String]) {
        self.registry.write().unwrap().retain(ids);
    }

    pub fn tokens(&self) -> HashMap<String, String> {
        self.registry.read().unwrap().tokens()
    }

    pub fn token_for(&self, id: &str) -> Option<String> {
        self.registry
            .read()
            .unwrap()
            .get(id)
            .map(|e| e.token.clone())
    }
}

impl Drop for PluginUiHandle {
    fn drop(&mut self) {
        if let Ok(mut g) = self.shutdown.lock() {
            if let Some(tx) = g.take() {
                let _ = tx.send(());
            }
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UiPathError {
    Escape,
    Forbidden,
    NotFound,
}

/// Resolve `{plugin.root}/ui/**` only. Canonical prefix check (symlink-safe).
pub fn resolve_plugin_ui_file(plugin_root: &Path, rel: &str) -> Result<PathBuf, UiPathError> {
    let rel = rel.trim().trim_start_matches('/');
    if rel.is_empty()
        || rel.contains('\0')
        || rel.contains('\\')
        || rel
            .split('/')
            .any(|s| s == ".." || s == "." || s.is_empty())
    {
        return Err(UiPathError::Escape);
    }
    if !rel.starts_with("ui/") && rel != "ui" {
        return Err(UiPathError::Forbidden);
    }
    let file_name = Path::new(rel)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("");
    if file_name == ".env" || file_name.starts_with(".env.") {
        return Err(UiPathError::Forbidden);
    }
    if rel.split('/').any(|s| s == "skills") {
        return Err(UiPathError::Forbidden);
    }

    let ui_root = plugin_root.join("ui");
    let ui_canon = ui_root.canonicalize().map_err(|_| UiPathError::NotFound)?;
    let joined = plugin_root.join(rel);
    let file_canon = joined.canonicalize().map_err(|_| UiPathError::NotFound)?;
    if !file_canon.starts_with(&ui_canon) {
        return Err(UiPathError::Escape);
    }
    if !file_canon.is_file() {
        return Err(UiPathError::NotFound);
    }
    Ok(file_canon)
}

fn random_token() -> String {
    let mut bytes = [0u8; 24];
    rand::thread_rng().fill_bytes(&mut bytes);
    use base64::Engine;
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

fn mime_for(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "svg" => "image/svg+xml",
        "json" => "application/json",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "woff2" => "font/woff2",
        _ => "application/octet-stream",
    }
}

fn with_csp(mut res: Response, is_html: bool) -> Response {
    if let Ok(v) = HeaderValue::from_str(&plugin_ui_csp()) {
        res.headers_mut().insert(header::CONTENT_SECURITY_POLICY, v);
    }
    res.headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    if is_html {
        res.headers_mut().insert(
            header::X_CONTENT_TYPE_OPTIONS,
            HeaderValue::from_static("nosniff"),
        );
    }
    res
}

fn status_text(code: StatusCode, msg: &'static str) -> Response {
    (code, msg).into_response()
}

async fn serve_plugin_ui(
    State(state): State<ServerState>,
    AxumPath((plugin, token, rel)): AxumPath<(String, String, String)>,
) -> Response {
    let entry = {
        let reg = state.registry.read().unwrap();
        match reg.get(&plugin) {
            Some(e) => e.clone(),
            None => return status_text(StatusCode::NOT_FOUND, "unknown plugin"),
        }
    };
    if token.is_empty() || token != entry.token {
        return status_text(StatusCode::UNAUTHORIZED, "invalid token");
    }
    let rel = if rel.is_empty() {
        "ui/index.html".to_string()
    } else if rel.starts_with("ui/") {
        rel
    } else {
        format!("ui/{rel}")
    };
    match resolve_plugin_ui_file(&entry.root, &rel) {
        Ok(path) => match std::fs::read(&path) {
            Ok(bytes) => {
                let mime = mime_for(&path);
                let mut res = Response::new(Body::from(bytes));
                *res.status_mut() = StatusCode::OK;
                if let Ok(v) = HeaderValue::from_str(mime) {
                    res.headers_mut().insert(header::CONTENT_TYPE, v);
                }
                with_csp(res, mime.starts_with("text/html"))
            }
            Err(_) => status_text(StatusCode::NOT_FOUND, "unreadable"),
        },
        Err(UiPathError::Escape) | Err(UiPathError::Forbidden) => {
            status_text(StatusCode::FORBIDDEN, "forbidden")
        }
        Err(UiPathError::NotFound) => status_text(StatusCode::NOT_FOUND, "not found"),
    }
}

const PLUGIN_HOST_CHROME_CSS: &[u8] = include_bytes!("../plugin_host_static/chrome.css");
const PLUGIN_HOST_CLIENT_JS: &[u8] = include_bytes!("../plugin_host_static/host-client.js");

async fn serve_chrome_css() -> Response {
    let mut res = Response::new(Body::from(PLUGIN_HOST_CHROME_CSS));
    res.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("text/css; charset=utf-8"),
    );
    with_csp(res, false)
}

async fn serve_host_client() -> Response {
    let mut res = Response::new(Body::from(PLUGIN_HOST_CLIENT_JS));
    res.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("text/javascript; charset=utf-8"),
    );
    with_csp(res, false)
}

pub async fn start() -> Result<PluginUiHandle, String> {
    let registry = Arc::new(std::sync::RwLock::new(PluginUiRegistry::default()));
    let state = ServerState {
        registry: registry.clone(),
    };
    let app = Router::new()
        .route("/plugin-host/chrome.css", get(serve_chrome_css))
        .route("/plugin-host/host-client.js", get(serve_host_client))
        .route("/plugin-ui/{plugin}/{token}/{*rel}", get(serve_plugin_ui))
        .with_state(state);

    let addr = SocketAddr::from(([127, 0, 0, 1], 0));
    let listener = TcpListener::bind(addr)
        .await
        .map_err(|e| format!("plugin-ui bind: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("plugin-ui local_addr: {e}"))?
        .port();
    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
    tokio::spawn(async move {
        let serve = axum::serve(listener, app).with_graceful_shutdown(async {
            let _ = shutdown_rx.await;
        });
        if let Err(e) = serve.await {
            tracing::error!(error = %e, "plugin-ui http server exited with error");
        }
    });
    let base_url = format!("http://127.0.0.1:{port}");
    tracing::info!(%base_url, "plugin-ui http listening (loopback, token-gated)");
    Ok(PluginUiHandle {
        base_url,
        registry,
        shutdown: std::sync::Mutex::new(Some(shutdown_tx)),
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginUiEndpointDto {
    pub base_url: String,
    pub tokens: HashMap<String, String>,
}

#[tauri::command]
pub async fn plugin_ui_endpoint(
    ui: tauri::State<'_, PluginUiHandle>,
) -> Result<PluginUiEndpointDto, String> {
    Ok(PluginUiEndpointDto {
        base_url: ui.base_url.clone(),
        tokens: ui.tokens(),
    })
}

/// Never log the full iframe URL (token is a secret).
pub fn redact_plugin_ui_url(url: &str) -> String {
    // Hide the token path segment: /plugin-ui/{id}/{token}/…
    if let Some(i) = url.find("/plugin-ui/") {
        let rest = &url[i + "/plugin-ui/".len()..];
        let mut parts = rest.splitn(3, '/');
        let id = parts.next().unwrap_or("");
        let _tok = parts.next();
        let tail = parts.next().unwrap_or("");
        return format!("{} /plugin-ui/{id}/***/{tail}", &url[..i]);
    }
    url.to_string()
}

#[cfg(test)]
mod plugin_ui_tests {
    use super::*;
    use std::fs;

    fn fixture_plugin(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("grok-pui-{}-{}", tag, std::process::id()));
        let ui = dir.join("ui");
        fs::create_dir_all(&ui).unwrap();
        fs::create_dir_all(dir.join("skills")).unwrap();
        fs::write(ui.join("index.html"), b"<html><body>ok</body></html>").unwrap();
        fs::write(dir.join("skills").join("SKILL.md"), b"# secret\n").unwrap();
        fs::write(dir.join(".env"), b"SECRET=1\n").unwrap();
        dir
    }

    #[test]
    fn plugin_ui_resolve_allows_ui_and_blocks_escape() {
        let root = fixture_plugin("esc");
        assert!(resolve_plugin_ui_file(&root, "ui/index.html").is_ok());
        assert_eq!(
            resolve_plugin_ui_file(&root, "ui/../skills/SKILL.md"),
            Err(UiPathError::Escape)
        );
        assert_eq!(
            resolve_plugin_ui_file(&root, "skills/SKILL.md"),
            Err(UiPathError::Forbidden)
        );
        assert_eq!(
            resolve_plugin_ui_file(&root, "../skills/SKILL.md"),
            Err(UiPathError::Escape)
        );
        assert_eq!(
            resolve_plugin_ui_file(&root, "ui/../../.env"),
            Err(UiPathError::Escape)
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn plugin_ui_resolve_blocks_symlink_escape() {
        let root = fixture_plugin("sym");
        let link = root.join("ui").join("leak.md");
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(root.join("skills").join("SKILL.md"), &link).unwrap();
            assert_eq!(
                resolve_plugin_ui_file(&root, "ui/leak.md"),
                Err(UiPathError::Escape)
            );
        }
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn plugin_ui_csp_lists_host_origins_not_self_alone() {
        let csp = plugin_ui_csp();
        assert!(csp.contains("frame-ancestors"));
        assert!(csp.contains("tauri://localhost"));
        assert!(csp.contains("http://localhost:1421"));
        // Must not be the design-doc typo `frame-ancestors 'self'` only.
        let after = csp.split("frame-ancestors").nth(1).unwrap_or("");
        assert!(after.contains("tauri://localhost"));
        assert_ne!(after.trim(), "'self'");
    }

    #[tokio::test]
    async fn plugin_ui_http_token_and_path_gates() {
        let a = fixture_plugin("http-a");
        let b = fixture_plugin("http-b");
        let handle = start().await.expect("start plugin-ui");
        handle.upsert("plug-a".into(), a.clone());
        handle.upsert("plug-b".into(), b.clone());
        let tok_a = handle.token_for("plug-a").unwrap();
        let tok_b = handle.token_for("plug-b").unwrap();
        assert_ne!(tok_a, tok_b);

        let client = reqwest::Client::new();
        let ok = client
            .get(format!(
                "{}/plugin-ui/plug-a/{tok_a}/index.html",
                handle.base_url
            ))
            .send()
            .await
            .unwrap();
        assert_eq!(ok.status(), 200);
        let csp = ok
            .headers()
            .get("content-security-policy")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");
        assert!(csp.contains("tauri://localhost"));
        assert_eq!(
            ok.headers()
                .get("cache-control")
                .and_then(|v| v.to_str().ok()),
            Some("no-store")
        );

        let cross = client
            .get(format!(
                "{}/plugin-ui/plug-a/{tok_b}/index.html",
                handle.base_url
            ))
            .send()
            .await
            .unwrap();
        assert_eq!(cross.status(), 401);

        // Keep the token segment intact; encode `..` inside the catch-all rel.
        let escape = client
            .get(format!(
                "{}/plugin-ui/plug-a/{tok_a}/ui/%2e%2e/skills/SKILL.md",
                handle.base_url
            ))
            .send()
            .await
            .unwrap();
        assert!(
            escape.status() == 403 || escape.status() == 404,
            "escape status {}",
            escape.status()
        );

        let skills = client
            .get(format!(
                "{}/plugin-ui/plug-a/{tok_a}/skills/SKILL.md",
                handle.base_url
            ))
            .send()
            .await
            .unwrap();
        // Router prefixes ui/ so this becomes ui/skills/… → forbidden or not found
        assert!(
            skills.status() == 403 || skills.status() == 404,
            "skills status {}",
            skills.status()
        );

        let chrome = client
            .get(format!("{}/plugin-host/chrome.css", handle.base_url))
            .send()
            .await
            .unwrap();
        assert_eq!(chrome.status(), 200);

        let _ = fs::remove_dir_all(&a);
        let _ = fs::remove_dir_all(&b);
    }

    #[tokio::test]
    async fn plugin_ui_serves_shipped_fixture_behind_its_token() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("app root")
            .join("fixtures/plugin-ui-hello");
        let handle = start().await.expect("start plugin-ui");
        handle.upsert("plugin-ui-hello".into(), root);
        let token = handle.token_for("plugin-ui-hello").expect("fixture token");
        let response = reqwest::Client::new()
            .get(format!(
                "{}/plugin-ui/plugin-ui-hello/{token}/index.html",
                handle.base_url
            ))
            .send()
            .await
            .expect("fetch fixture");
        assert_eq!(response.status(), StatusCode::OK);
        let body = response.text().await.expect("fixture body");
        assert!(body.contains("Plugin UI Hello"));
        assert!(body.contains("host-client.js"));
    }

    #[test]
    fn plugin_ui_redacts_token_from_logged_url() {
        let red =
            redact_plugin_ui_url("http://127.0.0.1:9/plugin-ui/hello/SECRETtoken/ui/index.html");
        assert!(!red.contains("SECRETtoken"));
        assert!(red.contains("hello"));
    }
}
