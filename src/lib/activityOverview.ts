import type { MessageToolSegment } from "./session";
import { classifyToolKind } from "./toolDisplay";
import { toolFailed, type GrokPhaseItem } from "./grokActivitySteps";

export type ActivityGroupKind = "explore" | "commands" | "changes" | "agents" | "other";
export type ActivityGroup = { kind: ActivityGroupKind; tools: MessageToolSegment[] };

export function activityGroupKind(tool: MessageToolSegment): ActivityGroupKind {
  switch (classifyToolKind(tool.toolKind, tool.title, tool.toolCallId)) {
    case "read":
    case "search":
    case "browse": return "explore";
    case "bash": return "commands";
    case "edit": return "changes";
    case "subagent": return "agents";
    default: return "other";
  }
}

export function isActivityNoise(tool: MessageToolSegment): boolean {
  return !toolFailed(tool) && /^(think|thinking|other)?$/i.test((tool.title || tool.toolKind || "").trim()) && !tool.input && !tool.path;
}

export function activityOverview(items: GrokPhaseItem[]) {
  const groups: ActivityGroup[] = [];
  const seen = new Set<string>();
  const tools: MessageToolSegment[] = [];
  for (const item of items) {
    if (item.kind !== "tool") continue;
    const tool = item.tool;
    if (tool.toolCallId && seen.has(tool.toolCallId)) continue;
    if (tool.toolCallId) seen.add(tool.toolCallId);
    tools.push(tool);
    if (isActivityNoise(tool)) continue;
    const kind = activityGroupKind(tool);
    let group = groups.find((entry) => entry.kind === kind);
    if (!group) {
      group = { kind, tools: [] };
      groups.push(group);
    }
    group.tools.push(tool);
  }
  const meaningful = tools.filter((tool) => !isActivityNoise(tool));
  const latest = [...meaningful].reverse().find((tool) => tool.streaming || /^(running|pending|in_progress)$/.test(tool.status || "")) ?? meaningful.at(-1);
  return { groups, tools, latest, failures: tools.filter(toolFailed).length };
}
