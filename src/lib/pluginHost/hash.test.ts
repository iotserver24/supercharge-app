import { describe, expect, it } from "vitest";
import {
  buildPluginHash,
  isReservedHashRoot,
  parsePluginHash,
} from "./hash";

describe("parsePluginHash", () => {
  it("round-trips a valid plugin route", () => {
    const built = buildPluginHash({ plugin: "plugin-ui-hello", pane: "home" });
    expect(built).toBe("#/plugin/plugin-ui-hello/home");
    expect(parsePluginHash(built)).toEqual({
      plugin: "plugin-ui-hello",
      pane: "home",
    });
  });

  it("accepts missing hash prefix and trailing slash", () => {
    expect(parsePluginHash("plugin/demo/home/")).toEqual({
      plugin: "demo",
      pane: "home",
    });
    expect(parsePluginHash("#plugin/demo/home")).toEqual({
      plugin: "demo",
      pane: "home",
    });
  });

  it("does not claim settings / session / automations / workbench / home", () => {
    expect(parsePluginHash("#/settings/extensions/plugins")).toBeNull();
    expect(parsePluginHash("#/session/abc-123")).toBeNull();
    expect(parsePluginHash("#/automations")).toBeNull();
    expect(parsePluginHash("#/workbench")).toBeNull();
    expect(parsePluginHash("#/home")).toBeNull();
    expect(parsePluginHash("")).toBeNull();
    expect(isReservedHashRoot("settings")).toBe(true);
    expect(isReservedHashRoot("plugin")).toBe(false);
  });

  it("rejects missing pane, extra segments, and invalid ids", () => {
    expect(parsePluginHash("#/plugin/only-id")).toBeNull();
    expect(parsePluginHash("#/plugin/demo/home/extra")).toBeNull();
    expect(parsePluginHash("#/plugin/HasCaps/home")).toBeNull();
    expect(parsePluginHash("#/plugin/demo/Bad_Pane")).toBeNull();
    expect(parsePluginHash("#/plugin/this-id-is-way-too-long-for-the-limit/home")).toBeNull();
  });

  it("buildPluginHash refuses reserved-looking or illegal ids", () => {
    expect(buildPluginHash({ plugin: "SETTINGS", pane: "home" })).toBeNull();
    expect(buildPluginHash({ plugin: "ok", pane: ".." })).toBeNull();
    expect(buildPluginHash({ plugin: "", pane: "home" })).toBeNull();
  });
});
