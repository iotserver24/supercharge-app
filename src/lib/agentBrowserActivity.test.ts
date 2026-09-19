import { describe, expect, it } from "vitest";
import { agentBrowserTarget } from "./agentBrowserActivity";
import { applySideContextOpen } from "./sideContextOpen";
import { emptySideWorkbenchState, openSideTab } from "./sideWorkbench";

const sessionId = "8574f886-b64d-48e3-b404-8300f023e4bc";
const activity = {
  sessionId,
  tabId: `agent_${sessionId}`,
  url: "https://example.com/",
  phase: "active",
};

describe("visible agent browser", () => {
  it("opens the exact native browser tab owned by the viewed session", () => {
    const target = agentBrowserTarget(activity, sessionId);
    expect(target).toEqual({ type: "url", url: activity.url, browserTabId: activity.tabId });
    const next = applySideContextOpen(emptySideWorkbenchState(), target!);
    expect(next.state.activeId).toBe(activity.tabId);
    expect(next.needAsideOpen).toBe(true);
  });

  it("does not steal focus for background sessions or idle updates", () => {
    expect(agentBrowserTarget(activity, "other")).toBeNull();
    expect(agentBrowserTarget(activity, null)).toBeNull();
    expect(agentBrowserTarget({ ...activity, phase: "idle" }, sessionId)).toBeNull();
  });

  it("rejects mismatched tabs and non-page URLs", () => {
    expect(agentBrowserTarget({ ...activity, tabId: "main" }, sessionId)).toBeNull();
    expect(agentBrowserTarget({ ...activity, url: "javascript:alert(1)" }, sessionId)).toBeNull();
  });

  it("does not confuse an agent tab with a user's tab on the same URL", () => {
    const manual = openSideTab(emptySideWorkbenchState(), "browser", { id: "manual", url: activity.url });
    const next = applySideContextOpen(manual, agentBrowserTarget(activity, sessionId)!);
    expect(next.state.activeId).toBe(activity.tabId);
    expect(next.state.tabs).toHaveLength(2);
  });

  it("updates the existing agent tab on navigation instead of multiplying tabs", () => {
    const first = applySideContextOpen(emptySideWorkbenchState(), agentBrowserTarget(activity, sessionId)!);
    const next = applySideContextOpen(first.state, agentBrowserTarget({ ...activity, url: "https://example.com/next" }, sessionId)!);
    expect(next.state.tabs).toHaveLength(1);
    expect(next.state.tabs[0]).toMatchObject({ id: activity.tabId, url: "https://example.com/next" });
  });
});
