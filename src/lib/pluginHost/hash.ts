/**
 * Plugin pane hash: `#/plugin/{id}/{pane}` (GOAL D3).
 * Never claims settings / session / automations / workbench / home.
 */

import {
  PANE_ID_RE,
  PLUGIN_HASH_ROOT,
  PLUGIN_ID_RE,
  RESERVED_HASH_ROOTS,
  type PluginRoute,
  type ReservedHashRoot,
} from "./types";

function stripHashPath(raw: string | null | undefined): string {
  let s = String(raw ?? "").trim();
  if (s.startsWith("#")) s = s.slice(1);
  if (s.startsWith("/")) s = s.slice(1);
  const qi = s.indexOf("?");
  if (qi >= 0) s = s.slice(0, qi);
  const hashFrag = s.indexOf("#");
  if (hashFrag >= 0) s = s.slice(0, hashFrag);
  return s.replace(/\/+$/, "");
}

export function isReservedHashRoot(root: string): root is ReservedHashRoot {
  return (RESERVED_HASH_ROOTS as readonly string[]).includes(root);
}

export function isValidPluginId(id: string): boolean {
  return PLUGIN_ID_RE.test(id);
}

export function isValidPaneId(id: string): boolean {
  return PANE_ID_RE.test(id);
}

/**
 * Parse `#/plugin/{id}/{pane}`. Returns null for reserved roots,
 * missing pane, or ids that fail `[a-z0-9-]{1,32}`.
 */
export function parsePluginHash(
  raw: string | null | undefined,
): PluginRoute | null {
  const path = stripHashPath(raw);
  if (!path) return null;
  const parts = path.split("/").filter(Boolean);
  const root = parts[0] ?? "";
  if (isReservedHashRoot(root)) return null;
  if (root !== PLUGIN_HASH_ROOT) return null;
  const plugin = parts[1] ?? "";
  const pane = parts[2] ?? "";
  if (!isValidPluginId(plugin) || !isValidPaneId(pane)) return null;
  if (parts.length !== 3) return null;
  return { plugin, pane };
}

/** Build `#/plugin/{id}/{pane}`. Returns null when ids are invalid. */
export function buildPluginHash(
  route: PluginRoute | null | undefined,
): string | null {
  if (!route) return null;
  const plugin = String(route.plugin ?? "").trim();
  const pane = String(route.pane ?? "").trim();
  if (!isValidPluginId(plugin) || !isValidPaneId(pane)) return null;
  return `#/${PLUGIN_HASH_ROOT}/${plugin}/${pane}`;
}
