import { describe, expect, it, vi } from "vitest";
import { dispatchHostRequest, parseHostReq } from "./bridge";
import type { BridgeContext } from "./bridge";

function ctx(over: Partial<BridgeContext> = {}): BridgeContext {
  return {
    pluginId: "hello-host",
    paneId: "home",
    locale: "en",
    theme: "dark",
    tokens: { "--bg": "#111" },
    appVersion: "0.2.20",
    permissions: ["sessions.create", "dialog"],
    sessions: {
      compose: vi.fn(async () => ({ sessionId: "s1" })),
      run: vi.fn(async () => ({ jobId: "j1", sessionId: "s2" })),
      open: vi.fn(async () => {}),
      get: vi.fn(async () => null),
      poll: vi.fn(async () => ({ status: "done" })),
    },
    storage: {
      get: () => null,
      set: () => {},
      list: () => [],
      delete: () => {},
    },
    dialog: {
      notice: vi.fn(async () => {}),
      confirm: vi.fn(async () => true),
      prompt: vi.fn(async () => "x"),
    },
    toast: vi.fn(),
    clipboardWrite: vi.fn(async () => {}),
    focusPane: vi.fn(),
    ...over,
  };
}

describe("dispatchHostRequest", () => {
  it("allows handshake and compose when sessions.create is granted", async () => {
    const c = ctx();
    const info = await dispatchHostRequest(
      { v: 1, id: "1", type: "req", method: "host.getInfo" },
      c,
    );
    expect(info.ok).toBe(true);
    const composed = await dispatchHostRequest(
      {
        v: 1,
        id: "2",
        type: "req",
        method: "host.sessions.compose",
        params: { prompt: "hi", target: "new" },
      },
      c,
    );
    expect(composed.ok).toBe(true);
    expect(c.sessions.compose).toHaveBeenCalled();
  });

  it("rejects storage without permission and P1 methods", async () => {
    const c = ctx();
    const stor = await dispatchHostRequest(
      { v: 1, id: "3", type: "req", method: "host.storage.get", params: { key: "a" } },
      c,
    );
    expect(stor.ok).toBe(false);
    if (!stor.ok) expect(stor.error.code).toBe("E_FORBIDDEN");
    const license = await dispatchHostRequest(
      { v: 1, id: "4", type: "req", method: "host.license.status" },
      c,
    );
    expect(license.ok).toBe(false);
  });

  it("parseHostReq ignores non-v1 envelopes", () => {
    expect(parseHostReq({ type: "req", method: "host.getInfo" })).toBeNull();
    expect(
      parseHostReq({ v: 1, id: "a", type: "req", method: "host.getInfo" }),
    ).toEqual({
      v: 1,
      id: "a",
      type: "req",
      method: "host.getInfo",
      params: undefined,
    });
  });
});
