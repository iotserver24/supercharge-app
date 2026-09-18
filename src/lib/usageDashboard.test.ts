import { describe, expect, it } from "vitest";
import { emptyCounts, localUsageDate, summarizeUsage, type DashboardUsage, type UsageRecord } from "./usageDashboard";
const usage = (totalTokens: number): UsageRecord => ({ ...emptyCounts(), totalTokens, modelCalls: 1, usageIsIncomplete: false, modelUsage: { test: { ...emptyCounts(), totalTokens, modelCalls: 1 } } });
const data: DashboardUsage = { skippedFiles: 0, truncated: false, sessions: [{ sessionId: "s", updatedAt: "2026-09-17T12:00:00Z", session: usage(300), turns: [{ ...usage(100), turnNumber: 1, endedAt: "2026-09-16T12:00:00Z" }, { ...usage(200), turnNumber: 2, endedAt: "2026-09-17T12:00:00Z" }] }] };
describe("usage dashboard", () => {
  it("does not add turn totals on top of session totals", () => {
    const result = summarizeUsage(data, null, new Date("2026-09-17T12:00:00Z"));
    expect(result.totals.totalTokens).toBe(300);
    expect(result.models[0].totalTokens).toBe(300);
    expect(result.calendar.reduce((sum, day) => sum + day.tokens, 0)).toBe(300);
    expect(result.activeDays).toBe(2);
    expect(result.totals.inputTokens).toBeNull();
  });
  it("filters model totals and sessions by actual turn dates", () => {
    const day = localUsageDate(data.sessions[0].turns[0].endedAt)!;
    const result = summarizeUsage(data, { start: day, end: day });
    expect(result.totals.totalTokens).toBe(100);
    expect(result.models[0].totalTokens).toBe(100);
    expect(result.sessions).toHaveLength(1);
  });
  it("deduplicates session roots and never fabricates dates", () => {
    const record = { ...data.sessions[0], turns: [{ ...usage(100), turnNumber: 1, endedAt: "" }] };
    const result = summarizeUsage({ ...data, sessions: [record, record], skippedFiles: 1 });
    expect(result.totals.totalTokens).toBe(300);
    expect(result.undatedTurns).toBe(1);
    expect(result.calendar.every((d) => d.tokens === 0)).toBe(true);
    expect(result.incomplete).toBe(true);
  });
  it("empty or selected empty periods preserve unknown totals", () => {
    expect(summarizeUsage({ ...data, sessions: [] }).totals.totalTokens).toBeNull();
    expect(summarizeUsage(data, { start: "2000-01-01", end: "2000-01-01" }).sessions).toHaveLength(0);
  });
});
