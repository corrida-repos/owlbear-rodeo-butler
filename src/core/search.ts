/** Creature search filters (F16): CR range, creature types, environments, sizes, spellcaster. Pure, over index rows. */
import type { Env } from "./habitat";

export interface IndexRow {
  name: string; source: string; cr: string; type: string; size: string; token: boolean; book: string; rules: string;
  envs: Env[] | "any"; envAssigned: boolean; caster: boolean;
}

export const CREATURE_TYPES = ["aberration", "beast", "celestial", "construct", "dragon", "elemental", "fey", "fiend", "giant", "humanoid", "monstrosity", "ooze", "plant", "undead"] as const;
export const SIZES = ["T", "S", "M", "L", "H", "G"] as const;
/** CR values in order, for the min/max selects. */
export const CR_STEPS = ["0", "1/8", "1/4", "1/2", ...Array.from({ length: 30 }, (_, i) => String(i + 1))];

export interface SearchFilters {
  crMin?: string;
  crMax?: string;
  types: string[];
  envs: Env[];
  sizes: string[];
  caster: "any" | "yes" | "no";
}

export const NO_FILTERS: SearchFilters = { types: [], envs: [], sizes: [], caster: "any" };

/** "1/4" → 0.25, "" → null. */
export function crValue(cr: string): number | null {
  if (!cr) return null;
  const m = /^(\d+)\/(\d+)$/.exec(cr);
  const v = m ? Number(m[1]) / Number(m[2]) : Number(cr);
  return Number.isFinite(v) ? v : null;
}

export const activeFilterCount = (f: SearchFilters) =>
  (f.crMin ? 1 : 0) + (f.crMax ? 1 : 0) + (f.types.length ? 1 : 0) + (f.envs.length ? 1 : 0) + (f.sizes.length ? 1 : 0) + (f.caster !== "any" ? 1 : 0);

/** Whether a row passes every filter that's set. A creature of "any" environment matches every environment. */
export function matchesFilters(r: IndexRow, f: SearchFilters): boolean {
  if (f.crMin || f.crMax) {
    const v = crValue(r.cr);
    if (v === null) return false;
    if (f.crMin && v < crValue(f.crMin)!) return false;
    if (f.crMax && v > crValue(f.crMax)!) return false;
  }
  if (f.types.length) {
    const t = r.type.toLowerCase();
    if (!f.types.some((x) => t.split("/").includes(x))) return false;
  }
  if (f.envs.length && r.envs !== "any" && !f.envs.some((e) => (r.envs as Env[]).includes(e))) return false;
  if (f.sizes.length && !f.sizes.includes(r.size)) return false;
  if (f.caster === "yes" && !r.caster) return false;
  if (f.caster === "no" && r.caster) return false;
  return true;
}

/** Filters only (no search text): every match, by CR then name. */
export function browse(rows: IndexRow[], f: SearchFilters): IndexRow[] {
  return rows.filter((r) => matchesFilters(r, f))
    .sort((a, b) => (crValue(a.cr) ?? 99) - (crValue(b.cr) ?? 99) || a.name.localeCompare(b.name) || a.source.localeCompare(b.source));
}
