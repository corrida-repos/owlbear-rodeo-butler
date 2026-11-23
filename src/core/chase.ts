/**
 * Chases (2024 DMG chapter 3; 2014 DMG chapter 8 in 5E rooms). The GM picks the quarry and the pursuers; then, automatically:
 *  - After each participant's turn, it rolls on the Urban or Wilderness Chase Complications table (2024: 1d12, a
 *    complication on 1–6; 2014: d20, a complication on 1–10). A complication affects the NEXT participant in initiative
 *    order, who makes the save or check (Butler rolls it with that unit's best allowed option) and suffers the failure
 *    effect (Prone, damage, Blinded, Restrained, a fall, Difficult Terrain…).
 *  - Dashing: a participant can Dash 3 + its Constitution modifier times (at least once) freely; each extra Dash calls
 *    for a DC 10 Constitution save (2014: check) at the end of its turn or 1 Exhaustion level; 5 levels drop it out.
 *  - At the end of each round each quarry makes a Dexterity (Stealth) check against the highest Passive Perception
 *    among the pursuers (with Advantage or Disadvantage from the Escape Factors); higher escapes. A quarry never out of
 *    the lead pursuer's sight fails automatically (the GM marks that).
 * Vehicle chases (core/vehicles.ts) use the same state with `mode: "vehicles"`.
 * Pure; the background page (primary GM) drives it and the DM Tools tab edits it.
 */
import { BUTLER_NS } from "./constants";
import type { Ability } from "./sheet";
import { readVehicle, type Vehicle, type VehicleEnv } from "./vehicles";

export const CHASE_KEY = `${BUTLER_NS}/chase`;

export type ChaseRules = "2024" | "2014";
export type ChaseEnv = "urban" | "wilderness";
export type EscapeFactor = "normal" | "advantage" | "disadvantage";

/** A complication waiting for the end of the affected participant's turn ("if it moves 20 feet", "if it Dashes"). */
export interface PendingComplication { target: string; table: string; roll: number; from: string }

export interface ChaseState {
  v: 1;
  active: boolean;
  /** Creatures on foot (or mounted), or vehicles with drivers and riders. */
  mode: "creatures" | "vehicles";
  env: ChaseEnv;
  vehicleEnv: VehicleEnv;
  quarry: string[];
  pursuers: string[];
  /** Dashes taken during the chase, per unit. */
  dashes: Record<string, number>;
  /** Exhaustion levels gained during the chase, per unit (a Short or Long Rest removes them). */
  exhaustionGained: Record<string, number>;
  /** Quarry that escaped, and participants out of the chase (5 Exhaustion levels, wrecked vehicles). Unit or vehicle ids. */
  escaped: string[];
  out: string[];
  /** Quarry the lead pursuer never lost sight of: its escape check fails automatically. Unit or vehicle ids. */
  inSight: string[];
  escapeFactor: EscapeFactor;
  /** Show the chase's rolls to players (otherwise the GM's alone). */
  publicRolls: boolean;
  vehicles: Vehicle[];
  pending: PendingComplication[];
  /** Recent events, newest last. */
  log: string[];
}

export const NEW_CHASE: ChaseState = {
  v: 1, active: false, mode: "creatures", env: "urban", vehicleEnv: "streets", quarry: [], pursuers: [], dashes: {}, exhaustionGained: {},
  escaped: [], out: [], inSight: [], escapeFactor: "normal", publicRolls: false, vehicles: [], pending: [], log: [],
};

const VEHICLE_ENVS: VehicleEnv[] = ["streets", "country", "water", "sky"];

export function readChase(meta: Record<string, unknown>): ChaseState {
  const c = meta[CHASE_KEY] as Partial<ChaseState> | undefined;
  if (!c || c.v !== 1) return { ...NEW_CHASE };
  const arr = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string") : []);
  const rec = (x: unknown) => (typeof x === "object" && x && !Array.isArray(x) ? x as Record<string, number> : {});
  return {
    ...NEW_CHASE, ...c, v: 1, active: c.active === true, mode: c.mode === "vehicles" ? "vehicles" : "creatures",
    env: c.env === "wilderness" ? "wilderness" : "urban", vehicleEnv: VEHICLE_ENVS.includes(c.vehicleEnv as VehicleEnv) ? c.vehicleEnv as VehicleEnv : "streets",
    quarry: arr(c.quarry), pursuers: arr(c.pursuers), escaped: arr(c.escaped), out: arr(c.out), inSight: arr(c.inSight), log: arr(c.log),
    dashes: rec(c.dashes), exhaustionGained: rec(c.exhaustionGained),
    escapeFactor: c.escapeFactor === "advantage" || c.escapeFactor === "disadvantage" ? c.escapeFactor : "normal",
    vehicles: Array.isArray(c.vehicles) ? c.vehicles.map(readVehicle).filter((v): v is Vehicle => !!v) : [],
    pending: Array.isArray(c.pending) ? c.pending.filter((p): p is PendingComplication => !!p && typeof p.target === "string" && typeof p.table === "string" && typeof p.roll === "number") : [],
  };
}

export const LOG_MAX = 16;
export const withLog = (c: ChaseState, ...lines: string[]): ChaseState => ({ ...c, log: [...c.log, ...lines].slice(-LOG_MAX) });

// ------------------------------------------------------------------ sides

export interface ChaseUnit { id: string; party: boolean; inEncounter: boolean; dead: boolean }
export type QuickSides = "party-quarry-hostiles" | "party-quarry-everyone" | "party-pursuers-hostiles" | "party-pursuers-everyone";

/**
 * One-click sides: the party on one side; on the other, "every hostile" (the non-party units in the initiative order)
 * or "everyone else" (every other unit in the scene). Dead units are left out.
 */
export function quickSides(units: ChaseUnit[], how: QuickSides): { quarry: string[]; pursuers: string[] } {
  const live = units.filter((u) => !u.dead);
  const party = live.filter((u) => u.party).map((u) => u.id);
  const others = live.filter((u) => !u.party && (how.endsWith("everyone") || u.inEncounter)).map((u) => u.id);
  return how.startsWith("party-quarry") ? { quarry: party, pursuers: others } : { quarry: others, pursuers: party };
}

/** Participants still in the chase (creatures mode). `down` leaves out units that are dead or at 0 HP. */
export const participants = (c: Pick<ChaseState, "quarry" | "pursuers" | "escaped" | "out">, down: (id: string) => boolean = () => false) =>
  [...c.quarry, ...c.pursuers].filter((id) => !c.escaped.includes(id) && !c.out.includes(id) && !down(id));

/** The next id after `afterId` in `order` (wrapping) that is in `live`; null if none. */
export function nextIn(order: string[], live: Set<string>, afterId: string): string | null {
  const i = order.indexOf(afterId);
  for (let k = 1; k <= order.length; k++) {
    const id = order[(i + k + order.length) % order.length]!;
    if (live.has(id) && id !== afterId) return id;
  }
  return null;
}

/** The next participant after `afterId` in initiative order (wrapping), skipping non-participants; null if none. */
export const nextParticipant = (order: string[], c: ChaseState, afterId: string, down?: (id: string) => boolean) =>
  nextIn(order, new Set(participants(c, down)), afterId);

// ------------------------------------------------------------------ complications

/** One way to make the test: a save with this ability, or a check (with a skill, or a plain ability check). */
export interface TestOption { ability: Ability; skill?: string }
export interface ChaseTest { kind: "save" | "check"; dc: number; options: TestOption[] }
export interface DamagePart { dice: string; type: string }

export interface Complication {
  /** d12 or d20 results it covers. */
  roll: [number, number];
  text: string;
  /** Save or check to avoid it (the unit's best option), or none. */
  test?: ChaseTest;
  /** An attack against the participant instead of a test (the 2014 guard and swarm). */
  attack?: { bonus: number; damage: DamagePart[] };
  /** Only if the participant moves at least this far on its turn: resolved at the end of its turn. */
  ifMoves?: number;
  /** On a failed test or a hit (or with neither). */
  fail: {
    damage?: DamagePart[];
    /** Falls this many feet ("1d4x5": 1d4 × 5 feet): 1d6 Bludgeoning per 10 feet, lands Prone. */
    fall?: number | "1d4x5";
    prone?: boolean; blindedThisTurn?: boolean; restrained?: boolean; difficult?: number; note?: string;
  };
}

const save = (dc: number, ...abilities: Ability[]): ChaseTest => ({ kind: "save", dc, options: abilities.map((ability) => ({ ability })) });
const check = (dc: number, ...options: TestOption[]): ChaseTest => ({ kind: "check", dc, options });
const ATH: TestOption = { ability: "str", skill: "Athletics" };
const ACRO: TestOption = { ability: "dex", skill: "Acrobatics" };
const INTIM: TestOption = { ability: "cha", skill: "Intimidation" };

export const URBAN: Complication[] = [
  { roll: [1, 1], text: "A cart or another large obstacle blocks the way.", test: save(10, "dex"), fail: { difficult: 10 } },
  { roll: [2, 2], text: "A crowd blocks the way.", test: save(10, "str", "dex", "cha"), fail: { difficult: 10 } },
  { roll: [3, 3], text: "A maze of barrels, crates or similar obstacles.", test: save(10, "dex", "int"), fail: { difficult: 10 } },
  { roll: [4, 4], text: "The ground is slippery with rain, spilled oil or another liquid.", test: save(10, "dex"), fail: { prone: true } },
  { roll: [5, 5], text: "A brawl in progress.", test: save(15, "str", "dex", "cha"), fail: { damage: [{ dice: "2d4", type: "Bludgeoning" }], difficult: 10 } },
  { roll: [6, 6], text: "A sharp turn to avoid colliding with something impassable.", test: save(10, "dex"), fail: { damage: [{ dice: "1d4", type: "Bludgeoning" }] } },
];

export const WILDERNESS: Complication[] = [
  { roll: [1, 1], text: "A Swarm of Insects (the GM picks the kind): the swarm uses one of its actions on this participant.", fail: { note: "the swarm acts against it" } },
  { roll: [2, 2], text: "A stream or ravine blocks the path.", test: save(10, "str", "dex"), fail: { difficult: 10 } },
  { roll: [3, 3], text: "Blowing sand, dirt, ash, snow or pollen.", test: save(10, "con"), fail: { blindedThisTurn: true, note: "Speed halved while Blinded this way" } },
  { roll: [4, 4], text: "A sudden drop.", test: save(10, "dex"), fail: { fall: 10 } },
  { roll: [5, 5], text: "Razorvine nearby (or it uses 10 feet of movement to avoid it).", test: save(15, "dex"), fail: { damage: [{ dice: "1d10", type: "Slashing" }] } },
  { roll: [6, 6], text: "A creature native to the area notices it (the GM picks one).", test: save(10, "wis", "cha"), fail: { note: "the creature joins the chase with it as its quarry" } },
];

/** 2014 DMG (d20; 11–20 no complication). Checks use skills; the participant who rolled or the one affected can spend Inspiration to negate it. */
export const URBAN_2014: Complication[] = [
  { roll: [1, 1], text: "A large obstacle such as a horse or cart blocks the way.", test: check(15, ACRO), fail: { difficult: 10 } },
  { roll: [2, 2], text: "A crowd blocks the way.", test: check(10, ATH, ACRO), fail: { difficult: 10 } },
  { roll: [3, 3], text: "A large stained-glass window or similar barrier blocks the path (smash through it).", test: save(10, "str"), fail: { prone: true, note: "bounces off the barrier" } },
  { roll: [4, 4], text: "A maze of barrels, crates or similar obstacles.", test: check(10, ACRO, { ability: "int" }), fail: { difficult: 10 } },
  { roll: [5, 5], text: "The ground is slippery with rain, spilled oil or another liquid.", test: save(10, "dex"), fail: { prone: true } },
  { roll: [6, 6], text: "A pack of dogs fighting over food.", test: check(10, ACRO), fail: { damage: [{ dice: "1d4", type: "Piercing" }], difficult: 5, note: "bitten" } },
  { roll: [7, 7], text: "A brawl in progress.", test: check(15, ATH, ACRO, INTIM), fail: { damage: [{ dice: "2d4", type: "Bludgeoning" }], difficult: 10 } },
  { roll: [8, 8], text: "A beggar blocks the way (tossing a coin gets past automatically).", test: check(10, ATH, ACRO, INTIM), fail: { difficult: 5 } },
  { roll: [9, 9], text: "An overzealous guard mistakes it for someone else: if it moves 20 feet or more on its turn, the guard makes an Opportunity Attack with a spear.", attack: { bonus: 3, damage: [{ dice: "1d6+1", type: "Piercing" }] }, ifMoves: 20, fail: {} },
  { roll: [10, 10], text: "A sharp turn to avoid colliding with something impassable.", test: save(10, "dex"), fail: { damage: [{ dice: "1d4", type: "Bludgeoning" }] } },
];

export const WILDERNESS_2014: Complication[] = [
  { roll: [1, 1], text: "A rough patch of brush.", test: check(10, ATH, ACRO), fail: { difficult: 5 } },
  { roll: [2, 2], text: "Uneven ground threatens to slow it.", test: check(10, ACRO), fail: { difficult: 10 } },
  { roll: [3, 3], text: "A swarm of insects makes an Opportunity Attack against it.", attack: { bonus: 3, damage: [{ dice: "4d4", type: "Piercing" }] }, fail: {} },
  { roll: [4, 4], text: "A stream, ravine or rock bed blocks the path.", test: check(10, ATH, ACRO), fail: { difficult: 10 } },
  { roll: [5, 5], text: "Blowing sand, dirt, ash, snow or pollen.", test: save(10, "con"), fail: { blindedThisTurn: true, note: "Speed halved while Blinded this way" } },
  { roll: [6, 6], text: "A sudden drop.", test: save(10, "dex"), fail: { fall: "1d4x5" } },
  { roll: [7, 7], text: "A hunter's snare.", test: save(15, "dex"), fail: { restrained: true, note: "caught in a net (escape: DC 10 Strength check, or deal 5 Slashing damage to the net, AC 10)" } },
  { roll: [8, 8], text: "A stampede of spooked animals.", test: save(10, "dex"), fail: { damage: [{ dice: "1d4", type: "Bludgeoning" }, { dice: "1d4", type: "Piercing" }] } },
  { roll: [9, 9], text: "Razorvine nearby (or it uses 10 feet of movement to avoid it).", test: save(15, "dex"), fail: { damage: [{ dice: "1d10", type: "Slashing" }] } },
  { roll: [10, 10], text: "A creature indigenous to the area chases after it (the GM picks one).", fail: { note: "the creature joins the chase" } },
];

export const COMPLICATION_TABLES: Record<string, Complication[]> = {
  "urban-2024": URBAN, "wilderness-2024": WILDERNESS, "urban-2014": URBAN_2014, "wilderness-2014": WILDERNESS_2014,
};
export const tableKey = (env: ChaseEnv, rules: ChaseRules) => `${env}-${rules}`;
/** The die rolled for complications: 1d12 in the 2024 DMG, d20 in the 2014 DMG. */
export const complicationDie = (rules: ChaseRules) => (rules === "2024" ? "1d12" : "1d20");

export const inRange = (roll: number, r: [number, number]) => roll >= r[0] && roll <= r[1];
/** The complication for a roll on a table, or null for "no complication". */
export const complicationIn = <T extends { roll: [number, number] }>(table: T[], roll: number): T | null => table.find((x) => inRange(roll, x.roll)) ?? null;
/** The complication for a roll, or null (2024: 7–12; 2014: 11–20). */
export const complicationFor = (env: ChaseEnv, roll: number, rules: ChaseRules = "2024"): Complication | null =>
  complicationIn(COMPLICATION_TABLES[tableKey(env, rules)]!, roll);

/** Damage dice for a fall: 1d6 per 10 feet, at most 20d6 ("" under 10 feet). */
export function fallDice(feet: number): string {
  const n = Math.min(20, Math.floor(feet / 10));
  return n > 0 ? `${n}d6` : "";
}

/** "Strength (Athletics) check", "Dexterity save"… */
export const optionText = (o: TestOption, kind: ChaseTest["kind"]) =>
  `${ABILITY_LABEL[o.ability]}${o.skill ? ` (${o.skill})` : ""} ${kind === "save" ? "save" : "check"}`;
const ABILITY_LABEL: Record<Ability, string> = { str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma" };

/** What a failed complication does, in words. */
export function failText(c: Pick<Complication, "fail">, rolled: { damage?: number; fallFeet?: number } = {}): string {
  const f = c.fail;
  const dmg = f.damage?.length ? f.damage.map((d) => `${d.dice} ${d.type}`).join(" + ") : "";
  return [
    f.note ?? "",
    f.fall != null ? `falls ${rolled.fallFeet ?? (f.fall === "1d4x5" ? "1d4 × 5" : f.fall)} feet and lands Prone` : "",
    rolled.damage != null ? `takes ${rolled.damage} damage` : dmg ? `takes ${dmg} damage` : "",
    f.prone ? "has the Prone condition" : "",
    f.blindedThisTurn ? "is Blinded until the end of its turn" : "",
    f.restrained ? "has the Restrained condition" : "",
    f.difficult ? `the obstacle counts as ${f.difficult} feet of Difficult Terrain for it` : "",
  ].filter(Boolean).join("; ");
}

// ------------------------------------------------------------------ dashing and escaping

/** Free Dashes during a chase: 3 + Constitution modifier, at least 1. */
export const freeDashes = (conMod: number) => Math.max(1, 3 + conMod);

/** Dashes over the free ones need a DC 10 Constitution save (2014: check) or 1 Exhaustion level. */
export const DASH_SAVE_DC = 10;
export const dashTestKind = (rules: ChaseRules): ChaseTest["kind"] => (rules === "2024" ? "save" : "check");
/** A participant with this many Exhaustion levels drops out. */
export const DROP_OUT_EXHAUSTION = 5;

/** End-of-round escape check: the quarry's total against the highest pursuer Passive Perception. */
export function escapes(total: number, pursuerPassives: number[], inSight: boolean): boolean {
  if (inSight) return false;
  return total > Math.max(0, ...pursuerPassives);
}

// ------------------------------------------------------------------ roll modes

export type Mode = "normal" | "advantage" | "disadvantage";
/** Advantage and Disadvantage from several sources: both cancel out. */
export function combineModes(...modes: (Mode | undefined)[]): Mode {
  const adv = modes.includes("advantage"), dis = modes.includes("disadvantage");
  return adv && !dis ? "advantage" : dis && !adv ? "disadvantage" : "normal";
}

/** Exhaustion on a d20 test: 2024 −2 per level; 2014 Disadvantage on checks from level 1 and on saves from level 3. */
export function exhaustionOnTest(level: number, kind: "save" | "check" | "attack", rules: ChaseRules): { penalty: number; mode: Mode } {
  if (rules === "2024") return { penalty: -2 * level, mode: "normal" };
  const dis = kind === "check" ? level >= 1 : level >= 3;
  return { penalty: 0, mode: dis ? "disadvantage" : "normal" };
}
