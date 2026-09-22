import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createT, type Locale } from "@/i18n";
import type { PluginContribution } from "@/lib/api/pluginHost";
import {
  dispatchHostRequest,
  parseHostReq,
  type BridgeContext,
} from "@/lib/pluginHost/bridge";
import {
  composeNewSession,
  finishJob,
  runNewSession,
  type PluginJob,
} from "@/lib/pluginHost/jobs";
import { storageForPlugin } from "@/lib/pluginHost/storage";
import {
  hostReadyPayload,
  sessionDonePayload,
  sessionNeedsUserPayload,
  sessionStartedPayload,
} from "@/lib/pluginHost/hostEvents";
import * as api from "@/lib/api";
import type {
  SessionSnapshot,
  StreamPayload,
  TurnErrorPayload,
} from "@/lib/session";
import { saveComposerSessionDraft } from "@/lib/composerSessionDraft";
import { GlassModal } from "@/components/GlassModal";
import { APP_VERSION } from "@/lib/whatsNew";

const EMPTY_THEME_TOKENS: Record<string, string> = {};

type DialogState =
  | null
  | {
      kind: "notice" | "confirm" | "prompt";
      title: string;
      body: string;
      resolve: (v: boolean | string | null) => void;
    };

type Props = {
  contribution: PluginContribution;
  paneId: string;
  baseUrl: string;
  token: string;
  locale: Locale;
  theme: string;
  tokens: Record<string, string>;
  hidden?: boolean;
  onOpenSession?: (sessionId: string) => void;
  onToast?: (message: string) => void;
};

function iframeSrc(
  baseUrl: string,
  pluginId: string,
  token: string,
  entry: string,
): string {
  const rel = entry.startsWith("ui/") ? entry.slice(3) : entry;
  return `${baseUrl.replace(/\/$/, "")}/plugin-ui/${pluginId}/${token}/${rel}`;
}

export function PluginPaneHost({
  contribution,
  paneId,
  baseUrl,
  token,
  locale,
  theme,
  tokens,
  hidden,
  onOpenSession,
  onToast,
}: Props) {
  const tr = createT(locale);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const jobsRef = useRef<Map<string, PluginJob>>(new Map());
  const [dialog, setDialog] = useState<DialogState>(null);
  const [loadedSrc, setLoadedSrc] = useState("");
  const [frameFailed, setFrameFailed] = useState(false);
  const pane = contribution.sidebar.find((s) => s.id === paneId);
  const src = pane
    ? iframeSrc(baseUrl, contribution.id, token, pane.entry)
    : "";
  const themeTokens = Object.keys(tokens).length ? tokens : EMPTY_THEME_TOKENS;

  const origin = useMemo(() => {
    try {
      return new URL(baseUrl).origin;
    } catch {
      return "";
    }
  }, [baseUrl]);

  const postToFrame = useCallback(
    (data: unknown) => {
      const win = iframeRef.current?.contentWindow;
      if (!win || !origin) return;
      win.postMessage(data, origin);
    },
    [origin],
  );

  const openDialog = useCallback(
    (kind: "notice" | "confirm" | "prompt", title: string, body: string) =>
      new Promise<boolean | string | null>((resolve) => {
        setDialog({ kind, title, body, resolve });
      }),
    [],
  );

  const ctx: BridgeContext = useMemo(
    () => ({
      pluginId: contribution.id,
      paneId,
      locale,
      theme,
      tokens: themeTokens,
      appVersion: APP_VERSION,
      permissions: contribution.permissions,
      sessions: {
        compose: async ({ title, skill, prompt }) => {
          const out = await composeNewSession(
            { pluginId: contribution.id, title, skill, prompt },
            {
              createSession: async (t) => {
                const meta = (await api.sessionCreate(undefined, t)) as {
                  id: string;
                };
                return { id: meta.id };
              },
              connectSession: async () => {},
              sendMessage: async () => {},
              saveDraft: (sessionId, text) => {
                saveComposerSessionDraft(sessionId, { text });
              },
            },
          );
          return out;
        },
        run: async ({ title, skill, prompt, open }) => {
          const out = await runNewSession(
            { pluginId: contribution.id, title, skill, prompt },
            {
              createSession: async (t) => {
                const meta = (await api.sessionCreate(undefined, t)) as {
                  id: string;
                };
                return { id: meta.id };
              },
              connectSession: async (sessionId) => {
                await api.sessionConnect({ sessionId });
              },
              sendMessage: async (sessionId, text) => {
                await api.sessionSend(text, null, sessionId);
              },
              saveDraft: () => {},
            },
          );
          jobsRef.current.set(out.jobId, {
            jobId: out.jobId,
            sessionId: out.sessionId,
            pluginId: contribution.id,
            status: "running",
          });
          postToFrame(sessionStartedPayload(out.jobId, out.sessionId));
          if (open === "focus") {
            onOpenSession?.(out.sessionId);
          }
          return out;
        },
        open: async (sessionId) => {
          onOpenSession?.(sessionId);
        },
        get: async (sessionId) => {
          const row = (await api.sessionsList()).find((item) => item.id === sessionId);
          return row
            ? { title: row.title, state: "stored", updatedAt: row.updatedAt }
            : null;
        },
        poll: async (jobId) => jobsRef.current.get(jobId) ?? null,
      },
      storage: api.isTauri()
        ? {
            get: (key) => api.pluginStorageGet(contribution.id, key),
            set: (key, value) =>
              api.pluginStorageSet(contribution.id, key, value).then(() => undefined),
            list: async () =>
              (await api.pluginStorageList(contribution.id)).keys ?? [],
            delete: (key) =>
              api.pluginStorageDelete(contribution.id, key).then(() => undefined),
          }
        : storageForPlugin(contribution.id),
      dialog: {
        notice: async (title, body) => {
          await openDialog("notice", title, body);
        },
        confirm: async (title, body) =>
          (await openDialog("confirm", title, body)) === true,
        prompt: async (title, body) => {
          const v = await openDialog("prompt", title, body);
          return typeof v === "string" ? v : null;
        },
      },
      toast: (message) => {
        onToast?.(message);
      },
      clipboardWrite: async (text) => {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          /* ignore */
        }
      },
      focusPane: () => {
        iframeRef.current?.focus();
      },
    }),
    [
      contribution,
      locale,
      onOpenSession,
      onToast,
      openDialog,
      paneId,
      postToFrame,
      theme,
      themeTokens,
    ],
  );

  useEffect(() => {
    const onMsg = (ev: MessageEvent) => {
      if (!origin || ev.origin !== origin) return;
      if (ev.source !== iframeRef.current?.contentWindow) return;
      const req = parseHostReq(ev.data);
      if (!req) return;
      void dispatchHostRequest(req, ctx).then((res) => {
        ev.source?.postMessage(res, { targetOrigin: origin });
      });
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [ctx, origin]);

  useEffect(() => {
    if (!api.isTauri()) return;
    let cancelled = false;
    const unsubs: Array<() => void> = [];
    void (async () => {
      unsubs.push(
        await api.listen<StreamPayload>("session://stream", (chunk) => {
          if (
            cancelled ||
            !chunk.sessionId ||
            !chunk.done ||
            (chunk.kind && chunk.kind !== "assistant")
          ) {
            return;
          }
          for (const [id, job] of jobsRef.current) {
            if (job.sessionId !== chunk.sessionId || job.status === "done") continue;
            const next = finishJob(job, {
              ok: true,
              text: chunk.text,
            });
            jobsRef.current.set(id, next);
            postToFrame(
              sessionDonePayload({
                jobId: next.jobId,
                sessionId: next.sessionId,
                ok: next.ok ?? true,
                reason: next.reason,
                text: next.text,
              }),
            );
          }
        }),
      );
      unsubs.push(
        await api.listen<SessionSnapshot>("session://state", (s) => {
          if (cancelled || !s.sessionId || s.state !== "disconnected" || !s.lastError) return;
          for (const [id, job] of jobsRef.current) {
            if (job.sessionId !== s.sessionId || job.status === "done") continue;
            const next = finishJob(job, {
              ok: false,
              reason: s.lastError.message,
            });
            jobsRef.current.set(id, next);
            postToFrame(
              sessionDonePayload({
                jobId: next.jobId,
                sessionId: next.sessionId,
                ok: false,
                reason: next.reason,
                text: next.text,
              }),
            );
          }
        }),
      );
      unsubs.push(
        await api.listen<TurnErrorPayload>("session://turn_error", (error) => {
          if (cancelled || !error.sessionId) return;
          for (const [id, job] of jobsRef.current) {
            if (job.sessionId !== error.sessionId || job.status === "done") continue;
            const next = finishJob(job, {
              ok: false,
              reason: error.message ?? error.code ?? "turn failed",
            });
            jobsRef.current.set(id, next);
            postToFrame(
              sessionDonePayload({
                jobId: next.jobId,
                sessionId: next.sessionId,
                ok: false,
                reason: next.reason,
                text: next.text,
              }),
            );
          }
        }),
      );
      unsubs.push(
        await api.listen<{ sessionId?: string }>("session://permission", (p) => {
          if (cancelled) return;
          for (const job of jobsRef.current.values()) {
            if (job.sessionId === p.sessionId && job.status !== "done") {
              jobsRef.current.set(job.jobId, { ...job, status: "needsUser" });
              postToFrame(sessionNeedsUserPayload(job.jobId, "permission"));
              void openDialog(
                "notice",
                createT(locale)("pluginHost.dialogTitle"),
                createT(locale)("pluginHost.warnTitle"),
              );
            }
          }
        }),
      );
      unsubs.push(
        await api.listen<{ sessionId?: string }>("session://ask_user", (p) => {
          if (cancelled) return;
          for (const job of jobsRef.current.values()) {
            if (job.sessionId === p.sessionId && job.status !== "done") {
              jobsRef.current.set(job.jobId, { ...job, status: "needsUser" });
              postToFrame(sessionNeedsUserPayload(job.jobId, "ask_user"));
              void openDialog(
                "notice",
                createT(locale)("pluginHost.dialogTitle"),
                createT(locale)("pluginHost.warnTitle"),
              );
            }
          }
        }),
      );
    })();
    return () => {
      cancelled = true;
      unsubs.forEach((u) => u());
    };
  }, [locale, openDialog, postToFrame]);

  const frameReady = !!src && loadedSrc === src && !frameFailed;

  if (!pane || !src) {
    return (
      <div
        className="plugin-pane-host"
        hidden={hidden}
        style={hidden ? { display: "none" } : undefined}
      >
        {tr("pluginHost.empty")}
      </div>
    );
  }

  return (
    <div
      className={
        "plugin-pane-host" + (hidden ? " plugin-pane-host--hidden" : "")
      }
      hidden={hidden}
    >
      {!frameReady ? (
        <div className="plugin-pane-host__status" role="status">
          {tr(
            frameFailed && loadedSrc === src
              ? "pluginHost.loadFailed"
              : "pluginHost.loading",
          )}
        </div>
      ) : null}
      <iframe
        ref={iframeRef}
        className="plugin-pane-host__frame"
        title={pane.titleEn}
        src={src}
        onLoad={() => {
          setFrameFailed(false);
          setLoadedSrc(src);
          postToFrame(
            hostReadyPayload({
              pluginId: contribution.id,
              paneId,
              locale,
              theme,
              tokens: themeTokens,
              appVersion: APP_VERSION,
              permissions: contribution.permissions,
            }),
          );
        }}
        onError={() => {
          setFrameFailed(true);
          setLoadedSrc(src);
        }}
        sandbox="allow-scripts allow-forms allow-same-origin"
        allow=""
      />
      <GlassModal
        open={!!dialog}
        onClose={() => {
          dialog?.resolve(dialog.kind === "confirm" ? false : null);
          setDialog(null);
        }}
        title={dialog?.title || tr("pluginHost.dialogTitle")}
        size="sm"
        closeLabel={tr("common.close")}
      >
        <p className="app-dialog__msg">{dialog?.body}</p>
        {dialog?.kind === "prompt" ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              dialog.resolve(String(fd.get("v") ?? ""));
              setDialog(null);
            }}
          >
            <input name="v" className="c-input" />
            <button type="submit" className="btn btn--solid">
              {tr("common.confirm")}
            </button>
          </form>
        ) : dialog?.kind === "confirm" ? (
          <button
            type="button"
            className="btn btn--solid"
            onClick={() => {
              dialog.resolve(true);
              setDialog(null);
            }}
          >
            {tr("common.confirm")}
          </button>
        ) : null}
      </GlassModal>
    </div>
  );
}
