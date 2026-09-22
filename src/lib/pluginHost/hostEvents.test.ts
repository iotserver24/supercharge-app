import { describe, expect, it } from "vitest";
import {
  hostReadyPayload,
  sessionDonePayload,
  sessionNeedsUserPayload,
  sessionStartedPayload,
} from "./hostEvents";

describe("host events", () => {
  it("builds ready / started / needsUser / done envelopes", () => {
    const ready = hostReadyPayload({
      pluginId: "hello-host",
      paneId: "home",
      locale: "en",
      theme: "dark",
      tokens: {},
      appVersion: "0.2.20",
      permissions: ["dialog"],
    });
    expect(ready.type).toBe("event");
    expect(ready.event).toBe("host.ready");
    expect(sessionStartedPayload("j1", "s1").payload).toEqual({
      jobId: "j1",
      sessionId: "s1",
    });
    expect(sessionNeedsUserPayload("j1", "permission").event).toBe(
      "session.needsUser",
    );
    const done = sessionDonePayload({
      jobId: "j1",
      sessionId: "s1",
      ok: true,
      text: "x".repeat(40_000),
    });
    expect((done.payload as { text: string }).text.length).toBe(32 * 1024);
  });
});
