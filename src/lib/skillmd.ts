import { invoke } from "@tauri-apps/api/core";

export type SkillMdItem = {
  slug: string;
  type: "single" | "pack";
  title: string;
  description: string;
  category: string | null;
  agents: string[];
  verified: boolean;
  rawUrl: string | null;
};

export async function searchSkillMd(query: string, signal?: AbortSignal): Promise<SkillMdItem[]> {
  const q = query.trim();
  if (q.length < 2 || q.length > 100) return [];
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const result = await invoke<{ items: SkillMdItem[] }>("skillmd_search", { query: q });
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  return Array.isArray(result.items) ? result.items : [];
}
