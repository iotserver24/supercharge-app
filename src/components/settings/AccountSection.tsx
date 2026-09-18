/** Settings → providers. */
import { ProvidersPanel } from "@/components/ProvidersPanel";
import { resolveLocale } from "@/i18n";
import { useSettingsModel } from "@/providers/SettingsModelContext";

export function AccountSection() {
  const {
    locale,
    onProviderActivated,
    onProvidersChanged,
    onProviderBalanceLoaded,
  } = useSettingsModel();

  return (
    <div id="settings-anchor-account-providers">
      <ProvidersPanel
        locale={resolveLocale(locale)}
        onProvidersChanged={onProvidersChanged}
        onProviderActivated={onProviderActivated}
        onBalanceLoaded={onProviderBalanceLoaded}
      />
    </div>
  );
}
