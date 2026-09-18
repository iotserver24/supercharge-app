import { describe, expect, it } from "vitest";
import {
  formatChineseCount,
  formatCompactNumber,
  formatLocaleCount,
  formatMessageTime,
  formatQuotaResetTime,
  formatRelativeTime,
  localDateKeyFromIso,
  tierLabel,
} from "./accountUi";
import type { BillingSnapshot } from "./api";

function billing(partial: Partial<BillingSnapshot>): BillingSnapshot {
  return {
    available: false,
    source: "test",
    message: null,
    subscriptionTier: null,
    creditUsagePercent: null,
    remainingPercent: null,
    monthlyLimit: null,
    includedUsed: null,
    totalUsed: null,
    prepaidBalance: null,
    onDemandEnabled: null,
    onDemandCap: null,
    onDemandUsed: null,
    billingPeriodStart: null,
    billingPeriodEnd: null,
    resetsAt: null,
    isUnifiedBillingUser: null,
    products: [],
    manageUrl: "",
    subscribeUrl: "",
    fetchedAt: null,
    ...partial,
  };
}

describe("tierLabel", () => {
  it("prefers subscriptionTier string", () => {
    expect(
      tierLabel(billing({ subscriptionTier: "Premium" }), "official_oauth"),
    ).toBe("Premium");
    expect(tierLabel(billing({ subscriptionTier: null }), "official_oauth")).toBe(
      "Supercharge",
    );
  });
});

describe("formatMessageTime", () => {
  it("formats weekday + time", () => {
    const iso = "2026-07-21T07:23:00.000Z";
    const zh = formatMessageTime(iso, "zh");
    const en = formatMessageTime(iso, "en");
    expect(zh.length).toBeGreaterThan(4);
    expect(en.length).toBeGreaterThan(4);
    expect(formatMessageTime(null, "zh")).toBe("");
  });
});

describe("formatRelativeTime", () => {
  it("returns em dash for empty/invalid", () => {
    expect(formatRelativeTime(null, "en")).toBe("—");
    expect(formatRelativeTime(undefined, "zh")).toBe("—");
    expect(formatRelativeTime("not-a-date", "en")).toBe("—");
  });

  it("formats recent times with relative units", () => {
    const now = Date.now();
    const twoMinAgo = new Date(now - 2 * 60 * 1000).toISOString();
    const en = formatRelativeTime(twoMinAgo, "en");
    const zh = formatRelativeTime(twoMinAgo, "zh");
    expect(en.length).toBeGreaterThan(1);
    expect(zh.length).toBeGreaterThan(1);
    // English uses minute/minutes or "2 minutes ago" / "2 min. ago" depending on engine
    expect(/minute|min/i.test(en) || /\d/.test(en)).toBe(true);
  });
});

describe("formatQuotaResetTime", () => {
  // Fixed local instant via Date components: Apr 15 09:05, whatever the
  // runner's time zone is.
  const iso = new Date(2026, 3, 15, 9, 5).toISOString();

  it("orders the parts the way the locale does", () => {
    // en-GB and en-US share a language and disagree on both of the things
    // this function prints, so a passing assertion here means the tag really
    // reached Intl rather than a hard-coded template.
    expect(formatQuotaResetTime(iso, "en")).toContain("04/15");
    expect(formatQuotaResetTime(iso, "de")).toContain("15.04");
    expect(formatQuotaResetTime(iso, "ja")).toContain("04/15");
  });

  it("keeps the clock in local time", () => {
    expect(formatQuotaResetTime(iso, "de")).toContain("09:05");
  });

  it("returns an empty string for nothing to show", () => {
    expect(formatQuotaResetTime(null, "en")).toBe("");
    expect(formatQuotaResetTime(undefined, "en")).toBe("");
    expect(formatQuotaResetTime("not-a-date", "en")).toBe("");
  });
});

describe("localDateKeyFromIso", () => {
  it("maps ISO to local YYYY-MM-DD", () => {
    const d = new Date(2026, 3, 15, 23, 30);
    expect(localDateKeyFromIso(d.toISOString())).toBe("2026-04-15");
    expect(localDateKeyFromIso(null)).toBeNull();
    expect(localDateKeyFromIso("bad")).toBeNull();
  });
});

describe("formatChineseCount", () => {
  it("uses 百 / 千 / 万 / 亿 (simplified)", () => {
    expect(formatChineseCount(0)).toBe("0");
    expect(formatChineseCount(42)).toBe("42");
    expect(formatChineseCount(100)).toBe("1百");
    expect(formatChineseCount(500)).toBe("5百");
    expect(formatChineseCount(1_000)).toBe("1千");
    expect(formatChineseCount(12_500)).toBe("1.3万");
    expect(formatChineseCount(123_456)).toBe("12.3万");
    expect(formatChineseCount(10_000)).toBe("1万");
    expect(formatChineseCount(100_000_000)).toBe("1亿");
  });

  it("uses 萬 / 億 for zh-TW", () => {
    expect(formatChineseCount(12_500, "zh-TW")).toBe("1.3萬");
    expect(formatChineseCount(100_000_000, "zh-TW")).toBe("1億");
  });

  it("stays on Chinese units even when locale is en", () => {
    expect(formatChineseCount(12_500, "en")).toBe("1.3万");
  });

  it("handles null / non-finite", () => {
    expect(formatChineseCount(null)).toBe("—");
    expect(formatChineseCount(Number.NaN)).toBe("—");
  });
});

describe("formatLocaleCount / formatCompactNumber", () => {
  it("uses K/M/B when locale is English", () => {
    expect(formatLocaleCount(300, "en")).toBe("300");
    expect(formatLocaleCount(12_500, "en")).toBe("12.5K");
    expect(formatLocaleCount(500_000, "en")).toBe("500K");
    expect(formatLocaleCount(1_000_000, "en")).toBe("1M");
    expect(formatCompactNumber(12_500, "en")).toBe("12.5K");
  });

  it("keeps Chinese units for zh / zh-TW", () => {
    expect(formatLocaleCount(12_500, "zh")).toBe("1.3万");
    expect(formatLocaleCount(12_500, "zh-TW")).toBe("1.3萬");
    expect(formatCompactNumber(12_500, "zh")).toBe("1.3万");
  });
});
