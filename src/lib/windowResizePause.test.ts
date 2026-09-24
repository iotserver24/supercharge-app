/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  installWindowResizePause,
  isWindowResizing,
  markWindowResizing,
} from "./windowResizePause";

describe("windowResizePause", () => {
  afterEach(() => {
    document.documentElement.classList.remove("is-window-resizing");
    vi.useRealTimers();
  });

  it("marks the document while resizing and clears after the quiet period", () => {
    vi.useFakeTimers();
    markWindowResizing();
    expect(isWindowResizing()).toBe(true);
    vi.advanceTimersByTime(159);
    expect(isWindowResizing()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(isWindowResizing()).toBe(false);
  });

  it("installs a single window resize listener", () => {
    const add = vi.spyOn(window, "addEventListener");
    installWindowResizePause();
    installWindowResizePause();
    const resizeAdds = add.mock.calls.filter((c) => c[0] === "resize");
    expect(resizeAdds).toHaveLength(1);
    add.mockRestore();
  });
});
