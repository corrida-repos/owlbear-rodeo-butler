/**
 * Hazards and traps from the 2024 DMG (chapter 3), as things placed on the map. Each has its area (in squares), what
 * sets it off (a creature entering the area, or starting its turn there; or the GM, for "when touched" and the like),
 * and what happens: a saving throw, damage (half on a success where the book says so) and conditions on a failure.
 * Pure data and resolution; the background page watches tokens and runs it, DM Tools places them.
 */
import { BUTLER_NS } from "./constants";
import type { Ability, UnitSheet } from "./sheet";
import { damageAgainst, immuneToCondition } from "./defenses";

export const HAZARD_KEY = `${BUTLER_NS}/hazard`;

export type HazardTrigger = "enter" | "start";

export interface HazardDef {
  key: string;
  name: string;
  kind: "hazard" | "trap";
  /** Severity and levels, as the book rates it. */
  rating: string;
  /** Side of the square area it occupies, in squares. */
  cells: number;
  /** What sets it off automatically; empty = only when the GM triggers it (touched, a lock opened…). */
  triggers: HazardTrigger[];
  /** A trap that goes off once and is then spent (the GM can re-arm it). */
  once?: boolean;
  save?: { ability: Ability; dc: number };
  damage?: { formula: string; type: string }[];
  /** Roll this first: the damage happens that many times (Poisoned Darts: 1d3 darts). */
  times?: string;
  /** Half damage on a successful save (otherwise none). */
  half?: boolean;
  /** Damage that happens even on a success? (no save: always.) */
  conditions?: { key: string; label?: string; rounds?: number; note?: string }[];
  /** What else happens, for the GM. */
  note: string;
  detect?: string;
  /** Picture: colour and file in public/hazards/. */
  color: string;
  image: string;
}

const H = (d: Omit<HazardDef, "image"> & { image?: string }): HazardDef => ({ ...d, image: d.image ?? `${d.key}.png` });

export const HAZARDS: HazardDef[] = [
  // ---- hazards
  H({ key: "brown-mold", name: "Brown Mold", kind: "hazard", rating: "Deadly 5–10, nuisance 11–16", cells: 4, triggers: ["enter", "start"], save: { ability: "con", dc: 12 }, damage: [{ formula: "4d10", type: "Cold" }], half: true, color: "#8d6e63",
    note: "The patch is the middle 10-ft square; the area includes 5 ft around it. Immune to Fire: fire within 5 ft makes it spread a new 10-ft patch toward the fire. Any Cold damage destroys it." }),
  H({ key: "green-slime", name: "Green Slime", kind: "hazard", rating: "Nuisance 1–4", cells: 1, triggers: ["enter"], save: { ability: "dex", dc: 10 }, damage: [{ formula: "1d10", type: "Acid" }], color: "#7cb342",
    conditions: [{ key: "custom", label: "Green Slime", note: "1d10 Acid at the start of each turn until scraped off (an action) or destroyed" }],
    note: "Drops from walls or ceilings when it senses movement (Blindsight 30 ft); only a creature aware of it gets the DC 10 Dexterity save. 1d10 Acid again at the start of each of its turns until scraped off (an action). 2d10 Acid per round to wood or metal. Sunlight, Cold, Fire or Radiant damage destroys it." }),
  H({ key: "yellow-mold", name: "Yellow Mold", kind: "hazard", rating: "Deadly 1–4, nuisance 5–10", cells: 2, triggers: [], save: { ability: "con", dc: 15 }, damage: [{ formula: "2d10", type: "Poison" }], color: "#fdd835",
    conditions: [{ key: "poisoned", rounds: 10, note: "Yellow Mold: 1d10 Poison at the start of each turn; repeat the save at the end of each turn" }],
    note: "Trigger it when touched: spores fill a 10-ft Cube (this area). While Poisoned this way, 1d10 Poison at the start of each turn; repeat the save at the end of each turn. Sunlight or any Fire damage destroys it." }),
  H({ key: "inferno", name: "Inferno", kind: "hazard", rating: "Deadly 5–10, nuisance 11–16", cells: 4, triggers: ["enter", "start"], damage: [{ formula: "4d10", type: "Fire" }], color: "#e64a19",
    conditions: [{ key: "custom", label: "Burning", note: "1d4 Fire at the start of each turn; an action to put it out" }],
    note: "At least four contiguous 10-ft Cubes of fire (extend it with more templates). 10 gallons of water douse a Cube; strong wind for 1 minute adds 1d4 Cubes; without fuel it burns out in 1d10 minutes. Burning: 1d4 Fire at the start of each turn (PHB)." }),
  H({ key: "poisonous-gas", name: "Poisonous Gas", kind: "hazard", rating: "Nuisance 1–4 (scales)", cells: 4, triggers: ["enter", "start"], save: { ability: "con", dc: 12 }, damage: [{ formula: "1d10", type: "Poison" }], half: true, color: "#9ccc65",
    note: "Up to ten 10-ft Cubes; strong wind disperses it for 1 minute. Creatures in the gas have Disadvantage on Death Saving Throws. Higher levels: 2d10/DC 14 (5–10), 4d10/DC 16 (11–16), 10d10/DC 18 (17–20)." }),
  H({ key: "quicksand-pit", name: "Quicksand Pit", kind: "hazard", rating: "Nuisance 1–4 (scales)", cells: 2, triggers: ["enter"], color: "#c8a165",
    conditions: [{ key: "restrained", note: "Quicksand: sinks 1d4+1 ft, then 1d4 ft at the start of each turn" }],
    note: "10 ft deep. Sinks 1d4 + 1 ft on entering and Restrained, then 1d4 ft at the start of each turn. Escape: an action and a Strength (Athletics) check, DC 10 + feet sunk. Submerged: Cover, Blinded, suffocating. Pulling someone out: an action, Athletics DC 5 + feet sunk." }),
  H({ key: "razorvine", name: "Razorvine", kind: "hazard", rating: "Nuisance 1–4", cells: 2, triggers: ["enter"], save: { ability: "dex", dc: 10 }, damage: [{ formula: "1d10", type: "Slashing" }], color: "#558b2f",
    note: "A 10-ft-high, 10-ft-wide, 5-ft-thick hedge: AC 11, HP 25, Immunity to Bludgeoning, Piercing and Psychic (track it in Objects). The save is on first contact each turn." }),
  H({ key: "rockslide", name: "Rockslide", kind: "hazard", rating: "Deadly 1–4 (scales)", cells: 4, triggers: [], save: { ability: "dex", dc: 15 }, damage: [{ formula: "2d10", type: "Bludgeoning" }], half: true, color: "#795548",
    conditions: [{ key: "prone", note: "Rockslide: buried when it stops (Restrained, Cover)" }],
    note: "Trigger it on the creatures in its path. On a failure: Prone and carried along; when it stops, Prone creatures are buried (Restrained, Cover). Crawling out: an action, DC 15 Strength (Athletics), or gain 1 Exhaustion level. Its space becomes Difficult Terrain. Higher levels: 4d10, 10d10, 18d10." }),
  H({ key: "vicious-vine", name: "Vicious Vine", kind: "hazard", rating: "Nuisance 1–4 (scales)", cells: 3, triggers: ["enter", "start"], save: { ability: "dex", dc: 12 }, color: "#33691e",
    conditions: [{ key: "grappled", note: "Vicious vine (escape DC 12): 1d10 Necrotic at the start of each turn" }],
    note: "The vine is the middle square; the area includes 5 ft around it. Grapples one creature at a time (escape DC 12), dealing 1d10 Necrotic at the start of each of its turns. AC 11, HP 16, Immunity to Bludgeoning, Piercing and Psychic." }),
  H({ key: "webs", name: "Webs", kind: "hazard", rating: "Nuisance 1–4", cells: 2, triggers: ["enter", "start"], save: { ability: "dex", dc: 12 }, color: "#cfd8dc",
    conditions: [{ key: "restrained", note: "Webs: escape with an action, DC 12 Strength (Athletics) or Dexterity (Acrobatics)" }],
    note: "Difficult Terrain. Escape: an action and a DC 12 Strength (Athletics) or Dexterity (Acrobatics) check. Each 10-ft Cube: AC 10, HP 15, Vulnerability to Fire, Immunity to Piercing, Poison and Psychic." }),
  H({ key: "fireball-fungus", name: "Fireball Fungus", kind: "hazard", rating: "Deadly 5–10", cells: 8, triggers: [], save: { ability: "dex", dc: 15 }, damage: [{ formula: "8d6", type: "Fire" }], half: true, color: "#ff9800",
    note: "The mushroom sits in the middle (AC 10, HP 6, Immunity to Psychic; sheds Bright Light 15 ft). Trigger it when it drops to 0 HP: it explodes as a Fireball (20-ft radius, this area). Other fungi in the blast explode too." }),
  H({ key: "river-styx", name: "River Styx", kind: "hazard", rating: "Nuisance 11–16", cells: 4, triggers: ["enter", "start"], save: { ability: "int", dc: 20 }, damage: [{ formula: "3d12", type: "Psychic" }], color: "#37474f",
    conditions: [{ key: "custom", label: "Styx-touched", note: "Can't cast spells or take the Magic action for 30 days (Greater Restoration, Heal or Wish ends it)" }],
    note: "On a failed save: can't cast spells or take the Magic action for 30 days; after 30 days it's permanent and memories are lost. Already affected creatures suffer nothing more. Some Fiends are immune." }),
  // ---- traps
  H({ key: "collapsing-roof", name: "Collapsing Roof", kind: "trap", rating: "Deadly 1–4 (scales)", cells: 2, triggers: ["enter"], once: true, save: { ability: "dex", dc: 13 }, damage: [{ formula: "2d10", type: "Bludgeoning" }], half: true, color: "#6d4c41",
    note: "A trip wire 3 in. off the ground; the ceiling above this area collapses. Rubble makes it Difficult Terrain.", detect: "Search action, DC 11 Wisdom (Perception): the trip wire and the unstable ceiling; once found it's easily cut or avoided." }),
  H({ key: "falling-net", name: "Falling Net", kind: "trap", rating: "Nuisance 1–4", cells: 2, triggers: ["enter"], once: true, save: { ability: "dex", dc: 10 }, color: "#a1887f",
    conditions: [{ key: "restrained", note: "Net: an action and a DC 10 Strength (Athletics) check frees a creature within reach" }],
    note: "A Huge or larger creature succeeds automatically. Freeing a creature: an action and a DC 10 Strength (Athletics) check. Destroying the Net frees it.", detect: "Search action, DC 11 Wisdom (Perception): the trip wire and the Net; easily cut or avoided once found." }),
  H({ key: "fire-casting-statue", name: "Fire-Casting Statue", kind: "trap", rating: "Deadly 1–4", cells: 1, triggers: ["enter", "start"], save: { ability: "dex", dc: 15 }, damage: [{ formula: "2d10", type: "Fire" }], half: true, color: "#d84315",
    note: "The pressure plate. The statue breathes a 15-ft Cone of fire: place a Cone template and apply the same save to everyone in it.", detect: "Detect Magic: Evocation. Search action within 5 ft, DC 10 Wisdom (Perception): a glyph; Study action, DC 15 Intelligence (Arcana): it means \"fire\". Defacing it (an action) disarms the trap. Search, DC 15 Perception: the pressure plate." }),
  H({ key: "hidden-pit", name: "Hidden Pit", kind: "trap", rating: "Nuisance 1–4", cells: 2, triggers: ["enter"], damage: [{ formula: "1d6", type: "Bludgeoning" }], color: "#5d4037",
    conditions: [{ key: "prone" }],
    note: "10 ft deep; the lid stays open after. Climbing out needs a Climb Speed, climbing gear or magic.", detect: "Study action, DC 15 Intelligence (Investigation); an Iron Spike wedged under the lid makes it safe." }),
  H({ key: "poisoned-darts", name: "Poisoned Darts", kind: "trap", rating: "Deadly 1–4 (scales)", cells: 1, triggers: ["enter"], save: { ability: "dex", dc: 13 }, times: "1d3", damage: [{ formula: "1d6", type: "Poison" }], color: "#689f38",
    note: "Darts from the walls hit each creature in their path: on a failed save, 1d3 darts, 1d6 Poison each.", detect: "Search action, DC 15 Wisdom (Perception): the holes (plug them) or the pressure plate (wedge an Iron Spike under it)." }),
  H({ key: "poisoned-needle", name: "Poisoned Needle", kind: "trap", rating: "Nuisance 1–4 (scales)", cells: 1, triggers: [], save: { ability: "con", dc: 11 }, damage: [{ formula: "1d10", type: "Poison" }], half: true, color: "#7cb342",
    conditions: [{ key: "poisoned", rounds: 600, note: "Poisoned Needle: 1 hour" }],
    note: "Trigger it when someone opens the lock without its key or fails to disarm it. Knock doesn't set it off. On a success: half damage and not Poisoned.", detect: "Search action, DC 15 Wisdom (Perception); disarm: an action, DC 15 Dexterity (Sleight of Hand) (failure triggers it)." }),
  H({ key: "rolling-stone", name: "Rolling Stone", kind: "trap", rating: "Deadly 11–16, nuisance 17–20", cells: 2, triggers: [], save: { ability: "dex", dc: 15 }, damage: [{ formula: "10d10", type: "Bludgeoning" }], color: "#757575",
    conditions: [{ key: "prone" }],
    note: "A 5-ft-radius stone: it and everyone nearby roll Initiative (stone +8); on its turn it rolls 60 ft. Trigger it on each creature whose space it enters (or who enters its space). Stone: Large object, AC 17, HP 100, threshold 10 (add it in Objects). Slowing it: an action, DC 20 Strength (Athletics).", detect: "Study action, DC 15 Intelligence (Investigation): the pressure plate; an Iron Spike under it stops it." }),
  H({ key: "spiked-pit", name: "Spiked Pit", kind: "trap", rating: "Deadly 1–4", cells: 2, triggers: ["enter"], damage: [{ formula: "1d6", type: "Bludgeoning" }, { formula: "2d8", type: "Piercing" }], color: "#4e342e",
    conditions: [{ key: "prone" }],
    note: "10 ft deep with spikes; the lid stays open after. Climbing out needs a Climb Speed, climbing gear or magic.", detect: "Study action, DC 15 Intelligence (Investigation); an Iron Spike wedged under the lid makes it safe." }),
];

export const hazardDef = (key: string) => HAZARDS.find((h) => h.key === key);

/** Stored on the placed map item. */
export interface PlacedHazard { key: string; armed: boolean }

export function readHazard(meta: Record<string, unknown>): PlacedHazard | null {
  const h = meta[HAZARD_KEY] as PlacedHazard | undefined;
  return h && typeof h.key === "string" && hazardDef(h.key) ? { key: h.key, armed: h.armed !== false } : null;
}

export interface HazardOutcome {
  /** Total damage to apply (after half on a success). */
  damage: number;
  /** Conditions to add (on a failed save, or always with no save). */
  conditions: NonNullable<HazardDef["conditions"]>;
  failed: boolean;
  text: string;
}

/**
 * What happens to a creature: `saveTotal` (if the hazard has a save), `rolled` damage per damage entry (already
 * multiplied by `times`). No save: the damage and conditions always apply. `defenses`: the creature's sheet defenses,
 * applied per damage type after halving on a success (Immunity, Resistance, Vulnerability); conditions it's immune to
 * are skipped.
 */
export function resolveHazard(d: HazardDef, name: string, saveTotal: number | null, rolled: number[], defenses?: UnitSheet["defenses"]): HazardOutcome {
  const failed = !d.save || saveTotal === null || saveTotal < d.save.dc;
  const notes: string[] = [];
  const parts = (d.damage ?? []).map((dm, i) => {
    const raw = rolled[i] ?? 0;
    const base = failed ? raw : d.half ? Math.floor(raw / 2) : 0;
    if (!base) return { type: dm.type, amount: 0 };
    const r = damageAgainst(defenses, base, dm.type);
    if (r.note) notes.push(r.note);
    return { type: dm.type, amount: r.amount };
  });
  const damage = parts.reduce((s, p) => s + p.amount, 0);
  const all = failed ? d.conditions ?? [] : [];
  const conditions = all.filter((c) => !immuneToCondition(defenses, c.key));
  const skipped = all.filter((c) => !conditions.includes(c));
  const label = (c: { key: string; label?: string }) => c.label ?? c.key[0]!.toUpperCase() + c.key.slice(1);
  const saveText = d.save && saveTotal !== null ? ` ${saveTotal} vs DC ${d.save.dc}: ${failed ? "fails" : "succeeds"}.` : "";
  const shown = parts.filter((p) => p.amount > 0);
  const tags = [!failed && d.half ? "half" : "", ...notes].filter(Boolean);
  const dmgText = damage ? ` ${shown.map((p) => `${p.amount} ${p.type}`).join(" + ")} damage${tags.length ? ` (${tags.join("; ")})` : ""}.` : "";
  const zero = !damage && notes.length ? ` No damage (${notes.join("; ")}).` : "";
  const condText = conditions.length ? ` ${conditions.map(label).join(", ")}.` : "";
  const skipText = skipped.length ? ` Immune to ${skipped.map(label).join(", ")}.` : "";
  const body = `${saveText}${damage ? dmgText : zero}${condText}${skipText}`;
  return { damage, conditions, failed, text: `${d.name} → ${name}:${body || " nothing happens."}` };
}

/** Which placed hazards a token newly entered: in `now` but not in `before`. */
export const entered = (before: Set<string>, now: Set<string>) => [...now].filter((id) => !before.has(id));
