import { useEffect, useState } from "react";
import { searchSkillMd, type SkillMdItem } from "@/lib/skillmd";
import { IconRefresh, IconSkills } from "@/components/icons";

export function SkillMdMarketplaceSection({ context = "plugins" }: { context?: "plugins" | "skills" }) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<SkillMdItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setItems([]);
      setError(null);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void searchSkillMd(trimmed, controller.signal)
      .then(setItems)
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setItems([]);
          setError(reason instanceof Error ? reason.message : "SkillMD search failed");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [query, refreshKey]);

  return (
    <section className="ext-ref-block" aria-labelledby="skillmd-marketplace-title">
      <div className="ext-ref-block__head">
        <div>
          <div className="ext-ref-section-label" id="skillmd-marketplace-title">
            <IconSkills size={15} /> SkillMD {context === "skills" ? "skills" : "skills and plugins"}
          </div>
          <p className="ext-ref-block__hint">
            Discover public SkillMD entries. Results are discovery-only; installation stays disabled until the official secure bundle flow is available.
          </p>
        </div>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          disabled={loading || query.trim().length < 2}
          onClick={() => setRefreshKey((value) => value + 1)}
          aria-label="Refresh SkillMD results"
        >
          <IconRefresh size={14} />
          <span>{loading ? "Searching…" : "Refresh"}</span>
        </button>
      </div>
      <input
        type="text"
        className="settings-input"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search SkillMD…"
        aria-label="Search SkillMD"
      />
      {error ? <p className="ext-alert ext-alert--warn" role="alert">{error}</p> : null}
      {!loading && !error && query.trim().length >= 2 && items.length === 0 ? (
        <p className="ext-ref-empty">No SkillMD results match this search.</p>
      ) : null}
      {items.length > 0 ? (
        <ul className="ext-ref-featured" aria-label="SkillMD results">
          {items.map((item) => (
            <li className="ext-ref-featured__item" key={`${item.type}:${item.slug}`}>
              <div className="ext-ref-featured__icon ext-ref-featured__icon--fallback" aria-hidden>
                <IconSkills size={18} />
              </div>
              <div className="ext-ref-featured__body">
                <div className="ext-ref-featured__title">
                  {item.title}
                  <span className="ext-ref-badge">{item.type === "pack" ? "Plugin pack" : "Skill"}</span>
                  {item.verified ? <span className="ext-ref-badge">Verified</span> : null}
                </div>
                <div className="ext-ref-featured__desc">{item.description}</div>
                <div className="ext-ref-featured__desc">{item.category ?? "SkillMD"} · {item.slug}</div>
              </div>
              <div className="ext-ref-featured__end">
                {item.rawUrl ? (
                  <a className="btn btn--ghost btn--sm" href={item.rawUrl} target="_blank" rel="noreferrer">View source</a>
                ) : null}
                <span className="ext-ref-badge">Discovery only</span>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
