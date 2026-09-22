// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { usePluginPaneState } from "./usePluginPaneState";

const mockContributions = vi.hoisted(() => ({
  current: [] as Array<{
    id: string;
    sidebar: Array<{ id: string; titleEn: string }>;
  }>,
  loading: false,
  booting: false,
}));

vi.mock("@/providers/PluginContributionsProvider", () => ({
  usePluginContributions: () => ({
    contributions: mockContributions.current,
    warns: [],
    endpoint: null,
    loading: mockContributions.loading,
    booting: mockContributions.booting,
    refresh: async () => true,
  }),
}));

describe("usePluginPaneState", () => {
  it("keeps other valid panes when the active plugin disappears", () => {
    mockContributions.current = [
      { id: "one", sidebar: [{ id: "home", titleEn: "One" }] },
      { id: "two", sidebar: [{ id: "home", titleEn: "Two" }] },
    ];
    const setMainPane = vi.fn();
    const secondary = { current: false };
    const { result, rerender } = renderHook(() =>
      usePluginPaneState({
        locale: "en",
        mainPane: "plugin",
        setMainPane,
        isSecondaryWindow: false,
        isSecondaryWindowRef: secondary,
      }),
    );

    act(() => {
      result.current.acceptPluginRoute({ plugin: "two", pane: "home" });
      result.current.acceptPluginRoute({ plugin: "one", pane: "home" });
    });
    expect(result.current.openedPluginRoutes).toHaveLength(2);

    mockContributions.current = [
      { id: "two", sidebar: [{ id: "home", titleEn: "Two" }] },
    ];
    rerender();

    expect(result.current.openedPluginRoutes).toEqual([
      { plugin: "two", pane: "home" },
    ]);
    expect(setMainPane).toHaveBeenCalledWith("chat");
  });

  it("clears a plugin route in a secondary session window", () => {
    mockContributions.current = [
      { id: "one", sidebar: [{ id: "home", titleEn: "One" }] },
    ];
    const setMainPane = vi.fn();
    const secondary = { current: false };
    const { result, rerender } = renderHook(
      ({ isSecondaryWindow }) =>
        usePluginPaneState({
          locale: "en",
          mainPane: "plugin",
          setMainPane,
          isSecondaryWindow,
          isSecondaryWindowRef: secondary,
        }),
      { initialProps: { isSecondaryWindow: false } },
    );

    act(() => {
      result.current.acceptPluginRoute({ plugin: "one", pane: "home" });
    });
    secondary.current = true;
    rerender({ isSecondaryWindow: true });

    expect(result.current.pluginRoute).toBeNull();
    expect(result.current.openedPluginRoutes).toEqual([]);
    expect(setMainPane).toHaveBeenCalledWith("chat");
  });
});
