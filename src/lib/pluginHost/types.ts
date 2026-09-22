/**
 * Plugin UI Host P0 contract types.
 * Shared by hash, permissions, manifest parse, and later Host/Rust mirrors.
 */

export const PLUGIN_ID_RE = /^[a-z0-9-]{1,32}$/;
export const PANE_ID_RE = /^[a-z0-9-]{1,32}$/;

export const PLUGIN_HASH_ROOT = "plugin";
export const PLUGIN_MANIFEST_FILENAMES = [
  "supercharge-app-extension.json",
  "grok-app-extension.json",
] as const;
export const PLUGIN_APP_IDS = ["supercharge-app", "grok-app"] as const;

/** First path segments that must never parse as a plugin route. */
export const RESERVED_HASH_ROOTS = [
  "settings",
  "session",
  "automations",
  "workbench",
  "home",
] as const;

export type ReservedHashRoot = (typeof RESERVED_HASH_ROOTS)[number];

export type PluginRoute = {
  plugin: string;
  pane: string;
};

export type SidebarPlacement = "nav" | "more";

export type LocalizedTitle = {
  en: string;
  zh?: string;
  "zh-TW"?: string;
};

export type SidebarContribution = {
  id: string;
  title: LocalizedTitle;
  icon: string;
  entry: string;
  placement: SidebarPlacement;
};

export type ExtensionManifest = {
  schemaVersion: 1;
  app: "supercharge-app" | "grok-app";
  id: string;
  minAppVersion: string | null;
  sidebar: SidebarContribution[];
  permissions: string[];
  licenseProductId: string | null;
};

export type ManifestIssue = {
  code: string;
  path: string;
  message: string;
};

export type ParseManifestOk = {
  ok: true;
  manifest: ExtensionManifest;
};

export type ParseManifestErr = {
  ok: false;
  issues: ManifestIssue[];
};

export type ParseManifestResult = ParseManifestOk | ParseManifestErr;

/** Host Tauri command names (WP-B must register these exact strings). */
export const PLUGIN_HOST_COMMANDS = {
  contributionsList: "plugin_contributions_list",
  uiEndpoint: "plugin_ui_endpoint",
  warns: "plugin_host_warns",
} as const;

export const HOST_PROTOCOL_VERSION = 1 as const;

export type HostReq = {
  v: typeof HOST_PROTOCOL_VERSION;
  id: string;
  type: "req";
  method: string;
  params?: unknown;
};

export type HostResOk = {
  v: typeof HOST_PROTOCOL_VERSION;
  id: string;
  type: "res";
  ok: true;
  result: unknown;
};

export type HostResErr = {
  v: typeof HOST_PROTOCOL_VERSION;
  id: string;
  type: "res";
  ok: false;
  error: { code: string; message: string };
};

export type HostEvent = {
  v: typeof HOST_PROTOCOL_VERSION;
  type: "event";
  event: string;
  payload: unknown;
};
