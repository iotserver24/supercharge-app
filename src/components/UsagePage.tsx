import { createT, type Locale } from "@/i18n";
import { IconArrowLeft } from "./icons";
import { UsageDashboard } from "./UsageDashboard";
import "./usage-page.css";

export function UsagePage({ locale }: { locale: Locale }) {
  const tr = createT(locale);
  return (
    <div className="usage-page" data-testid="usage-page">
      <button type="button" className="btn btn--ghost usage-page__back" onClick={() => { window.location.hash = "#/home"; }}>
        <IconArrowLeft size={16} />{tr("settings.backToApp")}
      </button>
      <UsageDashboard locale={locale} />
    </div>
  );
}
