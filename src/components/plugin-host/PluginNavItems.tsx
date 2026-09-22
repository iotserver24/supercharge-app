import type { Locale } from "@/i18n";
import type { PluginContribution } from "@/lib/api/pluginHost";

type Props = {
  contributions: PluginContribution[];
  locale: Locale;
  /** Only the visible workbench plugin pane; omit when mainPane !== "plugin". */
  activePlugin?: string | null;
  activePane?: string | null;
  onOpen: (plugin: string, pane: string) => void;
};

export function pluginSidebarTitle(
  pane: PluginContribution["sidebar"][number],
  locale: Locale,
): string {
  if (locale === "zh" && pane.titleZh) return pane.titleZh;
  if (locale === "zh-TW" && pane.titleZhTw) return pane.titleZhTw;
  return pane.titleEn;
}

/** Nav highlight follows the visible pane, not a leftover pluginRoute. */
export function isPluginNavActive(
  mainIsPlugin: boolean,
  route: { plugin: string; pane: string } | null | undefined,
  plugin: string,
  pane: string,
): boolean {
  return (
    mainIsPlugin && route?.plugin === plugin && route?.pane === pane
  );
}

export function PluginNavItems({
  contributions,
  locale,
  activePlugin,
  activePane,
  onOpen,
}: Props) {
  const nav = contributions.flatMap((c) =>
    c.sidebar.map((s) => ({ plugin: c.id, pane: s })),
  );
  if (!nav.length) return null;
  return (
    <>
      {nav.map(({ plugin, pane }) => {
        const active =
          !!activePlugin &&
          !!activePane &&
          isPluginNavActive(
            true,
            { plugin: activePlugin, pane: activePane },
            plugin,
            pane.id,
          );
        return (
          <button
            key={`${plugin}:${pane.id}`}
            type="button"
            className={"nav-item" + (active ? " nav-item--active" : "")}
            onClick={() => onOpen(plugin, pane.id)}
          >
            <span className="nav-item__icon" aria-hidden>
              ◆
            </span>
            {pluginSidebarTitle(pane, locale)}
          </button>
        );
      })}
    </>
  );
}
