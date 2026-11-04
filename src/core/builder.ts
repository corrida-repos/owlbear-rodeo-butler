import { FORGE_DEFAULT_DICTIONARY_ID, PACKAGE_SCHEMA } from "./constants";
import { resolveRollMode, rollFormula, rollInitiative, type Rng } from "./dice";
import { convertMonster, fivetoolsTokenUrl } from "./fivetools";
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
  /** Either a 5etools reference or a full stat block (user-provided / homebrew / adapted). */
  statblock: { fivetools: { name: string; source: string } } | { custom: Statblock };
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

export interface BuildDeps {
  /** Returns 5etools monster JSON (already fetched). */
  fivetoolsMonster: (name: string, source: string) => any;
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
    if ("fivetools" in group.statblock) {
      const { name, source } = group.statblock.fivetools;
      sb = convertMonster(deps.fivetoolsMonster(name, source));
      sbKey = `${slug(name)}-${source.toLowerCase()}`;
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
      sbKey = `${sbKey}-${slug(group.initiative.reason).slice(0, 20)}`;
    }
    statblocks[sbKey] = sb;

    let tokenKey: string;
    if (group.token === "fivetools") {
      if (!("fivetools" in group.statblock)) throw new Error(`${sb.name}: token "fivetools" requires a 5etools stat block reference`);
      const { name, source } = group.statblock.fivetools;
      tokenKey = `token-${sbKey}`;
      assets[tokenKey] = {
        image: { kind: "url", url: fivetoolsTokenUrl(source, name), mime: "image/webp" },
        credit: `5etools-img token (${source})`,
        provenance: "official",
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
      const hp = rollHp(sb, group.hp ?? "average", deps.rng);
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
    forgeDictionary: FORGE_DEFAULT_DICTIONARY_ID,
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

function rollHp(sb: Statblock, method: "average" | "roll", rng: Rng): HpRecord {
  if (method === "roll" && sb.hp.formula) {
    const r = rollFormula(sb.hp.formula, rng);
    const max = Math.max(1, r.total);
    return { max, current: max, temp: 0, method: "rolled", formula: sb.hp.formula, dice: r.dice };
  }
  return { max: sb.hp.average, current: sb.hp.average, temp: 0, method: "average", formula: sb.hp.formula };
}
