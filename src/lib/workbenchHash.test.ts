import { describe, expect, it } from "vitest";
import { resolveWorkbenchHash } from "./workbenchHash";

describe("resolveWorkbenchHash", () => {
  it("treats empty / workbench / home as the chat pane", () => {
    expect(resolveWorkbenchHash("")).toEqual({ kind: "pane", pane: "chat" });
    expect(resolveWorkbenchHash("#/workbench")).toEqual({
      kind: "pane",
      pane: "chat",
    });
    expect(resolveWorkbenchHash("#/home")).toEqual({
      kind: "pane",
      pane: "chat",
    });
  });

  it("routes automations and kanban panes", () => {
    expect(resolveWorkbenchHash("#/automations")).toEqual({
      kind: "pane",
      pane: "automations",
    });
    expect(resolveWorkbenchHash("#/kanban/board")).toEqual({
      kind: "pane",
      pane: "kanban",
    });
  });

  it("opens usage as a standalone pane and returns home to chat", () => {
    expect(resolveWorkbenchHash("#/usage")).toEqual({ kind: "pane", pane: "usage" });
    expect(resolveWorkbenchHash("#/home")).toEqual({ kind: "pane", pane: "chat" });
  });

  it("routes valid plugin panes and rejects malformed plugin hashes", () => {
    expect(resolveWorkbenchHash("#/plugin/hello-host/home")).toEqual({
      kind: "plugin",
      pane: "plugin",
      route: { plugin: "hello-host", pane: "home" },
    });
    expect(resolveWorkbenchHash("#/plugin/../../settings")).toEqual({
      kind: "pane",
      pane: "chat",
    });
  });

  it("bare settings hash restores last route", () => {
    expect(resolveWorkbenchHash("#/settings")).toEqual({
      kind: "settings-last",
    });
    expect(resolveWorkbenchHash("#/settings/not-a-section")).toEqual({
      kind: "settings-last",
    });
  });

  it("explicit settings section wins and parses PR hub query", () => {
    expect(resolveWorkbenchHash("#/settings/runtime/tools")).toEqual({
      kind: "settings-explicit",
      section: "runtime",
      tab: "tools",
      prNumber: null,
    });
    expect(resolveWorkbenchHash("#/settings/runtime/tools?pr=42")).toEqual({
      kind: "settings-explicit",
      section: "runtime",
      tab: "tools",
      prNumber: 42,
    });
  });
});
