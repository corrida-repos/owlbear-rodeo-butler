/** Pieces shared by the 5etools converter, copy resolver and CLI (no imports, to avoid cycles). */

export function proficiencyBonusForCr(cr: number): number {
  if (!Number.isFinite(cr) || cr < 5) return 2;
  return Math.min(9, Math.floor((cr - 1) / 4) + 2);
}

export interface CatalogEntry {
  source: string;
  file: string;
  title: string;
  published?: string;
  /** Inferred from publication date (5etools doesn't tag editions): on/after the 2024 PHB => "2024". */
  rules: "2024" | "2014";
}
export type Catalog = Record<string, CatalogEntry>;

export const RULES_2024_FROM = "2024-09-17"; // Player's Handbook (2024) release

/** Builds the source catalog from 5etools data/bestiary/index.json + data/books.json + data/adventures.json. */
export function buildCatalog(
  index: Record<string, string>,
  books: { book?: any[] } = {},
  adventures: { adventure?: any[] } = {},
): Catalog {
  const meta = new Map<string, { name: string; published?: string }>();
  for (const b of [...(books.book ?? []), ...(adventures.adventure ?? [])]) meta.set(b.id ?? b.source, { name: b.name, published: b.published });
  const out: Catalog = {};
  for (const [source, file] of Object.entries(index)) {
    const m = meta.get(source);
    out[source] = {
      source,
      file,
      title: m?.name ?? source,
      published: m?.published,
      rules: m?.published && m.published >= RULES_2024_FROM ? "2024" : "2014",
    };
  }
  return out;
}

/** Case-insensitive lookup of the catalog key ("xmm" -> "XMM"). */
export function catalogKey(catalog: Catalog, source: string): string | undefined {
  if (catalog[source]) return source;
  return Object.keys(catalog).find((k) => k.toLowerCase() === source.toLowerCase());
}

/**
 * When no book is named: prefer 2024-rules sources (newest first), then the newest 2014 source.
 * Returns the chosen candidate plus a note listing the alternatives.
 */
export function chooseMonster<T extends { name: string; source: string }>(candidates: T[], catalog: Catalog): { chosen: T; note: string } {
  if (!candidates.length) throw new Error("no candidates");
  const score = (c: T) => {
    const e = catalog[c.source];
    return [e?.rules === "2024" ? 1 : 0, e?.published ?? ""] as const;
  };
  const sorted = [...candidates].sort((a, b) => {
    const [ra, pa] = score(a);
    const [rb, pb] = score(b);
    return rb - ra || (pb > pa ? 1 : pb < pa ? -1 : 0);
  });
  const chosen = sorted[0]!;
  const note = sorted.length > 1
    ? `"${chosen.name}": no book given; picked ${catalog[chosen.source]?.title ?? chosen.source} (${chosen.source}) over ${sorted.slice(1).map((c) => c.source).join(", ")}.`
    : `"${chosen.name}": no book given; only found in ${catalog[chosen.source]?.title ?? chosen.source} (${chosen.source}).`;
  return { chosen, note };
}
