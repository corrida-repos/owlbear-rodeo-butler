/**
 * Loads 5etools data on demand (cached under .cache/5etools): the bestiary index, book/adventure titles,
 * monster templates and individual bestiary files. Resolves `_copy` chains across books.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { FivetoolsResolved } from "../../src/core/builder";
import { findMonster, FIVETOOLS_DATA_BASE } from "../../src/core/fivetools";
import { copyBaseRef, resolveCopy, usesTemplates } from "../../src/core/fivetools-copy";
import { buildCatalog, catalogKey, chooseMonster, type Catalog } from "../../src/core/fivetools-shared";

export class FivetoolsLibrary {
  catalog: Catalog = {};
  private files = new Map<string, any>();
  private templates: any[] | null = null;
  private prepared = new Map<string, FivetoolsResolved>();

  constructor(private cacheDir = resolve(".cache/5etools"), private dataDir?: string, private log: (s: string) => void = () => {}) {}

  private async fetchJson(rel: string): Promise<any> {
    if (this.dataDir && existsSync(join(this.dataDir, rel))) return JSON.parse(readFileSync(join(this.dataDir, rel), "utf8"));
    const cacheFile = join(this.cacheDir, rel.replace(/^bestiary\//, ""));
    if (existsSync(cacheFile)) return JSON.parse(readFileSync(cacheFile, "utf8"));
    const url = `${FIVETOOLS_DATA_BASE}/${rel}`;
    this.log(`fetching ${url}`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    const text = await res.text();
    mkdirSync(this.cacheDir, { recursive: true });
    writeFileSync(cacheFile, text);
    return JSON.parse(text);
  }

  async init() {
    const [index, books, adventures] = await Promise.all([
      this.fetchJson("bestiary/index.json"),
      this.fetchJson("books.json"),
      this.fetchJson("adventures.json"),
    ]);
    this.catalog = buildCatalog(index, books, adventures);
    return this;
  }

  private key(source: string): string {
    const k = catalogKey(this.catalog, source);
    if (!k) throw new Error(`Unknown 5etools source "${source}". Known sources include: ${Object.keys(this.catalog).slice(0, 25).join(", ")}…`);
    return k;
  }

  async loadSource(source: string): Promise<any> {
    const k = this.key(source);
    if (!this.files.has(k)) this.files.set(k, await this.fetchJson(`bestiary/${this.catalog[k]!.file}`));
    return this.files.get(k);
  }

  private rawLookup = (name: string, source: string) => {
    const k = catalogKey(this.catalog, source);
    const data = k ? this.files.get(k) : undefined;
    return data?.monster?.find((m: any) => m.name.toLowerCase() === name.toLowerCase() && m.source.toLowerCase() === source.toLowerCase());
  };

  /** Loads every file a `_copy` chain needs (bases in other books, templates). */
  private async ensureChain(raw: any) {
    let cur = raw;
    for (let i = 0; cur && i < 10; i++) {
      if (usesTemplates(cur) && !this.templates) this.templates = (await this.fetchJson("bestiary/template.json")).monsterTemplate ?? [];
      const ref = copyBaseRef(cur);
      if (!ref) return;
      await this.loadSource(ref.source);
      cur = this.rawLookup(ref.name, ref.source);
      if (!cur) throw new Error(`"${raw.name}" copies "${ref.name}" (${ref.source}), which isn't in 5etools' ${ref.source} data`);
    }
  }

  /** Finds, loads and copy-resolves a creature. Call before the (synchronous) package build. */
  async prepare(name: string, source?: string): Promise<FivetoolsResolved> {
    const cacheKey = `${name.toLowerCase()}|${source?.toLowerCase() ?? ""}`;
    const hit = this.prepared.get(cacheKey);
    if (hit) return hit;
    let raw: any;
    const notes: string[] = [];
    if (source) {
      raw = findMonster(await this.loadSource(source), name, this.key(source));
    } else {
      for (const s of Object.keys(this.catalog)) await this.loadSource(s);
      const candidates = [...this.files.values()].flatMap((d) => (d.monster ?? []).filter((m: any) => m.name?.toLowerCase() === name.toLowerCase()));
      if (!candidates.length) {
        const near = [...this.files.values()].flatMap((d) => d.monster ?? []).filter((m: any) => m.name?.toLowerCase().includes(name.toLowerCase())).slice(0, 8).map((m: any) => `${m.name} (${m.source})`);
        throw new Error(`No creature named "${name}" in any 5etools book.${near.length ? ` Similar: ${near.join(", ")}` : ""}`);
      }
      const { chosen, note } = chooseMonster(candidates, this.catalog);
      raw = chosen;
      notes.push(note);
    }
    await this.ensureChain(raw);
    const r = resolveCopy(raw, { getMonster: this.rawLookup, templates: this.templates ?? [] });
    const out: FivetoolsResolved = { monster: r.monster, catalogEntry: this.catalog[this.key(raw.source)], copyChain: r.chain, copyNotes: r.notes, notes };
    this.prepared.set(cacheKey, out);
    return out;
  }

  /** Synchronous accessor for BuildDeps.fivetools (after prepare). */
  get = (name: string, source?: string): FivetoolsResolved => {
    const r = this.prepared.get(`${name.toLowerCase()}|${source?.toLowerCase() ?? ""}`);
    if (!r) throw new Error(`internal: ${name} (${source ?? "any"}) was not prepared`);
    return r;
  };
}
