/** Provider-neutral per-session token, cache, latency, and cost usage. */

import { useMemo, useState } from "react";
import { UsageDashboard } from "./UsageDashboard";
import { createT, type Locale } from "@/i18n";
import { GlassModal } from "@/components/GlassModal";
import {
  formatApiDuration,
  formatExactTokenCount,
  formatUsdFromTicks,
  hasSessionSpend,
  sessionSpendCacheHitRate,
  type SessionSpend,
} from "@/lib/sessionSpend";

type Props = {
  open: boolean;
  locale: Locale;
  sessionId?: string | null;
  spend: SessionSpend;
  /** True while a turn is in flight — usage lands on turn_completed. */
  turnActive?: boolean;
  onClose: () => void;
};

export function UsageLimitModal({
  open,
  locale,
  sessionId,
  spend,
  turnActive = false,
  onClose,
}: Props) {
  const tr = useMemo(() => createT(locale), [locale]);
  const [view, setView] = useState<"history" | "session">("history");
  const cost = formatUsdFromTicks(spend.costUsdTicks);
  const showSpend = hasSessionSpend(spend);
  const cacheRate = sessionSpendCacheHitRate(spend);

  return (
    <GlassModal
      open={open}
      onClose={onClose}
      title={tr("usageDashboard.title")}
      titleId="usage-limit-modal-title"
      closeLabel={tr("common.close")}
      size="lg"
      className="usage-limit-modal"
      wrapBody
      bodyClassName="usage-limit-modal__body"
      footer={
        <button type="button" className="btn btn--solid" onClick={onClose}>
          {tr("common.close")}
        </button>
      }
    >
      <div className="usage-dashboard__switch" role="group" aria-label={tr("usageDashboard.title")}>
        <button type="button" aria-pressed={view === "history"} onClick={() => setView("history")}>{tr("usageDashboard.title")}</button>
        <button type="button" aria-pressed={view === "session"} onClick={() => setView("session")}>{tr("usageModal.sessionTitle")}</button>
      </div>
      {view === "history" ? (open ? <UsageDashboard locale={locale} /> : null) : (
      <section className="usage-limit-modal__section" aria-labelledby="usage-session-title">
        <h3 id="usage-session-title" className="usage-limit-modal__h">
          {tr("usageModal.sessionTitle")}
        </h3>
        {!sessionId ? (
          <p className="usage-limit-modal__note">{tr("usageModal.noSession")}</p>
        ) : !showSpend ? (
          <p className="usage-limit-modal__note">
            {turnActive
              ? tr("usageModal.pendingTurn")
              : tr("usageModal.noCalls")}
          </p>
        ) : (
          <dl className="usage-limit-modal__dl">
            <div className="usage-limit-modal__row">
              <dt>{tr("usageModal.input")}</dt>
              <dd>
                {formatExactTokenCount(spend.inputTokens, locale)}
                {spend.cachedReadTokens > 0
                  ? ` ${tr("usageModal.cached", {
                      count: formatExactTokenCount(
                        spend.cachedReadTokens,
                        locale,
                      ),
                    })}`
                  : ""}
              </dd>
            </div>
            <div className="usage-limit-modal__row">
              <dt>{tr("usageModal.output")}</dt>
              <dd>
                {formatExactTokenCount(spend.outputTokens, locale)}
                {spend.reasoningTokens > 0
                  ? ` ${tr("usageModal.reasoning", {
                      count: formatExactTokenCount(
                        spend.reasoningTokens,
                        locale,
                      ),
                    })}`
                  : ""}
              </dd>
            </div>
            <div className="usage-limit-modal__row">
              <dt>{tr("usageModal.total")}</dt>
              <dd>{formatExactTokenCount(spend.totalTokens, locale)}</dd>
            </div>
            <div className="usage-limit-modal__row">
              <dt>{tr("usageModal.cacheHit")}</dt>
              <dd>{cacheRate != null ? `${cacheRate}%` : "—"}</dd>
            </div>
            <div className="usage-limit-modal__row">
              <dt>{tr("usageModal.modelCalls")}</dt>
              <dd>
                {formatExactTokenCount(spend.modelCalls, locale)}
                <span className="usage-limit-modal__sep"> · </span>
                <span className="usage-limit-modal__k">
                  {tr("usageModal.apiTime")}
                </span>{" "}
                {formatApiDuration(spend.apiDurationMs)}
              </dd>
            </div>
            <div className="usage-limit-modal__row">
              <dt>{tr("usageModal.cost")}</dt>
              <dd>{cost ?? "—"}</dd>
            </div>
          </dl>
        )}
        {showSpend && spend.usageIsIncomplete ? (
          <p className="usage-limit-modal__note">{tr("usageModal.incomplete")}</p>
        ) : null}
        {showSpend && spend.costIsPartial ? (
          <p className="usage-limit-modal__note">{tr("usageModal.costPartial")}</p>
        ) : null}
      </section>)}
    </GlassModal>
  );
}
