/**
 * @vitest-environment jsdom
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { CustomProvider } from "@/lib/api";
import { createT } from "@/i18n";
import { WorkbenchSidebar, type WorkbenchSidebarProps } from "./WorkbenchSidebar";

vi.mock("@/lib/floatingMenu", () => ({
  FLOATING_MENU_Z_INDEX: 13_000,
  useFloatingMenu: () => ({
    pos: { top: 100, left: 10 },
    style: { position: "fixed" },
    settled: true,
  }),
}));

vi.mock("@/components/SidebarUpdateButton", () => ({
  SidebarUpdateButton: () => null,
}));

afterEach(cleanup);

const tr = createT("en");

function deepseekProvider(): CustomProvider {
  return {
    id: "deepseek",
    model: "deepseek-chat",
    baseUrl: "https://api.deepseek.com",
    name: "DeepSeek",
    hasApiKey: true,
    apiBackend: "openai",
    providerMode: "generic",
    isDefault: false,
  };
}

function props(
  override: Partial<WorkbenchSidebarProps> = {},
): WorkbenchSidebarProps {
  return {
    tr,
    locale: "en",
    children: <div>sessions</div>,
    layout: { sidebarCollapsed: false, sidebarWidth: 280 },
    phoneLayout: false,
    sidebarOverlay: false,
    resizingSidebar: false,
    dragZone: null,
    sidebarOpenW: 280,
    sidebarPaint: 280,
    beginSidebarResize: () => undefined,
    dragRegion: "false",
    titlebarMax: {
      onDoubleClick: () => undefined,
      onMouseDown: () => undefined,
    },
    replaceProviderBrandLogo: false,
    customRouteActive: false,
    activeCustomProvider: null,
    mainPane: "chat",
    onOpenSearch: () => undefined,
    onNewChat: () => undefined,
    onNavigateAutomations: () => undefined,
    onNavigateKanban: () => undefined,
    onNavigateRemoteIm: () => undefined,
    showUserMenu: false,
    setShowUserMenu: () => undefined,
    theme: "dark",
    themePreference: "dark",
    providerBalanceCache: null,
    providerBalanceBusy: false,
    providerBalanceError: null,
    loadProviderBalance: () => undefined,
    applyThemeChoice: () => undefined,
    onSettings: () => undefined,
    onTutorial: () => undefined,
    onUserMenuOpened: () => undefined,
    ...override,
  };
}

it("shows local identity and opens the footer menu", () => {
  const setShowUserMenu = vi.fn();
  render(
    <WorkbenchSidebar
      {...props({
        setShowUserMenu,
        showUserMenu: false,
      })}
    />,
  );

  expect(screen.getByText("Local")).toBeTruthy();
  expect(document.querySelector(".sidebar__footer-remain")).toBeNull();
  const settings = screen.getByRole("button", { name: "Settings" });
  const usage = screen.getByRole("button", { name: "Usage" });
  expect(settings.compareDocumentPosition(usage) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  fireEvent.click(usage);
  expect(window.location.hash).toBe("#/usage");

  fireEvent.click(screen.getByRole("button", { name: "Provider menu" }));
  expect(setShowUserMenu).toHaveBeenCalled();
});

it("preserves the exact sidebar subtitle", () => {
  render(<WorkbenchSidebar {...props()} />);
  expect(screen.getByText("building beyond limits")).toBeTruthy();
});

it("shows the active provider identity without official account chrome", () => {
  render(
    <WorkbenchSidebar
      {...props({
        customRouteActive: true,
        activeCustomProvider: deepseekProvider(),
      })}
    />,
  );

  expect(screen.getByText("DeepSeek")).toBeTruthy();
  expect(document.querySelector(".sidebar__footer-remain")).toBeNull();
});

it("keeps generic provider balance beside the provider name", () => {
  render(
    <WorkbenchSidebar
      {...props({
        customRouteActive: true,
        activeCustomProvider: deepseekProvider(),
        providerBalanceCache: {
          providerId: "deepseek",
          fetchedAt: Date.now(),
          result: {
            kind: "balance",
            provider: "deepseek",
            endpoint: "https://api.deepseek.com/user/balance",
            ok: true,
            latencyMs: 12,
            isAvailable: true,
            balances: [
              {
                currency: "CNY",
                totalBalance: "9.55",
                grantedBalance: "0",
                toppedUpBalance: "9.55",
              },
            ],
          },
        },
      })}
    />,
  );

  expect(
    document.querySelector(".sidebar__footer-remain")?.textContent,
  ).toBe("9.55 CNY");
});

it("puts Settings, theme, What's new, and tutorial in the open menu", () => {
  const onSettings = vi.fn();
  render(
    <WorkbenchSidebar
      {...props({
        showUserMenu: true,
        onSettings,
      })}
    />,
  );

  expect(screen.getByRole("menuitem", { name: "Settings" })).toBeTruthy();
  expect(screen.getByRole("menuitem", { name: "Theme" })).toBeTruthy();
  expect(screen.getByRole("menuitem", { name: "What's new" })).toBeTruthy();
  expect(screen.getByRole("menuitem", { name: "Product tour" })).toBeTruthy();
  expect(document.querySelector(".user-menu__quota")).toBeNull();
  expect(document.querySelector(".user-menu__accounts")).toBeNull();
  expect(screen.queryByText(/SuperGrok/i)).toBeNull();

  fireEvent.click(screen.getByRole("menuitem", { name: "Settings" }));
  expect(onSettings).toHaveBeenCalledTimes(1);
});

it("puts provider balance and refresh at the top of the open menu", () => {
  const loadProviderBalance = vi.fn();
  render(
    <WorkbenchSidebar
      {...props({
        showUserMenu: true,
        customRouteActive: true,
        activeCustomProvider: deepseekProvider(),
        loadProviderBalance,
        providerBalanceCache: {
          providerId: "deepseek",
          fetchedAt: Date.now(),
          result: {
            kind: "balance",
            provider: "deepseek",
            endpoint: "https://api.deepseek.com/user/balance",
            ok: true,
            latencyMs: 12,
            isAvailable: true,
            balances: [
              {
                currency: "CNY",
                totalBalance: "9.55",
                grantedBalance: "0",
                toppedUpBalance: "9.55",
              },
            ],
          },
        },
      })}
    />,
  );

  const balance = screen.getByTestId("user-menu-balance");
  expect(balance.textContent).toContain("9.55 CNY");
  fireEvent.click(screen.getByRole("button", { name: "Refresh balance" }));
  expect(loadProviderBalance).toHaveBeenCalled();
});
