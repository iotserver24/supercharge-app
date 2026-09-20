use std::cell::RefCell;
use std::collections::HashMap;
use std::sync::mpsc;
use std::time::Duration;

use gtk::prelude::*;
use tauri::{Manager, Webview};

thread_local! {
    static OVERLAYS: RefCell<HashMap<String, gtk::Overlay>> = RefCell::new(HashMap::new());
}

pub fn prepare_process() {
    let current = std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER");
    if let Some(value) = renderer_override(current) {
        // DMA-BUF driver incompatibilities also affect X11 and bundled AppImage WebKit.
        // Apply before WebKit starts, without changing its sandbox or an explicit override.
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", value);
    }
}

fn renderer_override(current: Option<std::ffi::OsString>) -> Option<&'static str> {
    current.is_none().then_some("1")
}

pub fn log_renderer_choice() {
    tracing::info!(
        value = ?std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER"),
        "Linux WebKit DMA-BUF renderer setting"
    );
}

pub fn attach(webview: &Webview, x: f64, y: f64, width: f64, height: f64) -> Result<(), String> {
    let window_label = webview.window().label().to_string();
    let (tx, rx) = mpsc::sync_channel(1);
    webview
        .with_webview(move |platform| {
            let child = platform.inner();
            let result = (|| {
                let parent = child
                    .parent()
                    .and_then(|widget| widget.downcast::<gtk::Box>().ok())
                    .ok_or_else(|| "side browser has no GTK box parent".to_string())?;
                child.hide();
                parent.remove(&child);
                let overlay = OVERLAYS.with(|overlays| {
                    let mut overlays = overlays.borrow_mut();
                    if let Some(overlay) = overlays.get(&window_label) {
                        return Ok(overlay.clone());
                    }
                    let main = parent
                        .children()
                        .into_iter()
                        .find(|widget| widget.type_().name() == "WebKitWebView")
                        .ok_or_else(|| "main GTK webview not found".to_string())?;
                    let overlay = gtk::Overlay::new();
                    overlay.set_hexpand(true);
                    overlay.set_vexpand(true);
                    parent.remove(&main);
                    overlay.add(&main);
                    parent.pack_start(&overlay, true, true, 0);
                    main.show();
                    overlay.show();
                    overlays.insert(window_label, overlay.clone());
                    Ok::<_, String>(overlay)
                })?;
                // Tauri packs Linux child views into a vertical GtkBox; Wry ignores
                // their bounds there. Overlay allocation must own this surface.
                child.set_halign(gtk::Align::Start);
                child.set_valign(gtk::Align::Start);
                child.set_hexpand(false);
                child.set_vexpand(false);
                overlay.add_overlay(&child);
                apply_bounds(&child, x, y, width, height);
                child.show();
                Ok(())
            })();
            let _ = tx.send(result);
        })
        .map_err(|e| format!("side browser GTK attach: {e}"))?;
    rx.recv_timeout(Duration::from_secs(5))
        .map_err(|_| "side browser GTK attach timed out".to_string())?
}

fn apply_bounds(widget: &impl IsA<gtk::Widget>, x: f64, y: f64, width: f64, height: f64) {
    widget.set_margin_start(x.round().max(0.0) as i32);
    widget.set_margin_top(y.round().max(0.0) as i32);
    widget.set_size_request(
        width.round().max(1.0) as i32,
        height.round().max(1.0) as i32,
    );
    widget.queue_resize();
}

pub fn set_bounds(
    webview: &Webview,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    webview
        .with_webview(move |platform| apply_bounds(&platform.inner(), x, y, width, height))
        .map_err(|e| format!("side browser GTK bounds: {e}"))
}

pub fn observe_load_errors(webview: &Webview) -> Result<(), String> {
    use webkit2gtk::WebViewExt;
    let app = webview.app_handle().clone();
    let label = webview.label().to_string();
    webview
        .with_webview(move |platform| {
            let view = platform.inner();
            let failed_app = app.clone();
            let failed_label = label.clone();
            view.connect_load_failed(move |_, _, uri, error| {
                if error.matches(webkit2gtk::NetworkError::Cancelled) {
                    return false;
                }
                crate::side_browser_host::emit_page_error(
                    &failed_app,
                    &failed_label,
                    uri,
                    error.to_string(),
                );
                // Keep the host error visible instead of WebKit's about:blank fallback.
                true
            });
            view.connect_web_process_terminated(move |view, reason| {
                crate::side_browser_host::emit_page_error(
                    &app,
                    &label,
                    view.uri().as_deref().unwrap_or(""),
                    format!("Browser renderer stopped: {reason:?}"),
                );
            });
        })
        .map_err(|e| format!("side browser load observer: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renderer_safeguard_defaults_on_all_linux_display_backends() {
        // Display backend and package format deliberately do not participate:
        // AppImage/X11 hit the same WebKit DMA-BUF blank-screen class as Wayland.
        assert_eq!(renderer_override(None), Some("1"));
    }

    #[test]
    fn explicit_renderer_override_is_preserved() {
        for value in ["0", "1", ""] {
            assert_eq!(renderer_override(Some(value.into())), None);
        }
    }
}
