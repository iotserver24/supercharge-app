/**
 * Built-in custom-provider presets (add-provider gallery).
 * Values align with upstream docs; App stores them in agent-home config.toml.
 */

import type { ProviderEffortEntry, ProviderModelEntry } from "@/lib/api";

/** Known brand marks with dedicated logos (see ProviderBrandIcon). */
export type ProviderBrandId =
  | "deepseek"
  | "openrouter"
  | "amux"
  | "opencode-go"
  | "volcano-ark"
  | "zhipu";

export type ProviderPreset = {
  id: string;
  /** Channel display name (provider card / group). */
  name: string;
  /** Suggested config section id. */
  suggestedId: string;
  baseUrl: string;
  /**
   * When true, store Base URL as typed (no auto `/v1`).
   * Needed for Volcengine Ark Coding Plan roots like `…/api/plan/v3`.
   */
  baseUrlFullPath?: boolean;
  apiBackend: "responses" | "chat_completions" | "messages";
  models: ProviderModelEntry[];
  efforts: ProviderEffortEntry[];
  /** Optional short blurb for the gallery chip. */
  blurbKey?: string;
  /** Where to obtain an API key (opened from the form). */
  apiKeyUrl?: string;
  /** Brand logo key when available (Yun API / AI98PRO have none yet). */
  brandId?: ProviderBrandId;
  /**
   * Prefill “this model can see images”. Grok-named models already count as
   * vision; set true when the channel is an explicit multimodal Grok relay.
   */
  supportsVision?: boolean;
  /**
   * Prefill per-channel `context_window` (bare integer in TOML).
   * Missing → Host/composer default 200k for custom channels.
   */
  contextWindow?: number;
  /**
   * Alternate Base URLs for the same brand (Zhipu: CN/intl × API/Coding Plan).
   * Gallery stays one chip; the form shows tags above Base URL.
   */
  endpoints?: ProviderEndpointOption[];
  defaultEndpointId?: string;
};

/** One switchable Base URL on a multi-endpoint preset (Zhipu only today). */
export type ProviderEndpointOption = {
  id: string;
  /** i18n key for the tag / picker row. */
  labelKey: string;
  baseUrl: string;
  baseUrlFullPath?: boolean;
  apiKeyUrl?: string;
};

/**
 * Default reasoning tiers for blank / non-Grok custom channels:
 * low · medium · high · max (max maps to the 极高 UI slot via `tier4` kind).
 */
export const GROK_CHANNEL_EFFORTS: ProviderEffortEntry[] = [
  { id: "low", name: "low" },
  { id: "medium", name: "medium", isDefault: true },
  { id: "high", name: "high" },
  { id: "max", name: "max" },
];

/**
 * Official Grok 4.6 effort enum (ids, display names, default).
 * Grok relay presets (Amux / Yun / AI98PRO) use this instead of
 * `GROK_CHANNEL_EFFORTS`.
 */
export const GROK_OFFICIAL_EFFORTS: ProviderEffortEntry[] = [
  { id: "low", name: "Low" },
  { id: "medium", name: "Medium" },
  { id: "high", name: "High" },
  { id: "xhigh", name: "Extra high", isDefault: true },
];

const GROK_RELAY_PRESET_IDS = new Set(["amux", "yun-api", "ai98pro"]);

export function isGrokRelayPresetId(id: string | null | undefined): boolean {
  return !!id && GROK_RELAY_PRESET_IDS.has(id.trim().toLowerCase());
}

export function officialGrokChannelEfforts(): ProviderEffortEntry[] {
  return GROK_OFFICIAL_EFFORTS.map((e) => ({ ...e }));
}

/** Saved ladder shipped as low/medium/high/max before official xhigh align. */
export function isLegacyGrokChannelEffortIds(ids: readonly string[]): boolean {
  const norm = ids.map((id) => id.trim().toLowerCase()).filter(Boolean);
  if (norm.length !== 4) return false;
  const set = new Set(norm);
  return (
    set.has("low") &&
    set.has("medium") &&
    set.has("high") &&
    set.has("max") &&
    !set.has("xhigh")
  );
}

/**
 * When the channel is a Grok relay preset, rewrite the effort catalog to the
 * official enum. Returns null when the provider is not a Grok preset or the
 * list is already a user-custom catalog we should not clobber.
 */
export function alignGrokPresetEfforts(opts: {
  providerId?: string | null;
  baseUrl?: string | null;
  efforts?: Array<{ id: string; name?: string; isDefault?: boolean }> | null;
}): ProviderEffortEntry[] | null {
  const preset = matchPreset({
    providerId: opts.providerId,
    baseUrl: opts.baseUrl,
  });
  if (!isGrokRelayPresetId(preset?.id)) return null;
  const list = opts.efforts ?? [];
  const ids = list.map((e) => e.id);
  if (list.length === 0 || isLegacyGrokChannelEffortIds(ids)) {
    return officialGrokChannelEfforts();
  }
  const hasMax = ids.some((id) => id.trim().toLowerCase() === "max");
  const hasXhigh = ids.some((id) => id.trim().toLowerCase() === "xhigh");
  if (hasMax && !hasXhigh) {
    return list.map((e) => {
      if (e.id.trim().toLowerCase() !== "max") {
        return { id: e.id, name: e.name || e.id, isDefault: !!e.isDefault };
      }
      const rawName = (e.name || "").trim();
      return {
        id: "xhigh",
        name:
          !rawName || rawName.toLowerCase() === "max"
            ? "Extra high"
            : rawName,
        isDefault: !!e.isDefault,
      };
    });
  }
  return null;
}

/**
 * DeepSeek thinking-mode efforts (OpenAI `reasoning_effort` mapping table):
 * low / high / xhigh / max — see
 * https://api-docs.deepseek.com/zh-cn/guides/thinking_mode
 */
export const DEEPSEEK_EFFORTS: ProviderEffortEntry[] = [
  { id: "low", name: "low" },
  { id: "high", name: "high", isDefault: true },
  { id: "xhigh", name: "xhigh" },
  { id: "max", name: "max" },
];

export const DEEPSEEK_MODELS: ProviderModelEntry[] = [
  { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", supportsVision: false },
  {
    id: "deepseek-v4-flash-vision-exp",
    name: "DeepSeek V4 Flash Vision Exp",
    supportsVision: true,
  },
  { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", supportsVision: false },
];

/**
 * OpenRouter GLM-5.3-Flash (was stealth/ox-alpha). Docs: low / high / max only;
 * OpenRouter ships `max` reasoning by default. 1M context, native vision/video.
 */
export const OPENROUTER_EFFORTS: ProviderEffortEntry[] = [
  { id: "low", name: "low" },
  { id: "high", name: "high" },
  { id: "max", name: "max", isDefault: true },
];

export const OPENROUTER_MODELS: ProviderModelEntry[] = [
  {
    id: "z-ai/glm-5.3-flash",
    name: "GLM-5.3 Flash",
    contextWindow: 1_048_576,
    supportsVision: true,
    supportsVideo: true,
    efforts: OPENROUTER_EFFORTS.map((e) => ({ ...e })),
  },
];

/**
 * OrcaRouter OpenAI-compatible gateway. Prefixed model ids; `orcarouter/auto`
 * picks a live cheap model per request. See https://docs.orcarouter.ai/
 */
export const ORCAROUTER_MODELS: ProviderModelEntry[] = [
  { id: "orcarouter/auto", name: "Auto Router", supportsVision: true },
  { id: "openai/gpt-4o-mini", name: "GPT-4o mini", supportsVision: true },
  {
    id: "google/gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    supportsVision: true,
  },
];

/**
 * Volcengine Ark (火山方舟) Coding Plan — OpenAI-compatible chat_completions
 * at a non-`/v1` full path root (requires baseUrlFullPath).
 */
export const VOLCANO_ARK_MODELS: ProviderModelEntry[] = [
  { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
];

/**
 * Zhipu GLM thinking ladder (docs: glm-5.3 / glm-5.3-flash only accept
 * low / high / max). Matches the saved 智谱 channel.
 */
export const ZHIPU_EFFORTS: ProviderEffortEntry[] = [
  { id: "low", name: "low", isDefault: true },
  { id: "high", name: "high" },
  { id: "max", name: "max" },
];

export const ZHIPU_MODELS: ProviderModelEntry[] = [
  {
    id: "glm-5.3-flash",
    name: "GLM-5.3 Flash",
    contextWindow: 1_000_000,
    supportsVision: true,
    supportsVideo: true,
    efforts: ZHIPU_EFFORTS.map((e) => ({ ...e })),
  },
];

/** CN general / CN Coding Plan / international general / international Coding Plan. */
export const ZHIPU_ENDPOINTS: ProviderEndpointOption[] = [
  {
    id: "cn-api",
    labelKey: "prov.preset.endpoint.cnApi",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    baseUrlFullPath: true,
    apiKeyUrl: "https://open.bigmodel.cn/usercenter/proj-api-key",
  },
  {
    id: "cn-coding",
    labelKey: "prov.preset.endpoint.cnCoding",
    baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
    baseUrlFullPath: true,
    apiKeyUrl: "https://bigmodel.cn/coding-plan/personal/overview",
  },
  {
    id: "intl-api",
    labelKey: "prov.preset.endpoint.intlApi",
    baseUrl: "https://api.z.ai/api/paas/v4",
    baseUrlFullPath: true,
    apiKeyUrl: "https://z.ai/manage-apikey/apikey-list",
  },
  {
    id: "intl-coding",
    labelKey: "prov.preset.endpoint.intlCoding",
    baseUrl: "https://api.z.ai/api/coding/paas/v4",
    baseUrlFullPath: true,
    apiKeyUrl: "https://z.ai/manage-apikey/apikey-list",
  },
];

/**
 * Providers ported from the Supercharge CLI `/setup` wizard preset list
 * (crates/codegen/supercharge-shell/src/agent/provider_setup.rs). No brand
 * mark yet — falls back to the letter avatar like AI98PRO / Yun API did.
 */
export const CLI_SETUP_PRESET_MODELS = {
  pollinations: [
    { id: "openai", name: "OpenAI" },
    { id: "openai-fast", name: "OpenAI Fast" },
    { id: "qwen-coder", name: "Qwen Coder" },
    { id: "kimi-code", name: "Kimi Code" },
    { id: "deepseek", name: "DeepSeek" },
  ] satisfies ProviderModelEntry[],
  openai: [
    { id: "gpt-5.4", name: "GPT-5.4", supportsVision: true },
    { id: "gpt-4.1", name: "GPT-4.1", supportsVision: true },
    { id: "gpt-4o", name: "GPT-4o", supportsVision: true },
    { id: "gpt-4o-mini", name: "GPT-4o mini", supportsVision: true },
  ] satisfies ProviderModelEntry[],
  anthropic: [
    { id: "claude-opus-4-6", name: "Claude Opus 4.6", supportsVision: true },
    { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", supportsVision: true },
    {
      id: "claude-haiku-4-5-20251001",
      name: "Claude Haiku 4.5",
      supportsVision: true,
    },
  ] satisfies ProviderModelEntry[],
  google: [
    { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", supportsVision: true },
    { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", supportsVision: true },
  ] satisfies ProviderModelEntry[],
  groq: [
    { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B Versatile" },
    { id: "mixtral-8x7b-32768", name: "Mixtral 8x7B" },
  ] satisfies ProviderModelEntry[],
  kimi: [
    { id: "kimi-k2.6", name: "Kimi K2.6" },
    { id: "kimi-k2.5", name: "Kimi K2.5" },
  ] satisfies ProviderModelEntry[],
  qwen: [
    { id: "qwen3.6-plus", name: "Qwen3.6 Plus" },
    { id: "qwen3-coder-plus", name: "Qwen3 Coder Plus" },
    { id: "qwen-max", name: "Qwen Max" },
  ] satisfies ProviderModelEntry[],
  mistral: [
    { id: "mistral-large-latest", name: "Mistral Large" },
    { id: "codestral-latest", name: "Codestral" },
  ] satisfies ProviderModelEntry[],
  together: [
    {
      id: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
      name: "Llama 3.3 70B Turbo",
    },
    { id: "deepseek-ai/DeepSeek-V3", name: "DeepSeek V3" },
  ] satisfies ProviderModelEntry[],
  fireworks: [
    {
      id: "accounts/fireworks/models/llama-v3p3-70b-instruct",
      name: "Llama v3.3 70B Instruct",
    },
  ] satisfies ProviderModelEntry[],
  grok: [
    { id: "grok-4-0709", name: "Grok 4 (0709)" },
    { id: "grok-3", name: "Grok 3" },
    { id: "grok-3-mini", name: "Grok 3 Mini" },
  ] satisfies ProviderModelEntry[],
  ollama: [
    { id: "llama3.3", name: "Llama 3.3" },
    { id: "qwen2.5-coder", name: "Qwen2.5 Coder" },
    { id: "codellama", name: "Code Llama" },
  ] satisfies ProviderModelEntry[],
  lmstudio: [{ id: "local-model", name: "Local Model" }] satisfies ProviderModelEntry[],
  routingRun: [
    { id: "route/glm-5.1", name: "GLM-5.1 (Routed)" },
    { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro" },
  ] satisfies ProviderModelEntry[],
  zenllm: [
    { id: "zhipu/glm-5.1", name: "GLM-5.1" },
    { id: "deepseek/deepseek-v3", name: "DeepSeek V3" },
  ] satisfies ProviderModelEntry[],
  nous: [
    { id: "Hermes-4.3-36B", name: "Hermes 4.3 36B" },
    { id: "Hermes-4-70B", name: "Hermes 4 70B" },
    { id: "deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash" },
  ] satisfies ProviderModelEntry[],
} as const;

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "deepseek",
    name: "DeepSeek",
    suggestedId: "deepseek",
    baseUrl: "https://api.deepseek.com/v1",
    apiBackend: "chat_completions",
    models: DEEPSEEK_MODELS,
    efforts: DEEPSEEK_EFFORTS,
    blurbKey: "prov.preset.deepseek.blurb",
    apiKeyUrl: "https://platform.deepseek.com/",
    brandId: "deepseek",
  },
  /**
   * OpenRouter unified API. Model slug is the OpenRouter id
   * (`z-ai/glm-5.3-flash`); chat_completions — not Responses.
   * Vision + 1M context from the model card.
   */
  {
    id: "openrouter",
    name: "OpenRouter",
    suggestedId: "openrouter",
    baseUrl: "https://openrouter.ai/api/v1",
    apiBackend: "chat_completions",
    models: OPENROUTER_MODELS,
    efforts: OPENROUTER_EFFORTS.map((e) => ({ ...e })),
    blurbKey: "prov.preset.openrouter.blurb",
    apiKeyUrl: "https://openrouter.ai/settings/keys",
    brandId: "openrouter",
    supportsVision: true,
    contextWindow: 1_048_576,
  },
  /**
   * OrcaRouter unified OpenAI-compatible API. Model slugs are provider-prefixed
   * (`orcarouter/auto`, `openai/gpt-4o-mini`, …); chat_completions — not Responses.
   * No brand logo yet.
   */
  {
    id: "orcarouter",
    name: "OrcaRouter",
    suggestedId: "orcarouter",
    baseUrl: "https://api.orcarouter.ai/v1",
    apiBackend: "chat_completions",
    models: ORCAROUTER_MODELS,
    efforts: GROK_CHANNEL_EFFORTS.map((e) => ({ ...e })),
    blurbKey: "prov.preset.orcarouter.blurb",
    apiKeyUrl: "https://orcarouter.ai/",
    supportsVision: true,
  },
  /**
   * OpenCode Zen Go gateway. DeepSeek-class models on this host must use
   * `chat_completions` — their Responses stream emits non-standard events
   * (`ping`, deltas without `sequence_number`) that crash Grok Build CLI.
   */
  {
    id: "opencode-go",
    name: "OpenCode Go",
    suggestedId: "opencode-go",
    baseUrl: "https://opencode.ai/zen/go/v1",
    apiBackend: "chat_completions",
    models: [
      { id: "deepseek-v4-flash", name: "DeepSeek-V4-Flash" },
      { id: "deepseek-v4-pro", name: "DeepSeek-V4-Pro" },
    ],
    efforts: DEEPSEEK_EFFORTS.map((e) => ({ ...e })),
    blurbKey: "prov.preset.opencodeGo.blurb",
    apiKeyUrl: "https://opencode.ai/",
    brandId: "opencode-go",
  },
  /**
   * Volcengine Ark (火山方舟) Coding Plan.
   * Full-path root — do not auto-append `/v1` (app_base_url_full_path).
   */
  {
    id: "volcano-ark",
    name: "火山方舟",
    suggestedId: "volcano-ark",
    baseUrl: "https://ark.cn-beijing.volces.com/api/plan/v3",
    baseUrlFullPath: true,
    apiBackend: "chat_completions",
    models: VOLCANO_ARK_MODELS,
    efforts: GROK_CHANNEL_EFFORTS.map((e) => ({ ...e })),
    blurbKey: "prov.preset.volcanoArk.blurb",
    apiKeyUrl: "https://console.volcengine.com/ark",
    brandId: "volcano-ark",
  },
  /**
   * Zhipu / Z.AI GLM. One gallery chip, four OpenAI-compatible roots
   * (China API, China Coding Plan, international API, international Coding Plan).
   * All are full-path chat_completions — do not auto-append `/v1`.
   */
  {
    id: "zhipu",
    name: "智谱",
    suggestedId: "zhipu",
    baseUrl: ZHIPU_ENDPOINTS[0]!.baseUrl,
    baseUrlFullPath: true,
    apiBackend: "chat_completions",
    models: ZHIPU_MODELS,
    efforts: ZHIPU_EFFORTS.map((e) => ({ ...e })),
    blurbKey: "prov.preset.zhipu.blurb",
    apiKeyUrl: ZHIPU_ENDPOINTS[0]!.apiKeyUrl,
    brandId: "zhipu",
    supportsVision: true,
    contextWindow: 1_000_000,
    endpoints: ZHIPU_ENDPOINTS,
    defaultEndpointId: "cn-api",
  },
  {
    id: "pollinations",
    name: "Pollinations",
    suggestedId: "pollinations",
    baseUrl: "https://gen.pollinations.ai/v1",
    apiBackend: "chat_completions",
    models: CLI_SETUP_PRESET_MODELS.pollinations,
    efforts: GROK_CHANNEL_EFFORTS.map((e) => ({ ...e })),
    blurbKey: "prov.preset.pollinations.blurb",
  },
  {
    id: "openai",
    name: "OpenAI",
    suggestedId: "openai",
    baseUrl: "https://api.openai.com/v1",
    apiBackend: "chat_completions",
    models: CLI_SETUP_PRESET_MODELS.openai,
    efforts: GROK_CHANNEL_EFFORTS.map((e) => ({ ...e })),
    blurbKey: "prov.preset.openai.blurb",
    apiKeyUrl: "https://platform.openai.com/api-keys",
    supportsVision: true,
  },
  {
    id: "anthropic",
    name: "Anthropic",
    suggestedId: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    apiBackend: "messages",
    models: CLI_SETUP_PRESET_MODELS.anthropic,
    efforts: GROK_CHANNEL_EFFORTS.map((e) => ({ ...e })),
    blurbKey: "prov.preset.anthropic.blurb",
    apiKeyUrl: "https://console.anthropic.com/settings/keys",
    supportsVision: true,
  },
  {
    id: "google",
    name: "Google AI Studio",
    suggestedId: "google",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    apiBackend: "chat_completions",
    models: CLI_SETUP_PRESET_MODELS.google,
    efforts: GROK_CHANNEL_EFFORTS.map((e) => ({ ...e })),
    blurbKey: "prov.preset.google.blurb",
    apiKeyUrl: "https://aistudio.google.com/apikey",
    supportsVision: true,
  },
  {
    id: "groq",
    name: "Groq",
    suggestedId: "groq",
    baseUrl: "https://api.groq.com/openai/v1",
    apiBackend: "chat_completions",
    models: CLI_SETUP_PRESET_MODELS.groq,
    efforts: GROK_CHANNEL_EFFORTS.map((e) => ({ ...e })),
    blurbKey: "prov.preset.groq.blurb",
    apiKeyUrl: "https://console.groq.com/keys",
  },
  {
    id: "kimi-coding",
    name: "Kimi Coding",
    suggestedId: "kimi-coding",
    baseUrl: "https://api.moonshot.ai/v1",
    apiBackend: "chat_completions",
    models: CLI_SETUP_PRESET_MODELS.kimi,
    efforts: GROK_CHANNEL_EFFORTS.map((e) => ({ ...e })),
    blurbKey: "prov.preset.kimiCoding.blurb",
  },
  {
    id: "kimi",
    name: "Moonshot (Kimi Anthropic)",
    suggestedId: "kimi",
    baseUrl: "https://api.moonshot.ai/anthropic",
    apiBackend: "messages",
    models: CLI_SETUP_PRESET_MODELS.kimi,
    efforts: GROK_CHANNEL_EFFORTS.map((e) => ({ ...e })),
    blurbKey: "prov.preset.kimi.blurb",
  },
  {
    id: "qwen",
    name: "Qwen Cloud",
    suggestedId: "qwen",
    baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    apiBackend: "chat_completions",
    models: CLI_SETUP_PRESET_MODELS.qwen,
    efforts: GROK_CHANNEL_EFFORTS.map((e) => ({ ...e })),
    blurbKey: "prov.preset.qwen.blurb",
  },
  {
    id: "mistral",
    name: "Mistral AI",
    suggestedId: "mistral",
    baseUrl: "https://api.mistral.ai/v1",
    apiBackend: "chat_completions",
    models: CLI_SETUP_PRESET_MODELS.mistral,
    efforts: GROK_CHANNEL_EFFORTS.map((e) => ({ ...e })),
    blurbKey: "prov.preset.mistral.blurb",
    apiKeyUrl: "https://console.mistral.ai/api-keys",
  },
  {
    id: "together",
    name: "Together AI",
    suggestedId: "together",
    baseUrl: "https://api.together.xyz/v1",
    apiBackend: "chat_completions",
    models: CLI_SETUP_PRESET_MODELS.together,
    efforts: GROK_CHANNEL_EFFORTS.map((e) => ({ ...e })),
    blurbKey: "prov.preset.together.blurb",
  },
  {
    id: "fireworks",
    name: "Fireworks AI",
    suggestedId: "fireworks",
    baseUrl: "https://api.fireworks.ai/inference/v1",
    apiBackend: "chat_completions",
    models: CLI_SETUP_PRESET_MODELS.fireworks,
    efforts: GROK_CHANNEL_EFFORTS.map((e) => ({ ...e })),
    blurbKey: "prov.preset.fireworks.blurb",
  },
  {
    id: "grok",
    name: "xAI (Grok)",
    suggestedId: "grok",
    baseUrl: "https://api.x.ai/v1",
    apiBackend: "chat_completions",
    models: CLI_SETUP_PRESET_MODELS.grok,
    efforts: GROK_CHANNEL_EFFORTS.map((e) => ({ ...e })),
    blurbKey: "prov.preset.grok.blurb",
    apiKeyUrl: "https://console.x.ai",
  },
  {
    id: "ollama",
    name: "Ollama (local)",
    suggestedId: "ollama",
    baseUrl: "http://127.0.0.1:11434/v1",
    apiBackend: "chat_completions",
    models: CLI_SETUP_PRESET_MODELS.ollama,
    efforts: GROK_CHANNEL_EFFORTS.map((e) => ({ ...e })),
    blurbKey: "prov.preset.ollama.blurb",
  },
  {
    id: "lmstudio",
    name: "LM Studio",
    suggestedId: "lmstudio",
    baseUrl: "http://127.0.0.1:1234/v1",
    apiBackend: "chat_completions",
    models: CLI_SETUP_PRESET_MODELS.lmstudio,
    efforts: GROK_CHANNEL_EFFORTS.map((e) => ({ ...e })),
    blurbKey: "prov.preset.lmstudio.blurb",
  },
  {
    id: "routing-run",
    name: "Routing.run",
    suggestedId: "routing-run",
    baseUrl: "https://api.routing.run/v1",
    apiBackend: "chat_completions",
    models: CLI_SETUP_PRESET_MODELS.routingRun,
    efforts: GROK_CHANNEL_EFFORTS.map((e) => ({ ...e })),
    blurbKey: "prov.preset.routingRun.blurb",
  },
  {
    id: "zenllm",
    name: "ZenLLM",
    suggestedId: "zenllm",
    baseUrl: "https://api.zenllm.org/v1",
    apiBackend: "chat_completions",
    models: CLI_SETUP_PRESET_MODELS.zenllm,
    efforts: GROK_CHANNEL_EFFORTS.map((e) => ({ ...e })),
    blurbKey: "prov.preset.zenllm.blurb",
  },
  {
    id: "nous",
    name: "Nous Research",
    suggestedId: "nous",
    baseUrl: "https://inference-api.nousresearch.com/v1",
    apiBackend: "chat_completions",
    models: CLI_SETUP_PRESET_MODELS.nous,
    efforts: GROK_CHANNEL_EFFORTS.map((e) => ({ ...e })),
    blurbKey: "prov.preset.nous.blurb",
  },
];

export function findProviderPreset(id: string): ProviderPreset | undefined {
  const n = id.trim().toLowerCase();
  if (!n) return undefined;
  return PROVIDER_PRESETS.find(
    (p) => p.id.toLowerCase() === n || p.suggestedId.toLowerCase() === n,
  );
}

function matchPreset(opts: {
  providerId?: string | null;
  baseUrl?: string | null;
}): ProviderPreset | undefined {
  const pid = opts.providerId?.trim().toLowerCase() ?? "";
  if (pid) {
    const byId = PROVIDER_PRESETS.find(
      (p) => p.id.toLowerCase() === pid || p.suggestedId.toLowerCase() === pid,
    );
    if (byId) return byId;
    // Legacy local ids that still map to a known brand (e.g. huo-shan → 火山方舟).
    if (
      pid === "huo-shan" ||
      pid === "huoshan" ||
      pid === "volcengine-ark" ||
      pid === "volcengine" ||
      pid === "ark"
    ) {
      const ark = PROVIDER_PRESETS.find((p) => p.id === "volcano-ark");
      if (ark) return ark;
    }
    // Auto-suffixed local ids from the add form (ai98pro-----1072183582).
    if (pid === "ai98pro" || pid.startsWith("ai98pro-")) {
      const ai98 = PROVIDER_PRESETS.find((p) => p.id === "ai98pro");
      if (ai98) return ai98;
    }
    if (pid === "openrouter" || pid.startsWith("openrouter-")) {
      const or = PROVIDER_PRESETS.find((p) => p.id === "openrouter");
      if (or) return or;
    }
    if (pid === "orcarouter" || pid.startsWith("orcarouter-")) {
      const orca = PROVIDER_PRESETS.find((p) => p.id === "orcarouter");
      if (orca) return orca;
    }
    if (
      pid === "zhipu" ||
      pid === "zhi-p" ||
      pid === "zhipuai" ||
      pid.startsWith("zhipu-") ||
      pid.startsWith("zhi-p-")
    ) {
      const zp = PROVIDER_PRESETS.find((p) => p.id === "zhipu");
      if (zp) return zp;
    }
  }
  let host = "";
  try {
    host = new URL(opts.baseUrl?.trim() || "").host.toLowerCase();
  } catch {
    host = "";
  }
  if (!host) return undefined;
  if (host === "open.bigmodel.cn" || host.endsWith(".open.bigmodel.cn")) {
    const zp = PROVIDER_PRESETS.find((p) => p.id === "zhipu");
    if (zp) return zp;
  }
  if (host === "api.z.ai") {
    const zp = PROVIDER_PRESETS.find((p) => p.id === "zhipu");
    if (zp) return zp;
  }
  // Volcengine Ark hosts: ark.*.volces.com / *.volcengineapi.com
  if (
    host.includes("volces.com") ||
    host.includes("volcengineapi.com") ||
    host.endsWith("volcengine.com")
  ) {
    if (host.startsWith("ark.") || host.includes(".ark.") || host.includes("ark")) {
      const ark = PROVIDER_PRESETS.find((p) => p.id === "volcano-ark");
      if (ark) return ark;
    }
  }
  for (const p of PROVIDER_PRESETS) {
    for (const url of presetUrls(p)) {
      try {
        if (new URL(url).host.toLowerCase() === host) return p;
      } catch {
        /* skip */
      }
    }
  }
  for (const p of PROVIDER_PRESETS) {
    try {
      const ph = new URL(p.baseUrl).host.toLowerCase();
      if (host === ph || host.endsWith(`.${ph}`) || ph.endsWith(`.${host}`)) {
        return p;
      }
    } catch {
      /* skip */
    }
  }
  return undefined;
}

function normalizeEndpointUrl(url: string): string {
  return url.trim().replace(/\/+$/, "").toLowerCase();
}

function presetUrls(preset: ProviderPreset): string[] {
  const extra = (preset.endpoints ?? []).map((e) => e.baseUrl);
  return [preset.baseUrl, ...extra];
}

export function matchPresetEndpoint(
  preset: ProviderPreset,
  baseUrl?: string | null,
): ProviderEndpointOption | undefined {
  const endpoints = preset.endpoints;
  if (!endpoints?.length) return undefined;
  const cur = normalizeEndpointUrl(baseUrl ?? "");
  if (cur) {
    const hit = endpoints.find(
      (e) => normalizeEndpointUrl(e.baseUrl) === cur,
    );
    if (hit) return hit;
  }
  return undefined;
}

export function defaultPresetEndpoint(
  preset: ProviderPreset,
): ProviderEndpointOption | undefined {
  const endpoints = preset.endpoints;
  if (!endpoints?.length) return undefined;
  return (
    endpoints.find((e) => e.id === preset.defaultEndpointId) ?? endpoints[0]
  );
}

/** Apply one endpoint onto a preset (Base URL / full-path / Get API Key). */
export function applyPresetEndpoint(
  preset: ProviderPreset,
  endpointId?: string | null,
): {
  baseUrl: string;
  baseUrlFullPath: boolean;
  apiKeyUrl: string | null;
  endpoint: ProviderEndpointOption | undefined;
} {
  const endpoints = preset.endpoints;
  const endpoint =
    (endpointId && endpoints?.find((e) => e.id === endpointId)) ||
    matchPresetEndpoint(preset, preset.baseUrl) ||
    defaultPresetEndpoint(preset);
  return {
    baseUrl: endpoint?.baseUrl ?? preset.baseUrl,
    baseUrlFullPath: !!(endpoint?.baseUrlFullPath ?? preset.baseUrlFullPath),
    apiKeyUrl: endpoint?.apiKeyUrl ?? preset.apiKeyUrl ?? null,
    endpoint,
  };
}

/** Resolve API-key signup URL for a form (by preset id or base URL host). */
export function resolveProviderApiKeyUrl(opts: {
  providerId?: string | null;
  baseUrl?: string | null;
}): string | null {
  const preset = matchPreset(opts);
  if (!preset) return null;
  if (preset.endpoints?.length) {
    const hit = matchPresetEndpoint(preset, opts.baseUrl);
    if (hit?.apiKeyUrl) return hit.apiKeyUrl;
  }
  return preset.apiKeyUrl ?? null;
}

export function resolveMatchedProviderPreset(opts: {
  providerId?: string | null;
  baseUrl?: string | null;
}): ProviderPreset | undefined {
  return matchPreset(opts);
}

/** Resolve brand logo key for UI avatars (null when no mark). */
export function resolveProviderBrandId(opts: {
  providerId?: string | null;
  baseUrl?: string | null;
}): ProviderBrandId | null {
  return matchPreset(opts)?.brandId ?? null;
}

/** Default efforts when creating a blank custom channel (Grok-compatible). */
export function defaultCustomChannelEfforts(): ProviderEffortEntry[] {
  return GROK_CHANNEL_EFFORTS.map((e) => ({ ...e }));
}
