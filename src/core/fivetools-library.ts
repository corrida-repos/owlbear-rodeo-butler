/**
 * Loads 5etools data on demand with an injectable fetcher (browser: plain fetch from GitHub, which sends
 * CORS `*`; Node CLI: fetch + disk cache). Resolves `_copy` chains across books.
 */
import type { FivetoolsResolved } from "./builder";
import { findMonster, FIVETOOLS_DATA_BASE } from "./fivetools";
import { copyBaseRef, resolveCopy, usesTemplates } from "./fivetools-copy";
import { buildCatalog, catalogKey, chooseMonster, type Catalog } from "./fivetools-shared";

/** Fetches a path relative to 5etools' data/ folder, e.g. "bestiary/index.json". */
export type DataFetcher = (rel: string) => Promise<any>;

export const httpFetcher: DataFetcher = async (rel) => {
  const res = await fetch(`${FIVETOOLS_DATA_BASE}/${rel}`);
  if (!res.ok) throw new Error(`HTTP ${res.status} for 5etools ${rel}`);
  return res.json();
};

export class FivetoolsLibrary {
  catalog: Catalog = {};
  private files = new Map<string, Promise<any>>();
  private templates: any[] | null = null;
  private prepared = new Map<string, FivetoolsResolved>();

  constructor(private fetchJson: DataFetcher = httpFetcher) {}

  async init() {
    const [index, books, adventures] = await Promise.all([
      this.fetchJson("bestiary/index.json"),
      this.fetchJson("books.json"),
      this.fetchJson("adventures.json"),
    ]);
    this.catalog = buildCatalog(index, books, adventures);
    return this;
  }

  key(source: string): string {
    const k = catalogKey(this.catalog, source);
    if (!k) throw new Error(`Unknown 5etools source "${source}".`);
    return k;
  }

  loadSource(source: string): Promise<any> {
    const k = this.key(source);
    if (!this.files.has(k)) this.files.set(k, this.fetchJson(`bestiary/${this.catalog[k]!.file}`));
    return this.files.get(k)!;
  }

  private loaded = new Map<string, any>();
  private rawLookup = (name: string, source: string) => {
    const k = catalogKey(this.catalog, source);
    const data = k ? this.loaded.get(k) : undefined;
    return data?.monster?.find((m: any) => m.name.toLowerCase() === name.toLowerCase() && m.source.toLowerCase() === source.toLowerCase());
  };
  private async load(source: string) {
    const k = this.key(source);
    if (!this.loaded.has(k)) this.loaded.set(k, await this.loadSource(k));
    return this.loaded.get(k);
  }

  private async ensureChain(raw: any) {
    let cur = raw;
    for (let i = 0; cur && i < 10; i++) {
      if (usesTemplates(cur) && !this.templates) this.templates = (await this.fetchJson("bestiary/template.json")).monsterTemplate ?? [];
      const ref = copyBaseRef(cur);
      if (!ref) return;
      await this.load(ref.source);
      cur = this.rawLookup(ref.name, ref.source);
      if (!cur) throw new Error(`"${raw.name}" copies "${ref.name}" (${ref.source}), which isn't in 5etools' ${ref.source} data`);
    }
  }

  /** Finds, loads and copy-resolves a creature. Without `source`, every book is searched (2024 rules preferred). */
  async prepare(name: string, source?: string): Promise<FivetoolsResolved> {
    const cacheKey = `${name.toLowerCase()}|${source?.toLowerCase() ?? ""}`;
    const hit = this.prepared.get(cacheKey);
    if (hit) return hit;
    let raw: any;
    const notes: string[] = [];
    if (source) {
      raw = findMonster(await this.load(source), name, this.key(source));
    } else {
      await Promise.all(Object.keys(this.catalog).map((s) => this.load(s)));
      const all = [...this.loaded.values()].flatMap((d) => d.monster ?? []);
      const candidates = all.filter((m: any) => m.name?.toLowerCase() === name.toLowerCase());
      if (!candidates.length) {
        const near = all.filter((m: any) => m.name?.toLowerCase().includes(name.toLowerCase())).slice(0, 8).map((m: any) => `${m.name} (${m.source})`);
        throw new Error(`No creature named "${name}" in any 5etools book.${near.length ? ` Similar: ${near.join(", ")}` : ""}`);
      }
      const { chosen, note } = chooseMonster(candidates, this.catalog);
      raw = chosen;
      notes.push(note);
    }
    await this.ensureChain(raw);
    const r = resolveCopy(raw, { getMonster: this.rawLookup, templates: this.templates ?? [] });
    // Lair actions live in 5etools' legendary groups (2014 books; the 2024 Monster Manual has none).
    if (r.monster.legendaryGroup && !r.monster.lairActions) {
      const lair = await this.lairActions(r.monster.legendaryGroup).catch(() => null);
      if (lair?.length) r.monster = { ...r.monster, _lairActions: lair };
    }
    const out: FivetoolsResolved = { monster: r.monster, catalogEntry: this.catalog[this.key(raw.source)], copyChain: r.chain, copyNotes: r.notes, notes };
    this.prepared.set(cacheKey, out);
    return out;
  }

  private groups: Promise<any[]> | null = null;
  /** A legendary group's lair actions, following its `_copy` (with appended lair actions). */
  async lairActions(ref: { name: string; source: string }): Promise<unknown[] | null> {
    this.groups ??= this.fetchJson("bestiary/legendarygroups.json").then((d) => d.legendaryGroup ?? []);
    return lairActionsOf(await this.groups, ref);
  }

  /** Synchronous accessor for BuildDeps.fivetools (after prepare). */
  get = (name: string, source?: string): FivetoolsResolved => {
    const r = this.prepared.get(`${name.toLowerCase()}|${source?.toLowerCase() ?? ""}`);
    if (!r) throw new Error(`internal: ${name} (${source ?? "any"}) was not prepared`);
    return r;
  };
}

/** A legendary group's lair actions; a `_copy` takes its base's, plus any appended with `_mod.lairActions` (appendArr). */
export function lairActionsOf(groups: any[], ref: { name: string; source: string }, depth = 0): unknown[] | null {
  const g = groups.find((x) => x.name?.toLowerCase() === ref.name?.toLowerCase() && x.source?.toLowerCase() === ref.source?.toLowerCase());
  if (!g) return null;
  if (Array.isArray(g.lairActions)) return g.lairActions;
  if (g._copy && depth < 5) {
    const base = lairActionsOf(groups, g._copy, depth + 1) ?? [];
    const mod = g._copy._mod?.lairActions;
    const extra = mod && mod.mode === "appendArr" ? (Array.isArray(mod.items) ? mod.items : [mod.items]) : [];
    return base.length || extra.length ? [...base, ...extra] : null;
  }
  return null;
}
