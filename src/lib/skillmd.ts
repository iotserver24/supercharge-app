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

const SKILLMD_SEARCH_URL = "https://api.skillmd.com/v1/search";
const SEARCH_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 512 * 1024;

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function parseItem(value: unknown): SkillMdItem | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const slug = text(item.slug);
  const title = text(item.title);
  const type = item.type === "pack" ? "pack" : item.type === "single" ? "single" : null;
  if (!slug || !title || !type) return null;
  const rawUrl = text(item.raw_url) || null;
  return {
    slug,
    type,
    title,
    description: text(item.description, "No description provided."),
    category: text(item.category) || null,
    agents: Array.isArray(item.agents) ? item.agents.filter((v): v is string => typeof v === "string") : [],
    verified: item.verified === true,
    rawUrl: rawUrl && /^https:\/\//i.test(rawUrl) ? rawUrl : null,
  };
}

export async function searchSkillMd(query: string, signal?: AbortSignal): Promise<SkillMdItem[]> {
  const q = query.trim();
  if (q.length < 2 || q.length > 100) return [];
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const response = await fetch(`${SKILLMD_SEARCH_URL}?q=${encodeURIComponent(q)}`, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`SkillMD search failed (${response.status})`);
    const length = Number(response.headers.get("content-length") ?? 0);
    if (length > MAX_RESPONSE_BYTES) throw new Error("SkillMD response is too large");
    const body = await response.text();
    if (new TextEncoder().encode(body).byteLength > MAX_RESPONSE_BYTES) throw new Error("SkillMD response is too large");
    const parsed: unknown = JSON.parse(body);
    const items = parsed && typeof parsed === "object" && Array.isArray((parsed as { items?: unknown }).items)
      ? (parsed as { items: unknown[] }).items
      : [];
    return items.map(parseItem).filter((item): item is SkillMdItem => item !== null);
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener("abort", onAbort);
  }
}
