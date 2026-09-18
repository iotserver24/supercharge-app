import { describe, expect, it } from "vitest";
import {
  migrateLegacyBrowserStorage,
  superchargeStorageKeyForLegacyKey,
  type BrowserStorageMigrationStore,
} from "./browserStorageMigration";

function memoryStorage(
  seed: Record<string, string> = {},
): BrowserStorageMigrationStore & { data: Map<string, string> } {
  const data = new Map(Object.entries(seed));
  return {
    data,
    get length() {
      return data.size;
    },
    key(index) {
      return [...data.keys()][index] ?? null;
    },
    getItem(key) {
      return data.get(key) ?? null;
    },
    setItem(key, value) {
      data.set(key, value);
    },
  };
}

describe("browser storage namespace migration", () => {
  it("maps only the two legacy prefixes", () => {
    expect(superchargeStorageKeyForLegacyKey("grok-app.theme")).toBe(
      "supercharge-app.theme",
    );
    expect(superchargeStorageKeyForLegacyKey("grok.chatDensity")).toBe(
      "supercharge.chatDensity",
    );
    expect(superchargeStorageKeyForLegacyKey("grok-app")).toBeNull();
    expect(superchargeStorageKeyForLegacyKey("unrelated.grok.theme")).toBeNull();
  });

  it("copies legacy values without deleting originals", () => {
    const storage = memoryStorage({
      "grok-app.theme": "dark",
      "grok.chatDensity": "compact",
      unrelated: "keep",
    });

    expect(migrateLegacyBrowserStorage(storage)).toEqual({
      copied: 2,
      skipped: 0,
      failed: 0,
    });
    expect(storage.data.get("supercharge-app.theme")).toBe("dark");
    expect(storage.data.get("supercharge.chatDensity")).toBe("compact");
    expect(storage.data.get("grok-app.theme")).toBe("dark");
    expect(storage.data.get("grok.chatDensity")).toBe("compact");
    expect(storage.data.get("unrelated")).toBe("keep");
  });

  it("preserves destination values and is idempotent", () => {
    const storage = memoryStorage({
      "grok-app.theme": "legacy-dark",
      "supercharge-app.theme": "system",
      "grok.chatDensity": "compact",
    });

    expect(migrateLegacyBrowserStorage(storage)).toEqual({
      copied: 1,
      skipped: 1,
      failed: 0,
    });
    expect(storage.data.get("supercharge-app.theme")).toBe("system");
    expect(storage.data.get("supercharge.chatDensity")).toBe("compact");

    expect(migrateLegacyBrowserStorage(storage)).toEqual({
      copied: 0,
      skipped: 2,
      failed: 0,
    });
  });

  it("fails closed when storage enumeration is unavailable", () => {
    const storage: BrowserStorageMigrationStore = {
      get length(): number {
        throw new Error("blocked");
      },
      key() {
        return null;
      },
      getItem() {
        return null;
      },
      setItem() {},
    };

    expect(migrateLegacyBrowserStorage(storage)).toEqual({
      copied: 0,
      skipped: 0,
      failed: 1,
    });
  });
});
