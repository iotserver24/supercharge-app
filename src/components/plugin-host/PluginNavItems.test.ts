import { describe, expect, it } from "vitest";
import { isPluginNavActive } from "./PluginNavItems";

describe("isPluginNavActive", () => {
  const route = { plugin: "x-host-lab", pane: "home" };

  it("is active only while the plugin pane is the visible workbench", () => {
    expect(isPluginNavActive(true, route, "x-host-lab", "home")).toBe(true);
    expect(isPluginNavActive(false, route, "x-host-lab", "home")).toBe(false);
  });

  it("ignores leftover pluginRoute when another nav item is showing", () => {
    expect(isPluginNavActive(false, route, "x-host-lab", "events")).toBe(
      false,
    );
    expect(isPluginNavActive(true, route, "x-host-lab", "events")).toBe(false);
    expect(isPluginNavActive(true, null, "x-host-lab", "home")).toBe(false);
  });
});