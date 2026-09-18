const LEGACY_APP_PREFIX = "grok-app.";
const LEGACY_SHORT_PREFIX = "grok.";
const SUPERCHARGE_APP_PREFIX = "supercharge-app.";
const SUPERCHARGE_SHORT_PREFIX = "supercharge.";

export type BrowserStorageMigrationStore = Pick<
  Storage,
  "length" | "key" | "getItem" | "setItem"
>;

export interface BrowserStorageMigrationResult {
  copied: number;
  skipped: number;
  failed: number;
}

export function superchargeStorageKeyForLegacyKey(
  key: string,
): string | null {
  if (key.startsWith(LEGACY_APP_PREFIX)) {
    return `${SUPERCHARGE_APP_PREFIX}${key.slice(LEGACY_APP_PREFIX.length)}`;
  }
  if (key.startsWith(LEGACY_SHORT_PREFIX)) {
    return `${SUPERCHARGE_SHORT_PREFIX}${key.slice(LEGACY_SHORT_PREFIX.length)}`;
  }
  return null;
}

/**
 * Copy legacy browser preferences into the Supercharge namespace before any
 * boot-time reads. Existing Supercharge values always win and legacy values
 * remain untouched so rollback stays possible.
 */
export function migrateLegacyBrowserStorage(
  storage: BrowserStorageMigrationStore,
): BrowserStorageMigrationResult {
  const result: BrowserStorageMigrationResult = {
    copied: 0,
    skipped: 0,
    failed: 0,
  };

  const keys: string[] = [];
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key !== null) keys.push(key);
    }
  } catch {
    result.failed += 1;
    return result;
  }

  for (const legacyKey of keys) {
    const destinationKey = superchargeStorageKeyForLegacyKey(legacyKey);
    if (destinationKey === null) continue;

    try {
      if (storage.getItem(destinationKey) !== null) {
        result.skipped += 1;
        continue;
      }
      const value = storage.getItem(legacyKey);
      if (value === null) {
        result.skipped += 1;
        continue;
      }
      storage.setItem(destinationKey, value);
      result.copied += 1;
    } catch {
      // localStorage can be blocked or run out of quota. Migration must never
      // prevent application startup, and later keys may still be copyable.
      result.failed += 1;
    }
  }

  return result;
}
