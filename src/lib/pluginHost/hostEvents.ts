import { HOST_PROTOCOL_VERSION, type HostEvent } from "./types";

export function hostEvent(event: string, payload: unknown): HostEvent {
  return { v: HOST_PROTOCOL_VERSION, type: "event", event, payload };
}

export function hostReadyPayload(input: {
  pluginId: string;
  paneId: string;
  locale: string;
  theme: string;
  tokens: Record<string, string>;
  appVersion: string;
  permissions: readonly string[];
}) {
  return hostEvent("host.ready", {
    pluginId: input.pluginId,
    paneId: input.paneId,
    locale: input.locale,
    theme: input.theme,
    tokens: input.tokens,
    appVersion: input.appVersion,
    permissions: [...input.permissions],
  });
}

export function sessionStartedPayload(jobId: string, sessionId: string) {
  return hostEvent("session.started", { jobId, sessionId });
}

export function sessionNeedsUserPayload(jobId: string, kind: "permission" | "ask_user") {
  return hostEvent("session.needsUser", { jobId, kind });
}

export function sessionDonePayload(input: {
  jobId: string;
  sessionId: string;
  ok: boolean;
  reason?: string;
  text?: string;
}) {
  return hostEvent("session.done", {
    jobId: input.jobId,
    sessionId: input.sessionId,
    ok: input.ok,
    reason: input.reason,
    text: (input.text ?? "").slice(0, 32 * 1024),
  });
}
