import { PACKAGE_SCHEMA } from "./constants";
import { resolveRollMode, rollFormula, rollInitiative, type Rng } from "./dice";
import { convertMonster, fivetoolsArtUrl, fivetoolsTokenUrl } from "./fivetools";
import type { CatalogEntry } from "./fivetools-shared";
import type { AssetInfo, Creature, EncounterPackage, HpRecord, ImageRef, Statblock } from "./schema";

/**
 * Encounter SOURCE spec: what the AI/GM writes for each encounter (encounters/<id>/encounter.source.json).
 * The builder turns it into a self-contained EncounterPackage (stats resolved, rolls made and recorded).
 */
export interface EncounterSource {
  id: string;
  title: string;
  description?: string;
  rules?: "2024" | "2014" | "mixed";
  map: {
    name: string;
    image: ImageRef;
    width: number;
    height: number;
    grid: { cellPx: number; offsetPx?: { x: number; y: number }; cols?: number; rows?: number; scale?: string };
    credit?: string;
  };
  groups: CreatureGroup[];
  assumptions?: string[];
}

export interface CreatureGroup {
  /**
   * Either a 5etools reference or a full stat block (user-provided / homebrew / adapted).
   * `source` (book code, e.g. "XMM", "CoS") is optional: without it the 2024-rules version is preferred.
   */
  statblock: { fivetools: { name: string; source?: string } } | { custom: Statblock };
  /** "fivetools" = official token from 5etools-img; or an explicit image. */
  token: "fivetools" | (ImageRef & { credit?: string; provenance?: AssetInfo["provenance"] });
  count?: number;
  /** "{n}" is replaced with 1..count. Default: "<Name> {n}" when count > 1. */
  name?: string;
  hp?: "average" | "roll";
  placements: { x: number; y: number; note?: string }[];
  hidden?: boolean;
  showLabel?: boolean;
  /** Homebrew/DM instruction overrides, recorded as reasons. */
  initiative?: { modifier?: number; advantage?: boolean; disadvantage?: boolean; reason: string };
}

/** A 5etools creature ready to convert: `_copy` already resolved. */
export interface FivetoolsResolved {
  monster: any;
  catalogEntry?: CatalogEntry;
  copyChain?: string[];
  copyNotes?: string[];
  /** e.g. how the book was chosen when none was given. */
  notes?: string[];
}

export interface BuildDeps {
  /** Looks up (and copy-resolves) a 5etools creature; `source` may be omitted. */
  fivetools: (name: string, source?: string) => FivetoolsResolved;
  rng: Rng;
  now?: () => Date;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function buildPackage(src: EncounterSource, deps: BuildDeps): EncounterPackage {
  const now = deps.now ?? (() => new Date());
  const warnings: string[] = [];
  const assumptions = [...(src.assumptions ?? [])];
  const assets: Record<string, AssetInfo> = {
    map: { image: src.map.image, credit: src.map.credit ?? "user-provided map", provenance: "user-provided" },
  };
  const statblocks: Record<string, Statblock> = {};
  const creatures: Creature[] = [];

  const g = src.map.grid;
  const offsetPx = g.offsetPx ?? { x: 0, y: 0 };
  if (!g.offsetPx) assumptions.push("Map grid assumed to start at the image's top-left corner (offset 0,0).");
  const cols = g.cols ?? Math.floor((src.map.width - offsetPx.x) / g.cellPx);
  const rows = g.rows ?? Math.floor((src.map.height - offsetPx.y) / g.cellPx);
  if (!g.scale) assumptions.push("Grid scale assumed 5 ft per square.");

  for (const group of src.groups) {
    let sb: Statblock;
    let sbKey: string;
    let ft: FivetoolsResolved | null = null;
    if ("fivetools" in group.statblock) {
      const { name, source } = group.statblock.fivetools;
      ft = deps.fivetools(name, source);
      sb = convertMonster(ft.monster, { catalogEntry: ft.catalogEntry, copyChain: ft.copyChain, copyNotes: ft.copyNotes, notes: ft.notes });
      sbKey = `${slug(ft.monster.name)}-${String(ft.monster.source).toLowerCase()}`;
      for (const n of ft.notes ?? []) assumptions.push(n);
    } else {
      sb = structuredClone(group.statblock.custom);
      sbKey = slug(sb.name);
      if (sb.source.provenance === "homebrew") warnings.push(`${sb.name}: homebrew stat block (not official).`);
    }
    if (group.initiative) {
      sb = structuredClone(sb);
      if (group.initiative.modifier != null) sb.initiative.modifier = group.initiative.modifier;
      if (group.initiative.advantage) sb.initiative.advantage = true;
      if (group.initiative.disadvantage) sb.initiative.disadvantage = true;
      sb.initiative.reasons.push(`override: ${group.initiative.reason}`);
      if ((group.initiative.advantage || group.initiative.disadvantage) && sb.initiative.conditional?.length) {
        sb.flags = sb.flags.map((f) =>
          f.startsWith("Conditional initiative effect NOT applied automatically")
            ? f.replace("NOT applied automatically", `applied by encounter override ("${group.initiative!.reason}")`)
            : f);
      }
      sbKey = `${sbKey}-${slug(group.initiative.reason).slice(0, 20)}`;
    }
    statblocks[sbKey] = sb;

    let tokenKey: string;
    if (group.token === "fivetools") {
      if (!ft) throw new Error(`${sb.name}: token "fivetools" requires a 5etools stat block reference`);
      const { name, source } = ft.monster;
      tokenKey = `token-${sbKey}`;
      // Own token → own art → (for copies) the base creature's token/art, checked in order by the CLI.
      const candidates = [fivetoolsTokenUrl(source, name), fivetoolsArtUrl(source, name)];
      const base = ft.monster._copiedFrom;
      if (base) candidates.push(fivetoolsTokenUrl(base.source, base.name), fivetoolsArtUrl(base.source, base.name));
      assets[tokenKey] = {
        image: { kind: "url", url: candidates[0]!, mime: "image/webp" },
        credit: `5etools-img token (${source})`,
        provenance: "official",
        candidates,
      };
    } else {
      const { credit, provenance, ...image } = group.token;
      tokenKey = `token-${sbKey}`;
      assets[tokenKey] = { image: image as ImageRef, credit, provenance };
    }

    const count = group.count ?? 1;
    if (group.placements.length !== count) {
      throw new Error(`${sb.name}: ${count} creatures but ${group.placements.length} placements`);
    }
    const pattern = group.name ?? (count > 1 ? `${sb.name} {n}` : sb.name);
    for (let i = 0; i < count; i++) {
      const name = pattern.replace("{n}", String(i + 1));
      const hp = rollHp(sb, group.hp ?? "average", deps.rng, warnings);
      const mode = resolveRollMode(sb.initiative.advantage, sb.initiative.disadvantage);
      const placement = group.placements[i]!;
      creatures.push({
        key: `${slug(name)}`,
        name,
        statblock: sbKey,
        token: tokenKey,
        cell: { x: placement.x, y: placement.y },
        hidden: group.hidden,
        showLabel: group.showLabel,
        hp,
        initiative: rollInitiative(sb.initiative.modifier, mode, deps.rng, "package-builder", now),
        placementNote: placement.note,
      });
    }
  }

  return {
    schema: PACKAGE_SCHEMA,
    id: src.id,
    revision: now().toISOString(),
    title: src.title,
    description: src.description,
    rules: src.rules ?? "2024",
    map: {
      name: src.map.name,
      asset: "map",
      width: src.map.width,
      height: src.map.height,
      grid: { cellPx: g.cellPx, offsetPx, cols, rows, scale: g.scale ?? "5ft", type: "SQUARE" },
    },
    assets,
    statblocks,
    creatures,
    assumptions,
    warnings,
  };
}

export function rollHp(sb: Statblock, method: "average" | "roll", rng: Rng, warnings: string[]): HpRecord {
  if (method === "roll" && sb.hp.formula) {
    try {
      const r = rollFormula(sb.hp.formula, rng);
      const max = Math.max(1, r.total);
      return { max, current: max, temp: 0, method: "rolled", formula: sb.hp.formula, dice: r.dice };
    } catch {
      const w = `${sb.name}: HP formula "${sb.hp.formula}" can't be rolled; using the average (${sb.hp.max}).`;
      if (!warnings.includes(w)) warnings.push(w);
    }
  }
  return { max: sb.hp.max, current: sb.hp.max, temp: 0, method: "average", formula: sb.hp.formula };
}
