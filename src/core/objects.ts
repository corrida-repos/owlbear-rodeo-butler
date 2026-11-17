/**
 * Objects without a token or initiative (a wall, a door, a pillar giving cover, a siege engine): Armor Class and Hit
 * Points from the rules, damage with the object rules, and whether a missed attack hit the cover instead.
 *  - PHB 2024 "Breaking Objects": Object Armor Class by substance, Object Hit Points by size (fragile / resilient),
 *    Huge or Gargantuan objects split into Large sections, Immunity to Poison and Psychic, damage thresholds.
 *  - DMG 2024: the Doors table (portcullises use the metal or wooden door), siege equipment.
 *  - PHB 2024 spells: Wall of Stone (AC 15, 30 HP per inch of thickness per panel), Wall of Ice (AC 12, 30 HP per
 *    10-foot section, Immunity to Cold, Vulnerability to Fire), Wall of Force (can't be damaged).
 *  - 2014 DMG optional rule "Hitting Cover": an attack that misses only because of the cover's bonus hits the cover.
 * Stored in scene metadata (GM only), so it stays small: a list of plain records.
 */
import { BUTLER_NS } from "./constants";

export const OBJECTS_KEY = `${BUTLER_NS}/objects`;

export const DAMAGE_TYPES = ["Acid", "Bludgeoning", "Cold", "Fire", "Force", "Lightning", "Necrotic", "Piercing", "Poison", "Psychic", "Radiant", "Slashing", "Thunder"] as const;
export type DamageType = (typeof DAMAGE_TYPES)[number];

export interface SceneObject {
  id: string;
  name: string;
  ac: number;
  maxHp: number;
  hp: number;
  /** "all" = can't be damaged (Wall of Force). */
  immune: (DamageType | "all")[];
  resist: DamageType[];
  vulnerable: DamageType[];
  /** Damage threshold: a single hit dealing less than this does nothing. */
  threshold?: number;
  /** How the stats were worked out ("Stone, Medium, resilient"). */
  basis: string;
  note?: string;
}

// ------------------------------------------------------------------ the rules' tables

export const SUBSTANCES: { key: string; label: string; ac: number }[] = [
  { key: "cloth", label: "Cloth, paper, rope", ac: 11 },
  { key: "glass", label: "Crystal, glass, ice", ac: 13 },
  { key: "wood", label: "Wood", ac: 15 },
  { key: "stone", label: "Stone", ac: 17 },
  { key: "iron", label: "Iron, steel", ac: 19 },
  { key: "mithral", label: "Mithral", ac: 21 },
  { key: "adamantine", label: "Adamantine", ac: 23 },
];

export type ObjectSize = "T" | "S" | "M" | "L" | "H" | "G";
export const OBJECT_SIZES: { key: ObjectSize; label: string; fragile: [number, string]; resilient: [number, string] }[] = [
  { key: "T", label: "Tiny (bottle, lock)", fragile: [2, "1d4"], resilient: [5, "2d4"] },
  { key: "S", label: "Small (chest, lute)", fragile: [3, "1d6"], resilient: [10, "3d6"] },
  { key: "M", label: "Medium (barrel, chandelier)", fragile: [4, "1d8"], resilient: [18, "4d8"] },
  { key: "L", label: "Large (cart, dining table)", fragile: [5, "1d10"], resilient: [27, "5d10"] },
  { key: "H", label: "Huge (in Large sections)", fragile: [5, "1d10"], resilient: [27, "5d10"] },
  { key: "G", label: "Gargantuan (in Large sections)", fragile: [5, "1d10"], resilient: [27, "5d10"] },
];
/** Large sections a Huge (3×3 squares) or Gargantuan (4×4) object is tracked as (PHB: "divide it into Large or smaller sections"). */
export const SECTIONS: Record<ObjectSize, number> = { T: 1, S: 1, M: 1, L: 1, H: 3, G: 4 };

const OBJECT_IMMUNE: DamageType[] = ["Poison", "Psychic"];

export interface ObjectStats { name: string; ac: number; maxHp: number; immune: SceneObject["immune"]; resist: DamageType[]; vulnerable: DamageType[]; threshold?: number; basis: string; sections: number }

/** Stats from substance × size × fragile/resilient (PHB 2024). Paper and cloth are Vulnerable to Fire. */
export function improvisedObject(substance: string, size: ObjectSize, resilient: boolean, opts: { name?: string; threshold?: number } = {}): ObjectStats {
  const sub = SUBSTANCES.find((s) => s.key === substance) ?? SUBSTANCES[2]!;
  const sz = OBJECT_SIZES.find((s) => s.key === size) ?? OBJECT_SIZES[2]!;
  const [hp] = resilient ? sz.resilient : sz.fragile;
  return {
    name: opts.name?.trim() || `${sub.label.split(",")[0]} object`, ac: sub.ac, maxHp: hp,
    immune: [...OBJECT_IMMUNE], resist: [], vulnerable: sub.key === "cloth" ? ["Fire"] : [],
    ...(opts.threshold ? { threshold: opts.threshold } : {}),
    basis: `${sub.label}, ${sz.label.split(" (")[0]}, ${resilient ? "resilient" : "fragile"}${SECTIONS[size] > 1 ? ", per Large section" : ""}`,
    sections: SECTIONS[size],
  };
}

export interface ObjectPreset { key: string; group: string; label: string; stats: Omit<ObjectStats, "sections"> & { sections?: number } }

const obj = (name: string, ac: number, maxHp: number, basis: string, extra: Partial<ObjectStats> = {}): Omit<ObjectStats, "sections"> =>
  ({ name, ac, maxHp, immune: [...OBJECT_IMMUNE], resist: [], vulnerable: [], basis, ...extra });

export const OBJECT_PRESETS: ObjectPreset[] = [
  { key: "door-glass", group: "Doors (DMG)", label: "Glass door", stats: obj("Glass door", 13, 4, "DMG Doors table; DC 10 to force open") },
  { key: "door-wood", group: "Doors (DMG)", label: "Wooden door", stats: obj("Wooden door", 15, 18, "DMG Doors table; DC 15 to force open") },
  { key: "door-stone", group: "Doors (DMG)", label: "Stone door", stats: obj("Stone door", 17, 40, "DMG Doors table; DC 20 to force open") },
  { key: "door-metal", group: "Doors (DMG)", label: "Metal door", stats: obj("Metal door", 19, 72, "DMG Doors table; DC 25 to force open") },
  { key: "door-wood-big", group: "Doors (DMG)", label: "Big wooden door (×2 HP)", stats: obj("Big wooden door", 15, 36, "DMG Doors table, bigger door: double HP, DC 20 to force open") },
  { key: "portcullis-iron", group: "Doors (DMG)", label: "Iron portcullis", stats: obj("Iron portcullis", 19, 72, "DMG: a metal door's AC and HP; gives Cover to creatures within 5 ft. against the other side") },
  { key: "portcullis-wood", group: "Doors (DMG)", label: "Wooden portcullis", stats: obj("Wooden portcullis", 15, 18, "DMG: a wooden door's AC and HP; gives Cover to creatures within 5 ft. against the other side") },
  { key: "wall-stone", group: "Spell walls (PHB)", label: "Wall of Stone panel (6 in. thick)", stats: obj("Wall of Stone panel", 15, 180, "Wall of Stone: 30 HP per inch of thickness, per 10-ft panel") },
  { key: "wall-stone-thin", group: "Spell walls (PHB)", label: "Wall of Stone panel (3 in., doubled size)", stats: obj("Wall of Stone panel", 15, 90, "Wall of Stone at double size and half thickness: 30 HP per inch") },
  { key: "wall-ice", group: "Spell walls (PHB)", label: "Wall of Ice section (10 ft.)", stats: obj("Wall of Ice section", 12, 30, "Wall of Ice: per 10-ft section", { immune: ["Cold", "Poison", "Psychic"], vulnerable: ["Fire"] }) },
  { key: "wall-force", group: "Spell walls (PHB)", label: "Wall of Force", stats: obj("Wall of Force", 0, 1, "Wall of Force: nothing can damage it (Disintegrate destroys it)", { immune: ["all"] }) },
  ...([["Ballista", 15, 50], ["Cannon", 19, 75], ["Flamethrower Coach", 19, 100], ["Keg Launcher", 15, 30], ["Lightning Cannon", 19, 30],
    ["Mangonel", 15, 100], ["Ram", 15, 100], ["Siege Tower", 15, 200], ["Suspended Cauldron", 19, 20], ["Trebuchet", 15, 150]] as [string, number, number][])
    .map(([n, ac, hp]): ObjectPreset => ({ key: `siege-${n.toLowerCase().replace(/\s+/g, "-")}`, group: "Siege equipment (DMG)", label: n, stats: obj(n, ac, hp, "DMG siege equipment") })),
  { key: "razorvine", group: "Hazards (DMG)", label: "Razorvine (10-ft section)", stats: obj("Razorvine", 11, 25, "DMG hazard", { immune: ["Bludgeoning", "Piercing", "Psychic"] }) },
  { key: "webs", group: "Hazards (DMG)", label: "Webs (10-ft cube)", stats: obj("Webs", 10, 15, "DMG hazard", { immune: ["Piercing", "Poison", "Psychic"], vulnerable: ["Fire"] }) },
  { key: "vicious-vine", group: "Hazards (DMG)", label: "Vicious vine", stats: obj("Vicious vine", 11, 16, "DMG hazard", { immune: ["Bludgeoning", "Piercing", "Psychic"] }) },
  { key: "fireball-fungus", group: "Hazards (DMG)", label: "Fireball fungus", stats: obj("Fireball fungus", 10, 6, "DMG hazard: explodes as a Fireball (DC 15) at 0 HP", { immune: ["Psychic"] }) },
];

// ------------------------------------------------------------------ damage

export interface ObjectHit { applied: number; why: string }

/** How much of `amount` damage of `type` the object takes, by its immunities, resistances, vulnerabilities and threshold. */
export function objectDamage(o: Pick<SceneObject, "immune" | "resist" | "vulnerable" | "threshold">, amount: number, type?: DamageType): ObjectHit {
  let n = Math.max(0, Math.floor(amount));
  if (o.immune.includes("all")) return { applied: 0, why: "it can't be damaged" };
  if (type && o.immune.includes(type)) return { applied: 0, why: `Immunity to ${type}` };
  const notes: string[] = [];
  if (type && o.resist.includes(type)) { n = Math.floor(n / 2); notes.push(`Resistance to ${type} (halved)`); }
  if (type && o.vulnerable.includes(type)) { n *= 2; notes.push(`Vulnerability to ${type} (doubled)`); }
  if (o.threshold && n < o.threshold) return { applied: 0, why: `below its damage threshold of ${o.threshold}` };
  return { applied: n, why: notes.join(", ") };
}

/** Applies damage (positive) or repair (negative) to an object; 0 HP means destroyed. */
export function hitObject(o: SceneObject, amount: number, type?: DamageType): { object: SceneObject; hit: ObjectHit } {
  if (amount < 0) {
    const hp = Math.min(o.maxHp, o.hp - Math.floor(amount));
    return { object: { ...o, hp }, hit: { applied: amount, why: "repaired" } };
  }
  const hit = objectDamage(o, amount, type);
  return { object: { ...o, hp: Math.max(0, o.hp - hit.applied) }, hit };
}

export const isDestroyed = (o: Pick<SceneObject, "hp">) => o.hp <= 0;

// ------------------------------------------------------------------ hitting cover

export type CoverDegree = "half" | "three-quarters";
export const COVER_BONUS: Record<CoverDegree, number> = { half: 2, "three-quarters": 5 };

/**
 * 2014 DMG optional rule "Hitting Cover": if the attack roll misses the target only because of the cover's AC bonus,
 * the cover is hit instead (and takes the damage if its AC is met too).
 */
export function coverHit(total: number, targetAc: number, cover: CoverDegree, coverAc?: number): "target" | "cover" | "miss" {
  const withCover = targetAc + COVER_BONUS[cover];
  if (total >= withCover) return "target";
  if (total >= targetAc) return coverAc === undefined || total >= coverAc ? "cover" : "miss";
  return "miss";
}

// ------------------------------------------------------------------ storage

export function readObjects(meta: Record<string, unknown>): SceneObject[] {
  const raw = meta[OBJECTS_KEY];
  return Array.isArray(raw) ? raw.filter((o): o is SceneObject => !!o && typeof o.id === "string" && typeof o.hp === "number") : [];
}

/** New object records from stats: one per section for Huge and Gargantuan objects ("Wall (section 2 of 3)"). */
export function makeObjects(s: ObjectStats | (Omit<ObjectStats, "sections"> & { sections?: number }), newId: () => string, count = 1): SceneObject[] {
  const n = Math.max(1, s.sections ?? 1) * Math.max(1, count);
  return Array.from({ length: n }, (_, i) => ({
    id: newId(), name: n > 1 ? `${s.name} ${i + 1}` : s.name, ac: s.ac, maxHp: s.maxHp, hp: s.maxHp,
    immune: [...s.immune], resist: [...s.resist], vulnerable: [...s.vulnerable], ...(s.threshold ? { threshold: s.threshold } : {}), basis: s.basis,
  }));
}
