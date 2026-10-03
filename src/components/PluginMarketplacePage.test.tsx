// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginDto } from "@/lib/api";

const api = vi.hoisted(() => ({
  isTauri: vi.fn(() => true),
  skillsList: vi.fn(), inspectMcp: vi.fn(), pluginsList: vi.fn(),
  marketplaceList: vi.fn(), marketplaceAvailable: vi.fn(), marketplacePluginMetaIndex: vi.fn(),
  marketplaceAdd: vi.fn(), marketplaceRemove: vi.fn(), marketplaceUpdate: vi.fn(),
  pluginInstall: vi.fn(), pluginDisable: vi.fn(), pluginEnable: vi.fn(),
  pluginApiConnect: vi.fn(), pluginApiList: vi.fn(), pluginApiCatalog: vi.fn(),
}));
vi.mock("@/lib/api", async (original) => ({ ...await original<object>(), ...api }));
vi.mock("@/lib/imageSrc", () => ({
  ensureMediaEndpoint: vi.fn(async () => undefined),
  localPathToMediaHttpUrl: (path: string) => `http://localhost/media${path}`,
}));
vi.mock("@/lib/nativeWebviewCover", () => ({ acquireNativeWebviewCover: () => () => undefined }));

import { PluginMarketplacePage } from "./PluginMarketplacePage";
import { __resetMarketplaceCatalogCacheForTests } from "@/lib/marketplaceCatalogCache";
import { invalidatePluginsListCache } from "@/lib/pluginsListCache";

let installed: PluginDto[];
let sources: Array<{ name: string; kind: string; url: string }>;
const catalog = [
  { name: "alpha-tools", marketplace: "openai", description: "Debug local applications", status: "available", has_mcp: true },
  { name: "beta-design", marketplace: "team", description: "Design interfaces", status: "available", skill_count: 2 },
];

beforeEach(() => {
  vi.clearAllMocks();
  __resetMarketplaceCatalogCacheForTests();
  invalidatePluginsListCache();
  vi.stubGlobal("IntersectionObserver", class { observe() {} disconnect() {} });
  installed = [{ name: "installed-kit", enabled: true, status: "installed" }];
  sources = [
    { name: "openai", kind: "git", url: "https://github.com/openai/plugins" },
    { name: "xAI Official", kind: "git", url: "https://github.com/xai-org/plugin-marketplace.git" },
    { name: "team", kind: "git", url: "https://github.com/team/claude-compatible-plugins" },
  ];
  api.isTauri.mockReturnValue(true);
  api.skillsList.mockResolvedValue({ skills: [] });
  api.inspectMcp.mockResolvedValue({ servers: [] });
  api.pluginsList.mockImplementation(async () => ({ plugins: [...installed] }));
  api.marketplaceList.mockImplementation(async () => ({ sources: [...sources] }));
  api.marketplaceAvailable.mockResolvedValue({ plugins: catalog });
  api.marketplacePluginMetaIndex.mockResolvedValue({ plugins: [
    { name: "alpha-tools", displayName: "Alpha Tools", category: "Developer Tools", logoPath: "/alpha.png" },
    { name: "beta-design", displayName: "Beta Design", category: "Design" },
  ] });
  api.marketplaceAdd.mockImplementation(async (url: string) => {
    sources.push({ name: "new-source", kind: "git", url });
    return { ok: true };
  });
  api.marketplaceRemove.mockResolvedValue({ ok: true });
  api.marketplaceUpdate.mockResolvedValue({ ok: true });
  api.pluginInstall.mockImplementation(async () => {
    installed.push({ name: "alpha-tools", marketplace: "openai", enabled: true, status: "installed" });
    return { ok: true, name: "alpha-tools" };
  });
  api.pluginDisable.mockImplementation(async (name: string) => {
    installed = installed.map((p) => p.name === name ? { ...p, enabled: false } : p);
    return { ok: true, name };
  });
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function openPage() {
  render(<PluginMarketplacePage locale="en" projectPath="/work/local" />);
  await screen.findByText("Alpha Tools");
}

function alphaRow() {
  return screen.getByText("Alpha Tools").closest("li")!;
}

describe("local Plugin Marketplace", () => {
  it("loads the CLI catalog, preserves custom sources, searches metadata, and opens details", async () => {
    await openPage();
    expect(screen.getByRole("heading", { name: "Plugin Marketplace" })).toBeTruthy();
    expect(api.skillsList).toHaveBeenCalledWith("/work/local");
    expect(screen.getByText("Beta Design")).toBeTruthy();
    expect(api.marketplaceRemove).not.toHaveBeenCalled();
    expect(api.pluginInstall).not.toHaveBeenCalled();
    expect(api.pluginApiConnect).not.toHaveBeenCalled();
    expect(api.pluginApiList).not.toHaveBeenCalled();
    expect(api.pluginApiCatalog).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Alpha" } });
    expect(screen.queryByText("Beta Design")).toBeNull();
    fireEvent.keyDown(alphaRow(), { key: "Enter" });
    expect(screen.getByRole("dialog", { name: "Alpha Tools" })).toBeTruthy();
    expect(within(screen.getByRole("dialog")).getAllByText("Debug local applications").length).toBeGreaterThan(0);
  });

  it("ensures openai/plugins without installing plugins or deleting user sources", async () => {
    sources = sources.filter((source) => source.name !== "openai");
    await openPage();
    expect(api.marketplaceAdd).toHaveBeenCalledWith("https://github.com/openai/plugins");
    expect(api.marketplaceRemove).not.toHaveBeenCalled();
    expect(api.pluginInstall).not.toHaveBeenCalled();
  });

  it("keeps browsing available sources when ensuring defaults fails", async () => {
    sources = sources.filter((source) => source.name !== "openai");
    api.marketplaceAdd.mockRejectedValueOnce(new Error("Source unavailable"));
    await openPage();
    expect(screen.getByText("Error: Source unavailable")).toBeTruthy();
    expect(screen.getByText("Beta Design")).toBeTruthy();
  });

  it("confirms trust before installing, refreshes CLI installed state, and supports management", async () => {
    await openPage();
    fireEvent.click(within(alphaRow()).getByRole("button", { name: "Install" }));
    const confirmation = screen.getByRole("dialog", { name: "Install plugin" });
    expect(api.pluginInstall).not.toHaveBeenCalled();
    fireEvent.click(within(confirmation).getByRole("button", { name: "Install" }));
    await waitFor(() => expect(api.pluginInstall).toHaveBeenCalledWith("alpha-tools@openai"));
    await waitFor(() => expect(document.querySelectorAll(".ext-ref-installed-chip")).toHaveLength(2));
    expect(within(alphaRow()).getByText("Installed")).toBeTruthy();
    fireEvent.click(screen.getByRole("listitem", { name: "Alpha Tools" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Alpha Tools" })).getByRole("button", { name: "Disable" }));
    await waitFor(() => expect(api.pluginDisable).toHaveBeenCalledWith("alpha-tools"));
    await waitFor(() => expect(document.querySelector('.ext-ref-installed-chip[aria-label="Alpha Tools"]')?.classList.contains("is-off")).toBe(true));
  });

  it("surfaces install errors without inventing installed state and permits retry", async () => {
    api.pluginInstall.mockRejectedValueOnce(new Error("Network unavailable"));
    await openPage();
    for (let attempt = 0; attempt < 2; attempt++) {
      fireEvent.click(within(alphaRow()).getByRole("button", { name: "Install" }));
      fireEvent.click(within(screen.getByRole("dialog", { name: "Install plugin" })).getByRole("button", { name: "Install" }));
      if (attempt === 0) {
        await screen.findByText("Error: Network unavailable");
        expect(document.querySelectorAll(".ext-ref-installed-chip")).toHaveLength(1);
      }
    }
    await waitFor(() => expect(document.querySelectorAll(".ext-ref-installed-chip")).toHaveLength(2));
  });

  it("refreshes catalog after source management and opens local MCP/skills settings", async () => {
    await openPage();
    fireEvent.click(screen.getByRole("button", { name: "Marketplace sources" }));
    await screen.findByText("team");
    fireEvent.change(screen.getByLabelText("Add source"), { target: { value: "https://github.com/team/new-plugins" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await screen.findByText("new-source");
    const calls = api.marketplaceAvailable.mock.calls.length;
    fireEvent.click(within(screen.getByRole("dialog", { name: "Marketplace sources" })).getAllByRole("button", { name: "Close" })[0]);
    await waitFor(() => expect(api.marketplaceAvailable.mock.calls.length).toBeGreaterThan(calls));
    expect(api.marketplaceRemove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "MCP servers" }));
    expect(window.location.hash).toBe("#/settings/extensions/mcp");
    fireEvent.click(screen.getByRole("button", { name: "Skills" }));
    expect(window.location.hash).toBe("#/settings/extensions/skills");
  });

  it("refreshes installed plugins after an external CLI change on focus", async () => {
    await openPage();
    installed.push({ name: "external-plugin", status: "installed", enabled: true });
    act(() => window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(document.querySelectorAll(".ext-ref-installed-chip")).toHaveLength(2));
  });

  it("shows catalog errors and retries instead of showing fake rows", async () => {
    api.marketplaceAvailable.mockRejectedValueOnce(new Error("Catalog offline"));
    render(<PluginMarketplacePage locale="en" />);
    await screen.findByText("Error: Catalog offline");
    expect(screen.queryByText("Alpha Tools")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByText("Alpha Tools");
  });

  it("clears an empty search without discarding the loaded catalog", async () => {
    await openPage();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "no-such-plugin" } });
    expect(screen.queryByText("Alpha Tools")).toBeNull();
    expect(screen.queryByText("ChatCut")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByText("Alpha Tools")).toBeTruthy();
  });

  it("does not install when confirmation is cancelled", async () => {
    await openPage();
    fireEvent.click(within(alphaRow()).getByRole("button", { name: "Install" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(api.pluginInstall).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("returns to the manual installer when its confirmation is cancelled", async () => {
    await openPage();
    fireEvent.click(screen.getByRole("button", { name: "Install from path or git…" }));
    fireEvent.change(screen.getByLabelText("Source"), { target: { value: "/work/my-plugin" } });
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Install" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Install plugin" })).getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("dialog", { name: "Install from path or git…" })).toBeTruthy();
    expect((screen.getByLabelText("Source") as HTMLInputElement).value).toBe("/work/my-plugin");
    expect(api.pluginInstall).not.toHaveBeenCalled();
  });

  it("shows a rejected CLI result as a failure rather than an installed plugin", async () => {
    api.pluginInstall.mockResolvedValueOnce({ ok: false, message: "Trust refused" });
    await openPage();
    fireEvent.click(within(alphaRow()).getByRole("button", { name: "Install" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Install" }));
    await screen.findByText("Error: Trust refused");
    expect(document.querySelectorAll(".ext-ref-installed-chip")).toHaveLength(1);
  });

  it("shows the CLI prerequisite and disables installation when unavailable", async () => {
    render(<PluginMarketplacePage locale="en" cliFound={false} />);
    await screen.findByText("Marketplace needs the Supercharge CLI");
    expect(api.marketplaceAvailable).not.toHaveBeenCalled();
    expect(api.pluginInstall).not.toHaveBeenCalled();
    for (const button of screen.getAllByRole("button", { name: "Install" })) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
  });
});
