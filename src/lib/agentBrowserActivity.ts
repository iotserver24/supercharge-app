import type { ResourceOpenTarget } from "@/components/resource-viewer/types";

export type AgentBrowserActivity = {
  sessionId?: string;
  tabId?: string;
  url?: string;
  action?: string;
  phase?: string;
};

export function agentBrowserTarget(
  activity: AgentBrowserActivity,
  viewingSessionId: string | null,
): ResourceOpenTarget | null {
  if (!viewingSessionId || activity.sessionId !== viewingSessionId || activity.phase !== "active") {
    return null;
  }
  if (activity.tabId !== `agent_${viewingSessionId}` || !activity.url) return null;
  try {
    const url = new URL(activity.url);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    return { type: "url", url: url.href, browserTabId: activity.tabId };
  } catch {
    return null;
  }
}
