import { describe, expect, it } from "vitest";
import { activityOverview } from "./activityOverview";
import type { GrokPhaseItem } from "./grokActivitySteps";
import type { MessageToolSegment } from "./session";

const item = (id: string, toolKind: string, extra: Partial<MessageToolSegment> = {}): GrokPhaseItem => ({
  kind: "tool", tool: { kind: "tool", toolCallId: id, toolKind, title: toolKind, status: "completed", ...extra },
});

describe("activityOverview", () => {
  it("groups interleaved operations without discarding distinct repeated commands", () => {
    const items = [item("a", "read_file"), { kind: "thought" as const, text: "Thinking" }, item("b", "bash"), item("c", "read_file"), item("d", "bash")];
    const overview = activityOverview(items);
    expect(overview.groups.map((g) => [g.kind, g.tools.length])).toEqual([["explore", 2], ["commands", 2]]);
    expect(items).toHaveLength(5);
  });
  it("deduplicates repeated event ids and excludes empty think rows from the summary", () => {
    const result = activityOverview([item("a", "read_file"), item("a", "read_file"), item("b", "think")]);
    expect(result.tools).toHaveLength(2);
    expect(result.groups).toHaveLength(1);
    expect(result.latest?.toolCallId).toBe("a");
  });
  it("preserves unknown failed tools and prioritizes an active operation", () => {
    const result = activityOverview([item("a", "bash", { status: "running" }), item("b", "other", { status: "failed", isError: true })]);
    expect(result.failures).toBe(1);
    expect(result.groups.at(-1)?.tools[0]?.toolCallId).toBe("b");
    expect(result.latest?.toolCallId).toBe("a");
  });
});
