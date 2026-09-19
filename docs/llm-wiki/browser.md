# Embedded browser and visible agent control

The Browser tab is a native Tauri child WebView. It is not an iframe, a remote screenshot, or the system browser.

## Linux placement

Tauri 2.11 / Wry 0.55 packs Linux child WebViews into the window's vertical `GtkBox`. Wry's bounds setter does not position a child in that container. The result is a browser below the app while its intended side-pane host is empty.

`linux_browser.rs` reparents browser children into a `GtkOverlay` over the main WebView. The main WebView retains the full client area. `side_browser_set_bounds` positions each browser overlay using the frontend host rectangle. Other platforms use Tauri's native bounds API. Do not restore direct frontend `setPosition` / `setSize` calls for these views.

Before Tauri starts on Wayland, the app defaults `WEBKIT_DISABLE_DMABUF_RENDERER=1`. An explicit environment override is respected; X11 is not changed. This avoids a reproduced WebKit DMA-BUF Wayland protocol failure without disabling the browser sandbox.

Native surfaces are hidden under app overlays and when their pane is inactive. Navigation does not destroy the browser. Page-load errors show a retry action. Wry drops evaluation callbacks queued before a first document commit, so host evaluation waits for page readiness off the UI thread.

## Agent browser bridge

`browser_bridge.rs` exposes a process-local, loopback-only MCP endpoint. Each local App session gets an independent random bearer capability, injected through ACP `mcpServers`, not saved into the user's CLI configuration or passed to web pages. Revoking/stopping the ACP client removes that capability. Requests carrying a browser Origin header are rejected.

Tools are `browser_open`, `browser_snapshot`, `browser_click`, `browser_type`, `browser_scroll`, and `browser_back`. They operate on `resource-browser-agent_<app-session-uuid>`. An active tool emits `side-browser://activity`; only the currently viewed session opens/focuses its exact matching Browser tab. A user's separate tab on the same URL must not be substituted.

Agent-driven page navigation and history are authoritative. Reattaching the UI to an agent browser must not navigate it back to an older observed URL. Native page events update the address bar.

The bridge is injected only for native local sessions. SSH, WSL, API-mode remote agents, and auxiliary side-channel agents do not receive it. Third-party browser tools that run external browsers do not become visible inside this pane. General web search is not a browser-control event.

## Validation

- `EmbeddedBrowser.test.tsx`: host bounds, StrictMode overlay recovery, page failures/retry, navigation callbacks.
- `agentBrowserActivity.test.ts`: exact session/tab routing, no background focus stealing, URL checks, repeated navigation.
- Rust `browser_bridge`, `linux_browser`, and `side_browser_host` tests.
- Native smoke test: cold open, visible click/type/submit, navigation/back, resize, pane hide/show, Settings cover, failure and reload.
