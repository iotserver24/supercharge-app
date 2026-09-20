use std::collections::HashMap;
use std::sync::{Arc, LazyLock, OnceLock};
use std::time::Duration;

use axum::extract::{DefaultBodyLimit, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use axum::{Json, Router};
use parking_lot::Mutex;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};
use tokio::net::TcpListener;
use tokio::sync::oneshot;

const SERVER_NAME: &str = "supercharge-browser";
const ACTIVITY_EVENT: &str = "side-browser://activity";
static ENDPOINT: OnceLock<String> = OnceLock::new();
static SESSIONS: LazyLock<Mutex<HashMap<String, Arc<BrowserSession>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

struct BrowserSession {
    id: String,
    operation: tokio::sync::Mutex<()>,
}

pub struct BrowserBinding {
    token: String,
    session_id: String,
}

impl BrowserBinding {
    pub fn entry(&self) -> Option<Value> {
        Some(json!({
            "name": SERVER_NAME, "type": "http", "url": ENDPOINT.get()?,
            "headers": [{"name": "Authorization", "value": format!("Bearer {}", self.token)}]
        }))
    }

    pub fn session_id(&self) -> &str {
        &self.session_id
    }
}

impl Drop for BrowserBinding {
    fn drop(&mut self) {
        SESSIONS.lock().remove(&self.token);
    }
}

pub fn bind(session_id: &str) -> Result<BrowserBinding, String> {
    uuid::Uuid::parse_str(session_id).map_err(|_| "invalid browser session id".to_string())?;
    if ENDPOINT.get().is_none() {
        return Err("browser bridge is not ready".into());
    }
    let token = crate::mirror::generate_token();
    SESSIONS.lock().insert(
        token.clone(),
        Arc::new(BrowserSession {
            id: session_id.into(),
            operation: tokio::sync::Mutex::new(()),
        }),
    );
    Ok(BrowserBinding {
        token,
        session_id: session_id.into(),
    })
}

pub struct BrowserBridgeHandle {
    shutdown: Option<oneshot::Sender<()>>,
}
impl Drop for BrowserBridgeHandle {
    fn drop(&mut self) {
        if let Some(tx) = self.shutdown.take() {
            let _ = tx.send(());
        }
    }
}

pub async fn start(app: AppHandle) -> Result<BrowserBridgeHandle, String> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| e.to_string())?;
    let address = listener.local_addr().map_err(|e| e.to_string())?;
    ENDPOINT
        .set(format!("http://{address}/mcp"))
        .map_err(|_| "browser bridge already started".to_string())?;
    let router = Router::new()
        .route("/mcp", post(handle_rpc))
        .layer(DefaultBodyLimit::max(256 * 1024))
        .with_state(app);
    let (tx, rx) = oneshot::channel();
    tokio::spawn(async move {
        if let Err(error) = axum::serve(listener, router)
            .with_graceful_shutdown(async {
                let _ = rx.await;
            })
            .await
        {
            tracing::error!(%error, "browser bridge stopped");
        }
    });
    tracing::info!(
        port = address.port(),
        "embedded browser MCP listening on loopback"
    );
    Ok(BrowserBridgeHandle { shutdown: Some(tx) })
}

fn authorized_session(headers: &HeaderMap) -> Option<Arc<BrowserSession>> {
    // Browser pages never receive the session capability, even on localhost.
    if headers.contains_key("origin") {
        return None;
    }
    let token = headers
        .get("authorization")?
        .to_str()
        .ok()?
        .strip_prefix("Bearer ")?;
    SESSIONS.lock().get(token).cloned()
}

async fn handle_rpc(
    State(app): State<AppHandle>,
    headers: HeaderMap,
    Json(request): Json<Value>,
) -> Response {
    let Some(session) = authorized_session(&headers) else {
        return (StatusCode::UNAUTHORIZED, "Unauthorized").into_response();
    };
    let Some(id) = request.get("id").cloned() else {
        return StatusCode::ACCEPTED.into_response();
    };
    let result = match request.get("method").and_then(Value::as_str).unwrap_or("") {
        "initialize" => Ok(json!({
            "protocolVersion": request.pointer("/params/protocolVersion").and_then(Value::as_str).unwrap_or("2025-03-26"),
            "capabilities": {"tools": {}},
            "serverInfo": {"name": SERVER_NAME, "version": "1.0.0"},
            "instructions": "Use these browser tools for browser tasks in Supercharge. They control the actual in-app browser the user can watch. Take a fresh browser_snapshot before selecting elements. Never claim a separate browser is visible here."
        })),
        "ping" => Ok(json!({})),
        "tools/list" => Ok(json!({"tools": tools()})),
        "tools/call" => {
            let name = request
                .pointer("/params/name")
                .and_then(Value::as_str)
                .unwrap_or("");
            let args = request
                .pointer("/params/arguments")
                .cloned()
                .unwrap_or(json!({}));
            let result = match session.operation.try_lock() {
                Ok(_guard) => execute(&app, &session.id, name, args).await,
                Err(_) => {
                    Err("This session's browser is busy; wait for the previous action.".into())
                }
            };
            let (text, failed) = match result {
                Ok(value) => (value.to_string(), false),
                Err(error) => (error, true),
            };
            Ok(json!({"content": [{"type": "text", "text": text}], "isError": failed}))
        }
        _ => Err(json!({"code": -32601, "message": "Method not found"})),
    };
    Json(match result {
        Ok(result) => json!({"jsonrpc":"2.0", "id":id, "result":result}),
        Err(error) => json!({"jsonrpc":"2.0", "id":id, "error":error}),
    })
    .into_response()
}

fn tools() -> Vec<Value> {
    let element = json!({"ref":{"type":"integer","minimum":1,"description":"Element reference from the latest browser_snapshot"}});
    vec![
        json!({"name":"browser_open","description":"Open a URL in this session's visible Supercharge browser. Use this instead of a separate headless browser.","inputSchema":{"type":"object","properties":{"url":{"type":"string"}},"required":["url"],"additionalProperties":false}}),
        json!({"name":"browser_snapshot","description":"Read the current in-app page and its interactive element references.","inputSchema":{"type":"object","properties":{},"additionalProperties":false}}),
        json!({"name":"browser_click","description":"Click an element from the most recent browser_snapshot in the visible browser.","inputSchema":{"type":"object","properties":element,"required":["ref"],"additionalProperties":false}}),
        json!({"name":"browser_type","description":"Replace the text of an input from browser_snapshot. Optionally submit its form.","inputSchema":{"type":"object","properties":{"ref":{"type":"integer","minimum":1},"text":{"type":"string"},"submit":{"type":"boolean"}},"required":["ref","text"],"additionalProperties":false}}),
        json!({"name":"browser_scroll","description":"Scroll the visible browser by pixels; positive y scrolls down.","inputSchema":{"type":"object","properties":{"y":{"type":"integer","minimum":-5000,"maximum":5000}},"required":["y"],"additionalProperties":false}}),
        json!({"name":"browser_back","description":"Go back in this session's browser history.","inputSchema":{"type":"object","properties":{},"additionalProperties":false}}),
    ]
}

fn tab_id(session_id: &str) -> String {
    format!("agent_{session_id}")
}
fn label(session_id: &str) -> String {
    format!("resource-browser-{}", tab_id(session_id))
}

fn activity(
    app: &AppHandle,
    session_id: &str,
    action: &str,
    phase: &str,
    target_url: Option<&str>,
) {
    let url = target_url.map(str::to_string).unwrap_or_else(|| {
        crate::side_browser_host::current_url(app, label(session_id)).unwrap_or_default()
    });
    let _ = app.emit(
        ACTIVITY_EVENT,
        json!({
            "sessionId": session_id, "tabId": tab_id(session_id), "url": url,
            "action": action, "phase": phase,
        }),
    );
}

fn checked_url(raw: Option<&Value>) -> Result<String, String> {
    let url = raw.and_then(Value::as_str).ok_or("url required")?;
    let parsed = tauri::Url::parse(url).map_err(|e| e.to_string())?;
    if !matches!(parsed.scheme(), "http" | "https")
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return Err("Use an http or https URL without embedded credentials.".into());
    }
    Ok(parsed.to_string())
}

async fn eval(app: &AppHandle, session_id: &str, script: String) -> Result<Value, String> {
    let app = app.clone();
    let label = label(session_id);
    let raw =
        tokio::task::spawn_blocking(move || crate::side_browser_host::eval(&app, label, script))
            .await
            .map_err(|e| e.to_string())??;
    let value: Value =
        serde_json::from_str(&raw).map_err(|e| format!("Browser returned invalid data: {e}"))?;
    let value = if let Some(text) = value.as_str() {
        serde_json::from_str(text).unwrap_or(value)
    } else {
        value
    };
    if let Some(error) = value.get("error").and_then(Value::as_str) {
        return Err(error.into());
    }
    Ok(value)
}

async fn execute(
    app: &AppHandle,
    session_id: &str,
    name: &str,
    args: Value,
) -> Result<Value, String> {
    if name == "browser_open" {
        let url = checked_url(args.get("url"))?;
        let app2 = app.clone();
        let label = label(session_id);
        tokio::task::spawn_blocking(move || {
            if app2.get_webview(&label).is_some() {
                crate::side_browser_host::navigate(&app2, label, url)
            } else {
                crate::side_browser_host::create(
                    &app2,
                    label.clone(),
                    url,
                    "main".into(),
                    0.0,
                    0.0,
                    1024.0,
                    720.0,
                )?;
                app2.get_webview(&label)
                    .ok_or("Browser was not created")?
                    .hide()
                    .map_err(|e| e.to_string())
            }
        })
        .await
        .map_err(|e| e.to_string())??;
    } else if app.get_webview(&label(session_id)).is_none() {
        return Err("Open a page with browser_open first.".into());
    }
    activity(
        app,
        session_id,
        name,
        "active",
        if name == "browser_open" {
            args.get("url").and_then(Value::as_str)
        } else {
            None
        },
    );
    let mut result = execute_action(app, session_id, name, &args).await;
    if name == "browser_open"
        && result
            .as_ref()
            .is_ok_and(|page| page.get("url").and_then(Value::as_str) == Some("about:blank"))
    {
        let error =
            "The browser could not load this URL. Check the address and try again.".to_string();
        crate::side_browser_host::emit_page_error(
            app,
            &label(session_id),
            args.get("url").and_then(Value::as_str).unwrap_or(""),
            error.clone(),
        );
        result = Err(error);
    }
    activity(
        app,
        session_id,
        name,
        if result.is_ok() { "idle" } else { "failed" },
        None,
    );
    result
}

async fn execute_action(
    app: &AppHandle,
    session_id: &str,
    name: &str,
    args: &Value,
) -> Result<Value, String> {
    match name {
        "browser_open" => {
            for _ in 0..40 {
                let state = eval(app, session_id, "document.readyState".into()).await?;
                if state == "interactive" || state == "complete" {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(250)).await;
            }
        }
        "browser_snapshot" => {}
        "browser_click" | "browser_type" => {
            let reference = args
                .get("ref")
                .and_then(Value::as_u64)
                .filter(|id| *id > 0 && *id <= 150)
                .ok_or("ref must come from browser_snapshot")?;
            let action = if name == "browser_click" {
                "element.click();".to_string()
            } else {
                let text = args
                    .get("text")
                    .and_then(Value::as_str)
                    .ok_or("text required")?;
                if text.len() > 100_000 {
                    return Err("text too large".into());
                }
                let text = serde_json::to_string(text).map_err(|e| e.to_string())?;
                let submit = args.get("submit").and_then(Value::as_bool).unwrap_or(false);
                format!(
                    r#"if (element.isContentEditable) {{ element.textContent = {text}; }} else {{
const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
if (!setter || !(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) throw new Error('Element is not a text input');
setter.call(element, {text}); }}
element.dispatchEvent(new Event('input', {{bubbles:true}})); element.dispatchEvent(new Event('change', {{bubbles:true}}));
if ({submit} && element.form) element.form.requestSubmit();"#
                )
            };
            let script = format!(
                r#"(function(){{try{{const element=document.querySelector('[data-supercharge-ref="{reference}"]');
if(!element) throw new Error('Element reference expired; take another browser_snapshot');
element.scrollIntoView({{block:'center'}}); element.focus(); {action} return {{ok:true}};
}}catch(error){{return {{error:String(error)}}}}}})()"#
            );
            eval(app, session_id, script).await?;
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
        "browser_scroll" => {
            let y = args
                .get("y")
                .and_then(Value::as_i64)
                .filter(|y| (-5000..=5000).contains(y))
                .ok_or("y must be between -5000 and 5000")?;
            eval(app, session_id, format!("window.scrollBy(0,{y}); true")).await?;
        }
        "browser_back" => {
            eval(app, session_id, "history.back(); true".into()).await?;
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
        _ => return Err("Unknown browser tool".into()),
    }
    eval(app, session_id, include_str!("browser_snapshot.js").into()).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn agent_urls_cannot_execute_scripts_or_open_local_files() {
        for value in [
            "javascript:alert(1)",
            "file:///etc/passwd",
            "data:text/html,hi",
            "https://user:pass@example.com",
        ] {
            assert!(checked_url(Some(&json!(value))).is_err());
        }
        assert!(checked_url(Some(&json!("http://127.0.0.1:5173"))).is_ok());
    }

    #[test]
    fn session_browser_labels_fit_the_frontend_label_limit() {
        let id = uuid::Uuid::new_v4().to_string();
        assert!(label(&id).len() <= 64);
        assert_ne!(label(&id), label(&uuid::Uuid::new_v4().to_string()));
    }

    #[test]
    fn auth_rejects_browser_origins_and_revoked_session_capabilities() {
        let token = uuid::Uuid::new_v4().to_string();
        SESSIONS.lock().insert(
            token.clone(),
            Arc::new(BrowserSession {
                id: "test".into(),
                operation: tokio::sync::Mutex::new(()),
            }),
        );
        let mut headers = HeaderMap::new();
        assert!(authorized_session(&headers).is_none());
        headers.insert("authorization", format!("Bearer {token}").parse().unwrap());
        assert_eq!(authorized_session(&headers).unwrap().id, "test");
        headers.insert("origin", "https://example.com".parse().unwrap());
        assert!(authorized_session(&headers).is_none());
        headers.remove("origin");
        drop(BrowserBinding {
            token,
            session_id: "test".into(),
        });
        assert!(authorized_session(&headers).is_none());
    }
}
