/** @vitest-environment jsdom */
import { useSyncExternalStore } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import "@/test/jsdomStubs";
import { createT } from "@/i18n";
import { UpdateController, type UpdatePorts } from "@/lib/updateController";
import { UpdatesPanel } from "./UpdatesPanel";

let controller: UpdateController;
const calls = vi.hoisted(() => ({ openExternalUrl: vi.fn() }));
vi.mock("@/lib/api", () => ({ openExternalUrl: calls.openExternalUrl }));
vi.mock("@/hooks/UpdaterProvider", () => ({
  useUpdaterContext: () => ({
    snapshot: useSyncExternalStore(controller.subscribe, controller.getSnapshot),
    checkForUpdate: controller.check, updateAll: controller.update, restartToUpdate: controller.restart,
  }),
}));

function setup(options: { cached?: boolean; manual?: boolean; unavailable?: boolean } = {}) {
  const ports: UpdatePorts = {
    checkApp: vi.fn(async () => ({ current: "0.2.36", latest: options.unavailable ? "0.2.36" : "0.2.37", source: options.manual ? "manual" as const : "package" as const, releaseFound: !options.unavailable, updateAvailable: !options.unavailable, cached: options.cached, releaseUrl: "https://github.com/iotserver24/supercharge-releases/releases" })),
    checkCli: vi.fn(async () => ({ current: "1.3.16", latest: "1.3.17", updateAvailable: true })),
    downloadApp: vi.fn(async () => {}), installApp: vi.fn(async () => {}),
    installCli: vi.fn(async () => ({ version: "1.3.17" })),
    prepareRestart: vi.fn(async () => {}), relaunch: vi.fn(async () => {}),
  };
  controller = new UpdateController(ports);
  return ports;
}

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("combined update panel", () => {
  it("shows separate versions and stages both with one button without restarting", async () => {
    const ports = setup();
    await controller.check();
    render(<UpdatesPanel t={createT("en")} />);
    expect(screen.getByText("Desktop app")).toBeInTheDocument();
    expect(screen.getByText("Supercharge CLI")).toBeInTheDocument();
    expect(screen.getByText("0.2.36")).toBeInTheDocument();
    expect(screen.getByText("1.3.16")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Update app & CLI" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Restart to use updates" })).toBeEnabled());
    expect(ports.downloadApp).toHaveBeenCalledTimes(1);
    expect(ports.installCli).toHaveBeenCalledTimes(1);
    expect(ports.relaunch).not.toHaveBeenCalled();
    expect(ports.prepareRestart).not.toHaveBeenCalled();
  });

  it("requires confirmation and preserves staged updates on cancel", async () => {
    const ports = setup({ cached: true });
    await controller.check();
    render(<UpdatesPanel t={createT("en")} />);
    fireEvent.click(screen.getByRole("button", { name: "Restart to use updates" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Running agent tasks will stop/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(ports.relaunch).not.toHaveBeenCalled();
    expect(controller.getSnapshot().restartRequired).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Restart to use updates" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Restart to use updates" }));
    await waitFor(() => expect(ports.relaunch).toHaveBeenCalledTimes(1));
    expect(ports.installApp).toHaveBeenCalledTimes(1);
  });

  it("shows unpublished app status without pretending the CLI is an app release", async () => {
    setup({ unavailable: true });
    await controller.check();
    render(<UpdatesPanel t={createT("en")} />);
    expect(screen.getByText("No desktop release published")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Update app & CLI" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Restart to use updates" })).not.toBeInTheDocument();
  });

  it("keeps manual app installation separate from the automated CLI result", async () => {
    const ports = setup({ manual: true });
    await controller.check();
    render(<UpdatesPanel t={createT("en")} />);
    expect(screen.getByText("Manual installation required")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Download app installer" }));
    await waitFor(() => expect(calls.openExternalUrl).toHaveBeenCalledOnce());
    await act(async () => controller.update());
    expect(ports.downloadApp).not.toHaveBeenCalled();
    expect(ports.installCli).toHaveBeenCalledOnce();
  });
});
