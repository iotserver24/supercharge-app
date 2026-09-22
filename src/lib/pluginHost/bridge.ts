/**
 * postMessage dispatch for the plugin iframe (GOAL D5 methods).
 */

import {
  HOST_PROTOCOL_VERSION,
  type HostReq,
  type HostResErr,
  type HostResOk,
} from "./types";
import { methodAllowed } from "./permissions";

export type BridgeDialog = {
  notice: (title: string, body: string) => Promise<void>;
  confirm: (title: string, body: string) => Promise<boolean>;
  prompt: (title: string, body: string) => Promise<string | null>;
};

export type BridgeStorage = {
  get: (key: string) => unknown | Promise<unknown>;
  set: (key: string, value: unknown) => void | Promise<void>;
  list: () => string[] | Promise<string[]>;
  delete: (key: string) => void | Promise<void>;
};

export type BridgeSessionApi = {
  compose: (params: {
    title?: string;
    skill?: string;
    prompt: string;
    target?: string;
  }) => Promise<{ sessionId: string }>;
  run: (params: {
    title?: string;
    skill?: string;
    prompt: string;
    open?: string;
  }) => Promise<{ jobId: string; sessionId: string }>;
  open: (sessionId: string) => Promise<void>;
  get: (sessionId: string) => Promise<{
    title: string;
    state: string;
    updatedAt: string;
  } | null>;
  poll: (jobId: string) => Promise<unknown>;
};

export type BridgeContext = {
  pluginId: string;
  paneId: string;
  locale: string;
  theme: string;
  tokens: Record<string, string>;
  appVersion: string;
  permissions: readonly string[];
  sessions: BridgeSessionApi;
  storage: BridgeStorage;
  dialog: BridgeDialog;
  toast: (message: string, tone?: string) => void;
  clipboardWrite: (text: string) => Promise<void>;
  focusPane: () => void;
};

export function parseHostReq(data: unknown): HostReq | null {
  if (!data || typeof data !== "object") return null;
  const o = data as Record<string, unknown>;
  if (o.v !== HOST_PROTOCOL_VERSION || o.type !== "req") return null;
  if (typeof o.id !== "string" || typeof o.method !== "string") return null;
  return {
    v: HOST_PROTOCOL_VERSION,
    id: o.id,
    type: "req",
    method: o.method,
    params: o.params,
  };
}

function ok(id: string, result: unknown): HostResOk {
  return { v: HOST_PROTOCOL_VERSION, id, type: "res", ok: true, result };
}

function err(id: string, code: string, message: string): HostResErr {
  return {
    v: HOST_PROTOCOL_VERSION,
    id,
    type: "res",
    ok: false,
    error: { code, message },
  };
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

export async function dispatchHostRequest(
  req: HostReq,
  ctx: BridgeContext,
): Promise<HostResOk | HostResErr> {
  if (!methodAllowed(req.method, ctx.permissions)) {
    return err(req.id, "E_FORBIDDEN", `method not allowed: ${req.method}`);
  }
  const p = asRecord(req.params);
  try {
    switch (req.method) {
      case "host.getInfo":
        return ok(req.id, {
          pluginId: ctx.pluginId,
          paneId: ctx.paneId,
          locale: ctx.locale,
          theme: ctx.theme,
          tokens: ctx.tokens,
          appVersion: ctx.appVersion,
          permissions: [...ctx.permissions],
        });
      case "host.theme.get":
        return ok(req.id, { dataTheme: ctx.theme, tokens: ctx.tokens });
      case "host.locale.get":
        return ok(req.id, { locale: ctx.locale });
      case "host.focus.pane":
        ctx.focusPane();
        return ok(req.id, { ok: true });
      case "host.sessions.poll":
        return ok(
          req.id,
          await ctx.sessions.poll(String(p.jobId ?? "")),
        );
      case "host.sessions.compose": {
        if (p.target && p.target !== "new") {
          return err(req.id, "E_UNSUPPORTED", "compose target must be new");
        }
        const result = await ctx.sessions.compose({
          title: typeof p.title === "string" ? p.title : undefined,
          skill: typeof p.skill === "string" ? p.skill : undefined,
          prompt: String(p.prompt ?? ""),
          target: "new",
        });
        return ok(req.id, result);
      }
      case "host.sessions.run": {
        const result = await ctx.sessions.run({
          title: typeof p.title === "string" ? p.title : undefined,
          skill: typeof p.skill === "string" ? p.skill : undefined,
          prompt: String(p.prompt ?? ""),
          open: typeof p.open === "string" ? p.open : "background",
        });
        return ok(req.id, result);
      }
      case "host.sessions.open":
        await ctx.sessions.open(String(p.sessionId ?? ""));
        return ok(req.id, { ok: true });
      case "host.sessions.get":
        return ok(req.id, await ctx.sessions.get(String(p.sessionId ?? "")));
      case "host.storage.get":
        return ok(req.id, await ctx.storage.get(String(p.key ?? "")));
      case "host.storage.set":
        await ctx.storage.set(String(p.key ?? ""), p.value);
        return ok(req.id, { ok: true });
      case "host.storage.list":
        return ok(req.id, { keys: await ctx.storage.list() });
      case "host.storage.delete":
        await ctx.storage.delete(String(p.key ?? ""));
        return ok(req.id, { ok: true });
      case "host.dialog.notice":
        await ctx.dialog.notice(String(p.title ?? ""), String(p.body ?? ""));
        return ok(req.id, { ok: true });
      case "host.dialog.confirm":
        return ok(req.id, {
          ok: await ctx.dialog.confirm(String(p.title ?? ""), String(p.body ?? "")),
        });
      case "host.dialog.prompt":
        return ok(req.id, {
          value: await ctx.dialog.prompt(
            String(p.title ?? ""),
            String(p.body ?? ""),
          ),
        });
      case "host.toast":
        ctx.toast(String(p.message ?? ""), typeof p.tone === "string" ? p.tone : undefined);
        return ok(req.id, { ok: true });
      case "host.clipboard.writeText":
        await ctx.clipboardWrite(String(p.text ?? ""));
        return ok(req.id, { ok: true });
      default:
        return err(req.id, "E_UNKNOWN", `unknown method: ${req.method}`);
    }
  } catch (e) {
    return err(req.id, "E_HOST", String(e));
  }
}
