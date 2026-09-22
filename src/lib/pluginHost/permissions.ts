/**
 * P0 permission whitelist (GOAL D5).
 * Unknown or P1 names reject the entire contribution.
 */

export const P0_PERMISSIONS = [
  "sessions.create",
  "sessions.read",
  "storage",
  "dialog",
  "toast",
  "clipboard.write",
] as const;

export type P0Permission = (typeof P0_PERMISSIONS)[number];

/** Names that are reserved for Host P1 — declaring any rejects the whole manifest. */
export const P1_PERMISSIONS = [
  "license",
  "automations.readwrite",
  "automations.read",
  "automations.write",
  "menu",
  "picker",
  "media.proxy",
  "account.read",
  "catalog.read",
  "open",
  "projects.read",
] as const;

export type P1Permission = (typeof P1_PERMISSIONS)[number];

const P0_SET = new Set<string>(P0_PERMISSIONS);
const P1_SET = new Set<string>(P1_PERMISSIONS);

export function isP0Permission(name: string): name is P0Permission {
  return P0_SET.has(name);
}

export function isP1Permission(name: string): name is P1Permission {
  return P1_SET.has(name) || name.startsWith("automations.");
}

export type PermissionClass = "p0" | "p1" | "unknown";

export function classifyPermission(name: string): PermissionClass {
  if (isP0Permission(name)) return "p0";
  if (isP1Permission(name)) return "p1";
  return "unknown";
}

export type PermissionReview = {
  ok: boolean;
  p0: string[];
  p1: string[];
  unknown: string[];
};

export function reviewPermissions(
  names: readonly string[] | null | undefined,
): PermissionReview {
  const p0: string[] = [];
  const p1: string[] = [];
  const unknown: string[] = [];
  const seen = new Set<string>();
  for (const raw of names ?? []) {
    const name = String(raw ?? "").trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const kind = classifyPermission(name);
    if (kind === "p0") p0.push(name);
    else if (kind === "p1") p1.push(name);
    else unknown.push(name);
  }
  return {
    ok: p1.length === 0 && unknown.length === 0,
    p0,
    p1,
    unknown,
  };
}

/** Method → required permission. Missing entry = always allowed (handshake). */
export const METHOD_PERMISSION: Record<string, P0Permission | null> = {
  "host.getInfo": null,
  "host.theme.get": null,
  "host.locale.get": null,
  "host.sessions.poll": null,
  "host.focus.pane": null,
  "host.sessions.compose": "sessions.create",
  "host.sessions.run": "sessions.create",
  "host.sessions.open": "sessions.create",
  "host.sessions.get": "sessions.read",
  "host.storage.get": "storage",
  "host.storage.set": "storage",
  "host.storage.list": "storage",
  "host.storage.delete": "storage",
  "host.dialog.notice": "dialog",
  "host.dialog.confirm": "dialog",
  "host.dialog.prompt": "dialog",
  "host.toast": "toast",
  "host.clipboard.writeText": "clipboard.write",
};

export function permissionForMethod(method: string): P0Permission | null | undefined {
  if (!Object.prototype.hasOwnProperty.call(METHOD_PERMISSION, method)) {
    return undefined;
  }
  return METHOD_PERMISSION[method];
}

/** True when the plugin's granted P0 list covers this method. */
export function methodAllowed(
  method: string,
  granted: readonly string[] | null | undefined,
): boolean {
  const need = permissionForMethod(method);
  if (need === undefined) return false;
  if (need === null) return true;
  return (granted ?? []).includes(need);
}
