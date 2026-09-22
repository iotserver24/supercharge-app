import {
  useCallback,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { PluginRoute } from "@/lib/pluginHost/types";
import type { WorkbenchPane } from "@/hooks/usePluginPaneState";

export function useWorkbenchPaneNavigation(input: {
  closeSettings: () => void;
  setMainPane: Dispatch<SetStateAction<WorkbenchPane>>;
  setShowUserMenu: Dispatch<SetStateAction<boolean>>;
  navigatePluginPane: (route: PluginRoute) => void;
}) {
  const {
    closeSettings,
    setMainPane,
    setShowUserMenu,
    navigatePluginPane,
  } = input;

  const navigateWorkbench = useCallback(() => {
    closeSettings();
    setMainPane("chat");
  }, [closeSettings, setMainPane]);

  const navigateAutomations = useCallback(() => {
    closeSettings();
    setMainPane("automations");
    setShowUserMenu(false);
    if (typeof window !== "undefined") {
      window.location.hash = "#/automations";
    }
  }, [closeSettings, setMainPane, setShowUserMenu]);

  const navigateKanban = useCallback(() => {
    closeSettings();
    setMainPane("kanban");
    setShowUserMenu(false);
    if (typeof window !== "undefined") {
      window.location.hash = "#/kanban";
    }
  }, [closeSettings, setMainPane, setShowUserMenu]);

  const navigatePlugin = useCallback(
    (route: PluginRoute) => {
      closeSettings();
      setShowUserMenu(false);
      navigatePluginPane(route);
    },
    [closeSettings, navigatePluginPane, setShowUserMenu],
  );

  return {
    navigateWorkbench,
    navigateAutomations,
    navigateKanban,
    navigatePlugin,
  };
}
