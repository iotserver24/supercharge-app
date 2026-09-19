import { describe, expect, it } from "vitest";
import { isNewerVersion, isVersionAtLeast, shouldDownloadUpdate } from "./updateVersion";

describe("update version ordering", () => {
  it.each([
    ["0.2.9", "0.2.10", true], ["0.2.10", "0.2.9", false],
    ["0.2.36", "v0.2.36", false], ["0.2.36", "0.2.37", true],
    ["1.0.0-beta.2", "1.0.0-beta.10", true], ["1.0.0-beta.10", "1.0.0", true],
    ["1.0.0", "1.0.0-rc.1", false], ["1.0.0+a", "1.0.0+b", false],
    ["supercharge 1.3.16 (abc)", "v1.3.17", true], ["invalid", "1.0.0", false],
    ["1.0.0", "latest", false], ["1.0.0", "1.0.0-beta.01", false],
  ])("compares %s against %s", (current, candidate, expected) => {
    expect(isNewerVersion(current, candidate)).toBe(expected);
  });

  it("compares against both installed and downloaded versions", () => {
    expect(shouldDownloadUpdate("0.2.36", null, "0.2.37")).toBe(true);
    expect(shouldDownloadUpdate("0.2.36", "0.2.37", "0.2.37")).toBe(false);
    expect(shouldDownloadUpdate("0.2.36", "0.2.38", "0.2.37")).toBe(false);
    expect(shouldDownloadUpdate("0.2.36", "0.2.37", "0.2.38")).toBe(true);
    expect(shouldDownloadUpdate("0.2.38", null, "0.2.37")).toBe(false);
  });

  it("requires a valid installed version when verifying installer output", () => {
    expect(isVersionAtLeast("invalid", "1.3.17")).toBe(false);
    expect(isVersionAtLeast("supercharge 1.3.17 (abc)", "1.3.17")).toBe(true);
    expect(isVersionAtLeast("1.3.16", "1.3.17")).toBe(false);
    expect(isVersionAtLeast("1.3.18", "1.3.17")).toBe(true);
  });
});
