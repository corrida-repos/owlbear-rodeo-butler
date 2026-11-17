/**
 * Chases (2024 DMG, chapter 3). The GM picks the quarry and the pursuers; then, automatically:
 *  - After each participant's turn, it rolls 1d12 on the Urban or Wilderness Chase Complications table; a complication
 *    affects the NEXT participant in initiative order, who makes the save (Butler rolls it with that unit's best
 *    allowed save) and suffers the failure effect (Prone, damage, Blinded, Difficult Terrain…).
 *  - Dashing: a participant can Dash 3 + its Constitution modifier times (at least once) freely; each extra Dash calls
 *    for a DC 10 Constitution save at the end of its turn or 1 Exhaustion level; 5 levels drop it out of the chase.
 *  - At initiative count 0 (the end of each round) each quarry makes a Dexterity (Stealth) check against the highest
 *    Passive Perception among the pursuers (with Advantage or Disadvantage from the Escape Factors); higher escapes.
 *    A quarry never out of the lead pursuer's sight fails automatically (the GM marks that).
 * Pure; the background page (primary GM) drives it and the DM Tools tab edits it.
 */
import { BUTLER_NS } from "./constants";
import type { Ability } from "./sheet";

export const CHASE_KEY = `${BUTLER_NS}/chase`;

export type ChaseEnv = "urban" | "wilderness";
export type EscapeFactor = "normal" | "advantage" | "disadvantage";

export interface ChaseState {
  v: 1;
  active: boolean;
  env: ChaseEnv;
  quarry: string[];
  pursuers: string[];
  /** Dashes taken during the chase, per unit. */
  dashes: Record<string, number>;
  /** Quarry that escaped, and participants out of the chase (5 Exhaustion levels). */
  escaped: string[];
  out: string[];
  /** Quarry the lead pursuer never lost sight of: its escape check fails automatically. */
  inSight: string[];
  escapeFactor: EscapeFactor;
  /** Show the chase's rolls to players (otherwise the GM's alone). */
  publicRolls: boolean;
  /** Recent events, newest last. */
  log: string[];
}

export const NEW_CHASE: ChaseState = { v: 1, active: false, env: "urban", quarry: [], pursuers: [], dashes: {}, escaped: [], out: [], inSight: [], escapeFactor: "normal", publicRolls: false, log: [] };

export function readChase(meta: Record<string, unknown>): ChaseState {
  const c = meta[CHASE_KEY] as Partial<ChaseState> | undefined;
  if (!c || c.v !== 1) return { ...NEW_CHASE };
  const arr = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string") : []);
  return {
    ...NEW_CHASE, ...c, v: 1, active: c.active === true, env: c.env === "wilderness" ? "wilderness" : "urban",
    quarry: arr(c.quarry), pursuers: arr(c.pursuers), escaped: arr(c.escaped), out: arr(c.out), inSight: arr(c.inSight), log: arr(c.log),
    dashes: typeof c.dashes === "object" && c.dashes ? c.dashes : {},
    escapeFactor: c.escapeFactor === "advantage" || c.escapeFactor === "disadvantage" ? c.escapeFactor : "normal",
  };
}

export const LOG_MAX = 12;
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

/** Participants still in the chase. */
export const participants = (c: Pick<ChaseState, "quarry" | "pursuers" | "escaped" | "out">) =>
  [...c.quarry, ...c.pursuers].filter((id) => !c.escaped.includes(id) && !c.out.includes(id));

/** The next participant after `afterId` in initiative order (wrapping), skipping non-participants; null if none. */
export function nextParticipant(order: string[], c: ChaseState, afterId: string): string | null {
  const live = new Set(participants(c));
  const i = order.indexOf(afterId);
  for (let k = 1; k <= order.length; k++) {
    const id = order[(i + k + order.length) % order.length]!;
    if (live.has(id) && id !== afterId) return id;
  }
  return null;
}

// ------------------------------------------------------------------ complications

export interface Complication {
  roll: number;
  text: string;
  /** Save to avoid it (the unit's best of these abilities), or none. */
  save?: { dc: number; abilities: Ability[] };
  /** On a failed save (or with no save). */
  fail: { damage?: string; damageType?: string; prone?: boolean; blindedThisTurn?: boolean; difficult?: number; note?: string };
}

export const URBAN: Complication[] = [
  { roll: 1, text: "A cart or another large obstacle blocks the way.", save: { dc: 10, abilities: ["dex"] }, fail: { difficult: 10 } },
  { roll: 2, text: "A crowd blocks the way.", save: { dc: 10, abilities: ["str", "dex", "cha"] }, fail: { difficult: 10 } },
  { roll: 3, text: "A maze of barrels, crates or similar obstacles.", save: { dc: 10, abilities: ["dex", "int"] }, fail: { difficult: 10 } },
  { roll: 4, text: "The ground is slippery with rain, spilled oil or another liquid.", save: { dc: 10, abilities: ["dex"] }, fail: { prone: true } },
  { roll: 5, text: "A brawl in progress.", save: { dc: 15, abilities: ["str", "dex", "cha"] }, fail: { damage: "2d4", damageType: "Bludgeoning", difficult: 10 } },
  { roll: 6, text: "A sharp turn to avoid colliding with something impassable.", save: { dc: 10, abilities: ["dex"] }, fail: { damage: "1d4", damageType: "Bludgeoning" } },
];

export const WILDERNESS: Complication[] = [
  { roll: 1, text: "A Swarm of Insects (the GM picks the kind): the swarm uses one of its actions on this participant.", fail: { note: "the swarm acts against it" } },
  { roll: 2, text: "A stream or ravine blocks the path.", save: { dc: 10, abilities: ["str", "dex"] }, fail: { difficult: 10 } },
  { roll: 3, text: "Blowing sand, dirt, ash, snow or pollen.", save: { dc: 10, abilities: ["con"] }, fail: { blindedThisTurn: true, note: "Speed halved while Blinded this way" } },
  { roll: 4, text: "A sudden drop.", save: { dc: 10, abilities: ["dex"] }, fail: { damage: "1d6", damageType: "Bludgeoning", prone: true, note: "falls 10 feet" } },
  { roll: 5, text: "Razorvine nearby (or it uses 10 feet of movement to avoid it).", save: { dc: 15, abilities: ["dex"] }, fail: { damage: "1d10", damageType: "Slashing" } },
  { roll: 6, text: "A creature native to the area notices it (the GM picks one).", save: { dc: 10, abilities: ["wis", "cha"] }, fail: { note: "the creature joins the chase with it as its quarry" } },
];

/** The complication for a d12 roll (1–6), or null for 7–12. */
export const complicationFor = (env: ChaseEnv, d12: number): Complication | null => (env === "urban" ? URBAN : WILDERNESS)[d12 - 1] ?? null;

/** What a failed complication does, in words. */
export function failText(c: Complication, damageRolled?: number): string {
  const f = c.fail;
  return [
    f.note ?? "",
    f.damage ? `takes ${damageRolled ?? f.damage} ${f.damageType ?? ""} damage`.replace(/\s+/g, " ").trim() : "",
    f.prone ? "has the Prone condition" : "",
    f.blindedThisTurn ? "is Blinded until the end of its turn" : "",
    f.difficult ? `the obstacle counts as ${f.difficult} feet of Difficult Terrain for it` : "",
  ].filter(Boolean).join("; ");
}

// ------------------------------------------------------------------ dashing and escaping

/** Free Dashes during a chase: 3 + Constitution modifier, at least 1. */
export const freeDashes = (conMod: number) => Math.max(1, 3 + conMod);

/** Dashes over the free ones need a DC 10 Constitution save or 1 Exhaustion level. */
export const DASH_SAVE_DC = 10;
/** A participant with this many Exhaustion levels drops out. */
export const DROP_OUT_EXHAUSTION = 5;

/** Count-0 escape check: the quarry's Stealth total against the highest pursuer Passive Perception. */
export function escapes(stealthTotal: number, pursuerPassives: number[], inSight: boolean): boolean {
  if (inSight) return false;
  return stealthTotal > Math.max(0, ...pursuerPassives);
}
