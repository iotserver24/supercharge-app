import { describe, expect, it, vi } from "vitest";
import { compilePluginPrompt, composeNewSession, runNewSession } from "./jobs";

function mockDeps() {
  const setViewingSessionId = vi.fn();
  const sendMessage = vi.fn(async () => {});
  const connectSession = vi.fn(async () => {});
  const saveDraft = vi.fn();
  const createSession = vi.fn(async (title?: string) => ({
    id: `sess-${title ?? "x"}`,
  }));
  return {
    createSession,
    connectSession,
    sendMessage,
    saveDraft,
    setViewingSessionId,
    newId: () => "job-1",
  };
}

describe("composeNewSession", () => {
  it("creates a session and writes draft without sending or changing viewing", async () => {
    const deps = mockDeps();
    const out = await composeNewSession(
      { pluginId: "hello-host", title: "Precheck", prompt: "look at this" },
      deps,
    );
    expect(out.sessionId).toBe("sess-Precheck");
    expect(deps.createSession).toHaveBeenCalledOnce();
    expect(deps.saveDraft).toHaveBeenCalledWith("sess-Precheck", "look at this");
    expect(deps.sendMessage).not.toHaveBeenCalled();
    expect(deps.connectSession).not.toHaveBeenCalled();
    expect(deps.setViewingSessionId).not.toHaveBeenCalled();
  });
});

describe("runNewSession", () => {
  it("create+connect+sends on the new id and never touches viewingSessionId", async () => {
    const deps = mockDeps();
    const out = await runNewSession(
      {
        pluginId: "hello-host",
        title: "Attr",
        skill: "x-copy-check",
        prompt: "https://x.com/a",
      },
      deps,
    );
    expect(out.sessionId).toBe("sess-Attr");
    expect(out.jobId).toBe("job-1");
    expect(deps.connectSession).toHaveBeenCalledWith("sess-Attr");
    expect(deps.sendMessage).toHaveBeenCalledWith(
      "sess-Attr",
      compilePluginPrompt("x-copy-check", "https://x.com/a"),
    );
    expect(deps.setViewingSessionId).not.toHaveBeenCalled();
    expect(deps.saveDraft).not.toHaveBeenCalled();
  });
});
