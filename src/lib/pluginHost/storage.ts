/** Isolated JSON bag per plugin. Backend is injectable (tests use a Map). */

export type PluginStorageBackend = {
  read: (pluginId: string) => Record<string, unknown>;
  write: (pluginId: string, bag: Record<string, unknown>) => void;
};

const mem = new Map<string, Record<string, unknown>>();

export const memoryPluginStorage: PluginStorageBackend = {
  read: (id) => ({ ...(mem.get(id) ?? {}) }),
  write: (id, bag) => {
    mem.set(id, { ...bag });
  },
};

export function pluginStorageGet(
  pluginId: string,
  key: string,
  backend: PluginStorageBackend = memoryPluginStorage,
): unknown {
  return backend.read(pluginId)[key] ?? null;
}

export function pluginStorageSet(
  pluginId: string,
  key: string,
  value: unknown,
  backend: PluginStorageBackend = memoryPluginStorage,
): void {
  const bag = backend.read(pluginId);
  bag[key] = value;
  backend.write(pluginId, bag);
}

export function pluginStorageList(
  pluginId: string,
  backend: PluginStorageBackend = memoryPluginStorage,
): string[] {
  return Object.keys(backend.read(pluginId));
}

export function pluginStorageDelete(
  pluginId: string,
  key: string,
  backend: PluginStorageBackend = memoryPluginStorage,
): void {
  const bag = backend.read(pluginId);
  delete bag[key];
  backend.write(pluginId, bag);
}

export function storageForPlugin(
  pluginId: string,
  backend: PluginStorageBackend = memoryPluginStorage,
) {
  return {
    get: (key: string) => pluginStorageGet(pluginId, key, backend),
    set: (key: string, value: unknown) =>
      pluginStorageSet(pluginId, key, value, backend),
    list: () => pluginStorageList(pluginId, backend),
    delete: (key: string) => pluginStorageDelete(pluginId, key, backend),
  };
}
