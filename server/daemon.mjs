#!/usr/bin/env node
/**
 * Supercharge daemon (Paseo-style).
 * Clients (phone app, browser, CLI) talk to this process.
 * This process launches `supercharge agent --always-approve stdio`.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import readline from "node:readline";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.join(__dirname, "web");
const PORT = Number(process.env.SUPERCHARGE_LISTEN_PORT || 6767);
const HOST = process.env.SUPERCHARGE_LISTEN_HOST || "0.0.0.0";
const PASSWORD = (process.env.SUPERCHARGE_PASSWORD || "").trim();
const WORKSPACE = process.env.SUPERCHARGE_WORKSPACE || "/workspace";
const CLI = process.env.SUPERCHARGE_BIN || "supercharge";
const MODEL = process.env.SUPERCHARGE_MODEL || "";

if (!PASSWORD) {
  console.error("Set SUPERCHARGE_PASSWORD");
  process.exit(1);
}

const tokens = new Set();
const events = [];
const sseClients = new Set();
let rpcId = 0;
let sessionId = null;
let child = null;
let pending = new Map();
let busy = false;

function pushEvent(ev) {
  const row = { id: randomUUID(), ts: Date.now(), ...ev };
  events.push(row);
  if (events.length > 2000) events.splice(0, events.length - 2000);
  const payload = `data: ${JSON.stringify(row)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(payload);
    } catch {
      sseClients.delete(res);
    }
  }
}

function authOk(req, body) {
  const h = req.headers.authorization || "";
  const bearer = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
  const q = new URL(req.url, "http://local").searchParams.get("token") || "";
  if (bearer && (tokens.has(bearer) || bearer === PASSWORD)) return true;
  if (q && (tokens.has(q) || q === PASSWORD)) return true;
  if (body && typeof body.password === "string" && body.password === PASSWORD) return true;
  return false;
}

function sendRpc(method, params) {
  if (!child || !child.stdin.writable) {
    return Promise.reject(new Error("agent is not running"));
  }
  const id = ++rpcId;
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`timeout: ${method}`));
      }
    }, 120000);
  });
}

function ensureAgent() {
  if (child && !child.killed) return;
  const args = ["agent", "--always-approve"];
  if (MODEL) args.push("--model", MODEL);
  args.push("stdio");
  child = spawn(CLI, args, {
    cwd: fs.existsSync(WORKSPACE) ? WORKSPACE : process.cwd(),
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const rl = readline.createInterface({ input: child.stdout });
  rl.on("line", (line) => {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (msg.id != null && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) p.reject(Object.assign(new Error(msg.error.message || "rpc"), msg.error));
      else p.resolve(msg.result);
      return;
    }
    const update = msg.params?.update || msg.params;
    const kind = update?.sessionUpdate || msg.params?.sessionUpdate;
    if (kind === "agent_message_chunk") {
      const text = update?.content?.text || update?.text || "";
      if (text) pushEvent({ type: "text", role: "assistant", text });
    } else if (kind === "tool_call") {
      pushEvent({
        type: "tool",
        title: update?.title || update?.kind || "tool",
        state: update?.status || "running",
      });
    } else if (kind === "tool_call_update" && update?.status) {
      pushEvent({ type: "tool", title: update?.title || "tool", state: update.status });
    }
  });
  child.stderr.on("data", (buf) => {
    const s = buf.toString();
    if (s.trim()) console.error("[agent]", s.trim());
  });
  child.on("exit", (code) => {
    console.error("agent exited", code);
    child = null;
    sessionId = null;
    for (const [, p] of pending) p.reject(new Error("agent exited"));
    pending.clear();
    busy = false;
    pushEvent({ type: "error", text: "Agent process exited" });
  });
}

async function ensureSession() {
  ensureAgent();
  if (sessionId) return sessionId;
  await sendRpc("initialize", {
    protocolVersion: 1,
    clientInfo: { name: "supercharge-daemon", version: "0.2.36" },
    clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
  });
  const created = await sendRpc("session/new", {
    cwd: fs.existsSync(WORKSPACE) ? WORKSPACE : process.cwd(),
    mcpServers: [],
    _meta: { yoloMode: true },
  });
  sessionId =
    created?.sessionId || created?.session_id || created?.session?.sessionId || randomUUID();
  return sessionId;
}

async function handlePrompt(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return;
  pushEvent({ type: "user", role: "user", text: trimmed, local: true });
  pushEvent({ type: "typing" });
  busy = true;
  try {
    const sid = await ensureSession();
    await sendRpc("session/prompt", {
      sessionId: sid,
      prompt: [{ type: "text", text: trimmed }],
    });
    pushEvent({ type: "done" });
  } catch (err) {
    pushEvent({ type: "error", text: err.message || String(err) });
  } finally {
    busy = false;
  }
}

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "authorization,content-type",
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
      if (raw.length > 2_000_000) req.destroy();
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });
}

function instance() {
  return {
    id: "local",
    name: "Supercharge",
    status: "running",
    liveState: "running",
    paid: true,
    isFree: true,
    runtime: "supercharge",
  };
}

function serveStatic(req, res) {
  let p = new URL(req.url, "http://local").pathname;
  if (p === "/") p = "/index.html";
  const file = path.normalize(path.join(WEB, p.replace(/^\/+/, "")));
  if (!file.startsWith(WEB)) {
    res.writeHead(403);
    res.end();
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      fs.readFile(path.join(WEB, "index.html"), (e2, html) => {
        if (e2) {
          res.writeHead(404);
          res.end("not found");
          return;
        }
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(html);
      });
      return;
    }
    const ext = path.extname(file);
    const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };
    res.writeHead(200, { "content-type": (types[ext] || "application/octet-stream") + "; charset=utf-8" });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "authorization,content-type",
      "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
    });
    res.end();
    return;
  }

  const url = new URL(req.url, "http://local");
  const p = url.pathname;

  if (p === "/health" || p === "/v1/health") {
    json(res, 200, { ok: true, busy, agent: Boolean(child) });
    return;
  }

  if (req.method === "POST" && p === "/api/auth/login") {
    const body = await readBody(req);
    if (body.password !== PASSWORD) {
      json(res, 401, { error: "Wrong password" });
      return;
    }
    const token = randomUUID();
    tokens.add(token);
    json(res, 200, {
      token,
      user: { id: "local", email: body.email || "server@supercharge" },
    });
    return;
  }

  if (p.startsWith("/api/") && !authOk(req, null)) {
    json(res, 401, { error: "Unauthorized" });
    return;
  }

  if (req.method === "GET" && p === "/api/me") {
    json(res, 200, { user: { id: "local", email: "server@supercharge" } });
    return;
  }
  if (req.method === "GET" && p === "/api/instances") {
    json(res, 200, { instances: [instance()], freeQuota: { limit: 1, used: 0, available: 1 } });
    return;
  }
  if (req.method === "GET" && /^\/api\/instances\/[^/]+$/.test(p)) {
    json(res, 200, { instance: instance() });
    return;
  }
  if (req.method === "GET" && p.endsWith("/config")) {
    json(res, 200, {});
    return;
  }
  if (req.method === "GET" && p.endsWith("/cli-version")) {
    json(res, 200, { current: "daemon", latest: "daemon" });
    return;
  }
  if (req.method === "POST" && (p === "/api/instances/local/wake" || p === "/api/instances/local/restart")) {
    json(res, 200, { ok: true });
    return;
  }
  if (req.method === "GET" && p === "/api/instances/local/chat/conversations") {
    json(res, 200, { conversations: [], activeSessionId: sessionId });
    return;
  }
  if (req.method === "POST" && p === "/api/instances/local/chat/conversations") {
    sessionId = null;
    json(res, 200, { ok: true });
    return;
  }
  if (req.method === "POST" && p === "/api/instances/local/chat") {
    const body = await readBody(req);
    handlePrompt(body.text).catch((e) => console.error(e));
    json(res, 200, { ok: true, queued: busy });
    return;
  }
  if (req.method === "POST" && p === "/api/instances/local/chat/stop") {
    if (child) {
      child.kill("SIGINT");
    }
    json(res, 200, { ok: true });
    return;
  }
  if (req.method === "GET" && p === "/api/instances/local/chat/events") {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      "connection": "keep-alive",
      "access-control-allow-origin": "*",
    });
    const since = url.searchParams.get("since");
    const start = since ? events.findIndex((e) => e.id === since) + 1 : 0;
    for (const ev of events.slice(Math.max(0, start))) {
      res.write(`data: ${JSON.stringify(ev)}\n\n`);
    }
    sseClients.add(res);
    req.on("close", () => sseClients.delete(res));
    return;
  }

  serveStatic(req, res);
});

server.listen(PORT, HOST, () => {
  console.log(`Supercharge daemon on http://${HOST}:${PORT}`);
  console.log("Clients: phone app, browser, or CLI. This process launches Supercharge CLI.");
});
