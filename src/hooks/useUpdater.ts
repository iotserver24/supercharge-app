import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import * as api from "@/lib/api";
import { UpdateController, type AppUpdateOffer, type UpdatePorts, type ComponentUpdate } from "@/lib/updateController";
import { isNewerVersion } from "@/lib/updateVersion";
import { DEVELOPER_MODE_CHANGE_EVENT } from "@/lib/developerModePref";
import { UPDATE_SIM_CHANGE_EVENT, UPDATE_SIM_VERSION, installDeveloperModeSimCleanup, installUpdateSimConsoleApi, readUpdateSimMode, sleepMs } from "@/lib/updateSim";

export type UpdateStatus = {
  state: "idle" | "checking" | "up-to-date" | "available" | "downloading" | "installing" | "ready" | "restarting" | "error" | "manual-required";
  version?: string;
  message?: string;
  releaseUrl?: string;
  downloadUrl?: string | null;
  assetNames?: string[];
};

export type UpdaterChannelInfo = {
  channel: "silent" | "github_manual" | "unsupported" | "unknown";
  pluginEnabled: boolean;
  platformSupported: boolean;
  endpoint: string;
};

type Staged = { version: string; installed: boolean };
const RELEASES_URL = "https://github.com/iotserver24/supercharge-app/releases";
const CHECK_INTERVAL = 6 * 60 * 60 * 1000;

function statusFor(app: ComponentUpdate, checking: boolean, restarting: boolean): UpdateStatus {
  if (restarting) return { state: "restarting", version: app.latest };
  if (checking) return { state: "checking" };
  const states: Record<ComponentUpdate["phase"], UpdateStatus["state"]> = {
    idle: "idle", current: "up-to-date", unavailable: "idle", available: "available",
    downloading: "downloading", downloaded: "ready", installing: "installing", installed: "ready",
    manual: "manual-required", error: "error",
  };
  return { state: states[app.phase], version: app.latest || undefined, message: app.error, releaseUrl: app.releaseUrl, downloadUrl: app.downloadUrl };
}

async function withProgress<T>(event: string, version: string | undefined, onProgress: (percent: number) => void, action: () => Promise<T>): Promise<T> {
  const unlisten = await api.listen<{ version?: string; percent?: number }>(event, (progress) => {
    if ((!version || !progress.version || progress.version === version) && typeof progress.percent === "number") onProgress(progress.percent);
  });
  try { return await action(); } finally { unlisten(); }
}

export function useUpdater() {
  const [channelInfo, setChannelInfo] = useState<UpdaterChannelInfo>({ channel: "unknown", pluginEnabled: false, platformSupported: false, endpoint: "" });
  const signedUpdateRef = useRef<Update | null>(null);
  const aliveRef = useRef(false);
  const portsRef = useRef<UpdatePorts | null>(null);
  if (!portsRef.current) {
    portsRef.current = {
      checkApp: async (): Promise<AppUpdateOffer> => {
        const sim = readUpdateSimMode();
        if (sim !== "off") {
          if (aliveRef.current) setChannelInfo({ channel: sim === "silent" ? "silent" : "github_manual", pluginEnabled: sim === "silent", platformSupported: true, endpoint: "sim://local" });
          return { current: "0.0.0", latest: UPDATE_SIM_VERSION, source: sim === "silent" ? "signed" : "manual", releaseFound: true, updateAvailable: true, releaseUrl: RELEASES_URL };
        }
        if (!api.isDesktopHost()) throw new Error("Updates are only available in the desktop app");
        const current = await getVersion();
        const staged = await invoke<Staged | null>("app_update_staged");
        const channel = await invoke<UpdaterChannelInfo>("updater_status");
        if (aliveRef.current) setChannelInfo(channel);
        if (channel.pluginEnabled && channel.platformSupported) {
          const update = await check({ headers: { "Cache-Control": "no-cache" }, allowDowngrades: false, timeout: 20000 });
          if (update && isNewerVersion(current, update.version)) {
            const old = signedUpdateRef.current;
            signedUpdateRef.current = update;
            if (old && old !== update) await old.close().catch(() => undefined);
            const cached = await invoke<boolean>("app_update_signed_cached", { rid: update.rid });
            return { current, latest: update.version, source: "signed", cached, releaseFound: true, updateAvailable: true, releaseUrl: RELEASES_URL };
          }
          if (update) await update.close();
          return { current, latest: current, source: "signed", releaseFound: true, updateAvailable: false };
        }
        const result = await api.appCheckUpdate().catch((error) => {
          if (staged && isNewerVersion(current, staged.version)) return null;
          throw error;
        });
        if (staged && isNewerVersion(current, staged.version) && (!result || !isNewerVersion(staged.version, result.latestVersion))) {
          return { current, latest: staged.version, source: "package", releaseFound: true, updateAvailable: true, cached: true, installed: staged.installed, releaseUrl: result?.htmlUrl || RELEASES_URL };
        }
        if (!result) throw new Error("Could not read the desktop release");
        return {
          current: result.currentVersion, latest: result.latestVersion,
          source: result.installSupported ? "package" : result.updateAvailable ? "manual" : "none",
          releaseFound: result.releaseFound !== false, updateAvailable: result.updateAvailable,
          releaseUrl: result.htmlUrl, downloadUrl: result.downloadUrl,
        };
      },
      checkCli: async () => {
        if (readUpdateSimMode() !== "off") return { current: "1.0.0", latest: UPDATE_SIM_VERSION, updateAvailable: true };
        if (!api.isDesktopHost()) throw new Error("Updates are only available in the desktop app");
        try {
          const result = await api.cliUpdateCheck();
          if (result.error) throw new Error(result.error);
          return { current: result.currentVersion || result.current || result.version || "", latest: result.latestVersion || result.latest || "", updateAvailable: result.updateAvailable === true };
        } catch (error) {
          // Old or stub CLIs may not support `update --check --json`. Probe the
          // binary so the panel still shows the installed version with a clear,
          // translated reason instead of leaking raw command output.
          let found: boolean | null = null;
          let current = "";
          try {
            const probe = await api.probeCli();
            found = !!probe?.found;
            current = String(probe?.version ?? "").trim();
          } catch { /* probe failure keeps the raw error */ }
          if (found === false) {
            throw Object.assign(new Error("Supercharge CLI is not installed"), { code: "updates.cliMissing" });
          }
          if (found === true && current) {
            throw Object.assign(new Error("CLI update check is unavailable for this CLI"), {
              code: "updates.cliCheckUnavailable",
              cliCurrent: current,
            });
          }
          throw error;
        }
      },
      downloadApp: async (version, source, progress) => {
        if (readUpdateSimMode() === "silent") { progress(25); await sleepMs(600); progress(100); return; }
        if (source === "signed") {
          const update = signedUpdateRef.current;
          if (!update || update.version !== version) throw new Error("App update changed; check for updates again");
          await withProgress("app://update-progress", version, progress, () => invoke("app_update_signed_download", { rid: update.rid }));
        } else {
          await withProgress("app://update-progress", version, progress, () => invoke("app_update_download", { expectedVersion: version }));
        }
      },
      installApp: async (_version, source) => {
        if (readUpdateSimMode() === "silent") { await sleepMs(300); return; }
        if (source === "signed") {
          const update = signedUpdateRef.current;
          if (!update) throw new Error("Signed app update is not ready");
          await invoke("app_update_signed_install", { rid: update.rid });
        } else {
          await invoke("app_update_install");
        }
      },
      installCli: async (progress) => {
        if (readUpdateSimMode() !== "off") { progress(25); await sleepMs(600); progress(100); return { version: UPDATE_SIM_VERSION }; }
        const result = await withProgress("setup://cli-install-progress", undefined, progress, () => api.cliUpdateInstall({ acknowledgeAppBehind: true }));
        if (!result.ok) throw new Error(result.message || result.error || "CLI update failed");
        const version = result.version;
        if (!version) throw new Error("CLI update did not report its installed version");
        return { version };
      },
      prepareRestart: async () => {
        if (readUpdateSimMode() !== "off") return;
        await invoke("prepare_for_app_update");
      },
      relaunch: async () => {
        if (readUpdateSimMode() !== "off") { window.location.reload(); return; }
        await relaunch();
      },
    };
  }
  const controllerRef = useRef<UpdateController | null>(null);
  if (!controllerRef.current) controllerRef.current = new UpdateController(portsRef.current);
  const controller = controllerRef.current;
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);

  useEffect(() => {
    aliveRef.current = true;
    installDeveloperModeSimCleanup();
    installUpdateSimConsoleApi();
    const timer = window.setTimeout(() => void controller.check(), 4500);
    const interval = window.setInterval(() => void controller.check(), CHECK_INTERVAL);
    const reseed = () => { controller.reset(); void controller.check(); };
    window.addEventListener(UPDATE_SIM_CHANGE_EVENT, reseed);
    window.addEventListener(DEVELOPER_MODE_CHANGE_EVENT, reseed);
    return () => {
      aliveRef.current = false;
      window.clearTimeout(timer);
      window.clearInterval(interval);
      window.removeEventListener(UPDATE_SIM_CHANGE_EVENT, reseed);
      window.removeEventListener(DEVELOPER_MODE_CHANGE_EVENT, reseed);
    };
  }, [controller]);

  const checkForUpdate = useCallback(() => controller.check(), [controller]);
  const updateAll = useCallback(() => controller.update(), [controller]);
  const restartToUpdate = useCallback(() => controller.restart(), [controller]);
  return {
    snapshot, channelInfo, status: statusFor(snapshot.app, snapshot.checking, snapshot.restarting),
    checkForUpdate, updateAll, restartToUpdate,
    installAndRelaunch: restartToUpdate,
    githubReleasesUrl: RELEASES_URL,
  };
}
