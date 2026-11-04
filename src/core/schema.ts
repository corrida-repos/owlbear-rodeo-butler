import { FORGE_DEFAULT_DICTIONARY_ID, PACKAGE_SCHEMA, SIZE_CELLS } from "./constants";

/**
 * Encounter package: the per-encounter data file the importer consumes.
 * Produced by scripts/build-encounter.ts (or by hand / by an AI), never by code changes.
 */

export type Provenance =
  | "official" // published stats, unmodified
  | "user-provided" // stat block the GM supplied
  | "adapted" // official base with documented changes
  | "homebrew"; // invented; never labelled official

export type RollMode = "normal" | "advantage" | "disadvantage";

/** Where an image comes from. `url` must be public HTTPS; `library` = pick from the GM's Owlbear asset library at import time. */
export type ImageRef =
  | { kind: "url"; url: string; width?: number; height?: number; mime?: string }
  | { kind: "library"; search: string; width?: number; height?: number };

export interface AssetInfo {
  image: ImageRef;
  /** Human-readable origin: "5etools-img XMM token", "user upload", "generated"... */
  credit?: string;
  provenance?: Provenance | "generated" | "placeholder";
}

export interface ListEntry {
  name: string;
  description: string;
}

export interface InitiativeRoll {
  /** All d20 results rolled (1 for normal, 2 for adv/dis). */
  dice: number[];
  /** The d20 result kept. */
  kept: number;
  modifier: number;
  mode: RollMode;
  total: number;
  /** e.g. "2d20kh1+2" */
  formula: string;
  rolledAt: string;
  rolledBy: "package-builder" | "importer" | "manual";
}

export interface HpRecord {
  max: number;
  current: number;
  temp?: number;
  method: "average" | "rolled" | "fixed";
  formula?: string;
  dice?: number[];
}

export interface StatblockInitiative {
  modifier: number;
  advantage: boolean;
  disadvantage: boolean;
  /** How the modifier/mode was derived, for the preview. */
  reasons: string[];
}

export interface Statblock {
  name: string;
  /** Size code T/S/M/L/H/G — drives token footprint. */
  size: keyof typeof SIZE_CELLS;
  source: {
    provenance: Provenance;
    book?: string; // e.g. "XMM"
    bookTitle?: string; // e.g. "Monster Manual (2025)"
    page?: number;
    url?: string;
    notes?: string[];
  };
  hp: { average: number; formula?: string };
  initiative: StatblockInitiative;
  /** Forge attribute values keyed by BID (without namespace). Lists are arrays of ListEntry. */
  forge: Record<string, number | string | ListEntry[]>;
  /** Missing/uncertain information the GM should know about. */
  flags: string[];
}

export interface Creature {
  /** Stable key within the package, e.g. "wolf-1". */
  key: string;
  name: string;
  statblock: string; // key into statblocks
  token: string; // key into assets
  /** Top-left grid cell occupied (0-based, map grid coordinates; fractions allowed). */
  cell: { x: number; y: number };
  hidden?: boolean;
  showLabel?: boolean;
  hp: HpRecord;
  initiative: InitiativeRoll | null; // null => importer rolls and records
  placementNote?: string;
}

export interface MapSpec {
  name: string;
  asset: string; // key into assets
  /** Pixel size of the source image the grid numbers refer to. */
  width: number;
  height: number;
  grid: {
    cellPx: number; // image pixels per grid cell
    offsetPx: { x: number; y: number }; // image pixel of a grid-line intersection (top-left of cell 0,0)
    cols: number;
    rows: number;
    scale: string; // e.g. "5ft"
    type: "SQUARE";
  };
}

export interface EncounterPackage {
  schema: typeof PACKAGE_SCHEMA;
  id: string;
  revision: string;
  title: string;
  description?: string;
  rules: "2024" | "2014" | "mixed";
  forgeDictionary: string;
  map: MapSpec;
  assets: Record<string, AssetInfo>;
  statblocks: Record<string, Statblock>;
  creatures: Creature[];
  assumptions: string[];
  warnings: string[];
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === "string";

export function validatePackage(input: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const err = (path: string, msg: string) => errors.push(`${path}: ${msg}`);

  if (!isObj(input)) return { ok: false, errors: ["package: not a JSON object"], warnings };
  const p = input as Record<string, unknown>;
  if (p.schema !== PACKAGE_SCHEMA) err("schema", `expected "${PACKAGE_SCHEMA}", got ${JSON.stringify(p.schema)}`);
  if (!isStr(p.id) || !/^[a-z0-9][a-z0-9-]*$/.test(p.id)) err("id", "must be a lowercase slug");
  if (!isStr(p.revision)) err("revision", "missing");
  if (!isStr(p.title)) err("title", "missing");
  if (p.forgeDictionary !== FORGE_DEFAULT_DICTIONARY_ID)
    warnings.push(`forgeDictionary "${String(p.forgeDictionary)}" is not the verified default (${FORGE_DEFAULT_DICTIONARY_ID})`);

  const assets = isObj(p.assets) ? p.assets : (err("assets", "missing"), {});
  for (const [k, a] of Object.entries(assets)) {
    if (!isObj(a) || !isObj(a.image)) { err(`assets.${k}`, "missing image"); continue; }
    const img = a.image;
    if (img.kind === "url") { if (!isStr(img.url)) err(`assets.${k}.image.url`, "missing"); }
    else if (img.kind === "library") { if (!isStr(img.search)) err(`assets.${k}.image.search`, "missing"); }
    else err(`assets.${k}.image.kind`, `must be "url" or "library"`);
  }

  const map = p.map;
  if (!isObj(map)) err("map", "missing");
  else {
    if (!isStr(map.asset) || !(map.asset in assets)) err("map.asset", "must reference an asset");
    if (!isNum(map.width) || map.width <= 0) err("map.width", "must be > 0");
    if (!isNum(map.height) || map.height <= 0) err("map.height", "must be > 0");
    const g = map.grid;
    if (!isObj(g)) err("map.grid", "missing");
    else {
      if (!isNum(g.cellPx) || g.cellPx <= 0) err("map.grid.cellPx", "must be > 0");
      if (!isObj(g.offsetPx) || !isNum(g.offsetPx.x) || !isNum(g.offsetPx.y)) err("map.grid.offsetPx", "needs x,y");
      if (!isNum(g.cols) || !isNum(g.rows)) err("map.grid", "needs cols, rows");
      if (!isStr(g.scale) || !/^\d+(\.\d+)?\s*[a-zA-Z]+$/.test(g.scale)) err("map.grid.scale", 'like "5ft"');
      if (g.type !== "SQUARE") err("map.grid.type", "only SQUARE is supported in v1");
    }
  }

  const statblocks = isObj(p.statblocks) ? p.statblocks : (err("statblocks", "missing"), {});
  for (const [k, s] of Object.entries(statblocks)) {
    const path = `statblocks.${k}`;
    if (!isObj(s)) { err(path, "not an object"); continue; }
    if (!isStr(s.name)) err(`${path}.name`, "missing");
    if (!isStr(s.size) || !(s.size in SIZE_CELLS)) err(`${path}.size`, "must be T/S/M/L/H/G");
    if (!isObj(s.source) || !isStr(s.source.provenance)) err(`${path}.source.provenance`, "missing");
    if (!isObj(s.hp) || !isNum(s.hp.average)) err(`${path}.hp.average`, "missing");
    if (!isObj(s.initiative) || !isNum(s.initiative.modifier)) err(`${path}.initiative.modifier`, "missing");
    if (!isObj(s.forge)) err(`${path}.forge`, "missing");
    if (isObj(s.source) && s.source.provenance === "homebrew" && isStr(s.source.book))
      warnings.push(`${path}: homebrew stat block names a book (${s.source.book}); make sure it is not presented as official`);
  }

  const creatures = Array.isArray(p.creatures) ? p.creatures : (err("creatures", "must be an array"), []);
  const keys = new Set<string>();
  creatures.forEach((c: unknown, i: number) => {
    const path = `creatures[${i}]`;
    if (!isObj(c)) { err(path, "not an object"); return; }
    if (!isStr(c.key)) err(`${path}.key`, "missing");
    else if (keys.has(c.key)) err(`${path}.key`, `duplicate key "${c.key}"`);
    else keys.add(c.key);
    if (!isStr(c.name)) err(`${path}.name`, "missing");
    if (!isStr(c.statblock) || !(c.statblock in statblocks)) err(`${path}.statblock`, `unknown statblock "${String(c.statblock)}"`);
    if (!isStr(c.token) || !(c.token in assets)) err(`${path}.token`, `unknown asset "${String(c.token)}"`);
    if (!isObj(c.cell) || !isNum(c.cell.x) || !isNum(c.cell.y)) err(`${path}.cell`, "needs numeric x,y");
    if (!isObj(c.hp) || !isNum(c.hp.max) || !isNum(c.hp.current)) err(`${path}.hp`, "needs max and current");
    else if (c.hp.max <= 0) err(`${path}.hp.max`, "must be > 0");
    if (c.initiative !== null) {
      const r = c.initiative;
      if (!isObj(r)) err(`${path}.initiative`, "must be an object or null");
      else {
        if (!Array.isArray(r.dice) || !r.dice.every((d) => isNum(d) && d >= 1 && d <= 20))
          err(`${path}.initiative.dice`, "must be d20 results");
        if (!isNum(r.kept) || !isNum(r.modifier) || !isNum(r.total)) err(`${path}.initiative`, "needs kept, modifier, total");
        else if (r.kept + r.modifier !== r.total) err(`${path}.initiative.total`, `${r.kept} + ${r.modifier} != ${r.total}`);
        if (r.mode !== "normal" && r.mode !== "advantage" && r.mode !== "disadvantage") err(`${path}.initiative.mode`, "invalid");
        else if (Array.isArray(r.dice) && isNum(r.kept)) {
          const d = r.dice as number[];
          const expectKept = r.mode === "advantage" ? Math.max(...d) : r.mode === "disadvantage" ? Math.min(...d) : d[0];
          if ((r.mode === "normal" ? d.length !== 1 : d.length !== 2) || expectKept !== r.kept)
            err(`${path}.initiative`, `dice ${JSON.stringify(d)} inconsistent with mode ${r.mode} / kept ${r.kept}`);
        }
      }
    }
  });
  if (creatures.length === 0) warnings.push("package has no creatures");

  if (!Array.isArray(p.assumptions)) err("assumptions", "must be an array");
  if (!Array.isArray(p.warnings)) err("warnings", "must be an array");
  return { ok: errors.length === 0, errors, warnings };
}
