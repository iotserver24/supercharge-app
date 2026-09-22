import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import * as api from "@/lib/api";
import type {
  PluginContribution,
  PluginHostWarn,
} from "@/lib/api/pluginHost";

export type PluginHostEndpoint = {
  baseUrl: string;
  tokens: Record<string, string>;
};

export const PLUGIN_HOST_REFRESH_EVENT = "supercharge-plugin-host-refresh";

export function requestPluginHostRefresh() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(PLUGIN_HOST_REFRESH_EVENT));
}

export type PluginContributionsValue = {
  contributions: PluginContribution[];
  warns: PluginHostWarn[];
  endpoint: PluginHostEndpoint | null;
  loading: boolean;
  booting: boolean;
  refresh: () => Promise<boolean>;
};

const PluginContributionsContext =
  createContext<PluginContributionsValue | null>(null);

export function PluginContributionsProvider({ children }: { children: ReactNode }) {
  const [contributions, setContributions] = useState<PluginContribution[]>([]);
  const [warns, setWarns] = useState<PluginHostWarn[]>([]);
  const [endpoint, setEndpoint] = useState<PluginHostEndpoint | null>(null);
  const [loading, setLoading] = useState(() => api.isDesktopHost());
  const [booting, setBooting] = useState(() => api.isDesktopHost());

  const refresh = useCallback(async (): Promise<boolean> => {
    if (!api.isDesktopHost()) {
      setContributions([]);
      setWarns([]);
      setEndpoint(null);
      setLoading(false);
      return true;
    }
    setLoading(true);
    try {
      const list = await api.pluginContributionsList();
      const ep = await api.pluginUiEndpoint();
      const nextContributions = Array.isArray(list?.contributions)
        ? list.contributions
        : [];
      const nextWarns = Array.isArray(list?.warns) ? list.warns : [];
      if (list.authoritative !== false) {
        setContributions(nextContributions);
      }
      setWarns(nextWarns);
      if (ep?.baseUrl) {
        setEndpoint({ baseUrl: ep.baseUrl, tokens: ep.tokens ?? {} });
      }
      return true;
    } catch {
      // Keep last-good contributions so a slow/failed rescan cannot
      // unmount a live iframe or clear sidebar highlight.
      setWarns([]);
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let disposed = false;
    let retry: number | null = null;
    void refresh().then((ready) => {
      if (disposed) return;
      if (ready || !api.isDesktopHost()) {
        setBooting(false);
        return;
      }
      retry = window.setTimeout(async () => {
        await refresh();
        if (!disposed) setBooting(false);
      }, 750);
    });
    const onRefresh = () => {
      void refresh();
    };
    window.addEventListener(PLUGIN_HOST_REFRESH_EVENT, onRefresh);
    window.addEventListener("focus", onRefresh);
    return () => {
      disposed = true;
      if (retry != null) window.clearTimeout(retry);
      window.removeEventListener(PLUGIN_HOST_REFRESH_EVENT, onRefresh);
      window.removeEventListener("focus", onRefresh);
    };
  }, [refresh]);

  const value = useMemo(
    () => ({ contributions, warns, endpoint, loading, booting, refresh }),
    [contributions, warns, endpoint, loading, booting, refresh],
  );

  return (
    <PluginContributionsContext.Provider value={value}>
      {children}
    </PluginContributionsContext.Provider>
  );
}

export function usePluginContributions(): PluginContributionsValue {
  const ctx = useContext(PluginContributionsContext);
  if (!ctx) {
    return {
      contributions: [],
      warns: [],
      endpoint: null,
      loading: false,
      booting: false,
      refresh: async () => true,
    };
  }
  return ctx;
}
