/**
 * @vitest-environment jsdom
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { UserMenu } from "./UserMenu";

afterEach(cleanup);

vi.mock("@/lib/floatingMenu", () => ({
  FLOATING_MENU_Z_INDEX: 13_000,
  useFloatingMenu: () => ({
    pos: { top: 100, left: 10 },
    style: { position: "fixed" },
    settled: true,
  }),
}));

const labels = {
  settings: "Settings",
  whatsNew: "What's new",
  tutorial: "Product tour",
  theme: "Theme",
  themeSystem: "System",
  themeLight: "Light",
  themeDark: "Dark",
};

function Harness({ collapsed }: { collapsed: boolean }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <output data-testid="open">{String(open)}</output>
      <UserMenu
        open={open}
        closeImmediately={collapsed}
        onClose={() => setOpen(false)}
        theme="dark"
        themePreference="dark"
        labels={labels}
        onSettings={() => undefined}
        onTheme={() => undefined}
      >
        <button type="button">Provider</button>
      </UserMenu>
    </>
  );
}

it("opens the theme editor from the theme submenu footer group", async () => {
  const onThemeEditor = vi.fn();
  const view = render(
    <UserMenu
      open
      onClose={() => undefined}
      theme="dark"
      themePreference="dark"
      labels={{ ...labels, themeEditor: "Theme editor" }}
      onSettings={() => undefined}
      onTheme={() => undefined}
      onThemeEditor={onThemeEditor}
    >
      <button type="button">Provider</button>
    </UserMenu>,
  );

  const themeItem = screen.getByRole("menuitem", { name: "Theme" });
  fireEvent.mouseEnter(themeItem);
  fireEvent.click(themeItem);
  expect(themeItem.getAttribute("aria-expanded")).toBe("true");
  const editor = await screen.findByRole("menuitem", { name: "Theme editor" });
  expect(document.querySelector(".user-menu__flyout-sep")).not.toBeNull();
  fireEvent.click(editor);
  expect(onThemeEditor).toHaveBeenCalledTimes(1);
  view.rerender(
    <UserMenu
      open={false}
      onClose={() => undefined}
      theme="dark"
      themePreference="dark"
      labels={{ ...labels, themeEditor: "Theme editor" }}
      onSettings={() => undefined}
      onTheme={() => undefined}
      onThemeEditor={onThemeEditor}
    >
      <button type="button">Provider</button>
    </UserMenu>,
  );
  await waitFor(() =>
    expect(document.querySelector(".user-menu__pop--portal")).toBeNull(),
  );
  view.unmount();
});

it("shows only navigation and appearance actions, without account or quota controls", () => {
  const onSettings = vi.fn();
  render(
    <UserMenu
      open
      onClose={() => undefined}
      theme="dark"
      themePreference="dark"
      labels={labels}
      onSettings={onSettings}
      onWhatsNew={() => undefined}
      onTutorial={() => undefined}
      onTheme={() => undefined}
    >
      <button type="button">Provider</button>
    </UserMenu>,
  );

  expect(screen.getByRole("menuitem", { name: "Settings" })).toBeTruthy();
  expect(screen.getByRole("menuitem", { name: "Theme" })).toBeTruthy();
  expect(screen.getByRole("menuitem", { name: "What's new" })).toBeTruthy();
  expect(screen.getByRole("menuitem", { name: "Product tour" })).toBeTruthy();
  expect(document.querySelector(".user-menu__quota")).toBeNull();
  expect(document.querySelector(".user-menu__accounts")).toBeNull();
  expect(screen.queryByText(/log in|log out|sign in|sign out/i)).toBeNull();

  fireEvent.click(screen.getByRole("menuitem", { name: "Settings" }));
  expect(onSettings).toHaveBeenCalledTimes(1);
});

it("keeps generic provider balance with an explicit refresh action", () => {
  const onRefresh = vi.fn();
  render(
    <UserMenu
      open
      onClose={() => undefined}
      theme="dark"
      themePreference="dark"
      labels={labels}
      providerBalance={{
        line: "9.55 CNY",
        busy: false,
        error: null,
        refreshLabel: "Refresh balance",
        refreshingLabel: "Checking…",
        onRefresh,
      }}
      onSettings={() => undefined}
      onTheme={() => undefined}
    >
      <button type="button">DeepSeek</button>
    </UserMenu>,
  );

  expect(screen.getByTestId("user-menu-balance").textContent).toContain(
    "9.55 CNY",
  );
  fireEvent.click(screen.getByRole("button", { name: "Refresh balance" }));
  expect(onRefresh).toHaveBeenCalledTimes(1);
});

it("clears an open provider menu when the sidebar collapses", async () => {
  const view = render(<Harness collapsed={false} />);
  expect(document.querySelector(".user-menu__pop--portal")).not.toBeNull();

  view.rerender(<Harness collapsed />);
  expect(document.querySelector(".user-menu__pop--portal")).toBeNull();
  await waitFor(() =>
    expect(screen.getByTestId("open").textContent).toBe("false"),
  );

  view.rerender(<Harness collapsed={false} />);
  expect(document.querySelector(".user-menu__pop--portal")).toBeNull();
});
