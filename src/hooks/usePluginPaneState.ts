import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { Locale } from "@/i18n";
import { buildPluginHash } from "@/lib/pluginHost/hash";
import { pluginSidebarTitle } from "@/components/plugin-host";
import type { PluginRoute } from "@/lib/pluginHost/types";
import type { WorkbenchHashPane } from "@/lib/workbenchHash";
import { usePluginContributions } from "@/providers/PluginContributionsProvider";

export type WorkbenchPane = WorkbenchHashPane;

function containsRoute(routes: readonly PluginRoute[], route: PluginRoute): boolean {
  return routes.some(
    (item) => item.plugin === route.plugin && item.pane === route.pane,
  );
}

export function usePluginPaneState(input: {
  locale: Locale;
  mainPane: WorkbenchPane;
  setMainPane: Dispatch<SetStateAction<WorkbenchPane>>;
  isSecondaryWindow: boolean;
  isSecondaryWindowRef: MutableRefObject<boolean>;
}) {
  const {
    locale,
    mainPane,
    setMainPane,
    isSecondaryWindow,
    isSecondaryWindowRef,
  } = input;
  const pluginHost = usePluginContributions();
  const [pluginRoute, setPluginRoute] = useState<PluginRoute | null>(null);
  const [openedPluginRoutes, setOpenedPluginRoutes] = useState<PluginRoute[]>([]);

  const rememberRoute = useCallback((route: PluginRoute) => {
    setOpenedPluginRoutes((previous) =>
      containsRoute(previous, route) ? previous : [...previous, route],
    );
  }, []);

  const acceptPluginRoute = useCallback(
    (route: PluginRoute) => {
      if (isSecondaryWindowRef.current) return;
      setPluginRoute(route);
      rememberRoute(route);
    },
    [isSecondaryWindowRef, rememberRoute],
  );

  const navigatePlugin = useCallback(
    (route: PluginRoute) => {
      if (isSecondaryWindowRef.current) return;
      acceptPluginRoute(route);
      setMainPane("plugin");
      const hash = buildPluginHash(route);
      if (hash && typeof window !== "undefined" && window.location.hash !== hash) {
        window.location.hash = hash;
      }
    },
    [acceptPluginRoute, isSecondaryWindowRef, setMainPane],
  );

  useEffect(() => {
    if (pluginHost.loading || pluginHost.booting) return;
    const isAvailable = (route: PluginRoute) =>
      pluginHost.contributions.some(
        (item) =>
          item.id === route.plugin &&
          item.sidebar.some((pane) => pane.id === route.pane),
      );

    if (pluginRoute && !isAvailable(pluginRoute)) {
      setPluginRoute(null);
      setOpenedPluginRoutes((routes) => routes.filter(isAvailable));
      if (mainPane === "plugin") {
        setMainPane("chat");
        if (typeof window !== "undefined" && window.location.hash.startsWith("#/plugin/")) {
          window.history.replaceState(
            null,
            "",
            `${window.location.pathname}${window.location.search}#/workbench`,
          );
        }
      }
      return;
    }

    setOpenedPluginRoutes((routes) => routes.filter(isAvailable));
  }, [
    mainPane,
    pluginHost.booting,
    pluginHost.contributions,
    pluginHost.loading,
    pluginRoute,
    setMainPane,
  ]);

  useEffect(() => {
    if (!isSecondaryWindow) return;
    setPluginRoute(null);
    setOpenedPluginRoutes([]);
    if (mainPane === "plugin") setMainPane("chat");
    if (typeof window !== "undefined" && window.location.hash.startsWith("#/plugin/")) {
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${window.location.search}#/workbench`,
      );
    }
  }, [isSecondaryWindow, mainPane, setMainPane]);

  const activePluginTitle = useMemo(() => {
    if (!pluginRoute) return null;
    const pane = pluginHost.contributions
      .find((item) => item.id === pluginRoute.plugin)
      ?.sidebar.find((item) => item.id === pluginRoute.pane);
    return pane ? pluginSidebarTitle(pane, locale) : null;
  }, [locale, pluginHost.contributions, pluginRoute]);

  return {
    pluginHost,
    pluginRoute,
    openedPluginRoutes,
    activePluginTitle,
    acceptPluginRoute,
    navigatePlugin,
  };
}
