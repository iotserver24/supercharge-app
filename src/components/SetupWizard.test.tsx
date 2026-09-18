/**
 * @vitest-environment jsdom
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createT } from "@/i18n";
import * as api from "@/lib/api";
import { SetupWizard, type SetupCliInfo } from "./SetupWizard";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    isTauri: vi.fn(() => false),
    cliInstallCommands: vi.fn(async () => ({
      primary: "install-supercharge",
      shell: "sh",
      docsUrl: "https://example.test/supercharge",
      mirrors: [],
    })),
    providersUpsert: vi.fn(),
    providersPing: vi.fn(async () => ({ ok: true })),
    secretsSet: vi.fn(),
    settingsGet: vi.fn(async () => ({})),
    settingsSet: vi.fn(),
  };
});

const tr = createT("en");
const cli = (cliAuthPresent: boolean): SetupCliInfo => ({
  found: true,
  path: "/usr/local/bin/supercharge",
  version: "1.0.0",
  source: "path",
  cliAuthPresent,
});

function renderWizard(cliAuthPresent: boolean, onComplete = vi.fn()) {
  render(
    <SetupWizard
      tr={tr}
      platform="linux"
      useCustomWindowChrome={false}
      initialCli={cli(cliAuthPresent)}
      onComplete={onComplete}
    />,
  );
  return onComplete;
}

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SetupWizard provider setup", () => {
  it("renders the Supercharge setup identity without removed account methods", () => {
    renderWizard(true);

    expect(screen.getByRole("heading", { name: "Welcome to Supercharge" })).toBeTruthy();
    expect(screen.getByText("building beyond limits")).toBeTruthy();
    expect(screen.queryByText("Browser OAuth")).toBeNull();
    expect(screen.queryByText("Official API key")).toBeNull();
    expect(screen.queryByText("Import from grok-go")).toBeNull();
  });

  it("reuses detected CLI authentication without copying credentials", () => {
    renderWizard(true);

    expect(
      screen.getByRole("button", {
        name: /Use detected CLI authentication \(recommended\)/,
      }),
    ).toBeTruthy();
    expect(screen.queryByText(/OAuth|xai-|grok-go/i)).toBeNull();

    fireEvent.click(
      screen.getByRole("button", {
        name: /Use detected CLI authentication \(recommended\)/,
      }),
    );

    expect(api.secretsSet).not.toHaveBeenCalled();
    expect(api.providersUpsert).not.toHaveBeenCalled();
    expect(screen.getByText("Provider ready")).toBeTruthy();
  });

  it("offers all supported custom provider protocols", async () => {
    renderWizard(false);
    fireEvent.click(
      screen.getByRole("button", { name: /Set up a custom provider/ }),
    );

    const protocol = screen.getByRole("button", { name: "Message format" });
    fireEvent.click(protocol);
    expect(await screen.findByRole("option", { name: "OpenAI Responses" })).toBeTruthy();
    expect(
      screen.getByRole("option", { name: "OpenAI Chat Completions" }),
    ).toBeTruthy();
    expect(screen.getByRole("option", { name: "Anthropic Messages" })).toBeTruthy();
  });

  it("defers provider configuration to the CLI setup command", async () => {
    const onComplete = renderWizard(false);
    fireEvent.click(
      screen.getByRole("button", { name: "Configure later with /setup" }),
    );

    expect(
      screen.getByText(
        "Provider setup was deferred. Run /setup in the Supercharge CLI whenever you are ready.",
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Enter Supercharge" }));

    await waitFor(() => expect(onComplete).toHaveBeenCalledWith(cli(false)));
    expect(api.settingsSet).toHaveBeenCalledWith(
      expect.objectContaining({
        setupWizardCompleted: true,
        authSetupDeferred: true,
        setupSkipped: true,
      }),
    );
  });
});
