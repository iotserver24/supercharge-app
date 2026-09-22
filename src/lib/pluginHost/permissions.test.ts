import { describe, expect, it } from "vitest";
import {
  classifyPermission,
  methodAllowed,
  permissionForMethod,
  reviewPermissions,
} from "./permissions";

describe("reviewPermissions", () => {
  it("accepts the P0 whitelist and nothing else", () => {
    const ok = reviewPermissions([
      "sessions.create",
      "sessions.read",
      "storage",
      "dialog",
      "toast",
      "clipboard.write",
    ]);
    expect(ok.ok).toBe(true);
    expect(ok.p1).toEqual([]);
    expect(ok.unknown).toEqual([]);
    expect(ok.p0).toHaveLength(6);
  });

  it("rejects unknown and P1 names so the whole contribution fails", () => {
    const bad = reviewPermissions([
      "sessions.create",
      "license",
      "automations.readwrite",
      "not-a-real-perm",
    ]);
    expect(bad.ok).toBe(false);
    expect(bad.p1).toEqual(["license", "automations.readwrite"]);
    expect(bad.unknown).toEqual(["not-a-real-perm"]);
    expect(classifyPermission("open")).toBe("p1");
    expect(classifyPermission("automations.list")).toBe("p1");
    expect(classifyPermission("dialog")).toBe("p0");
  });
});

describe("methodAllowed", () => {
  const granted = ["sessions.create", "dialog"];

  it("allows handshake methods without a permission", () => {
    expect(permissionForMethod("host.getInfo")).toBeNull();
    expect(methodAllowed("host.getInfo", granted)).toBe(true);
    expect(methodAllowed("host.sessions.poll", [])).toBe(true);
  });

  it("gates compose/run on sessions.create and rejects unknown methods", () => {
    expect(methodAllowed("host.sessions.compose", granted)).toBe(true);
    expect(methodAllowed("host.sessions.run", granted)).toBe(true);
    expect(methodAllowed("host.sessions.compose", [])).toBe(false);
    expect(methodAllowed("host.storage.get", granted)).toBe(false);
    expect(methodAllowed("host.notAMethod", granted)).toBe(false);
  });
});
