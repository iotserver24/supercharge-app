import type { HeatmapDay } from "./api/account";
import type { HeatRange } from "./heatmapRange";
import { dateInHeatRange } from "./heatmapRange";

export type UsageCounts = {
  inputTokens: number | null;
  outputTokens: number | null;
  cachedReadTokens: number | null;
  totalTokens: number | null;
  modelCalls: number | null;
};
export type UsageRecord = UsageCounts & { modelUsage: Record<string, UsageCounts>; usageIsIncomplete: boolean };
export type RecordedSession = { sessionId: string; updatedAt: string; session: UsageRecord; turns: (UsageRecord & { turnNumber: number; endedAt: string })[] };
export type DashboardUsage = { sessions: RecordedSession[]; skippedFiles: number; truncated: boolean };
const fields = ["inputTokens", "outputTokens", "cachedReadTokens", "totalTokens", "modelCalls"] as const;
export function emptyCounts(): UsageCounts {
  return { inputTokens: null, outputTokens: null, cachedReadTokens: null, totalTokens: null, modelCalls: null };
}
function add(target: UsageCounts, row: UsageCounts) {
  for (const key of fields) {
    const value = row[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) target[key] = (target[key] ?? 0) + value;
  }
}
export function localUsageDate(iso: string): string | null {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function summarizeUsage(data: DashboardUsage, range: HeatRange | null = null, now = new Date()) {
  const totals = emptyCounts();
  const models = new Map<string, UsageCounts>();
  const days = new Map<string, HeatmapDay>();
  const sessions: RecordedSession[] = [];
  let incomplete = data.truncated || data.skippedFiles > 0;
  let undatedTurns = 0;
  let missingDailyUsage = false;
  const seen = new Set<string>();
  for (const session of data.sessions) {
    if (seen.has(session.sessionId)) continue;
    seen.add(session.sessionId);
    if (!session.turns.length && (session.session.totalTokens ?? 0) > 0) missingDailyUsage = true;
    const turnNumbers = new Set<number>();
    const turns = session.turns.filter((turn) => {
      if (turnNumbers.has(turn.turnNumber)) { incomplete = true; return false; }
      turnNumbers.add(turn.turnNumber);
      if (turn.totalTokens == null) missingDailyUsage = true;
      const day = localUsageDate(turn.endedAt);
      if (!day) { undatedTurns += 1; return false; }
      const entry = days.get(day) ?? { date: day, tokens: 0, requests: 0, costUsd: 0 };
      if (turn.totalTokens != null) entry.tokens += Math.max(0, turn.totalTokens);
      entry.requests += 1;
      days.set(day, entry);
      return !range || dateInHeatRange(day, range);
    });
    const rows = range ? turns : [session.session];
    if (rows.length) sessions.push(session);
    for (const row of rows) {
      add(totals, row);
      incomplete ||= row.usageIsIncomplete;
      for (const [name, counts] of Object.entries(row.modelUsage ?? {})) {
        const model = models.get(name) ?? emptyCounts();
        add(model, counts);
        models.set(name, model);
      }
    }
  }
  const calendar: HeatmapDay[] = [];
  for (let offset = 370; offset >= 0; offset--) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset, 12);
    const key = localUsageDate(date.toISOString())!;
    calendar.push(days.get(key) ?? { date: key, tokens: 0, requests: 0, costUsd: 0 });
  }
  const selectedDays = calendar.filter((day) => !range || dateInHeatRange(day.date, range));
  return { totals, models: [...models].map(([name, counts]) => ({ name, ...counts })).sort((a, b) => (b.totalTokens ?? 0) - (a.totalTokens ?? 0)), calendar, sessions: sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), incomplete: incomplete || missingDailyUsage, undatedTurns,
    activeDays: selectedDays.filter((d) => d.requests > 0).length,
    peakTokens: missingDailyUsage || undatedTurns > 0 || !data.sessions.length ? null : Math.max(0, ...selectedDays.map((d) => d.tokens)),
  };
}
