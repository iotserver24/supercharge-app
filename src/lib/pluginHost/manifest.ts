/**
 * Parse and validate grok-app-extension.json (plugin root only, GOAL D4).
 */

import { reviewPermissions } from "./permissions";
import {
  PANE_ID_RE,
  PLUGIN_APP_IDS,
  PLUGIN_ID_RE,
  type ExtensionManifest,
  type ManifestIssue,
  type ParseManifestResult,
  type SidebarContribution,
  type SidebarPlacement,
  type LocalizedTitle,
} from "./types";

function issue(code: string, path: string, message: string): ManifestIssue {
  return { code, path, message };
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

/**
 * Relative path under ui/ only. Rejects absolute, backslash, `..`,
 * empty segments, and anything not starting with `ui/`.
 */
export function isSafeUiRelPath(raw: string | null | undefined): boolean {
  const p = String(raw ?? "").trim();
  if (!p) return false;
  if (p.startsWith("/") || p.startsWith("\\")) return false;
  if (p.includes("\\") || p.includes("\0")) return false;
  if (!p.startsWith("ui/")) return false;
  const segs = p.split("/");
  if (segs.some((s) => s === "" || s === "." || s === "..")) return false;
  return segs.length >= 2;
}

function parseTitle(
  raw: unknown,
  path: string,
  issues: ManifestIssue[],
): LocalizedTitle | null {
  const rec = asRecord(raw);
  if (!rec) {
    issues.push(issue("title_missing", path, "title must be an object with en"));
    return null;
  }
  const en = typeof rec.en === "string" ? rec.en.trim() : "";
  if (!en) {
    issues.push(issue("title_en", path, "title.en is required"));
    return null;
  }
  const title: LocalizedTitle = { en };
  if (typeof rec.zh === "string" && rec.zh.trim()) title.zh = rec.zh.trim();
  const tw = rec["zh-TW"];
  if (typeof tw === "string" && tw.trim()) title["zh-TW"] = tw.trim();
  return title;
}

function parsePlacement(raw: unknown): SidebarPlacement {
  return raw === "more" ? "more" : "nav";
}

function parseSidebarItem(
  raw: unknown,
  path: string,
  issues: ManifestIssue[],
): SidebarContribution | null {
  const rec = asRecord(raw);
  if (!rec) {
    issues.push(issue("sidebar_item", path, "sidebar item must be an object"));
    return null;
  }
  const id = typeof rec.id === "string" ? rec.id.trim() : "";
  if (!PANE_ID_RE.test(id)) {
    issues.push(
      issue("sidebar_id", `${path}.id`, "sidebar id must match [a-z0-9-]{1,32}"),
    );
    return null;
  }
  const title = parseTitle(rec.title, `${path}.title`, issues);
  const icon = typeof rec.icon === "string" ? rec.icon.trim() : "";
  const entry = typeof rec.entry === "string" ? rec.entry.trim() : "";
  if (!isSafeUiRelPath(icon)) {
    issues.push(
      issue("sidebar_icon", `${path}.icon`, "icon must be a relative path under ui/"),
    );
  }
  if (!isSafeUiRelPath(entry)) {
    issues.push(
      issue(
        "sidebar_entry",
        `${path}.entry`,
        "entry must be a relative path under ui/",
      ),
    );
  }
  if (!title || !isSafeUiRelPath(icon) || !isSafeUiRelPath(entry)) return null;
  return {
    id,
    title,
    icon,
    entry,
    placement: parsePlacement(rec.placement),
  };
}

/**
 * Parse a JSON value (already deserialized) as a grok-app-extension.json body.
 * Unknown schema major versions and any P1/unknown permission fail the whole file.
 */
export function parseExtensionManifest(raw: unknown): ParseManifestResult {
  const issues: ManifestIssue[] = [];
  const rec = asRecord(raw);
  if (!rec) {
    return {
      ok: false,
      issues: [issue("not_object", "", "manifest must be a JSON object")],
    };
  }

  const schemaVersion = rec.schemaVersion;
  if (schemaVersion !== 1) {
    issues.push(
      issue(
        "schema_version",
        "schemaVersion",
        "unknown schemaVersion; only 1 is accepted",
      ),
    );
  }

  if (
    typeof rec.app !== "string" ||
    !(PLUGIN_APP_IDS as readonly string[]).includes(rec.app)
  ) {
    issues.push(
      issue(
        "app",
        "app",
        "app must be supercharge-app or the legacy grok-app identifier",
      ),
    );
  }

  const id = typeof rec.id === "string" ? rec.id.trim() : "";
  if (!PLUGIN_ID_RE.test(id)) {
    issues.push(issue("id", "id", "id must match [a-z0-9-]{1,32}"));
  }

  const minAppVersion =
    typeof rec.minAppVersion === "string" && rec.minAppVersion.trim()
      ? rec.minAppVersion.trim()
      : null;

  const contributes = asRecord(rec.contributes);
  const sidebarRaw = contributes?.sidebar;
  const sidebar: SidebarContribution[] = [];
  const seenPane = new Set<string>();
  if (!Array.isArray(sidebarRaw) || sidebarRaw.length === 0) {
    issues.push(
      issue("sidebar", "contributes.sidebar", "at least one sidebar pane is required"),
    );
  } else {
    sidebarRaw.forEach((item, i) => {
      const parsed = parseSidebarItem(item, `contributes.sidebar[${i}]`, issues);
      if (!parsed) return;
      if (seenPane.has(parsed.id)) {
        issues.push(
          issue(
            "sidebar_dup",
            `contributes.sidebar[${i}].id`,
            "sidebar id must be unique inside the plugin",
          ),
        );
        return;
      }
      seenPane.add(parsed.id);
      sidebar.push(parsed);
    });
  }

  const permRaw = Array.isArray(rec.permissions)
    ? rec.permissions.map((p) => String(p ?? "").trim()).filter(Boolean)
    : [];
  const review = reviewPermissions(permRaw);
  if (!review.ok) {
    if (review.p1.length) {
      issues.push(
        issue(
          "permission_p1",
          "permissions",
          `P1 permissions reject the contribution: ${review.p1.join(", ")}`,
        ),
      );
    }
    if (review.unknown.length) {
      issues.push(
        issue(
          "permission_unknown",
          "permissions",
          `unknown permissions reject the contribution: ${review.unknown.join(", ")}`,
        ),
      );
    }
  }

  const license = asRecord(rec.license);
  const licenseProductId =
    typeof license?.productId === "string" && license.productId.trim()
      ? license.productId.trim()
      : null;

  if (issues.length) return { ok: false, issues };

  const app =
    rec.app === "grok-app" || rec.app === "supercharge-app"
      ? rec.app
      : "supercharge-app";
  const manifest: ExtensionManifest = {
    schemaVersion: 1,
    app,
    id,
    minAppVersion,
    sidebar,
    permissions: review.p0,
    licenseProductId,
  };
  return { ok: true, manifest };
}

/** Parse a JSON text body. Invalid JSON becomes a single parse_error issue. */
export function parseExtensionManifestJson(text: string): ParseManifestResult {
  try {
    return parseExtensionManifest(JSON.parse(text) as unknown);
  } catch {
    return {
      ok: false,
      issues: [issue("parse_error", "", "manifest is not valid JSON")],
    };
  }
}
