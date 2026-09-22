import { invoke } from "./host";

export type PluginContributionSidebar = {
  id: string;
  titleEn: string;
  titleZh?: string | null;
  titleZhTw?: string | null;
  icon: string;
  entry: string;
  placement: string;
};

export type PluginContribution = {
  id: string;
  cliName: string;
  minAppVersion?: string | null;
  permissions: string[];
  sidebar: PluginContributionSidebar[];
};

export type PluginHostWarn = {
  plugin: string;
  code: string;
  message: string;
};

export async function pluginContributionsList(): Promise<{
  contributions: PluginContribution[];
  warns: PluginHostWarn[];
  /** False only when the host could not enumerate the CLI plugins. */
  authoritative?: boolean;
}> {
  return invoke("plugin_contributions_list");
}

export async function pluginUiEndpoint(): Promise<{
  baseUrl: string;
  tokens: Record<string, string>;
}> {
  return invoke("plugin_ui_endpoint");
}

export async function pluginHostWarns(): Promise<{ warns: PluginHostWarn[] }> {
  return invoke("plugin_host_warns");
}

export async function pluginStorageGet(pluginId: string, key: string) {
  return invoke<unknown>("plugin_storage_get", { pluginId, key });
}

export async function pluginStorageSet(
  pluginId: string,
  key: string,
  value: unknown,
) {
  return invoke("plugin_storage_set", { pluginId, key, value });
}

export async function pluginStorageList(pluginId: string) {
  return invoke<{ keys: string[] }>("plugin_storage_list", { pluginId });
}

export async function pluginStorageDelete(pluginId: string, key: string) {
  return invoke("plugin_storage_delete", { pluginId, key });
}
