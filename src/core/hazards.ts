/**
 * Hazards and traps as things placed on the map: the 2024 DMG's (chapter 3) and every other official trap 5etools lists
 * (2014 DMG, Xanathar's, Van Richten's, The Book of Many Things, adventures). Each has its area (in squares), what sets
 * it off (a creature entering the area, or starting its turn there; or the GM, for "when touched" and the like), and
 * what happens: an attack roll, a saving throw, damage (half on a success where the book says so) and conditions.
 * Complex traps have elements the GM sets off one at a time (Path of Blades' blades, pillars and rune).
 * Pure data and resolution; the background page watches tokens and runs it, DM Tools places them.
 */
import { BUTLER_NS } from "./constants";
import type { Ability, UnitSheet } from "./sheet";
import { damageAgainst, immuneToCondition } from "./defenses";

export const HAZARD_KEY = `${BUTLER_NS}/hazard`;

export type HazardTrigger = "enter" | "start";

export interface HazardCondition { key: string; label?: string; rounds?: number; note?: string; always?: boolean }

/** What a hazard (or one element of a complex trap) does to one creature. */
export interface HazardEffect {
  save?: { ability: Ability; dc: number };
  /** The trap attacks first (against the creature's AC): nothing happens on a miss. `count` attacks, the damage once per hit. */
  attack?: { bonus: number; count?: number };
  /** `always`: taken whatever the save (Poison Needle's 1 Piercing). */
  damage?: { formula: string; type: string; always?: boolean }[];
  /** Roll this first: the damage happens that many times (Poisoned Darts: 1d3 darts). */
  times?: string;
  /** Half damage on a successful save (otherwise none). */
  half?: boolean;
  /** On a failed save (or a hit, or always with neither); `always`: whatever the save (a falling net's Restrained). */
  conditions?: HazardCondition[];
  /** Said when it goes off ("an iron portcullis drops"). */
  says?: string;
}

/** One part of a multi-part trap, set off by hand (Path of Blades' Whirling Blades, Crushing Pillars…). */
export interface HazardElement extends HazardEffect { name: string; note?: string }

export interface HazardDef extends HazardEffect {
  key: string;
  name: string;
  kind: "hazard" | "trap";
  /** 5etools source: XDMG, DMG, XGE… */
  source: string;
  /** The 5etools entry it stands for when that differs from name|source ("Pits|DMG" is split in four). */
  fivetools?: string;
  /** Severity and levels, as the book rates it. */
  rating: string;
  /** Side of the square area it occupies, in squares. */
  cells: number;
  /** What sets it off automatically; empty = only when the GM triggers it (touched, a lock opened…). */
  triggers: HazardTrigger[];
  /** A trap that goes off once and is then spent (the GM can re-arm it). */
  once?: boolean;
  /** Parts the GM sets off by hand, in addition to (or instead of) the main effect above. */
  elements?: HazardElement[];
  /** What else happens, for the GM. */
  note: string;
  detect?: string;
  /** Picture: colour and file in public/hazards/. */
  color: string;
  image: string;
}

export const SOURCE_NAMES: Record<string, string> = {
  XDMG: "Dungeon Master's Guide (2024)", DMG: "Dungeon Master's Guide (2014)", XGE: "Xanathar's Guide to Everything",
  VRGR: "Van Richten's Guide to Ravenloft", BMT: "The Book of Many Things", RtG: "Return to Glory", AZfyT: "A Zib for Your Thoughts",
};

/** Haunted traps (VRGR): noticing the emanation and disarming. */
const HAUNTED = (bonus: number) => `Its emanation comes first: noticed with a passive Wisdom (Perception) of ${10 + bonus} or more (then there's until the start of the next turn to react); Divine Sense and Detect Evil and Good detect it. Thieves' tools and Dispel Magic don't work: Channel Divinity (an action) or Remove Curse makes it save against the spell save DC with +${bonus}; on a failure it's disarmed for 24 hours, for good if it fails by 10 or more.`;

const H = (d: Omit<HazardDef, "image" | "source"> & { image?: string; source?: string }): HazardDef => ({ ...d, source: d.source ?? "XDMG", image: d.image ?? `${d.key}.png` });

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
  // ---- traps from other official books (5etools trapshazards.json)
  // Dungeon Master's Guide (2014)
  H({ key: "collapsing-roof-2014", name: "Collapsing Roof", kind: "trap", source: "DMG", rating: "Mechanical trap", cells: 2, triggers: ["enter"], once: true, save: { ability: "dex", dc: 15 }, damage: [{ formula: "4d10", type: "Bludgeoning" }], half: true, color: "#6d4c41",
    note: "A trip wire 3 in. off the ground pulls the supports of the unstable ceiling above this area. Knocking over one of the wedged beams (an action) also sets it off. The rubble makes the area Difficult Terrain.",
    detect: "DC 10 to spot the trip wire; anyone who can see the ceiling can tell it's about to collapse. DC 15 Dexterity check with thieves' tools disables the wire (Disadvantage with an edged weapon or tool instead); failure sets it off." }),
  H({ key: "falling-net-2014", name: "Falling Net", kind: "trap", source: "DMG", rating: "Mechanical trap", cells: 2, triggers: ["enter"], once: true, save: { ability: "str", dc: 10 }, color: "#a1887f",
    conditions: [{ key: "restrained", always: true, note: "Net: an action and a DC 10 Strength check frees a creature within reach" }, { key: "prone" }],
    note: "Everyone under the 10-ft-square net is Restrained; a failed DC 10 Strength save also knocks them Prone. Freeing a creature: an action and a DC 10 Strength check. Net: AC 10, 20 HP; 5 Slashing damage destroys a 5-ft square of it, freeing whoever is under it.",
    detect: "DC 10 to spot the trip wire and the net. DC 15 Dexterity check with thieves' tools breaks the wire harmlessly (Disadvantage with an edged weapon or tool instead); failure sets it off." }),
  H({ key: "fire-breathing-statue", name: "Fire-Breathing Statue", kind: "trap", source: "DMG", rating: "Magic trap", cells: 1, triggers: ["enter"], save: { ability: "dex", dc: 13 }, damage: [{ formula: "4d10", type: "Fire" }], half: true, color: "#e65100",
    note: "The pressure plate (more than 20 lb). The statue breathes a 30-ft Cone of fire: place a Cone template and set it off on everyone in it.",
    detect: "DC 15 to spot the pressure plate and faint scorch marks; Detect Magic shows Evocation around the statue. An Iron Spike wedged under the plate stops it; Dispel Magic (DC 13) on the statue destroys it." }),
  H({ key: "simple-pit", name: "Simple Pit", kind: "trap", source: "DMG", fivetools: "Pits|DMG", rating: "Mechanical trap", cells: 2, triggers: ["enter"], damage: [{ formula: "1d6", type: "Bludgeoning" }], color: "#6d5a4b",
    conditions: [{ key: "prone" }],
    note: "A hole covered by camouflaged cloth; the victim pulls the cloth down with it. Usually 10 ft deep (1d6 per 10 ft fallen: add more by hand for a deeper pit).", detect: "DC 10 to spot the pit." }),
  H({ key: "hidden-pit-2014", name: "Hidden Pit", kind: "trap", source: "DMG", fivetools: "Pits|DMG", rating: "Mechanical trap", cells: 2, triggers: ["enter"], damage: [{ formula: "1d6", type: "Bludgeoning" }], color: "#5d4037",
    conditions: [{ key: "prone" }],
    note: "The cover swings open like a trapdoor. Usually 10 or 20 ft deep (1d6 per 10 ft fallen: add more by hand for a deeper pit).",
    detect: "DC 15 Wisdom (Perception): no foot traffic over that floor; DC 15 Intelligence (Investigation) confirms the cover. An Iron Spike wedged in, or Arcane Lock, holds it shut." }),
  H({ key: "locking-pit", name: "Locking Pit", kind: "trap", source: "DMG", fivetools: "Pits|DMG", rating: "Mechanical trap", cells: 2, triggers: ["enter"], damage: [{ formula: "1d6", type: "Bludgeoning" }], color: "#4e3b31",
    conditions: [{ key: "prone" }, { key: "custom", label: "Locked in a pit", note: "The spring-loaded cover snapped shut: DC 20 Strength check to pry it open" }],
    note: "A hidden pit whose spring-loaded cover snaps shut on its victim. Prying it open: DC 20 Strength check (or smash the cover). From inside: DC 15 Dexterity check with thieves' tools disables the spring, if it can be reached and seen. A nearby hidden mechanism may open it.",
    detect: "As a hidden pit: DC 15 Wisdom (Perception) and DC 15 Intelligence (Investigation); an Iron Spike or Arcane Lock holds it shut." }),
  H({ key: "spiked-pit-2014", name: "Spiked Pit", kind: "trap", source: "DMG", fivetools: "Pits|DMG", rating: "Mechanical trap", cells: 2, triggers: ["enter"], damage: [{ formula: "1d6", type: "Bludgeoning" }, { formula: "2d10", type: "Piercing" }], color: "#3e2723",
    conditions: [{ key: "prone" }],
    elements: [{ name: "Poisoned spikes", save: { ability: "con", dc: 13 }, damage: [{ formula: "4d10", type: "Poison" }], half: true, note: "Nastier versions: anyone taking Piercing damage from the spikes also makes this save." }],
    note: "A simple, hidden or locking pit with spikes at the bottom: 2d10 Piercing on top of the fall (10 ft assumed).", detect: "As the simple, hidden or locking pit it's built on." }),
  H({ key: "poison-darts", name: "Poison Darts", kind: "trap", source: "DMG", rating: "Mechanical trap", cells: 1, triggers: [], attack: { bonus: 8 }, save: { ability: "con", dc: 15 },
    damage: [{ formula: "1d4", type: "Piercing", always: true }, { formula: "2d10", type: "Poison" }], half: true, color: "#689f38",
    note: "The pressure plate (more than 20 lb) fires four darts, each at a random creature within 10 ft of it (vision doesn't matter): trigger it once per dart on the creature it targets. A hit deals 1d4 Piercing and calls for the Constitution save.",
    detect: "DC 15 to spot the holes; DC 15 Intelligence (Investigation): the pressure plate. An Iron Spike under the plate stops it; cloth or wax in the holes stops their darts." }),
  H({ key: "poison-needle", name: "Poison Needle", kind: "trap", source: "DMG", rating: "Mechanical trap", cells: 1, triggers: [], save: { ability: "con", dc: 15 },
    damage: [{ formula: "1", type: "Piercing", always: true }, { formula: "2d10", type: "Poison", always: true }], color: "#7cb342",
    conditions: [{ key: "poisoned", rounds: 600, note: "Poison Needle: 1 hour" }],
    note: "Trigger it when someone opens the lock without its key or fails to pick it: 1 Piercing and 2d10 Poison, and Poisoned for 1 hour on a failed save.",
    detect: "DC 20 Intelligence (Investigation): alterations to the lock. DC 15 Dexterity check with thieves' tools removes the needle." }),
  H({ key: "rolling-sphere", name: "Rolling Sphere", kind: "trap", source: "DMG", rating: "Mechanical trap", cells: 2, triggers: [], save: { ability: "dex", dc: 15 }, damage: [{ formula: "10d10", type: "Bludgeoning" }], color: "#616161",
    conditions: [{ key: "prone" }],
    note: "The pressure plate (20 lb) drops a 10-ft-diameter stone sphere from the ceiling. Everyone rolls Initiative (sphere +8); on its turn it rolls 60 ft in a straight line until a wall stops it. Trigger it on each creature whose space it enters (or who enters its space; it's Difficult Terrain). Slowing it: an action within 5 ft, DC 20 Strength check, −15 ft speed.",
    detect: "DC 15 Wisdom (Perception): the trapdoor and the plate; DC 15 Intelligence (Investigation) of the floor or ceiling: the mortar gives them away. An Iron Spike under the plate stops it." }),
  H({ key: "sphere-of-annihilation", name: "Sphere of Annihilation", kind: "trap", source: "DMG", rating: "Magic trap", cells: 1, triggers: [], color: "#212121",
    conditions: [{ key: "custom", label: "Annihilated", note: "Obliterated by a sphere of annihilation, with everything it carried" }],
    says: "Obliterated: the creature and everything it carries are destroyed.",
    note: "A 2-ft mouth of magical darkness in a carved stone face; any matter that enters it is obliterated. Some versions urge chosen creatures to crawl inside (the sympathy of Antipathy/Sympathy). Trigger it on a creature that goes in.",
    detect: "DC 20 Intelligence (Arcana): a sphere of annihilation that can't be controlled or moved. Dispel Magic (DC 18) removes the enchantment." }),
  // Xanathar's Guide to Everything
  H({ key: "bear-trap", name: "Bear Trap", kind: "trap", source: "XGE", rating: "Simple trap · dangerous, levels 1–4", cells: 1, triggers: ["enter"], once: true, attack: { bonus: 8 }, damage: [{ formula: "1d10", type: "Piercing" }], color: "#78909c",
    conditions: [{ key: "custom", label: "Bear Trap", note: "Speed 0 until freed: DC 15 Strength check by it or a creature next to the trap" }],
    note: "Iron jaws spiked into the ground. The attack can't have Advantage or Disadvantage. Breaking free: DC 15 Strength check by the victim or an adjacent creature.",
    detect: "DC 10 Wisdom (Perception) reveals it; DC 10 Dexterity check with thieves' tools disables it." }),
  H({ key: "crossbow-trap", name: "Crossbow Trap", kind: "trap", source: "XGE", rating: "Simple trap · dangerous, levels 1–4", cells: 1, triggers: ["enter"], once: true, attack: { bonus: 8, count: 2 }, damage: [{ formula: "1d10", type: "Piercing" }], color: "#8d6e63",
    note: "A trip wire across the hall fires two hidden heavy crossbows at whoever breaks it. The attacks can't have Advantage or Disadvantage.",
    detect: "DC 15 Wisdom (Perception): the trip wire. DC 15 Dexterity check with thieves' tools disables it; a total of 5 or lower sets it off." }),
  H({ key: "falling-portcullis", name: "Falling Portcullis", kind: "trap", source: "XGE", rating: "Simple trap · moderate, levels 1–4", cells: 1, triggers: ["enter"], once: true, color: "#546e7a",
    says: "An iron portcullis drops from the ceiling, blocking the way.",
    note: "The pressure plate. The portcullis may drop far from it, even at the dungeon's entrance, so the party doesn't know it's shut in until it heads for the exit.",
    detect: "DC 20 Wisdom (Perception): the pressure plate. DC 20 Dexterity check with thieves' tools disables it; a total of 5 or lower sets it off." }),
  H({ key: "fiery-blast-trap", name: "Fiery Blast Trap", kind: "trap", source: "XGE", rating: "Simple trap · dangerous, levels 5–10", cells: 3, triggers: ["enter"], save: { ability: "dex", dc: 15 }, damage: [{ formula: "7d6", type: "Fire" }], half: true, color: "#f4511e",
    note: "A floor mosaic that erupts in a 15-ft Cube of fire around itself when stepped on. Those openly wearing the temple god's holy symbol don't set it off.",
    detect: "DC 15 Wisdom (Perception): ash and faint burn marks. DC 15 Intelligence (Religion) defaces a key rune at the mosaic's edge, destroying the trap (failure sets it off); Dispel Magic (DC 15) on the runes destroys it." }),
  H({ key: "net-trap", name: "Net Trap", kind: "trap", source: "XGE", rating: "Simple trap · dangerous, levels 1–4", cells: 2, triggers: ["enter"], once: true, save: { ability: "dex", dc: 15 }, color: "#a1887f",
    conditions: [{ key: "restrained", note: "Net: an action and a DC 10 Strength check frees a creature" }],
    says: "A bell rings, alerting nearby guards.",
    note: "A 10-ft-square net centred on the trip wire; only creatures fully within it make the save. Freeing a creature: an action and a DC 10 Strength check; 5 Slashing damage to the net (AC 10, 20 HP) frees one without harming it.",
    detect: "DC 15 Wisdom (Perception): the trip wire and the net. DC 15 Dexterity check with thieves' tools disables it silently; failure sets it off." }),
  H({ key: "pit-trap", name: "Pit Trap", kind: "trap", source: "XGE", rating: "Simple trap · moderate, levels 1–4", cells: 2, triggers: ["enter"], save: { ability: "dex", dc: 10 }, damage: [{ formula: "1d6", type: "Bludgeoning" }], color: "#5d4037",
    conditions: [{ key: "prone" }],
    note: "A 10-ft-deep hole under canvas covered with leaves and dirt. On a success the creature catches the edge or steps back. A 1-ft ledge around the edges is safe.",
    detect: "DC 10 Wisdom (Perception): the canvas and the ledge." }),
  H({ key: "poison-needle-trap", name: "Poison Needle Trap", kind: "trap", source: "XGE", rating: "Simple trap · deadly, levels 1–4", cells: 1, triggers: [], save: { ability: "con", dc: 20 }, damage: [{ formula: "4d6", type: "Poison" }], half: true, color: "#558b2f",
    conditions: [{ key: "poisoned", rounds: 100, note: "Poison Needle Trap: 10 minutes, Paralyzed while Poisoned" }, { key: "paralyzed", rounds: 100, note: "While Poisoned by the needle" }],
    note: "Trigger it on whoever tries to pick or open the lock. On a success: half damage and not Poisoned.",
    detect: "DC 20 Wisdom (Perception) reveals the needle, only when inspecting the lock. DC 20 Dexterity check with thieves' tools disables it; a total of 10 or lower sets it off." }),
  H({ key: "scything-blade-trap", name: "Scything Blade Trap", kind: "trap", source: "XGE", rating: "Simple trap · dangerous, levels 5–10", cells: 1, triggers: [], save: { ability: "dex", dc: 15 }, damage: [{ formula: "4d6", type: "Slashing" }], half: true, color: "#90a4ae",
    note: "Pulling the lever sweeps blades through a 5-ft-wide, 20-ft-long area: place a Line template and set it off on each Medium or larger creature in it.",
    detect: "The lever isn't hidden. DC 15 Wisdom (Perception) of the area: scrape marks and bloodstains. DC 15 Dexterity check with thieves' tools disables the lever." }),
  H({ key: "sleep-of-ages-trap", name: "Sleep of Ages Trap", kind: "trap", source: "XGE", rating: "Simple trap · deadly, levels 11–16", cells: 8, triggers: [], color: "#5c6bc0",
    conditions: [{ key: "unconscious", rounds: 10, note: "Sleep: 1 minute, or until it takes damage or someone uses an action to wake it" }],
    note: "The pressure plate casts Sleep at 9th level centred on itself (20-ft radius, this area): roll 21d8; creatures fall asleep in order of lowest current HP, each subtracting its HP from the total. Trigger it on those it puts to sleep.",
    detect: "DC 20 Wisdom (Perception): the plate. DC 20 Intelligence (Arcana) within 5 ft disables it; a total of 10 or lower sets it off. Dispel Magic (DC 19) on the plate destroys it." }),
  H({ key: "path-of-blades", name: "Path of Blades", kind: "trap", source: "XGE", rating: "Complex trap · dangerous, levels 1–4", cells: 4, triggers: [], color: "#b0bec5",
    elements: [
      { name: "Whirling Blades (initiative 20)", attack: { bonus: 5 }, damage: [{ formula: "2d10", type: "Slashing" }], note: "Each creature in the first 80 ft. After each miss: +2 to hit and +1d6 damage, until they hit." },
      { name: "Crushing Pillars (initiative 10)", save: { ability: "dex", dc: 15 }, damage: [{ formula: "2d10", type: "Bludgeoning" }], half: true, conditions: [{ key: "prone" }], note: "Each creature in the next 50 ft." },
      { name: "Rune of Fear (initiative 10, and end of turn)", save: { ability: "wis", dc: 15 }, conditions: [{ key: "frightened", note: "Rune of Fear: uses its reaction to move its speed toward the pillars; can't move closer to the far end; an action and a DC 15 Wisdom save ends it" }], note: "Each creature in the last 30 ft, and any that ends its turn there." },
      { name: "Whirling Blades (end of turn)", attack: { bonus: 5 }, damage: [{ formula: "1d10", type: "Slashing" }], note: "A creature that ends its turn in the blades' area." },
    ],
    note: "A 20-ft-wide, 160-ft-long hall, active while any non-undead creature is in it; the floor is Difficult Terrain from 80 to 130 ft. Each successful check against the rune adds 1d10 to the blades' and pillars' damage and +1 to the rune's DC.",
    detect: "Blades: disabled at −8 to hit. DC 15 Intelligence (Investigation), an action: their attacks against you have Disadvantage. A readied attack on a blade (AC 15, 15 HP; it attacks you with Advantage) or a DC 15 Dexterity check with thieves' tools: −2 to hit each. Pillars: no countermeasure. Rune: three DC 15 Intelligence (Arcana) checks at the far end (one creature at a time) or three Dispel Magic (DC 13)." }),
  H({ key: "poisoned-tempest", name: "Poisoned Tempest", kind: "trap", source: "XGE", rating: "Complex trap · deadly, levels 11–16", cells: 12, triggers: [], color: "#7b1fa2",
    elements: [
      { name: "Poison Gas (initiative 20)", save: { ability: "con", dc: 20 }, damage: [{ formula: "6d10", type: "Poison" }], half: true, note: "Each creature in the room. +2d10 each round after it starts, to 10d10." },
      { name: "Poison Gas, 2nd round (8d10)", save: { ability: "con", dc: 20 }, damage: [{ formula: "8d10", type: "Poison" }], half: true },
      { name: "Poison Gas, 3rd round on (10d10)", save: { ability: "con", dc: 20 }, damage: [{ formula: "10d10", type: "Poison" }], half: true },
      { name: "Tempest 2: explosive gas", save: { ability: "dex", dc: 20 }, damage: [{ formula: "4d10", type: "Fire" }], half: true, note: "Only if someone holds an open flame; the flame then goes out." },
      { name: "Tempest 4: buffeting winds", save: { ability: "str", dc: 20 }, conditions: [{ key: "prone" }] },
    ],
    note: "A 60-ft-square room with four serpent statues; prying a ruby from one sets it off. Initiative 20: the four doors slam and lock (first time only) and Poison Gas floods the room. Initiative 10, Tempest (d6): 1 Intelligence and Wisdom checks at Disadvantage; 2 explosive gas; 3 Strength and Dexterity checks at Disadvantage; 4 buffeting winds; 5 smoke, visibility 1 ft; 6 Poison Gas again — each until the next Tempest.",
    detect: "Doors: DC 20 Wisdom (Perception) finds the lock, DC 20 Intelligence (Arcana) removes its sphere of force (Dispel Magic doesn't work), DC 20 thieves' tools picks it, DC 20 Strength (Athletics) pushes the door, an action each. Statues (AC 17, 20 HP): breaking one adds 1d10 to the gas; blocking one (DC 20 thieves' tools, or DC 15 Strength with a cloak, someone staying next to it) takes 1d10 off; all four blocked ends the trap." }),
  H({ key: "sphere-of-crushing-doom", name: "Sphere of Crushing Doom", kind: "trap", source: "XGE", rating: "Complex trap · deadly, levels 5–10", cells: 2, triggers: [], color: "#455a64",
    elements: [4, 6, 8, 10].map((n) => ({ name: n === 4 ? "Sphere (initiative 10)" : `Sphere, ${n}d10${n === 10 ? " (initiative 20 and 10)" : ""}`,
      save: { ability: "str" as const, dc: 20 }, damage: [{ formula: `${n}d10`, type: "Bludgeoning" }], half: true, conditions: [{ key: "prone" }],
      ...(n === 4 ? { note: "Each creature in its path down the slope. +2d10 after each of its turns; from 10d10 it acts on 20 and 10." } : {}) })),
    note: "Opening the jester's tomb door sends a steel sphere down a 10-ft-wide, 150-ft sloping hall; a portal at the bottom sends it back to the top. Objects blocking it take maximum damage.",
    detect: "Stop the sphere (Wall of Force, or an object that survives the hit). Or disrupt a portal: examine its runes (an action), then three DC 20 Intelligence (Arcana) checks (−2d10 damage each) or three Dispel Magic (DC 19). With the bottom portal gone, the sphere stops against the south wall." }),
  // Van Richten's Guide to Ravenloft: haunted traps
  H({ key: "danse-macabre", name: "Danse Macabre", kind: "trap", source: "VRGR", rating: "Haunted trap · Haunt Bonus +4", cells: 8, triggers: ["enter", "start"], save: { ability: "wis", dc: 14 }, color: "#8e24aa",
    conditions: [{ key: "custom", label: "Danse Macabre", note: "Floats 20 ft up and dances (Otto's Irresistible Dance) until the song ends; an action to repeat the save, then falls 20 ft (2d6 Bludgeoning)" }],
    elements: [{ name: "Falls when freed by its own save", damage: [{ formula: "2d6", type: "Bludgeoning" }] }],
    note: "A 20-ft sphere around an ancient instrument. A creature entering brings mournful music; a round later a phantom performer plays for 1 minute (disarm it when the song ends). A creature that succeeds on a save is immune for 24 hours. Talking the performer down: an action, DC 14 Charisma (Persuasion); everyone floats down safely.",
    detect: HAUNTED(4) }),
  H({ key: "faceless-malice", name: "Faceless Malice", kind: "trap", source: "VRGR", rating: "Haunted trap · Haunt Bonus +2", cells: 3, triggers: ["start"], save: { ability: "wis", dc: 12 }, color: "#6a1b9a",
    conditions: [{ key: "blinded", rounds: 10, note: "Faceless Malice" }, { key: "deafened", rounds: 10, note: "Faceless Malice" }, { key: "custom", label: "Faceless", rounds: 10, note: "Can't speak; its face looks erased. Remove Curse or breaking the mirror ends it" }],
    note: "A 15-ft cube in front of an ornate mirror. A visible creature entering sees its distorted reflection; starting its next turn there sets it off. After a failed save it won't activate for 24 hours (disarm it). Mirror: AC 12, 10 HP, Vulnerability to Bludgeoning, Immunity to Poison and Psychic.",
    detect: HAUNTED(2) }),
  H({ key: "icon-of-the-lower-aerial-kingdoms", name: "Icon of the Lower Aerial Kingdoms", kind: "trap", source: "VRGR", rating: "Haunted trap · Haunt Bonus +6", cells: 4, triggers: ["start"], once: true, save: { ability: "wis", dc: 16 }, color: "#4a148c",
    conditions: [{ key: "charmed", rounds: 10, note: "Icon: ends if damaged or shaken (an action); after the full minute, Magic Jar: a fiend's spirit takes the body" }, { key: "incapacitated", rounds: 10, note: "Icon: ends if damaged or shaken (an action)" }],
    note: "A 10-ft sphere around a 1-ft statue of a four-winged bird-fiend, once a day. Flapping wings and warm air on entering; starting the next turn there sets it off. Charmed the whole minute: Magic Jar, the soul trapped in the statue, until Dispel Evil and Good on the creature or the statue (AC 17, 15 HP, Immunity to Poison and Psychic) is destroyed.",
    detect: `${HAUNTED(6)} Dispel Evil and Good on the statue disarms it for good.` }),
  H({ key: "morbid-memory", name: "Morbid Memory", kind: "trap", source: "VRGR", rating: "Haunted trap · Haunt Bonus +0", cells: 6, triggers: [], save: { ability: "wis", dc: 10 }, color: "#7e57c2",
    conditions: [{ key: "frightened", note: "Morbid Memory: 1d4 rounds; Dashes away from the area by the safest route each turn" }],
    note: "A room or 30-ft square. Faint whispers when a creature enters; if it's still there at the start of its next turn, an illusion replays a terrible event for about a minute. Trigger it on everyone who saw it when it ends (Frightened 1d4 rounds). Then it won't activate for 24 hours.",
    detect: HAUNTED(0) }),
  // The Book of Many Things
  H({ key: "balance-and-ruin", name: "Balance and Ruin", kind: "trap", source: "BMT", rating: "Mechanical trap · deadly, levels 5–10", cells: 4, triggers: [], color: "#8d6e63",
    elements: [
      { name: "Balance Beam", save: { ability: "dex", dc: 12 }, conditions: [{ key: "prone" }], note: "Ends its turn on the beam, or is on it when it tilts. Disadvantage with metal armor or gear while the walls are magnetized. Failing by 5 or more: falls into the gear pit instead." },
      { name: "Magnetic Walls", damage: [{ formula: "2d10", type: "Bludgeoning" }], conditions: [{ key: "restrained", note: "Stuck to the magnetic wall until the field switches off" }], note: "Each creature off the beam wearing metal armor or holding metal gear is pulled to the nearest wall." },
      { name: "Gear Pit", save: { ability: "dex", dc: 17 }, damage: [{ formula: "10d10", type: "Bludgeoning" }], conditions: [{ key: "prone" }], note: "Falls in or ends its turn there. Standing needs an action and a Tiny object to jam the gears until the end of its turn." },
    ],
    note: "A 100-ft-long beam (Difficult Terrain) over a 25-ft-deep pit of turning gears, between metal walls 25 ft away on each side. Weight between the party and the central fulcrum tips the beam onto a hidden plate that magnetizes the walls, unless counterweighted on the far side.",
    detect: "DC 15 Intelligence (Investigation) examining the beam: its slight tilt. Counterweighting the far end (or taking all weight off) turns the field off." }),
  H({ key: "surface-of-the-sun", name: "Surface of the Sun", kind: "trap", source: "BMT", rating: "Magic trap · dangerous, levels 1–4", cells: 6, triggers: [], damage: [{ formula: "1d10", type: "Radiant" }], color: "#ffb300",
    elements: [{ name: "Talons Pedestal", damage: [{ formula: "2d10", type: "Slashing" }], conditions: [{ key: "grappled", note: "Talons (escape DC 15); AC 19, 10 HP" }], note: "Touching the silver orb (worth 500 gp)." }],
    note: "Three 15-ft-wide, 100-ft halls under a scorching ceiling: at initiative 20 (losing ties), set it off on every creature in the area. The 4-ft gold key is a living object (Flying Sword) one round after it's taken, and tries to return to its rack; it opens the skull door. Climbing the vines: DC 12 Strength (Athletics).",
    detect: "DC 12 Wisdom (Perception): the talons' pressure plate through a slit; DC 13 Dexterity check with thieves' tools opens the talons (a grappled Small or Medium creature can't reach it)." }),
  H({ key: "test-of-the-empty-moon", name: "Test of the Empty Moon", kind: "trap", source: "BMT", rating: "Mechanical trap · setback, levels 1–4", cells: 6, triggers: ["enter"], save: { ability: "dex", dc: 15 }, color: "#b0bec5",
    conditions: [{ key: "prone" }],
    note: "A 30-ft-wide, 20-ft-deep silver bowl (Difficult Terrain; ending a turn in it also calls for the save: trigger it by hand). It can't be climbed out of without help. 4,000 lb on the scale under it fills the moon glyph and opens the portcullis. The lever drops the bowl (half moon), floods the room (1,000 lb of water a minute; full after 4 minutes) and releases four Ochre Jellies (500 lb each).",
    detect: "Detect Magic: the Immovable Rod under the bowl." }),
  // Return to Glory
  H({ key: "death-fog-trap", name: "Death Fog Trap", kind: "trap", source: "RtG", rating: "Simple trap · dangerous, levels 5–10", cells: 8, triggers: ["enter", "start"], save: { ability: "con", dc: 15 }, damage: [{ formula: "5d8", type: "Poison" }], half: true, color: "#9ccc65",
    note: "Place it when thieves disturb the burial niches: the doors slam shut and lock and a Cloudkill (DC 15) fills the room. Entering it or starting a turn in it: 5d8 Poison, half on a success.",
    detect: "DC 15 Wisdom (Perception): runes on the doors and niches; DC 15 Intelligence (Arcana): a conjuration ward. Dispel Magic (DC 15, or at 5th level) on the runes disperses the cloud." }),
  // A Zib for Your Thoughts
  H({ key: "phase-transference-emitter", name: "Malfunctioning Phase Transference Emitter", kind: "trap", source: "AZfyT", rating: "Complex trap · dangerous, levels 1–4", cells: 2, triggers: [], color: "#29b6f6",
    elements: [
      { name: "Phase Beam (initiative 20)", attack: { bonus: 5 }, conditions: [{ key: "invisible", rounds: 10, note: "Phase beam" }, { key: "custom", label: "Phased", rounds: 10, note: "Incorporeal: fly 10 ft only, Resistance to nonmagical damage, Advantage on Str/Dex/Con saves, passes through solids; can't touch or attack unaffected things (can talk and cast)" }], note: "A random creature in the room; from its 4th turn it also fires on initiative 10." },
      { name: "Coil Discharge (initiative 10)", save: { ability: "dex", dc: 11 }, damage: [{ formula: "3d6", type: "Lightning" }], note: "Each creature within 30 ft of the power matrix." },
      { name: "Coil Discharge (end of turn within 5 ft)", save: { ability: "dex", dc: 11 }, damage: [{ formula: "2d6", type: "Lightning" }], note: "Disadvantage in metal armor." },
      { name: "Emitter Heat (touching it)", damage: [{ formula: "1d6", type: "Fire" }] },
      { name: "Room Heat (6th turn)", save: { ability: "con", dc: 10 }, conditions: [{ key: "exhaustion" }], note: "Disadvantage in Medium or Heavy armor; Fire Resistance or Immunity: no save needed." },
      { name: "Room Heat (9th turn)", save: { ability: "con", dc: 13 }, conditions: [{ key: "exhaustion" }], note: "As on the 6th turn." },
      { name: "Explosion (10th turn)", damage: [{ formula: "10d6", type: "Fire" }], note: "Everyone in the room; the trap is destroyed and the facility loses power." },
    ],
    note: "A 10-ft ring of coils wired to an 8-ft steel emitter on a swivel, already overloading once the power switch is thrown. Roll initiative for it; the room gets hotter from its 3rd turn.",
    detect: "Beam: DC 15 Intelligence (Investigation), an action: its attacks against you have Disadvantage; DC 15 thieves' tools or Strength locks the swivel (touching the hot emitter), disabling it; cutting its 10 cables (AC 5, 3 HP each): −1 to hit per two, all ten stop it. Coils: three DC 15 Intelligence (Arcana) checks or Dispel Magic (DC 13) stop the discharges and the explosion. Main breaker: DC 10 Perception finds it; two DC 20 thieves' tools or DC 16 Arcana checks, or 20 damage with a magic weapon, open it; the switch stops everything." }),
];

export const hazardDef = (key: string) => HAZARDS.find((h) => h.key === key);

/** The books the catalog draws on, in the order the picker lists them. */
export const HAZARD_SOURCES = [...new Set(HAZARDS.map((h) => h.source))];

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
  conditions: HazardCondition[];
  failed: boolean;
  text: string;
}

/** Something a placed hazard can set off on a creature: its main effect, or one element of a complex trap. */
export interface HazardOption { name: string; effect: HazardEffect }

export const hasEffect = (e: HazardEffect) => !!(e.save || e.attack || e.damage?.length || e.conditions?.length || e.says);

/** What the GM can set off: the main effect (if any) and then each element, named "Trap: element". */
export function hazardOptions(d: HazardDef): HazardOption[] {
  return [...(hasEffect(d) ? [{ name: d.name, effect: d as HazardEffect }] : []), ...(d.elements ?? []).map((e) => ({ name: `${d.name}: ${e.name}`, effect: e }))];
}

/** A trap's attack roll: a natural 20 always hits (and is a critical hit), a natural 1 always misses. */
export function attackHits(natural: number | undefined, total: number, ac: number): { hit: boolean; crit: boolean } {
  if (natural === 20) return { hit: true, crit: true };
  if (natural === 1) return { hit: false, crit: false };
  return { hit: total >= ac, crit: false };
}

/**
 * What happens to a creature: `saveTotal` (if the effect has a save), `rolled` damage per damage entry (already
 * multiplied by `times` or the hits). No save: the damage and conditions always apply. `defenses`: the creature's sheet
 * defenses, applied per damage type after halving on a success (Immunity, Resistance, Vulnerability); conditions it's
 * immune to are skipped. `hits`: for an attacking effect, how many of its attacks hit (0 = it misses, nothing else).
 */
export function resolveHazard(d: HazardEffect & { name: string }, name: string, saveTotal: number | null, rolled: number[], defenses?: UnitSheet["defenses"], opts: { hits?: number } = {}): HazardOutcome {
  const says = d.says ? ` ${d.says}` : "";
  const count = d.attack?.count ?? 1;
  const hits = d.attack ? opts.hits ?? count : 0;
  const atkText = d.attack ? (hits ? ` ${count > 1 ? `${hits} of ${count} attacks hit` : "Hit"}.` : ` ${count > 1 ? "All attacks miss" : "Misses"}.`) : "";
  if (d.attack && !hits) return { damage: 0, conditions: [], failed: false, text: `${d.name} → ${name}:${says}${atkText}` };
  const failed = !d.save || saveTotal === null || saveTotal < d.save.dc;
  const notes: string[] = [];
  const parts = (d.damage ?? []).map((dm, i) => {
    const raw = rolled[i] ?? 0;
    const base = failed || dm.always ? raw : d.half ? Math.floor(raw / 2) : 0;
    if (!base) return { type: dm.type, amount: 0 };
    const r = damageAgainst(defenses, base, dm.type);
    if (r.note) notes.push(r.note);
    return { type: dm.type, amount: r.amount };
  });
  const damage = parts.reduce((s, p) => s + p.amount, 0);
  const all = (d.conditions ?? []).filter((c) => failed || c.always);
  const conditions = all.filter((c) => !immuneToCondition(defenses, c.key));
  const skipped = all.filter((c) => !conditions.includes(c));
  const label = (c: { key: string; label?: string }) => c.label ?? c.key[0]!.toUpperCase() + c.key.slice(1);
  const saveText = d.save && saveTotal !== null ? ` ${saveTotal} vs DC ${d.save.dc}: ${failed ? "fails" : "succeeds"}.` : "";
  const shown = parts.filter((p) => p.amount > 0);
  const halved = !failed && d.half && (d.damage ?? []).some((dm) => !dm.always);
  const tags = [halved ? "half" : "", ...notes].filter(Boolean);
  const dmgText = damage ? ` ${shown.map((p) => `${p.amount} ${p.type}`).join(" + ")} damage${tags.length ? ` (${tags.join("; ")})` : ""}.` : "";
  const zero = !damage && notes.length ? ` No damage (${notes.join("; ")}).` : "";
  const condText = conditions.length ? ` ${conditions.map(label).join(", ")}.` : "";
  const skipText = skipped.length ? ` Immune to ${skipped.map(label).join(", ")}.` : "";
  const body = `${says}${atkText}${saveText}${damage ? dmgText : zero}${condText}${skipText}`;
  return { damage, conditions, failed, text: `${d.name} → ${name}:${body || " nothing happens."}` };
}

/** Which placed hazards a token newly entered: in `now` but not in `before`. */
export const entered = (before: Set<string>, now: Set<string>) => [...now].filter((id) => !before.has(id));
