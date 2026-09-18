import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(__dirname, path), "utf8");
const page = read("../components/SettingsPage.tsx");
const panel = read("../components/ProvidersPanel.tsx");
const settings = read("../styles/settings.part1.css");
const appearance = read("../styles/settings.part3.css");
const part1 = read("../styles/composer.part1.css");
const part2 = read("../styles/composer.part2.css");
const part3 = read("../styles/composer.part3.css");

function rule(css: string, selector: string) {
  const start = css.indexOf(`\n${selector} {`);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf("}", start) + 1);
}

describe("Settings page scrolling", () => {
  it("keeps the whole content column scrollable for every section", () => {
    expect(page).not.toContain("dualPaneFill");
    expect(page).not.toContain("--pane-fill");
    expect(rule(settings, ".settings-page__content")).toContain("overflow-y: auto");
    expect(rule(settings, ".settings-page__content")).toContain("display: block");
    expect(rule(settings, ".settings-page__main")).toContain("padding: 16px 36px 96px");
    expect(page).toMatch(/className="settings-page__content"\s+tabIndex=\{0\}\s+role="region"/);
  });

  it("keeps sidebar navigation outside the page scrollport", () => {
    const navEnd = page.indexOf("</aside>");
    const content = page.indexOf('className="settings-page__content"');
    expect(navEnd).toBeGreaterThanOrEqual(0);
    expect(content).toBeGreaterThan(navEnd);
    expect(rule(settings, ".app-settings-stage")).toContain("inset: 0");
    expect(rule(settings, ".settings-page")).toContain("height: 100%");
  });

  it("lets provider content and Save actions grow into the page scroll height", () => {
    expect(panel).not.toContain("OverlayScroll");
    expect(panel).toContain('<div className="prov-rail">');
    expect(panel).toContain('<div className="prov-split__detail">');
    expect(rule(part1, ".prov-split")).toContain("align-items: start");
    expect(rule(part1, ".prov-split")).toContain("overflow: visible");
    expect(rule(part2, ".prov-detail")).toContain("height: auto");
    expect(panel).toContain('className="prov-form__actions"');
    expect(part1 + part2 + part3).not.toContain("settings-page__main--pane-fill");
  });

  it("uses natural stacked rows on smaller windows instead of viewport percentages", () => {
    expect(part3).toMatch(/@media \(max-width:\s*860px\)\s*\{\s*\.prov-split\s*\{[^}]*grid-template-rows:\s*auto auto/s);
  });

  it("lets Appearance scroll with Settings without changing standalone theme editors", () => {
    expect(rule(appearance, ".settings-page .settings-appearance-theme-layout")).toContain("align-items: start");
    expect(rule(appearance, ".settings-page .settings-appearance-theme-layout__main")).toContain("overflow: visible");
    expect(rule(appearance, ".theme-editor-shell__body")).toContain("overflow: hidden");
  });
});
