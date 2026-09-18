/**
 * Minimal local CLI account snapshot used by workbench features that still
 * need to know whether the detected CLI already has authentication.
 *
 * Direct login/logout, quota, subscription, and saved-account management are
 * intentionally not exposed by the app chrome. Provider configuration lives
 * in Settings and the CLI's own `/setup` flow remains the fallback.
 */
import {
  useCallback,
  useEffect,
  useState,
  type MutableRefObject,
} from "react";
import * as api from "@/lib/api";
import { isAccountConnected } from "@/lib/accountUi";

export type AccountQuotaChromeHost = {
  noteAccountConnected: (next: { auth: boolean; cliFound: boolean }) => void;
};

function emptyHost(): AccountQuotaChromeHost {
  const noop = () => {};
  return {
    noteAccountConnected: noop,
  };
}

export function createAccountQuotaChromeHost(): AccountQuotaChromeHost {
  return emptyHost();
}

export function useAccountQuotaChrome(opts: {
  hostRef: MutableRefObject<AccountQuotaChromeHost>;
  manualCliPath: string | null | undefined;
}) {
  const hostRef = opts.hostRef;
  const manualCliPath = opts.manualCliPath ?? null;

  const [account, setAccount] = useState<api.AccountStatus | null>(null);

  const applyAccountSnapshot = useCallback((st: api.AccountStatus | null) => {
    if (st) setAccount(st);
  }, []);

  const refreshAccount = useCallback(
    async (refreshOpts?: {
      refreshBilling?: boolean;
      quiet?: boolean;
      includeLocalUsage?: boolean;
      isCurrent?: () => boolean;
    }) => {
      if (!api.isTauri()) return;
      try {
        const st = await api.accountStatus({
          // The app no longer presents official quota. Keep the default probe
          // local-only unless a remaining legacy caller explicitly asks.
          refreshBilling: refreshOpts?.refreshBilling ?? false,
          includeLocalUsage: refreshOpts?.includeLocalUsage ?? true,
          manualCliPath: manualCliPath || null,
        });
        if (refreshOpts?.isCurrent && !refreshOpts.isCurrent()) return;
        setAccount(st);
        hostRef.current.noteAccountConnected({
          auth: isAccountConnected(st),
          cliFound: !!st?.cliFound,
        });
        void api.trayRefresh();
      } catch (e) {
        if (refreshOpts?.isCurrent && !refreshOpts.isCurrent()) return;
        console.warn("account status failed", e);
      }
    },
    [hostRef, manualCliPath],
  );

  useEffect(() => {
    if (!api.isTauri()) return;
    let cancelled = false;
    void refreshAccount({
      refreshBilling: false,
      isCurrent: () => !cancelled,
    });
    return () => {
      cancelled = true;
    };
  }, [refreshAccount]);

  return {
    account,
    applyAccountSnapshot,
    refreshAccount,
  };
}
