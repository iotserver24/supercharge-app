import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  isSafeUiRelPath,
  parseExtensionManifest,
  parseExtensionManifestJson,
} from "./manifest";

const validBody = {
  schemaVersion: 1,
  app: "grok-app",
  id: "plugin-ui-hello",
  minAppVersion: "0.2.16",
  contributes: {
    sidebar: [
      {
        id: "home",
        title: { en: "Hello Host", zh: "你好" },
        icon: "ui/icon.svg",
        entry: "ui/index.html",
        placement: "nav",
      },
    ],
  },
  permissions: ["sessions.create", "dialog", "toast"],
};

describe("isSafeUiRelPath", () => {
  it("allows only relative paths under ui/", () => {
    expect(isSafeUiRelPath("ui/index.html")).toBe(true);
    expect(isSafeUiRelPath("ui/assets/app.js")).toBe(true);
    expect(isSafeUiRelPath("../ui/index.html")).toBe(false);
    expect(isSafeUiRelPath("ui/../secret")).toBe(false);
    expect(isSafeUiRelPath("ui/foo/../../etc/passwd")).toBe(false);
    expect(isSafeUiRelPath("/ui/index.html")).toBe(false);
    expect(isSafeUiRelPath("skills/SKILL.md")).toBe(false);
    expect(isSafeUiRelPath("ui\\index.html")).toBe(false);
    expect(isSafeUiRelPath("")).toBe(false);
  });
});

describe("parseExtensionManifest", () => {
  it("accepts Supercharge and legacy P0 manifests", () => {
    const result = parseExtensionManifest({ ...validBody, app: "supercharge-app" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.id).toBe("plugin-ui-hello");
    expect(result.manifest.sidebar).toHaveLength(1);
    expect(result.manifest.sidebar[0]?.entry).toBe("ui/index.html");
    expect(result.manifest.permissions).toEqual([
      "sessions.create",
      "dialog",
      "toast",
    ]);
  });

  it("rejects unknown schema, escaped entry, and P1/unknown permissions", () => {
    const schema = parseExtensionManifest({ ...validBody, schemaVersion: 2 });
    expect(schema.ok).toBe(false);
    if (schema.ok) return;
    expect(schema.issues.some((i) => i.code === "schema_version")).toBe(true);

    const escape = parseExtensionManifest({
      ...validBody,
      contributes: {
        sidebar: [
          {
            id: "home",
            title: { en: "Hello" },
            icon: "ui/icon.svg",
            entry: "ui/../skills/SKILL.md",
          },
        ],
      },
    });
    expect(escape.ok).toBe(false);
    if (escape.ok) return;
    expect(escape.issues.some((i) => i.code === "sidebar_entry")).toBe(true);

    const perms = parseExtensionManifest({
      ...validBody,
      permissions: ["sessions.create", "license", "made-up"],
    });
    expect(perms.ok).toBe(false);
    if (perms.ok) return;
    expect(perms.issues.some((i) => i.code === "permission_p1")).toBe(true);
    expect(perms.issues.some((i) => i.code === "permission_unknown")).toBe(true);
  });

  it("accepts the hello fixture manifest from disk", () => {
    const text = readFileSync(
      resolve("fixtures/plugin-ui-hello/supercharge-app-extension.json"),
      "utf8",
    );
    const result = parseExtensionManifestJson(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.id).toBe("plugin-ui-hello");
    expect(result.manifest.sidebar[0]?.entry).toBe("ui/index.html");
  });

  it("requires title.en and unique pane ids", () => {
    const noEn = parseExtensionManifest({
      ...validBody,
      contributes: {
        sidebar: [
          {
            id: "home",
            title: { zh: "你好" },
            icon: "ui/icon.svg",
            entry: "ui/index.html",
          },
        ],
      },
    });
    expect(noEn.ok).toBe(false);

    const dup = parseExtensionManifest({
      ...validBody,
      contributes: {
        sidebar: [
          {
            id: "home",
            title: { en: "A" },
            icon: "ui/icon.svg",
            entry: "ui/index.html",
          },
          {
            id: "home",
            title: { en: "B" },
            icon: "ui/icon.svg",
            entry: "ui/b.html",
          },
        ],
      },
    });
    expect(dup.ok).toBe(false);
    if (dup.ok) return;
    expect(dup.issues.some((i) => i.code === "sidebar_dup")).toBe(true);
  });
});
