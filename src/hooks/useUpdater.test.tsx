/** @vitest-environment jsdom */
import { StrictMode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUpdater } from "./useUpdater";

const host = vi.hoisted(() => ({
  invoke: vi.fn(), check: vi.fn(), relaunch: vi.fn(), appCheck: vi.fn(), cliCheck: vi.fn(), cliInstall: vi.fn(), probeCli: vi.fn(),
  listeners: new Map<string, (value: unknown) => void>(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: host.invoke }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: async () => "0.2.36" }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: host.check }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: host.relaunch }));
vi.mock("@/lib/api", () => ({
  isDesktopHost: () => true, appCheckUpdate: host.appCheck, cliUpdateCheck: host.cliCheck, cliUpdateInstall: host.cliInstall,
  probeCli: host.probeCli,
  listen: async (event: string, listener: (value: unknown) => void) => { host.listeners.set(event, listener); return () => host.listeners.delete(event); },
}));
vi.mock("@/lib/updateSim", () => ({
  UPDATE_SIM_CHANGE_EVENT: "update-sim", UPDATE_SIM_VERSION: "99.0.0-sim", readUpdateSimMode: () => "off",
  installDeveloperModeSimCleanup: () => {}, installUpdateSimConsoleApi: () => {}, sleepMs: async () => {},
}));

beforeEach(() => {
  vi.resetAllMocks();
  host.listeners.clear();
  host.invoke.mockImplementation(async (command: string) => {
    if (command === "updater_status") return { channel: "github_manual", pluginEnabled: false, platformSupported: false, endpoint: "" };
    if (command === "app_update_staged") return null;
    return undefined;
  });
  host.appCheck.mockResolvedValue({ currentVersion: "0.2.36", latestVersion: "0.2.37", releaseFound: true, updateAvailable: true, installSupported: true });
  host.cliCheck.mockResolvedValue({ currentVersion: "1.3.16", latestVersion: "1.3.17", updateAvailable: true });
  host.cliInstall.mockResolvedValue({ ok: true, version: "supercharge 1.3.17 (abc)" });
});
afterEach(cleanup);

describe("useUpdater integration", () => {
  it("shares a StrictMode-safe check and waits for restart after updating both", async () => {
    const { result } = renderHook(() => useUpdater(), { wrapper: StrictMode });
    await act(async () => { await Promise.all([result.current.checkForUpdate(), result.current.checkForUpdate()]); });
    expect(host.appCheck).toHaveBeenCalledTimes(1);
    expect(host.cliCheck).toHaveBeenCalledTimes(1);
    await act(async () => { await result.current.updateAll(); });
    expect(host.invoke).toHaveBeenCalledWith("app_update_download", { expectedVersion: "0.2.37" });
    expect(host.cliInstall).toHaveBeenCalledTimes(1);
    expect(host.invoke).not.toHaveBeenCalledWith("prepare_for_app_update");
    expect(host.relaunch).not.toHaveBeenCalled();
    expect(result.current.snapshot.restartRequired).toBe(true);
    await act(async () => { await result.current.restartToUpdate(); });
    expect(host.invoke).toHaveBeenCalledWith("app_update_install");
    expect(host.invoke).toHaveBeenCalledWith("prepare_for_app_update");
    expect(host.relaunch).toHaveBeenCalledTimes(1);
  });

  it("uses verified signed-package cache rather than re-downloading", async () => {
    const update = { version: "0.2.37", currentVersion: "0.2.36", rid: 45, close: vi.fn() };
    host.check.mockResolvedValue(update);
    host.invoke.mockImplementation(async (command: string) => {
      if (command === "updater_status") return { channel: "silent", pluginEnabled: true, platformSupported: true, endpoint: "https://updates.example.test/latest.json" };
      if (command === "app_update_signed_cached") return true;
      return null;
    });
    const { result } = renderHook(() => useUpdater());
    await act(async () => { await result.current.checkForUpdate(); });
    expect(result.current.snapshot.app.phase).toBe("downloaded");
    await act(async () => { await result.current.updateAll(); });
    expect(host.invoke).not.toHaveBeenCalledWith("app_update_signed_download", expect.anything());
    await act(async () => { await result.current.restartToUpdate(); });
    expect(host.invoke).toHaveBeenCalledWith("app_update_signed_install", { rid: 45 });
  });

  it("keeps a previously downloaded package available while release checks are offline", async () => {
    host.invoke.mockImplementation(async (command: string) => {
      if (command === "updater_status") return { channel: "github_manual", pluginEnabled: false, platformSupported: false, endpoint: "" };
      if (command === "app_update_staged") return { version: "0.2.37", installed: false };
      return null;
    });
    host.appCheck.mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useUpdater());
    await act(async () => { await result.current.checkForUpdate(); });
    await waitFor(() => expect(result.current.snapshot.app.phase).toBe("downloaded"));
    expect(result.current.snapshot.restartRequired).toBe(true);
  });

  it("falls back to a friendly message and probed version when the CLI cannot report updates", async () => {
    host.cliCheck.mockRejectedValue(new Error("missing currentVersion/latestVersion in update --check JSON"));
    host.probeCli.mockResolvedValue({ found: true, version: "supercharge 1.3.16 (abc)", path: "/usr/local/bin/supercharge" });
    host.invoke.mockImplementation(async (command: string) => {
      if (command === "updater_status") return { channel: "github_manual", pluginEnabled: false, platformSupported: false, endpoint: "" };
      if (command === "app_update_staged") return null;
      return null;
    });
    const { result } = renderHook(() => useUpdater());
    await act(async () => { await result.current.checkForUpdate(); });
    await waitFor(() => expect(result.current.snapshot.cli.errorKey).toBe("updates.cliCheckUnavailable"));
    expect(result.current.snapshot.cli.current).toBe("supercharge 1.3.16 (abc)");
    expect(result.current.snapshot.cli.error).toBeUndefined();
  });
});
