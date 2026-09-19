import { describe, expect, it, vi } from "vitest";
import { UpdateController, type AppUpdateOffer, type UpdatePorts } from "./updateController";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function setup(app: Partial<AppUpdateOffer> = {}) {
  const events: string[] = [];
  const ports = {
    checkApp: vi.fn(async () => ({ current: "0.2.36", latest: "0.2.37", source: "package", releaseFound: true, updateAvailable: true, ...app } as AppUpdateOffer)),
    checkCli: vi.fn(async () => ({ current: "1.3.16", latest: "1.3.17", updateAvailable: true })),
    downloadApp: vi.fn(async () => { events.push("downloadApp"); }),
    installApp: vi.fn(async () => { events.push("installApp"); }),
    installCli: vi.fn(async () => { events.push("installCli"); return { version: "supercharge 1.3.17 (abc)" }; }),
    prepareRestart: vi.fn(async () => { events.push("prepareRestart"); }),
    relaunch: vi.fn(async () => { events.push("relaunch"); }),
  } satisfies UpdatePorts;
  return { ports, events, controller: new UpdateController(ports) };
}

describe("combined app and CLI updater", () => {
  it("checks both but never downloads or restarts as a side effect of checking", async () => {
    const { controller, ports } = setup();
    await controller.check();
    expect(controller.getSnapshot().app.phase).toBe("available");
    expect(controller.getSnapshot().cli.phase).toBe("available");
    expect(ports.downloadApp).not.toHaveBeenCalled();
    expect(ports.installCli).not.toHaveBeenCalled();
    expect(ports.relaunch).not.toHaveBeenCalled();
  });

  it("updates both concurrently and waits for an explicit restart", async () => {
    const { controller, ports, events } = setup();
    const download = deferred<void>();
    const cli = deferred<{ version: string }>();
    ports.downloadApp.mockImplementation(() => download.promise);
    ports.installCli.mockImplementation(() => cli.promise);
    await controller.check();
    const pending = controller.update();
    expect(ports.downloadApp).toHaveBeenCalledTimes(1);
    expect(ports.installCli).toHaveBeenCalledTimes(1);
    await controller.restart();
    expect(ports.relaunch).not.toHaveBeenCalled();
    download.resolve(); cli.resolve({ version: "1.3.17" });
    await pending;
    expect(controller.getSnapshot()).toMatchObject({ updating: false, restartRequired: true, app: { phase: "downloaded" }, cli: { phase: "installed" } });
    expect(ports.installApp).not.toHaveBeenCalled();
    expect(ports.prepareRestart).not.toHaveBeenCalled();
    await controller.restart();
    expect(events).toEqual(["installApp", "prepareRestart", "relaunch"]);
  });

  it("never downloads equal, older or invalid versions even when a server flags them", async () => {
    for (const version of ["0.2.36", "0.2.35", "bad"]) {
      const { controller, ports } = setup({ latest: version });
      ports.checkCli.mockResolvedValue({ current: "1.3.17", latest: "1.3.16", updateAvailable: true });
      await controller.check(); await controller.update();
      expect(ports.downloadApp).not.toHaveBeenCalled();
      expect(ports.installCli).not.toHaveBeenCalled();
      expect(controller.getSnapshot().restartRequired).toBe(false);
    }
  });

  it("reuses downloaded app updates across rechecks and repeated clicks", async () => {
    const { controller, ports } = setup();
    await controller.check(); await controller.update();
    await controller.check(); await controller.update();
    expect(ports.downloadApp).toHaveBeenCalledTimes(1);
    expect(ports.installCli).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().restartRequired).toBe(true);
  });

  it("restores a verified downloaded package without downloading it again", async () => {
    const { controller, ports } = setup({ cached: true });
    await controller.check(); await controller.update();
    expect(controller.getSnapshot().app.phase).toBe("downloaded");
    expect(ports.downloadApp).not.toHaveBeenCalled();
    await controller.restart();
    expect(ports.installApp).toHaveBeenCalledTimes(1);
  });

  it("keeps a newer downloaded app when release metadata goes backwards", async () => {
    const { controller, ports } = setup({ latest: "0.2.38", cached: true });
    await controller.check();
    ports.checkApp.mockResolvedValue({ current: "0.2.36", latest: "0.2.37", source: "package", releaseFound: true, updateAvailable: true });
    await controller.check(); await controller.update();
    expect(controller.getSnapshot().app.latest).toBe("0.2.38");
    expect(ports.downloadApp).not.toHaveBeenCalled();
  });

  it("keeps a successful app download when the CLI fails and retries only the CLI", async () => {
    const { controller, ports } = setup();
    ports.installCli.mockRejectedValueOnce(new Error("CLI network failure"));
    await controller.check(); await controller.update();
    expect(controller.getSnapshot()).toMatchObject({ app: { phase: "downloaded" }, cli: { phase: "error" }, restartRequired: true });
    await controller.update();
    expect(ports.downloadApp).toHaveBeenCalledTimes(1);
    expect(ports.installCli).toHaveBeenCalledTimes(2);
  });

  it("does not tear down agents after an app install failure", async () => {
    const { controller, ports } = setup({ cached: true });
    ports.installApp.mockRejectedValueOnce(new Error("disk full"));
    await controller.check(); await controller.restart();
    expect(ports.prepareRestart).not.toHaveBeenCalled();
    expect(ports.relaunch).not.toHaveBeenCalled();
    expect(controller.getSnapshot()).toMatchObject({ app: { phase: "downloaded" }, restarting: false, restartRequired: true, error: "disk full" });
    await controller.restart();
    expect(ports.prepareRestart).toHaveBeenCalledTimes(1);
    expect(ports.relaunch).toHaveBeenCalledTimes(1);
  });

  it("does not reinstall a staged app if only relaunch failed", async () => {
    const { controller, ports } = setup({ cached: true });
    ports.relaunch.mockRejectedValueOnce(new Error("restart failed"));
    await controller.check(); await controller.restart(); await controller.restart();
    expect(ports.installApp).toHaveBeenCalledTimes(1);
    expect(ports.relaunch).toHaveBeenCalledTimes(2);
  });

  it("deduplicates simultaneous check, update, and restart requests", async () => {
    const { controller, ports } = setup();
    await Promise.all([controller.check(), controller.check()]);
    await Promise.all([controller.update(), controller.update()]);
    await Promise.all([controller.restart(), controller.restart()]);
    expect(ports.checkApp).toHaveBeenCalledTimes(1);
    expect(ports.installCli).toHaveBeenCalledTimes(1);
    expect(ports.downloadApp).toHaveBeenCalledTimes(1);
    expect(ports.relaunch).toHaveBeenCalledTimes(1);
  });

  it("does not mistake an unpublished desktop release for a CLI version", async () => {
    const { controller, ports } = setup({ latest: "0.2.36", source: "none", releaseFound: false, updateAvailable: false });
    await controller.check(); await controller.update();
    expect(controller.getSnapshot().app.phase).toBe("unavailable");
    expect(ports.downloadApp).not.toHaveBeenCalled();
    expect(ports.installCli).toHaveBeenCalledTimes(1);
  });

  it("keeps package-managed desktop installs manual", async () => {
    const { controller, ports } = setup({ source: "manual" });
    await controller.check(); await controller.update();
    expect(controller.getSnapshot().app.phase).toBe("manual");
    expect(ports.downloadApp).not.toHaveBeenCalled();
    expect(ports.installCli).toHaveBeenCalledTimes(1);
  });

  it("does not report success when a CLI installer returns the old version", async () => {
    const { controller, ports } = setup();
    ports.installCli.mockResolvedValue({ version: "1.3.16" });
    await controller.check(); await controller.update();
    expect(controller.getSnapshot().cli.phase).toBe("error");
  });

  it("shows the installed CLI version with a translated reason when checks are unsupported", async () => {
    const { controller, ports } = setup();
    const failure = Object.assign(new Error("missing currentVersion/latestVersion"), {
      code: "updates.cliCheckUnavailable",
      cliCurrent: "supercharge 1.3.16 (abc)",
    });
    ports.checkCli.mockRejectedValue(failure);
    await controller.check();
    expect(controller.getSnapshot().cli).toMatchObject({
      phase: "error", current: "supercharge 1.3.16 (abc)", errorKey: "updates.cliCheckUnavailable",
    });
    expect(controller.getSnapshot().cli.error).toBeUndefined();
  });
});
