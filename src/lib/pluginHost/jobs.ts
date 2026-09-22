/**
 * Plugin session jobs (GOAL D6).
 * compose: create + draft, never send, never change viewing session.
 * run: create + connect + send on the new id, never change viewing session.
 */

export type PluginJob = {
  jobId: string;
  sessionId: string;
  pluginId: string;
  status: "created" | "running" | "needsUser" | "done";
  ok?: boolean;
  reason?: string;
  text?: string;
};

export type ComposeInput = {
  pluginId: string;
  title?: string;
  skill?: string;
  prompt: string;
};

export type RunInput = ComposeInput & {
  open?: "background" | "focus";
};

export type SessionJobDeps = {
  createSession: (title?: string) => Promise<{ id: string }>;
  connectSession: (sessionId: string) => Promise<void>;
  sendMessage: (sessionId: string, prompt: string) => Promise<void>;
  saveDraft: (sessionId: string, text: string) => void;
  /** Must not be called by compose/run (D6). */
  setViewingSessionId?: (id: string) => void;
  newId?: () => string;
};

export function compilePluginPrompt(skill: string | undefined, prompt: string): string {
  const body = String(prompt ?? "");
  const sk = (skill ?? "").trim();
  if (!sk) return body;
  const slash = sk.startsWith("/") ? sk : `/${sk}`;
  return `${slash}\n\n${body}`;
}

function nextId(deps: SessionJobDeps): string {
  if (deps.newId) return deps.newId();
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `job-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export async function composeNewSession(
  input: ComposeInput,
  deps: SessionJobDeps,
): Promise<{ sessionId: string }> {
  const prompt = compilePluginPrompt(input.skill, input.prompt);
  const meta = await deps.createSession(input.title);
  deps.saveDraft(meta.id, prompt);
  return { sessionId: meta.id };
}

export async function runNewSession(
  input: RunInput,
  deps: SessionJobDeps,
): Promise<{ jobId: string; sessionId: string }> {
  const prompt = compilePluginPrompt(input.skill, input.prompt);
  const meta = await deps.createSession(input.title);
  await deps.connectSession(meta.id);
  await deps.sendMessage(meta.id, prompt);
  return { jobId: nextId(deps), sessionId: meta.id };
}

export function finishJob(
  job: PluginJob,
  result: { ok: boolean; reason?: string; text?: string },
): PluginJob {
  const text = (result.text ?? "").slice(0, 32 * 1024);
  return {
    ...job,
    status: "done",
    ok: result.ok,
    reason: result.reason,
    text,
  };
}
