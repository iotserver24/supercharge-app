import { useEffect, useMemo, useState } from "react";
import { createT, intlLocale, type Locale } from "@/i18n";
import { invoke } from "@/lib/api/host";
import { localUsageDate, summarizeUsage, type DashboardUsage, type UsageCounts } from "@/lib/usageDashboard";
import { Heatmap, type HeatGranularity, type HeatRange } from "./Heatmap";
import "./usage-dashboard.css";

export function UsageDashboard({ locale }: { locale: Locale }) {
  const tr = useMemo(() => createT(locale), [locale]);
  const [data, setData] = useState<DashboardUsage | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [range, setRange] = useState<HeatRange | null>(null);
  const [granularity, setGranularity] = useState<HeatGranularity>("day");
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    invoke<DashboardUsage>("usage_dashboard").then((next) => {
      if (!cancelled) setData(next);
    }).catch(() => { if (!cancelled) setError(true); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [revision]);
  const view = useMemo(() => data ? summarizeUsage(data, range) : null, [data, range]);
  const count = (value: number | null | undefined) => value == null ? tr("usageDashboard.unknown") : new Intl.NumberFormat(intlLocale(locale)).format(value);
  const compact = (value: number | null | undefined) => value == null ? tr("usageDashboard.unknown") : new Intl.NumberFormat(intlLocale(locale), { notation: "compact", maximumFractionDigits: 1 }).format(value);
  const metrics = view ? [
    [tr("usageDashboard.recorded"), compact(view.totals.totalTokens)],
    [tr("account.heatmap.stat.peak"), compact(view.peakTokens)],
    [tr("usageDashboard.active"), count(view.activeDays)],
    [tr("usageDashboard.sessions"), count(view.sessions.length)],
  ] : [];
  const columns: [keyof UsageCounts, string][] = [["inputTokens", tr("usageModal.input")], ["outputTokens", tr("usageModal.output")], ["cachedReadTokens", tr("usageDashboard.cache")], ["modelCalls", tr("usageModal.modelCalls")], ["totalTokens", tr("usageModal.total")]];
  return (
    <section className="usage-dashboard" aria-label={tr("usageDashboard.title")} aria-busy={loading}>
      <header className="usage-dashboard__header">
        <div><h2>{tr("usageDashboard.title")}</h2><p>{tr("usageDashboard.scope")}</p></div>
        <button type="button" className="btn btn--ghost" disabled={loading} onClick={() => setRevision((v) => v + 1)}>{tr(loading ? "account.refreshing" : "usageDashboard.refresh")}</button>
      </header>
      {error ? <p role="alert">{tr("account.heatmap.err.otherHint")}</p> : null}
      {loading && !data ? <p role="status">{tr("account.heatmap.loading")}</p> : null}
      {view ? <>
        <dl className="usage-dashboard__metrics">{metrics.map(([label, value]) => <div key={label}><dd>{value}</dd><dt>{label}</dt></div>)}</dl>
        {view.incomplete || view.undatedTurns > 0 ? <p className="usage-dashboard__note">{tr("usageDashboard.partial")}</p> : null}
        <div className="usage-dashboard__heat-header"><h3>{tr("account.heatmap")}</h3><div className="usage-dashboard__switch" role="group" aria-label={tr("account.heatmap")}>
          {(["day", "week", "cumulative"] as const).map((mode) => <button type="button" key={mode} aria-pressed={granularity === mode} onClick={() => setGranularity(mode)}>{tr(`account.heatmap.${mode}`)}</button>)}
        </div></div>
        <Heatmap days={view.calendar} locale={locale} granularity={granularity} selectedRange={range} onSelectRange={setRange} labels={{ less: tr("account.heatmap.less"), more: tr("account.heatmap.more"), noData: tr("account.heatmap.noData"), noDataHint: tr("usageDashboard.scope"), aria: tr("account.heatmap.aria"), requests: tr("usageDashboard.turns"), tokens: tr("usageDashboard.recorded"), cumulative: tr("account.heatmap.cumulative") }} />
        {range ? <button type="button" className="btn btn--ghost" onClick={() => setRange(null)}>{range.start} – {range.end} · {tr("account.callLogs.clearDay")}</button> : null}
        <h3>{tr("usageDashboard.models")}</h3>
        {view.models.length ? <div className="usage-dashboard__table-wrap"><table><thead><tr><th>{tr("usageDashboard.models")}</th>{columns.map(([key, label]) => <th key={key}>{label}</th>)}</tr></thead><tbody>
          {view.models.map((model) => <tr key={model.name}><th scope="row">{model.name}</th>{columns.map(([key]) => <td key={key}>{count(model[key])}</td>)}</tr>)}
        </tbody></table></div> : <p>{tr("usageDashboard.unknown")}</p>}
        <p className="usage-dashboard__note">{tr("usageDashboard.providerNote")}</p>
        <details className="usage-dashboard__sessions"><summary>{tr("account.callLogs")} · {view.sessions.length}</summary><ul>{view.sessions.slice(0, 100).map((session) => <li key={session.sessionId}><code>{session.sessionId}</code><span>{range ? count(session.turns.filter((turn) => { const day = localUsageDate(turn.endedAt); return day != null && day >= range.start && day <= range.end; }).length) + " " + tr("usageDashboard.turns") : compact(session.session.totalTokens)}</span></li>)}</ul></details>
      </> : null}
    </section>
  );
}
