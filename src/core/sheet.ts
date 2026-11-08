/**
 * Native unit data stored on tokens (replaces Forge's metadata).
 *  - `sheet`: the stat block. Large, rarely changes.
 *  - `state`: HP, initiative, conditions, party… Small, changes often, edited by the GM and (for their own units) players.
 * Kept under two keys so frequent state writes stay small and don't collide with sheet edits.
 * Rollable text uses the chip syntax `[1d20+4]` (see fivetools.ts diceChip).
 */
import { BUTLER_NS, SIZE_CELLS } from "./constants";
import type { InitiativeRoll, Provenance, StatblockInitiative } from "./schema";

export const SHEET_KEY = `${BUTLER_NS}/sheet`;
export const STATE_KEY = `${BUTLER_NS}/state`;
export const SHEET_SCHEMA = "butler-sheet@1";

export type Ability = "str" | "dex" | "con" | "int" | "wis" | "cha";
export const ABILITIES: Ability[] = ["str", "dex", "con", "int", "wis", "cha"];
export const ABILITY_NAMES: Record<Ability, string> = {
  str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma",
};
export type SizeCode = keyof typeof SIZE_CELLS;

/** One named block of text: a trait, an action, a spell, an item. `text` may contain `[formula]` chips. */
export interface SheetEntry { name: string; text: string }

export interface UnitSheet {
  schema: typeof SHEET_SCHEMA;
  name: string;
  /** "creature" (monster/NPC stat block) or "character" (PC, e.g. from D&D Beyond). */
  kind: "creature" | "character";
  size: SizeCode;
  /** e.g. "Beast", "Humanoid (Goblinoid)", or a PC's species/class line. */
  type?: string;
  alignment?: string;
  ac: number;
  acNote?: string;
  hp: { max: number; formula?: string };
  speed: { walk: number; swim?: number; fly?: number; climb?: number; burrow?: number; hover?: boolean };
  abilities: Record<Ability, number>;
  /** Save totals; omitted abilities use the plain modifier. */
  saves: Partial<Record<Ability, number>>;
  skills: { name: string; bonus: number }[];
  senses?: string;
  passivePerception?: number;
  languages?: string;
  defenses: { vulnerable?: string; resist?: string; immune?: string; conditionImmune?: string };
  cr?: number;
  level?: number;
  proficiencyBonus: number;
  initiative: StatblockInitiative;
  traits: SheetEntry[];
  actions: SheetEntry[];
  bonusActions: SheetEntry[];
  reactions: SheetEntry[];
  legendary: SheetEntry[];
  spells: SheetEntry[];
  inventory: SheetEntry[];
  source: { provenance: Provenance; book?: string; bookTitle?: string; page?: number; url?: string; notes?: string[] };
  flags: string[];
}

/** A condition or status effect on a unit. `key` is a GameSystem condition key or "custom". */
export interface ConditionInstance {
  id: string;
  key: string;
  /** Display name for custom effects. */
  label?: string;
  note?: string;
  /** Exhaustion level, etc. */
  level?: number;
  /** Optional expiry: after N rounds, or at the start/end of a given unit's turn. */
  until?: { rounds?: number; turnOf?: string; at?: "start" | "end" };
}

export interface UnitState {
  hp: number;
  tempHp: number;
  maxHpOverride?: number;
  initiative: number | null;
  initiativeRoll?: InitiativeRoll;
  /** GM's order among units tied on initiative (higher goes first). */
  initiativeTiebreak?: number;
  /** In the initiative tracker. */
  inEncounter: boolean;
  /** PC, companion or sidekick (the party). */
  party: boolean;
  /** Owlbear player id of the player who controls this unit. */
  controlledBy?: string;
  conditions: ConditionInstance[];
  /** Death saving throws while a party member is at 0 HP (cleared when healed or marked dead). */
  deathSaves?: { successes: number; failures: number };
  /** Portrait shown on the card/tracker; defaults to the token image. */
  portraitUrl?: string;
  /** Name players see until the GM reveals the unit. */
  alias?: string;
}

export const abilityMod = (score: number) => Math.floor((score - 10) / 2);
export const maxHp = (sheet: Pick<UnitSheet, "hp">, state: Pick<UnitState, "maxHpOverride">) => state.maxHpOverride ?? sheet.hp.max;
export const saveBonus = (sheet: UnitSheet, a: Ability) => sheet.saves[a] ?? abilityMod(sheet.abilities[a]);

export function newState(sheet: UnitSheet, patch: Partial<UnitState> = {}): UnitState {
  return { hp: sheet.hp.max, tempHp: 0, initiative: null, inEncounter: false, party: sheet.kind === "character", conditions: [], ...patch };
}

// ------------------------------------------------------------------ validation + migration

const isObj = (v: unknown): v is Record<string, any> => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const LISTS = ["traits", "actions", "bonusActions", "reactions", "legendary", "spells", "inventory"] as const;

export function validateSheet(x: unknown): string[] {
  const e: string[] = [];
  if (!isObj(x)) return ["sheet: not an object"];
  if (x.schema !== SHEET_SCHEMA) e.push(`schema: expected ${SHEET_SCHEMA}`);
  if (typeof x.name !== "string" || !x.name.trim()) e.push("name: missing");
  if (x.kind !== "creature" && x.kind !== "character") e.push("kind: creature or character");
  if (typeof x.size !== "string" || !(x.size in SIZE_CELLS)) e.push("size: T/S/M/L/H/G");
  if (!isNum(x.ac)) e.push("ac: number");
  if (!isObj(x.hp) || !isNum(x.hp.max) || x.hp.max <= 0) e.push("hp.max: > 0");
  if (!isObj(x.speed) || !isNum(x.speed.walk)) e.push("speed.walk: number");
  if (!isObj(x.abilities) || !ABILITIES.every((a) => isNum(x.abilities[a]))) e.push("abilities: six numbers");
  if (!isObj(x.saves)) e.push("saves: object");
  if (!Array.isArray(x.skills)) e.push("skills: array");
  if (!isObj(x.defenses)) e.push("defenses: object");
  if (!isNum(x.proficiencyBonus)) e.push("proficiencyBonus: number");
  if (!isObj(x.initiative) || !isNum(x.initiative.modifier)) e.push("initiative.modifier: number");
  for (const l of LISTS) {
    if (!Array.isArray(x[l]) || !x[l].every((it: unknown) => isObj(it) && typeof it.name === "string" && typeof it.text === "string"))
      e.push(`${l}: array of {name, text}`);
  }
  if (!isObj(x.source) || typeof x.source.provenance !== "string") e.push("source.provenance: missing");
  if (!Array.isArray(x.flags)) e.push("flags: array");
  return e;
}

/** Brings a stored sheet up to the current schema. Only v1 exists; unknown schemas are rejected, not guessed. */
export function migrateSheet(x: unknown): UnitSheet {
  if (isObj(x) && x.schema === SHEET_SCHEMA) {
    const errs = validateSheet(x);
    if (errs.length) throw new Error(`Invalid unit sheet: ${errs.join("; ")}`);
    return x as UnitSheet;
  }
  throw new Error(`Unknown unit sheet schema ${JSON.stringify(isObj(x) ? x.schema : x)}`);
}

/** Fills missing state fields (older or hand-written tokens) without touching present ones. */
export function normalizeState(x: unknown, sheet?: UnitSheet): UnitState {
  const s = isObj(x) ? x : {};
  return {
    ...s,
    hp: isNum(s.hp) ? s.hp : sheet?.hp.max ?? 0,
    tempHp: isNum(s.tempHp) ? s.tempHp : 0,
    initiative: isNum(s.initiative) ? s.initiative : null,
    inEncounter: s.inEncounter === true,
    party: s.party === true,
    conditions: Array.isArray(s.conditions) ? s.conditions : [],
  } as UnitState;
}
