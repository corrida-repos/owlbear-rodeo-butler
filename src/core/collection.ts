/**
 * Creature collection (F8): homebrew and favourite units the GM keeps, stored in the GM's browser (IndexedDB, D3) with
 * JSON export/import as the backup and the way to move it to another computer. Pure model functions; the browser
 * storage is in extension/collectionStore.ts. Units added to a scene are copies: editing the collection never changes
 * placed tokens.
 */
import type { ResolvedImage } from "./importer";
import { validateSheet, type UnitSheet } from "./sheet";

export const COLLECTION_SCHEMA = "owlbear-butler/collection@1";

export interface CollectionEntry {
  id: string;
  sheet: UnitSheet;
  /** Token picture used when adding it to a scene. */
  image?: ResolvedImage;
  tags: string[];
  savedAt: string;
  updatedAt: string;
  /** Where it came from, e.g. "token Wolf 2", "homebrew", "adapted from Aboleth (XMM)". */
  from?: string;
}

export interface CollectionFile { schema: typeof COLLECTION_SCHEMA; exportedAt: string; entries: CollectionEntry[] }

export const parseTags = (s: string) => [...new Set(s.split(/[,#]/).map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 12);

export function newEntry(sheet: UnitSheet, opts: { image?: ResolvedImage; tags?: string[]; from?: string; now?: () => Date; newId?: () => string } = {}): CollectionEntry {
  const errs = validateSheet(sheet);
  if (errs.length) throw new Error(`${sheet.name}: invalid stat block (${errs.join("; ")})`);
  const at = (opts.now ?? (() => new Date()))().toISOString();
  return {
    id: (opts.newId ?? (() => globalThis.crypto.randomUUID()))(),
    sheet: structuredClone(sheet),
    ...(opts.image ? { image: opts.image } : {}),
    tags: opts.tags ?? [],
    savedAt: at, updatedAt: at,
    ...(opts.from ? { from: opts.from } : {}),
  };
}

/** A changed copy of an entry (sheet / tags / image), with a new updatedAt. */
export function updateEntry(e: CollectionEntry, patch: Partial<Pick<CollectionEntry, "sheet" | "tags" | "image">>, now: () => Date = () => new Date()): CollectionEntry {
  if (patch.sheet) {
    const errs = validateSheet(patch.sheet);
    if (errs.length) throw new Error(`Invalid stat block: ${errs.join("; ")}`);
  }
  return { ...e, ...patch, updatedAt: now().toISOString() };
}

export const exportCollection = (entries: CollectionEntry[], now: () => Date = () => new Date()): CollectionFile =>
  ({ schema: COLLECTION_SCHEMA, exportedAt: now().toISOString(), entries });

export interface ImportResult { entries: CollectionEntry[]; added: number; updated: number; skipped: number; errors: string[] }

/** Merges an exported file into the collection: new ids are added, the newer copy of an existing id wins. */
export function importCollection(existing: CollectionEntry[], data: unknown): ImportResult {
  const f = data as CollectionFile;
  if (!f || f.schema !== COLLECTION_SCHEMA || !Array.isArray(f.entries)) throw new Error("That isn't an Encounter Butler collection file.");
  const byId = new Map(existing.map((e) => [e.id, e]));
  const out: ImportResult = { entries: [], added: 0, updated: 0, skipped: 0, errors: [] };
  for (const e of f.entries) {
    if (!e || typeof e.id !== "string" || !e.sheet) { out.errors.push("An entry without an id or stat block was skipped."); continue; }
    const errs = validateSheet(e.sheet);
    if (errs.length) { out.errors.push(`${e.sheet?.name ?? e.id}: ${errs.join("; ")}`); continue; }
    const clean: CollectionEntry = { ...e, tags: Array.isArray(e.tags) ? e.tags.filter((t) => typeof t === "string") : [] };
    const cur = byId.get(e.id);
    if (!cur) { byId.set(e.id, clean); out.added++; }
    else if (Date.parse(clean.updatedAt) > Date.parse(cur.updatedAt)) { byId.set(e.id, clean); out.updated++; }
    else out.skipped++;
  }
  out.entries = [...byId.values()];
  return out;
}

export const allTags = (entries: CollectionEntry[]) => [...new Set(entries.flatMap((e) => e.tags))].sort();

/** Name / type / tag search, narrowed to entries having every selected tag; sorted by name. */
export function searchCollection(entries: CollectionEntry[], q: string, tags: string[] = []): CollectionEntry[] {
  const n = q.trim().toLowerCase();
  return entries
    .filter((e) => tags.every((t) => e.tags.includes(t)))
    .filter((e) => !n || e.sheet.name.toLowerCase().includes(n) || (e.sheet.type ?? "").toLowerCase().includes(n) || e.tags.some((t) => t.includes(n)))
    .sort((a, b) => a.sheet.name.localeCompare(b.sheet.name, undefined, { numeric: true }));
}

/** A blank homebrew unit to start editing from. */
export function blankSheet(name = "New creature"): UnitSheet {
  return {
    schema: "butler-sheet@1", name, kind: "creature", size: "M", type: "Humanoid", ac: 12, hp: { max: 10, formula: "3d8" }, speed: { walk: 30 },
    abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, saves: {}, skills: [], defenses: {}, cr: 0.5, proficiencyBonus: 2,
    initiative: { modifier: 0, advantage: false, disadvantage: false, reasons: [] },
    traits: [], actions: [{ name: "Attack", text: "Melee Attack Roll: +4 [1d20+4], reach 5 ft. Hit: 5 (1d6 + 2 [1d6+2]) Slashing damage." }],
    bonusActions: [], reactions: [], legendary: [], spells: [], inventory: [],
    source: { provenance: "homebrew" }, flags: [],
  };
}
