/**
 * Vehicle chases: the chase rules (core/chase.ts) with general vehicle rules (adapted from the vehicle appendix of
 * Descent into Avernus, with nothing that assumes a particular kind of vehicle), for any chase: carts and carriages
 * through city streets, buggies and war wagons across open country, boats on rivers and seas, airships in the sky.
 * Vehicle chases are played at a large scale: the scene's grid must be at least 100 ft per square.
 *
 * - A vehicle has AC, Hit Points, a damage threshold (less damage than that does nothing) and a mishap threshold (that
 *   much damage from one source causes a mishap), a Speed, and Strength, Dexterity and Constitution (0 in the mental
 *   scores). It acts on its driver's turn: drivers roll Initiative, passengers keep their own turns.
 * - A driver proficient with the right vehicles adds its Proficiency Bonus to checks and saves made with the vehicle's
 *   scores. With no driver (none, or Incapacitated), the vehicle fails Dexterity saves, and checks, automatically.
 * - Dashing uses the vehicle's Constitution: 3 + its modifier free, then a DC 10 Constitution save (2014: check) or a
 *   level of (vehicular) Exhaustion. 5 levels: it drops out; 6: it breaks down (0 HP). Only repairs remove it.
 * - After each driver's turn, a d20 on the terrain's Vehicle Chase Complications table (11–20: none) affects the next
 *   vehicle in initiative order. A failed complication check by 5 or more, or damage of at least the mishap threshold,
 *   causes a roll on the Mishaps table (only while the vehicle is moving).
 * - Riders are inside (total cover), aboard (exposed: on a seat or deck) or clinging on (exposed and unsecured: they can
 *   be thrown off). The driver counts as aboard.
 * - Crashing: 1d6 Bludgeoning per 10 feet the vehicle moved since its last turn (max 20d6) to the vehicle (none if below
 *   its damage threshold) and to what it hits; each rider makes a DC 15 Strength save, taking that much or half.
 * - Escaping (Butler's ruling, the books don't say): a quarry vehicle's escape check is a Dexterity check with the
 *   vehicle's Dexterity (plus the driver's proficiency), against the best Passive Perception of anyone aboard a pursuer.
 * Pure: the background page runs it (background/vehicleChase.ts), DM Tools edits it (extension/vehiclePanel.ts).
 */
import type { Ability, SizeCode, UnitSheet } from "./sheet";
import type { DamagePart, Mode } from "./chase";
import { SUBSTANCES } from "./objects";

export type VehicleEnv = "streets" | "country" | "water" | "sky";
export type Terrain = "land" | "water" | "air";
export type VAbility = "str" | "dex" | "con";
export type RiderAt = "inside" | "aboard" | "clinging";
export type MishapKey = "fire" | "steering" | "power" | "weapon" | "smoke" | "plating" | "gear" | "overturn";

export interface Rider { id: string; at: RiderAt }

export interface Vehicle {
  id: string;
  name: string;
  preset?: string;
  terrain: Terrain;
  size: SizeCode;
  ac: number;
  hp: number;
  maxHp: number;
  /** Damage threshold (0 = none) and mishap threshold. */
  dt: number;
  mt: number;
  /** Feet per round. */
  speed: number;
  str: number;
  dex: number;
  con: number;
  /** Has weapon stations (a Weapon Jam mishap needs one). */
  weapons: boolean;
  side: "quarry" | "pursuer" | "";
  /** Unit id of the driver; the vehicle acts on its turn. */
  driver?: string;
  /** Everyone else aboard. */
  riders: Rider[];
  /** The driver's proficiency with these vehicles: forced on or off, or read from the driver's sheet (undefined). */
  proficient?: boolean;
  dashes: number;
  exhaustion: number;
  mishaps: MishapKey[];
  /** Overturned, capsized or stalled: at a dead stop until righted. */
  overturned?: boolean;
  /** Three-quarters cover against attacks from other vehicles until the start of its driver's next turn. */
  cover?: boolean;
  /** Butler's ruling or the source of the stats, shown on hover. */
  basis?: string;
}

const mod = (score: number) => Math.floor((score - 10) / 2);
const num = (x: unknown, d: number) => (typeof x === "number" && Number.isFinite(x) ? x : d);
const RIDER_AT: RiderAt[] = ["inside", "aboard", "clinging"];
const MISHAP_KEYS: MishapKey[] = ["fire", "steering", "power", "weapon", "smoke", "plating", "gear", "overturn"];

export function readVehicle(x: unknown): Vehicle | null {
  const v = x as Partial<Vehicle> | null;
  if (!v || typeof v !== "object" || typeof v.id !== "string") return null;
  const maxHp = Math.max(1, num(v.maxHp, 10));
  return {
    id: v.id, name: typeof v.name === "string" && v.name ? v.name : "Vehicle", preset: typeof v.preset === "string" ? v.preset : undefined,
    terrain: v.terrain === "water" || v.terrain === "air" ? v.terrain : "land", size: (typeof v.size === "string" ? v.size : "L") as SizeCode,
    ac: num(v.ac, 15), hp: Math.min(maxHp, Math.max(0, num(v.hp, maxHp))), maxHp, dt: Math.max(0, num(v.dt, 0)), mt: Math.max(0, num(v.mt, 10)),
    speed: Math.max(0, num(v.speed, 30)), str: num(v.str, 10), dex: num(v.dex, 10), con: num(v.con, 10), weapons: v.weapons === true,
    side: v.side === "quarry" || v.side === "pursuer" ? v.side : "", driver: typeof v.driver === "string" && v.driver ? v.driver : undefined,
    riders: Array.isArray(v.riders) ? v.riders.filter((r): r is Rider => !!r && typeof r.id === "string").map((r) => ({ id: r.id, at: RIDER_AT.includes(r.at) ? r.at : "aboard" })) : [],
    proficient: typeof v.proficient === "boolean" ? v.proficient : undefined,
    dashes: Math.max(0, num(v.dashes, 0)), exhaustion: Math.min(6, Math.max(0, num(v.exhaustion, 0))),
    mishaps: Array.isArray(v.mishaps) ? v.mishaps.filter((m): m is MishapKey => MISHAP_KEYS.includes(m)) : [],
    overturned: v.overturned === true || undefined, cover: v.cover === true || undefined, basis: typeof v.basis === "string" ? v.basis : undefined,
  };
}

// ------------------------------------------------------------------ presets

export interface VehiclePreset {
  key: string; group: string; label: string;
  stats: Pick<Vehicle, "terrain" | "size" | "ac" | "maxHp" | "dt" | "mt" | "speed" | "str" | "dex" | "con" | "weapons" | "basis">;
}

const p = (key: string, group: string, label: string, terrain: Terrain, size: SizeCode, speed: number, ac: number, maxHp: number, dt: number, mt: number,
  [str, dex, con]: [number, number, number], basis: string, weapons = false): VehiclePreset =>
  ({ key, group, label, stats: { terrain, size, speed, ac, maxHp, dt, mt, str, dex, con, weapons, basis } });

// ------------------------------------------------------------------ any vehicle, from what it's made of

export type Handling = "clumsy" | "steady" | "nimble" | "agile";
export const HANDLING: Record<Handling, { label: string; dex: number }> = {
  clumsy: { label: "Clumsy (barges, big wagons)", dex: 6 }, steady: { label: "Steady", dex: 10 },
  nimble: { label: "Nimble", dex: 14 }, agile: { label: "Agile (racers, skiffs)", dex: 18 },
};
export const VEHICLE_SIZES: { key: SizeCode; label: string; hp: number; str: number; mt: number }[] = [
  { key: "M", label: "Medium", hp: 20, str: 10, mt: 10 },
  { key: "L", label: "Large", hp: 30, str: 14, mt: 10 },
  { key: "H", label: "Huge", hp: 80, str: 18, mt: 15 },
  { key: "G", label: "Gargantuan", hp: 200, str: 20, mt: 20 },
];
/** Per material (the Object Armor Class table's substances): base damage threshold, Constitution and HP multiplier. */
const MATERIAL: Record<string, { dt: number; con: number; hp: number }> = {
  cloth: { dt: 0, con: 8, hp: 0.5 }, glass: { dt: 0, con: 8, hp: 0.5 }, wood: { dt: 0, con: 12, hp: 1 }, stone: { dt: 5, con: 14, hp: 1.25 },
  iron: { dt: 5, con: 14, hp: 1.5 }, mithral: { dt: 10, con: 16, hp: 1.5 }, adamantine: { dt: 10, con: 18, hp: 2 },
};
export interface VehicleSpec { terrain: Terrain; size: SizeCode; material: string; handling: Handling; speed: number; weapons?: boolean }

/**
 * Stats for any vehicle (Butler's guideline, every number editable): AC = its material's Object AC + Dexterity
 * modifier; Dexterity from its handling; HP, Strength and mishap threshold from its size; damage threshold and
 * Constitution from its material (Huge and bigger: threshold +5); mishap threshold at least twice the damage threshold.
 */
export function vehicleStats(spec: VehicleSpec): VehiclePreset["stats"] {
  const size = VEHICLE_SIZES.find((x) => x.key === spec.size) ?? VEHICLE_SIZES[1]!;
  const mat = MATERIAL[spec.material] ?? MATERIAL.wood!;
  const sub = SUBSTANCES.find((x) => x.key === spec.material) ?? SUBSTANCES.find((x) => x.key === "wood")!;
  const dex = HANDLING[spec.handling].dex;
  const dt = mat.dt + (spec.size === "H" || spec.size === "G" ? 5 : 0);
  return {
    terrain: spec.terrain, size: size.key, speed: Math.max(0, spec.speed), ac: sub.ac + mod(dex), maxHp: Math.max(1, Math.round(size.hp * mat.hp)), dt,
    mt: Math.max(size.mt, 2 * dt), str: size.str, dex, con: mat.con, weapons: !!spec.weapons,
    basis: `Butler's guideline: ${sub.label.toLowerCase()} (AC ${sub.ac}) + Dexterity modifier, ${HANDLING[spec.handling].label.replace(/ \(.*\)$/, "").toLowerCase()} handling, ${size.label} size`,
  };
}

const b = (key: string, group: string, label: string, spec: VehicleSpec, note = ""): VehiclePreset => {
  const stats = vehicleStats(spec);
  return { key, group, label, stats: note ? { ...stats, basis: `${stats.basis}; ${note}` } : stats };
};
const SHIP = "Ghosts of Saltmarsh hull; mishap threshold (twice the damage threshold, at least 10) is Butler's estimate";
const TEAM = "Speed: the animals pulling it (they're creatures of their own if you want them on the map)";

/** Starting points: every number can be edited once the vehicle is added, or build your own (vehicleStats). */
export const VEHICLE_PRESETS: VehiclePreset[] = [
  b("chariot", "Land: drawn", "Chariot (two horses)", { terrain: "land", size: "L", material: "wood", handling: "nimble", speed: 60 }, TEAM),
  b("carriage", "Land: drawn", "Carriage or coach", { terrain: "land", size: "L", material: "wood", handling: "steady", speed: 50 }, TEAM),
  b("cart", "Land: drawn", "Cart", { terrain: "land", size: "L", material: "wood", handling: "clumsy", speed: 40 }, TEAM),
  b("wagon", "Land: drawn", "Wagon", { terrain: "land", size: "H", material: "wood", handling: "clumsy", speed: 40 }, TEAM),
  b("sled", "Land: drawn", "Sled (dog team)", { terrain: "land", size: "L", material: "wood", handling: "nimble", speed: 40 }, TEAM),
  b("minecart", "Land: drawn", "Mine cart (on rails, can't leave the track)", { terrain: "land", size: "L", material: "iron", handling: "clumsy", speed: 60 }),
  b("buggy", "Land: engines and magic", "Fast buggy or bike (1–2 riders)", { terrain: "land", size: "L", material: "iron", handling: "agile", speed: 120 }),
  b("warwagon", "Land: engines and magic", "Armored war wagon (crew of 4–8)", { terrain: "land", size: "H", material: "iron", handling: "steady", speed: 90, weapons: true }),
  b("crawler", "Land: engines and magic", "Land crawler or walker (huge hauler)", { terrain: "land", size: "G", material: "iron", handling: "clumsy", speed: 60, weapons: true }),
  p("rowboat", "Water", "Rowboat", "water", "L", 15, 11, 50, 0, 10, [11, 8, 11], SHIP),
  p("keelboat", "Water", "Keelboat", "water", "G", 25, 15, 100, 10, 20, [16, 7, 13], SHIP),
  p("longship", "Water", "Longship", "water", "G", 45, 15, 300, 15, 30, [20, 6, 17], SHIP),
  p("sailingship", "Water", "Sailing ship", "water", "G", 45, 15, 300, 15, 30, [20, 7, 17], SHIP, true),
  b("speedboat", "Water", "Fast skiff (engine, sail or magic)", { terrain: "water", size: "L", material: "wood", handling: "agile", speed: 90 }),
  p("skyskiff", "Air", "Skyskiff (small airship)", "air", "L", 70, 18, 150, 5, 10, [12, 16, 12], "Eberron: Forge of the Artificer skyskiff hull; ability scores and mishap threshold are Butler's estimate"),
  p("airship", "Air", "Airship (balloon)", "air", "G", 80, 15, 500, 15, 30, [18, 17, 20], "Acquisitions Incorporated battle balloon; mishap threshold is Butler's estimate", true),
  b("flyer", "Air", "Light flyer (glider, flying carpet, ornithopter)", { terrain: "air", size: "L", material: "cloth", handling: "agile", speed: 80 }),
];

export function vehicleFromPreset(preset: VehiclePreset, id: string, name?: string): Vehicle {
  return { id, name: name?.trim() || preset.label.replace(/\s*\(.*\)$/, ""), preset: preset.key, ...preset.stats, hp: preset.stats.maxHp, side: "", riders: [], dashes: 0, exhaustion: 0, mishaps: [] };
}

// ------------------------------------------------------------------ riders

export const RIDER_LABEL: Record<RiderAt | "driver", string> = {
  driver: "Driver", aboard: "Aboard (exposed)", inside: "Inside (total cover)", clinging: "Clinging on (unsecured)",
};

/** Everyone on the vehicle, the driver first (as "driver"). */
export const ridersOf = (v: Pick<Vehicle, "driver" | "riders">): { id: string; at: RiderAt | "driver" }[] =>
  [...(v.driver ? [{ id: v.driver, at: "driver" as const }] : []), ...v.riders.filter((r) => r.id !== v.driver)];

/** Without total cover: the driver, those aboard and those clinging on. */
export const isExposed = (at: RiderAt | "driver") => at !== "inside";

export function vehicleOf(vehicles: Vehicle[], unitId: string): { vehicle: Vehicle; at: RiderAt | "driver" } | null {
  for (const v of vehicles) {
    const r = ridersOf(v).find((x) => x.id === unitId);
    if (r) return { vehicle: v, at: r.at };
  }
  return null;
}

/** Puts a unit on a vehicle (as driver or rider), or off every vehicle (`to` null). A replaced driver stays aboard. */
export function placeUnit(vehicles: Vehicle[], unitId: string, to: string | null, at: RiderAt | "driver" = "aboard"): Vehicle[] {
  return vehicles.map((v) => {
    let x: Vehicle = { ...v, driver: v.driver === unitId ? undefined : v.driver, riders: v.riders.filter((r) => r.id !== unitId) };
    if (v.id !== to) return x;
    if (at === "driver") {
      if (x.driver) x = { ...x, riders: [...x.riders, { id: x.driver, at: "aboard" }] };
      return { ...x, driver: unitId };
    }
    return { ...x, riders: [...x.riders, { id: unitId, at }] };
  });
}

/** A rider thrown off or tumbling out. */
export const dropRider = (v: Vehicle, unitId: string): Vehicle =>
  ({ ...v, driver: v.driver === unitId ? undefined : v.driver, riders: v.riders.filter((r) => r.id !== unitId) });

// ------------------------------------------------------------------ the vehicle's numbers


/** Proficiency the driver adds: "Vehicles (Land)" for land vehicles, "Vehicles (Water)" (or Air) for boats and airships. */
export function driverProficient(v: Pick<Vehicle, "terrain" | "proficient">, driver: Pick<UnitSheet, "proficiencies"> | undefined): boolean {
  if (typeof v.proficient === "boolean") return v.proficient;
  const text = driver?.proficiencies ?? "";
  return v.terrain === "land" ? /vehicles?\s*\(\s*land/i.test(text) : /vehicles?\s*\(\s*(water|air|sea)/i.test(text);
}

/** Speed after mishaps and Exhaustion (2024: −5 ft per level; 2014: halved from level 2, 0 at level 5). */
export function effectiveSpeed(v: Pick<Vehicle, "speed" | "mishaps" | "exhaustion" | "overturned">, rules: "2024" | "2014"): number {
  if (v.overturned) return 0;
  let s = v.speed - (v.mishaps.includes("power") ? 30 : 0);
  if (rules === "2024") s -= 5 * v.exhaustion;
  else if (v.exhaustion >= 5) s = 0;
  else if (v.exhaustion >= 2) s = Math.floor(s / 2);
  return Math.max(0, s);
}

/** Damage threshold after a Loose Plating mishap (−10). */
export const effectiveDt = (v: Pick<Vehicle, "dt" | "mishaps">) => Math.max(0, v.dt - (v.mishaps.includes("plating") ? 10 : 0));

export interface VehicleTest { auto: string | null; bonus: number; mode: Mode; notes: string[] }

/**
 * A check or save with the vehicle's ability. `driverPb`: the driver's Proficiency Bonus if proficient (else 0), or
 * null with no able driver.
 */
export function vehicleTest(v: Vehicle, kind: "save" | "check", ability: VAbility, driverPb: number | null, rules: "2024" | "2014"): VehicleTest {
  const notes: string[] = [];
  let auto: string | null = null;
  if (driverPb === null && (kind === "check" || ability === "dex")) auto = "no driver: it fails automatically";
  if (ability === "dex" && v.mishaps.includes("steering")) auto = "Jammed Steering: it fails Dexterity checks and saves";
  let mode: Mode = "normal";
  if (ability === "dex" && kind === "check" && v.mishaps.includes("gear")) { mode = "disadvantage"; notes.push("Damaged Running Gear"); }
  let penalty = 0;
  if (v.exhaustion) {
    if (rules === "2024") { penalty = -2 * v.exhaustion; notes.push(`Exhaustion ${v.exhaustion}`); }
    else if (kind === "check" ? v.exhaustion >= 1 : v.exhaustion >= 3) { mode = "disadvantage"; notes.push(`Exhaustion ${v.exhaustion}`); }
  }
  if (driverPb) notes.push(`driver's proficiency +${driverPb}`);
  return { auto, bonus: mod(v[ability]) + (driverPb ?? 0) + penalty, mode, notes };
}

export interface VehicleHit { vehicle: Vehicle; applied: number; why: string; mishap: boolean }

/** Damage to the vehicle: Immunity to Poison and Psychic, its damage threshold; a mishap if it takes at least its mishap threshold while moving. */
export function damageVehicle(v: Vehicle, amount: number, type?: string): VehicleHit {
  const n = Math.max(0, Math.floor(amount));
  if (type && /^(poison|psychic)$/i.test(type)) return { vehicle: v, applied: 0, why: `Immunity to ${type}`, mishap: false };
  const dt = effectiveDt(v);
  if (dt && n < dt) return { vehicle: v, applied: 0, why: `below its damage threshold of ${dt}`, mishap: false };
  const vehicle = { ...v, hp: Math.max(0, v.hp - n) };
  return { vehicle, applied: n, why: "", mishap: n > 0 && !!v.mt && n >= v.mt && !v.overturned && vehicle.hp > 0 };
}

/** Crash damage dice: 1d6 per 10 feet moved since its last turn, at most 20d6 ("" under 10 feet). */
export function crashDice(feet: number): string {
  const n = Math.min(20, Math.floor(feet / 10));
  return n > 0 ? `${n}d6` : "";
}
export const CRASH_SAVE_DC = 15;

/** Vehicles still in the chase: on a side, not escaped or out, not wrecked. */
export const liveVehicles = (vehicles: Vehicle[], c: { escaped: string[]; out: string[] }) =>
  vehicles.filter((v) => v.side && v.hp > 0 && !c.escaped.includes(v.id) && !c.out.includes(v.id));

/** The next live vehicle after `afterId` in its driver's initiative order (wrapping); vehicles whose driver isn't in the order are skipped. */
export function nextVehicle(order: string[], vehicles: Vehicle[], afterId: string): Vehicle | null {
  const placed = vehicles.filter((v) => v.driver && order.includes(v.driver)).sort((a, b) => order.indexOf(a.driver!) - order.indexOf(b.driver!));
  const i = placed.findIndex((v) => v.id === afterId);
  if (i < 0) return null;
  for (let k = 1; k < placed.length; k++) {
    const v = placed[(i + k) % placed.length]!;
    if (v.id !== afterId) return v;
  }
  return null;
}

// ------------------------------------------------------------------ complications

export interface VehicleComplication {
  roll: [number, number];
  text: string;
  /** The vehicle's check or save (the driver uses the vehicle's score; the best of these abilities). */
  test?: { kind: "save" | "check"; dc: number; abilities: VAbility[] };
  /** Only if the vehicle Dashes on its turn: resolved at the end of its driver's turn. */
  ifDashed?: boolean;
  success?: { cover?: boolean };
  fail?: { difficult?: number; overturn?: boolean; crash?: boolean; damage?: DamagePart };
  /** What happens to riders: exposed ones (no total cover) or only those clinging on; always, or when the vehicle fails. */
  riders?: {
    who: "exposed" | "clinging"; when: "always" | "fail";
    save?: { ability: Ability; dc: number; half?: boolean };
    damage?: DamagePart;
    /** Blinded until the start of its next turn (no save). */
    blinded?: boolean;
    /** Off the vehicle: falls this far (1d6 per 10 ft) and lands Prone, or goes into the water. */
    thrownOff?: { fall?: number; water?: boolean; note?: string };
  };
  note?: string;
}

const vcheck = (dc: number, ...abilities: VAbility[]) => ({ kind: "check" as const, dc, abilities });
const vsave = (dc: number, ...abilities: VAbility[]) => ({ kind: "save" as const, dc, abilities });

/** Roads and streets: towns, cities, highways. */
export const STREETS: VehicleComplication[] = [
  { roll: [1, 2], text: "A city watch patrol, a rival or a local creature takes notice and gives chase (the GM chooses).", note: "a new pursuer joins the chase" },
  { roll: [3, 3], text: "A scaffold collapses or cargo swings loose from a crane across the street.", test: vsave(15, "dex"),
    riders: { who: "exposed", when: "fail", save: { ability: "dex", dc: 13, half: true }, damage: { dice: "3d10", type: "Bludgeoning" } } },
  { roll: [4, 4], text: "Smoke from a forge, steam from a bathhouse or a burst sack of flour sweeps over the vehicle.", riders: { who: "exposed", when: "always", blinded: true }, note: "protective eyewear prevents the blindness" },
  { roll: [5, 5], text: "An arcade, market stalls or a row of columns: the driver weaves between them for cover.", test: vcheck(15, "dex"), success: { cover: true } },
  { roll: [6, 6], text: "A crowd, a parade or a packed market fills the street.", test: vcheck(15, "str", "dex"), fail: { difficult: 30 } },
  { roll: [7, 7], text: "The street drops down a flight of steps or off a 10-foot loading dock.", riders: { who: "clinging", when: "always", save: { ability: "dex", dc: 15 }, thrownOff: { fall: 10 } } },
  { roll: [8, 8], text: "Broken cobbles, potholes or a muddy lane.", test: vcheck(10, "dex"), fail: { difficult: 30 } },
  { roll: [9, 9], text: "Parked wagons, stalls and barrels line a narrow street: if the vehicle Dashes this turn, the driver must steer clear or crash into them.", test: vcheck(10, "dex"), ifDashed: true, fail: { crash: true } },
  { roll: [10, 10], text: "A corner taken too fast tips the vehicle onto its side.", test: vsave(10, "dex"), fail: { overturn: true },
    riders: { who: "clinging", when: "always", save: { ability: "str", dc: 20 }, thrownOff: { note: "lands Prone within 20 feet" } } },
];

/** Open country: plains, deserts, tundra, badlands. */
export const COUNTRY: VehicleComplication[] = [
  { roll: [1, 2], text: "A creature native to the area chases after the vehicle (the GM chooses).", note: "a new pursuer joins the chase" },
  { roll: [3, 3], text: "A brush fire sweeps across the path.", test: vsave(15, "dex"),
    riders: { who: "exposed", when: "fail", save: { ability: "dex", dc: 13, half: true }, damage: { dice: "3d10", type: "Fire" } } },
  { roll: [4, 4], text: "A swirling cloud of dust, sand or snow envelops the vehicle.", riders: { who: "exposed", when: "always", blinded: true }, note: "protective eyewear prevents the blindness" },
  { roll: [5, 5], text: "Rock pillars or a stand of trees: the driver swerves between them for cover.", test: vcheck(15, "dex"), success: { cover: true } },
  { roll: [6, 6], text: "A herd of animals crosses the path.", test: vcheck(15, "str", "dex"), fail: { difficult: 30 } },
  { roll: [7, 7], text: "The vehicle drives off a 10-foot ledge and comes crashing down.", riders: { who: "clinging", when: "always", save: { ability: "dex", dc: 15 }, thrownOff: { fall: 10 } } },
  { roll: [8, 8], text: "Uneven ground threatens to slow the vehicle.", test: vcheck(10, "dex"), fail: { difficult: 60 } },
  { roll: [9, 9], text: "Boulders, stumps and old wrecks dot the land: if the vehicle Dashes this turn, the driver must steer clear or crash into one.", test: vcheck(10, "dex"), ifDashed: true, fail: { crash: true } },
  { roll: [10, 10], text: "The ground gives way under the vehicle and it rolls.", test: vsave(10, "dex"), fail: { overturn: true },
    riders: { who: "clinging", when: "always", save: { ability: "str", dc: 20 }, thrownOff: { note: "lands Prone within 20 feet" } } },
];

/** Rivers, lakes and seas. */
export const WATER: VehicleComplication[] = [
  { roll: [1, 2], text: "A creature of the waters (a shark, a crocodile, something bigger) gives chase (the GM chooses).", note: "a new pursuer joins the chase" },
  { roll: [3, 3], text: "Rocks or a sandbar just under the surface.", test: vcheck(15, "dex"), fail: { damage: { dice: "4d10", type: "Bludgeoning" } } },
  { roll: [4, 4], text: "A sheet of spray breaks over the deck.", riders: { who: "exposed", when: "always", blinded: true }, note: "protective eyewear prevents the blindness" },
  { roll: [5, 5], text: "Islets, pilings or moored ships: the helm weaves between them for cover.", test: vcheck(15, "dex"), success: { cover: true } },
  { roll: [6, 6], text: "Floating debris, reeds or a kelp bed.", test: vcheck(15, "str", "dex"), fail: { difficult: 30 } },
  { roll: [7, 7], text: "The vessel slams down off a wave crest or a short fall of rapids.", riders: { who: "clinging", when: "always", save: { ability: "dex", dc: 15 }, thrownOff: { water: true } } },
  { roll: [8, 8], text: "Choppy water and crosscurrents.", test: vcheck(10, "dex"), fail: { difficult: 60 } },
  { roll: [9, 9], text: "A crowded anchorage or a narrow channel: if the vessel Dashes this turn, the helm must steer clear or ram something.", test: vcheck(10, "dex"), ifDashed: true, fail: { crash: true } },
  { roll: [10, 10], text: "A rogue wave hits the vessel broadside.", test: vsave(10, "dex"), fail: { overturn: true },
    riders: { who: "clinging", when: "always", save: { ability: "str", dc: 20 }, thrownOff: { water: true } } },
];

/** The sky: airships, flying vehicles. */
export const SKY: VehicleComplication[] = [
  { roll: [1, 2], text: "A flying creature takes an interest and gives chase (the GM chooses).", note: "a new pursuer joins the chase" },
  { roll: [3, 3], text: "A thunderhead looms across the course.", test: vsave(15, "dex"),
    riders: { who: "exposed", when: "fail", save: { ability: "dex", dc: 13, half: true }, damage: { dice: "3d10", type: "Lightning" } } },
  { roll: [4, 4], text: "The vehicle plunges into a cloud bank.", riders: { who: "exposed", when: "always", blinded: true }, note: "protective eyewear doesn't help in cloud: the GM may rule otherwise" },
  { roll: [5, 5], text: "Peaks, spires or towering clouds: the helm weaves between them for cover.", test: vcheck(15, "dex"), success: { cover: true } },
  { roll: [6, 6], text: "A flock of birds bursts across the course.", test: vcheck(15, "str", "dex"), fail: { difficult: 30 } },
  { roll: [7, 7], text: "An air pocket drops the vehicle suddenly.", riders: { who: "clinging", when: "always", save: { ability: "dex", dc: 15 }, thrownOff: { note: "falls: the GM sets the height (1d6 Bludgeoning per 10 feet, at most 20d6)" } } },
  { roll: [8, 8], text: "Headwinds and turbulence.", test: vcheck(10, "dex"), fail: { difficult: 60 } },
  { roll: [9, 9], text: "Spires, rigging or cliff faces crowd the course: if the vehicle Dashes this turn, the helm must steer clear or crash into one.", test: vcheck(10, "dex"), ifDashed: true, fail: { crash: true } },
  { roll: [10, 10], text: "A downdraft throws the vehicle into a spin.", test: vsave(10, "dex"), fail: { overturn: true },
    riders: { who: "clinging", when: "always", save: { ability: "str", dc: 20 }, thrownOff: { note: "falls: the GM sets the height (1d6 Bludgeoning per 10 feet, at most 20d6)" } } },
];

export const VEHICLE_TABLES: Record<VehicleEnv, VehicleComplication[]> = { streets: STREETS, country: COUNTRY, water: WATER, sky: SKY };
export const VEHICLE_ENV_LABEL: Record<VehicleEnv, string> = { streets: "Roads and streets", country: "Open country", water: "Rivers and seas", sky: "Skies" };
export const vehicleComplicationFor = (env: VehicleEnv, d20: number): VehicleComplication | null =>
  VEHICLE_TABLES[env].find((x) => d20 >= x.roll[0] && d20 <= x.roll[1]) ?? null;
/** A complication check that fails by this much or more causes a mishap. */
export const MISHAP_MARGIN = 5;

/** What overturning means on this terrain. */
export const overturnWord = (t: Terrain) => (t === "water" ? "capsizes or is swamped" : t === "air" ? "stalls into a spin" : "overturns");

// ------------------------------------------------------------------ mishaps

export interface Mishap { key: MishapKey; roll: [number, number]; name: string; text: string; repair?: { dc: number; ability: VAbility } }

export const MISHAPS: Mishap[] = [
  { key: "fire", roll: [1, 1], name: "Fire Aboard", text: "Fire breaks out (an engine, a lamp, a stove, sparks from the axles). Any creature that starts its turn on or inside the vehicle takes 10 (3d6) Fire damage until this ends.", repair: { dc: 15, ability: "dex" } },
  { key: "steering", roll: [2, 4], name: "Jammed Steering", text: "The steering, reins or rudder jam. The vehicle can move in a straight line only and automatically fails Dexterity checks and saves until this ends.", repair: { dc: 15, ability: "str" } },
  { key: "power", roll: [5, 7], name: "Power Loss", text: "The engine sputters, a sail tears or the team falters. Speed −30 feet until this ends.", repair: { dc: 15, ability: "str" } },
  { key: "weapon", roll: [8, 10], name: "Weapon Jam", text: "One of the vehicle's weapons (GM's choice) can't be used until this ends. No mishap if it has no working weapons.", repair: { dc: 20, ability: "str" } },
  { key: "smoke", roll: [11, 13], name: "Blinding Smoke", text: "Smoke, steam or dust fills the driver's position: it is Heavily Obscured, and anyone there is Blinded until this ends.", repair: { dc: 15, ability: "dex" } },
  { key: "plating", roll: [14, 16], name: "Loose Plating", text: "Armor plates or hull planks come loose. Damage threshold −10 until this ends.", repair: { dc: 15, ability: "str" } },
  { key: "gear", roll: [17, 19], name: "Damaged Running Gear", text: "An axle, wheel, keel or rudder is damaged and the vehicle shakes. Until this ends it has Disadvantage on Dexterity checks, and creatures on or inside it have Disadvantage on ability checks and attack rolls.", repair: { dc: 20, ability: "dex" } },
  { key: "overturn", roll: [20, 20], name: "Overturned", text: "The vehicle flips (or capsizes, or stalls) and comes to a dead stop. Anyone clinging on makes a DC 20 Strength save or is thrown off, landing Prone within 20 feet; those inside or aboard fall Prone and make a DC 15 Strength save or take 10 (3d6) Bludgeoning damage. Can't be repaired: it must be righted." },
];
export const mishapFor = (d20: number) => MISHAPS.find((m) => d20 >= m.roll[0] && d20 <= m.roll[1])!;
export const mishapByKey = (k: MishapKey) => MISHAPS.find((m) => m.key === k)!;

/** A creature that starts its turn aboard a burning vehicle. */
export const FIRE_DAMAGE: DamagePart = { dice: "3d6", type: "Fire" };
/** Creatures inside or aboard when it overturns. */
export const OVERTURN = { clingDc: 20, insideDc: 15, damage: { dice: "3d6", type: "Bludgeoning" } as DamagePart };

/** Pending complications store the table by its environment key. */
export const VEHICLE_TABLES_BY_KEY: Record<string, VehicleComplication[]> = VEHICLE_TABLES;
/** A vehicle drops out of the chase at this much Exhaustion and breaks down (0 HP) at 6. */
export const DROP_OUT_EXHAUSTION = 5;

/** Vehicle chases are played at a large scale: the scene's grid must be in feet, at least 100 ft per square. Null when it's fine. */
export const MIN_GRID_FT = 100;
export function vehicleGridProblem(grid: { multiplier: number; unit: string } | null): string | null {
  if (!grid) return "Reading the scene's grid…";
  if (!/^(ft|feet|foot|')$/i.test(grid.unit.trim())) return `The grid is measured in "${grid.unit}": vehicle chases need feet, at least ${MIN_GRID_FT} ft per square.`;
  if (grid.multiplier < MIN_GRID_FT) return `The grid is ${grid.multiplier} ft per square: vehicle chases need at least ${MIN_GRID_FT} ft per square (Scene → grid settings in Owlbear).`;
  return null;
}
