/**
 * `pnpm dev` must merge tauri.dev.conf.json so debug does not steal the
 * installed Supercharge single-instance mutex / WebView2 user-data dir.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../..");
const PKG = resolve(ROOT, "package.json");
const BASE_CONF = resolve(ROOT, "src-tauri/tauri.conf.json");
const DEV_CONF = resolve(ROOT, "src-tauri/tauri.dev.conf.json");

describe("Supercharge package and Tauri identity", () => {
  it("ships Supercharge package metadata", () => {
    const pkg = JSON.parse(readFileSync(PKG, "utf8")) as {
      name?: string;
      description?: string;
    };
    expect(pkg.name).toBe("supercharge-app");
    expect(pkg.description).toContain("Supercharge");
    expect(pkg.description).not.toContain("Grok");
  });

  it("ships a distinct development identifier from the release bundle", () => {
    expect(existsSync(DEV_CONF)).toBe(true);
    const base = JSON.parse(readFileSync(BASE_CONF, "utf8")) as { identifier: string };
    const dev = JSON.parse(readFileSync(DEV_CONF, "utf8")) as {
      identifier: string;
      productName?: string;
    };
    expect(base.identifier).toBe("com.supercharge.desktop");
    expect(dev.identifier).toBe("com.supercharge.desktop.dev");
    expect(dev.productName).toBe("Supercharge Dev");
  });

  it("wires pnpm dev to merge the overlay", () => {
    const pkg = JSON.parse(readFileSync(PKG, "utf8")) as { scripts: { dev: string } };
    expect(pkg.scripts.dev).toContain("--config");
    expect(pkg.scripts.dev).toContain("src-tauri/tauri.dev.conf.json");
  });
});
