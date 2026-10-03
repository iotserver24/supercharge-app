import { createT, type Locale } from "@/i18n";
import { ExtensionsPanel } from "./ExtensionsPanel";
import { IconArrowLeft, IconPlug, IconSettings, IconSkills } from "./icons";
import "./plugin-marketplace-page.css";

export function PluginMarketplacePage({ locale, projectPath = null, cliFound = true }: {
  locale: Locale;
  projectPath?: string | null;
  cliFound?: boolean;
}) {
  const tr = createT(locale);
  const openSettings = (tab: string) => { window.location.hash = `#/settings/extensions/${tab}`; };
  return (
    <div className="plugin-marketplace-page" data-testid="plugin-marketplace-page">
      <div className="plugin-marketplace-page__content">
        <button type="button" className="btn btn--ghost" onClick={() => { window.location.hash = "#/home"; }}>
          <IconArrowLeft size={16} />{tr("settings.backToApp")}
        </button>
        <header className="plugin-marketplace-page__header">
          <h2>{tr("localMarketplace.title")}</h2>
          <p>{tr("localMarketplace.subtitle")}</p>
          <nav className="plugin-marketplace-page__management" aria-label={tr("localMarketplace.manage")}>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => openSettings("plugins")}>
              <IconSettings size={15} />{tr("localMarketplace.manage")}
            </button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => openSettings("mcp")}>
              <IconPlug size={15} />{tr("ext.mcp.title")}
            </button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => openSettings("skills")}>
              <IconSkills size={15} />{tr("ext.skills.title")}
            </button>
          </nav>
        </header>
        <ExtensionsPanel
          locale={locale}
          projectPath={projectPath}
          cliFound={cliFound}
          presentation="marketplace"
          activeTab="plugins"
          onOpenRuntime={() => { window.location.hash = "#/settings/runtime/cli"; }}
        />
      </div>
    </div>
  );
}
