/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import * as api from "@/lib/api";
import {
  createAccountQuotaChromeHost,
  useAccountQuotaChrome,
} from "./useAccountQuotaChrome";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    isTauri: vi.fn(() => false),
    accountStatus: vi.fn(),
    trayRefresh: vi.fn(async () => {}),
  };
});

function signedOutStatus(): api.AccountStatus {
  return {
    profile: {
      signedIn: false,
      authMode: null,
      email: null,
      displayName: null,
      userId: null,
      teamId: null,
      principalType: null,
      expiresAt: null,
      expired: false,
      hasRefresh: false,
      oidcIssuer: null,
    },
    hasOfficialKey: false,
    hasRelayKey: false,
    relayBaseUrl: null,
    cliAuthPresent: false,
    cliFound: true,
    cliPath: "/cli",
    channel: "none",
    billing: {
      available: false,
      source: "test",
      message: null,
      subscriptionTier: null,
      creditUsagePercent: null,
      remainingPercent: null,
      monthlyLimit: null,
      includedUsed: null,
      totalUsed: null,
      prepaidBalance: null,
      onDemandEnabled: null,
      onDemandCap: null,
      onDemandUsed: null,
      billingPeriodStart: null,
      billingPeriodEnd: null,
      resetsAt: null,
      isUnifiedBillingUser: null,
      products: [],
      manageUrl: "",
      subscribeUrl: "",
      fetchedAt: null,
    },
    heatmap: [],
    callLogs: [],
    usageManageUrl: "",
    subscribeUrl: "",
  };
}

function setup() {
  const host = createAccountQuotaChromeHost();
  host.noteAccountConnected = vi.fn();
  const hostRef = { current: host };
  const hook = renderHook(() =>
    useAccountQuotaChrome({
      hostRef,
      manualCliPath: null,
    }),
  );
  return { ...hook, host };
}

describe("useAccountQuotaChrome", () => {
  beforeEach(() => {
    vi.mocked(api.isTauri).mockReturnValue(false);
    vi.mocked(api.accountStatus).mockResolvedValue(signedOutStatus());
    vi.mocked(api.accountStatus).mockClear();
    vi.mocked(api.trayRefresh).mockClear();
  });

  it("does not expose direct account, quota, or saved-account actions", () => {
    const { result } = setup();
    expect(Object.keys(result.current).sort()).toEqual([
      "account",
      "applyAccountSnapshot",
      "refreshAccount",
    ]);
  });

  it("does not probe account services outside the desktop host", async () => {
    const { result } = setup();
    await act(async () => {
      await result.current.refreshAccount();
    });
    expect(result.current.account).toBeNull();
    expect(api.accountStatus).not.toHaveBeenCalled();
  });

  it("stores the local CLI snapshot without requesting billing by default", async () => {
    const st = signedOutStatus();
    st.cliAuthPresent = true;
    vi.mocked(api.isTauri).mockReturnValue(true);
    vi.mocked(api.accountStatus).mockResolvedValue(st);
    const { result, host } = setup();

    await waitFor(() => expect(result.current.account).toEqual(st));
    expect(api.accountStatus).toHaveBeenCalledWith({
      refreshBilling: false,
      includeLocalUsage: true,
      manualCliPath: null,
    });
    expect(host.noteAccountConnected).toHaveBeenCalledWith({
      auth: true,
      cliFound: true,
    });
  });

  it("can apply a host-provided snapshot without account management calls", () => {
    const st = signedOutStatus();
    const { result } = setup();
    act(() => result.current.applyAccountSnapshot(st));
    expect(result.current.account).toEqual(st);
  });
});
