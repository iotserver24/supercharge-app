import { createT, type Locale, type MessageKey } from "@/i18n";
import { resolvePluginCatalogEmptyState, type PluginCatalogEmptyInput } from "@/lib/pluginMarketPro";

export function PluginMarketplaceCatalogStatus({ locale, input, onRetry, onClear, onOpenRuntime }: {
  locale: Locale;
  input: PluginCatalogEmptyInput;
  onRetry: () => void;
  onClear: () => void;
  onOpenRuntime?: () => void;
}) {
  const tr = createT(locale);
  const state = resolvePluginCatalogEmptyState(input);
  if (!state && !input.error) return null;
  const runtime = state?.retryAction === "open_runtime" || state?.retryAction === "update_cli";
  const clear = state?.retryAction === "clear_filter";
  const action = runtime ? onOpenRuntime : clear ? onClear : onRetry;
  const label = runtime ? "ext.error.openRuntime" : clear ? "ext.market.clearFilters" : "ext.market.retry";
  return (
    <div className={input.error ? "ext-alert ext-alert--warn" : "ext-ref-empty"} role="status" aria-live="polite">
      {state ? <p className="ext-alert__title">{tr(state.titleKey as MessageKey)}</p> : null}
      {state?.hintKey ? <p className="ext-alert__body">{tr(state.hintKey as MessageKey)}</p> : null}
      {input.error ? <p className="ext-alert__body">{String(input.error)}</p> : null}
      {state?.retryAction !== "none" && action ? (
        <button type="button" className="btn btn--ghost btn--sm" disabled={input.loading} onClick={action}>
          {tr(label)}
        </button>
      ) : null}
    </div>
  );
}
