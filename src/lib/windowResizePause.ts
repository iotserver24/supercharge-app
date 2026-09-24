/** Pause expensive paint and chat remeasure while the window frame is changing. */

const CLASS_NAME = "is-window-resizing";
const END_EVENT = "supercharge-window-resize-end";
const QUIET_MS = 160;

let timer: ReturnType<typeof setTimeout> | null = null;
let installed = false;

export function isWindowResizing(): boolean {
  return (
    typeof document !== "undefined" &&
    document.documentElement.classList.contains(CLASS_NAME)
  );
}

export function markWindowResizing(): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.add(CLASS_NAME);
  if (timer != null) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    document.documentElement.classList.remove(CLASS_NAME);
    window.dispatchEvent(new Event(END_EVENT));
  }, QUIET_MS);
}

export function onWindowResizeEnd(listener: () => void): () => void {
  window.addEventListener(END_EVENT, listener);
  return () => window.removeEventListener(END_EVENT, listener);
}

/** `window.resize` covers WebView2 and WebKit size changes, including maximize. */
export function installWindowResizePause(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("resize", markWindowResizing, { passive: true });
}
