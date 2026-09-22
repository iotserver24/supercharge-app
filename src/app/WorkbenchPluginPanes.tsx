import type { Locale } from "@/i18n";
import { PluginPaneHost } from "@/components/plugin-host";
import type { PluginRoute } from "@/lib/pluginHost/types";
import type { PluginContributionsValue } from "@/providers/PluginContributionsProvider";
import type { WorkbenchPane } from "@/hooks/usePluginPaneState";

export function WorkbenchPluginPanes(props: {
  host: PluginContributionsValue;
  routes: readonly PluginRoute[];
  activeRoute: PluginRoute | null;
  mainPane: WorkbenchPane;
  locale: Locale;
  theme: string;
  onOpenSession: (sessionId: string) => void;
  onToast: (message: string) => void;
}) {
  const {
    host,
    routes,
    activeRoute,
    mainPane,
    locale,
    theme,
    onOpenSession,
    onToast,
  } = props;

  return (
    <>
      {routes.map((route) => {
        const contribution = host.contributions.find(
          (item) => item.id === route.plugin,
        );
        const baseUrl = host.endpoint?.baseUrl ?? "";
        const token = host.endpoint?.tokens[route.plugin] ?? "";
        if (!contribution || !baseUrl || !token) return null;

        return (
          <PluginPaneHost
            key={`${route.plugin}:${route.pane}`}
            contribution={contribution}
            paneId={route.pane}
            baseUrl={baseUrl}
            token={token}
            locale={locale}
            theme={theme}
            tokens={{}}
            hidden={
              mainPane !== "plugin" ||
              activeRoute?.plugin !== route.plugin ||
              activeRoute?.pane !== route.pane
            }
            onOpenSession={onOpenSession}
            onToast={onToast}
          />
        );
      })}
    </>
  );
}
