import { isNewerVersion, isVersionAtLeast } from "./updateVersion";

export type UpdatePhase = "idle" | "current" | "unavailable" | "available" | "downloading" | "downloaded" | "installing" | "installed" | "manual" | "error";
export type AppUpdateSource = "signed" | "package" | "manual" | "none";

export type ComponentUpdate = {
  phase: UpdatePhase;
  current: string;
  latest: string;
  source?: AppUpdateSource;
  releaseUrl?: string;
  downloadUrl?: string | null;
  percent?: number;
  error?: string;
  /** i18n key shown instead of the raw error when the failure is expected/known. */
  errorKey?: string;
};

export type AppUpdateOffer = {
  current: string;
  latest: string;
  source: AppUpdateSource;
  releaseFound: boolean;
  updateAvailable: boolean;
  cached?: boolean;
  installed?: boolean;
  releaseUrl?: string;
  downloadUrl?: string | null;
};

export type CliUpdateOffer = { current: string; latest: string; updateAvailable: boolean };

export type UpdateSnapshot = {
  app: ComponentUpdate;
  cli: ComponentUpdate;
  checking: boolean;
  updating: boolean;
  restarting: boolean;
  restartRequired: boolean;
  checked: boolean;
  error?: string;
};

export interface UpdatePorts {
  checkApp(): Promise<AppUpdateOffer>;
  checkCli(): Promise<CliUpdateOffer>;
  downloadApp(version: string, source: AppUpdateSource, progress: (percent: number) => void): Promise<void>;
  installApp(version: string, source: AppUpdateSource): Promise<void>;
  installCli(progress: (percent: number) => void): Promise<{ version: string }>;
  prepareRestart(): Promise<void>;
  relaunch(): Promise<void>;
}

const initialComponent = (): ComponentUpdate => ({ phase: "idle", current: "", latest: "" });
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);
const isPending = (component: ComponentUpdate) => component.phase === "downloaded" || component.phase === "installed";

export class UpdateController {
  private snapshot: UpdateSnapshot = {
    app: initialComponent(), cli: initialComponent(), checking: false, updating: false,
    restarting: false, restartRequired: false, checked: false,
  };
  private listeners = new Set<() => void>();
  private checkPromise: Promise<UpdateSnapshot> | null = null;
  private updatePromise: Promise<UpdateSnapshot> | null = null;
  private restartPromise: Promise<void> | null = null;
  private generation = 0;

  constructor(private readonly ports: UpdatePorts) {}

  getSnapshot = (): UpdateSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(patch: Partial<UpdateSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }

  private component(which: "app" | "cli", value: ComponentUpdate) {
    this.set({ [which]: value });
  }

  reset(): void {
    if (this.snapshot.updating || this.snapshot.restarting || this.checkPromise) return;
    this.generation++;
    this.set({ app: initialComponent(), cli: initialComponent(), checked: false, error: undefined, restartRequired: false });
  }

  check = (): Promise<UpdateSnapshot> => {
    if (this.checkPromise) return this.checkPromise;
    if (this.snapshot.updating || this.snapshot.restarting) return Promise.resolve(this.snapshot);
    const generation = this.generation;
    this.set({ checking: true, error: undefined });
    const stagedApp = this.snapshot.app;
    const appCheck = isPending(stagedApp)
      ? Promise.resolve<AppUpdateOffer>({ current: stagedApp.current, latest: stagedApp.latest, source: stagedApp.source ?? "none", releaseFound: true, updateAvailable: true, cached: true, installed: stagedApp.phase === "installed" })
      : this.ports.checkApp();
    const operation = Promise.allSettled([appCheck, this.ports.checkCli()]).then(([app, cli]) => {
      if (generation !== this.generation) return this.snapshot;
      if (app.status === "fulfilled") {
        const offer = app.value;
        const pending = this.snapshot.app;
        const keepPending = isPending(pending) && !isNewerVersion(pending.latest, offer.latest);
        if (!keepPending) {
          const newer = offer.updateAvailable && isNewerVersion(offer.current, offer.latest);
          const phase: UpdatePhase = newer
            ? offer.installed ? "installed" : offer.cached ? "downloaded" : offer.source === "manual" ? "manual" : "available"
            : offer.releaseFound ? "current" : "unavailable";
          this.component("app", { phase, current: offer.current, latest: offer.latest, source: offer.source, releaseUrl: offer.releaseUrl, downloadUrl: offer.downloadUrl });
        }
      } else {
        this.component("app", { ...this.snapshot.app, phase: isPending(this.snapshot.app) ? this.snapshot.app.phase : "error", error: errorMessage(app.reason) });
      }
      if (cli.status === "fulfilled") {
        const offer = cli.value;
        const installed = this.snapshot.cli;
        if (installed.phase === "installed" && !isNewerVersion(installed.current, offer.latest)) {
          this.component("cli", { ...installed, error: undefined });
        } else {
          const phase = offer.updateAvailable && isNewerVersion(offer.current, offer.latest) ? "available" : "current";
          this.component("cli", { ...offer, phase });
        }
      } else {
        const installed = this.snapshot.cli;
        const reason = cli.reason as (Error & { code?: string; cliCurrent?: string }) | undefined;
        const keepInstalled = installed.phase === "installed" && !isNewerVersion(installed.current, installed.latest);
        this.component("cli", {
          ...installed,
          phase: keepInstalled ? "installed" : "error",
          current: reason?.cliCurrent?.trim() || installed.current,
          error: reason?.code || keepInstalled ? undefined : errorMessage(cli.reason),
          errorKey: reason?.code,
        });
      }
      this.set({ checking: false, checked: true, restartRequired: this.snapshot.restartRequired || isPending(this.snapshot.app) });
      return this.snapshot;
    }).finally(() => { if (this.checkPromise === operation) this.checkPromise = null; });
    this.checkPromise = operation;
    return operation;
  };

  update = (): Promise<UpdateSnapshot> => {
    if (this.updatePromise) return this.updatePromise;
    if (this.snapshot.restarting) return Promise.resolve(this.snapshot);
    const operation = (async () => {
      if (!this.snapshot.checked || this.checkPromise) await this.check();
      if (this.snapshot.restarting) return this.snapshot;
      this.set({ updating: true, error: undefined });
      const app = this.snapshot.app;
      const cli = this.snapshot.cli;
      await Promise.all([
        (async () => {
          if (app.phase !== "available" && !(app.phase === "error" && app.latest)) return;
          if (!isNewerVersion(app.current, app.latest) || !app.source || app.source === "manual" || app.source === "none") return;
          this.component("app", { ...app, phase: "downloading", percent: undefined, error: undefined });
          try {
            await this.ports.downloadApp(app.latest, app.source, (percent) => {
              this.component("app", { ...this.snapshot.app, percent: Math.max(0, Math.min(100, percent)) });
            });
            this.component("app", { ...app, phase: "downloaded", percent: 100, error: undefined });
            this.set({ restartRequired: true });
          } catch (error) {
            this.component("app", { ...app, phase: "error", error: errorMessage(error) });
          }
        })(),
        (async () => {
          if (cli.phase !== "available" && !(cli.phase === "error" && cli.latest)) return;
          if (!isNewerVersion(cli.current, cli.latest)) return;
          this.component("cli", { ...cli, phase: "installing", percent: undefined, error: undefined });
          try {
            const result = await this.ports.installCli((percent) => {
              this.component("cli", { ...this.snapshot.cli, percent: Math.max(0, Math.min(100, percent)) });
            });
            if (isNewerVersion(cli.current, result.version) && isVersionAtLeast(result.version, cli.latest)) {
              this.component("cli", { ...cli, phase: "installed", current: result.version, latest: result.version, percent: 100, error: undefined });
            } else {
              throw new Error("CLI installer did not report the expected newer version");
            }
            this.set({ restartRequired: true });
          } catch (error) {
            this.component("cli", { ...cli, phase: "error", error: errorMessage(error) });
          }
        })(),
      ]);
      this.set({ updating: false });
      return this.snapshot;
    })().finally(() => { if (this.updatePromise === operation) this.updatePromise = null; });
    this.updatePromise = operation;
    return operation;
  };

  restart = (): Promise<void> => {
    if (this.restartPromise) return this.restartPromise;
    if (!this.snapshot.restartRequired || this.snapshot.updating || this.snapshot.checking || this.snapshot.restarting) return Promise.resolve();
    const operation = (async () => {
      this.set({ restarting: true, error: undefined });
      const app = this.snapshot.app;
      try {
        if (app.phase === "downloaded" && app.source && app.source !== "manual" && app.source !== "none") {
          this.component("app", { ...app, phase: "installing" });
          try {
            await this.ports.installApp(app.latest, app.source);
            this.component("app", { ...app, phase: "installed", error: undefined });
          } catch (error) {
            this.component("app", { ...app, error: errorMessage(error) });
            throw error;
          }
        }
        await this.ports.prepareRestart();
        await this.ports.relaunch();
      } catch (error) {
        this.set({ restarting: false, error: errorMessage(error) });
      }
    })().finally(() => { if (this.restartPromise === operation) this.restartPromise = null; });
    this.restartPromise = operation;
    return operation;
  };
}
