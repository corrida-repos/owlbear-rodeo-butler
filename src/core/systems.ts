/**
 * Game systems: the rules that differ between D&D 5E (2014) and 5.5E (2024). 5.5E is the default.
 * Phase 0 skeleton: conditions, Bloodied and concentration. Difficulty, initiative, exhaustion effects and card
 * labels move here in later phases (see docs/ROADMAP.md, GameSystem table).
 */
import type { UnitSheet, UnitState } from "./sheet";
import { maxHp } from "./sheet";

export type SystemId = "dnd5e-2024" | "dnd5e-2014";
export const DEFAULT_SYSTEM: SystemId = "dnd5e-2024";

export interface ConditionDef {
  key: string;
  label: string;
  /** Set and cleared by the rules (e.g. Bloodied from HP), never by hand. */
  automatic?: boolean;
  /** Has levels (Exhaustion). */
  maxLevel?: number;
}

export interface GameSystem {
  id: SystemId;
  label: string;
  short: "5.5E" | "5E";
  /** 5etools edition this system prefers when a creature exists in both. */
  rules: "2024" | "2014";
  /** Core books of the other edition, left out of the 5etools search (F9): 5.5E hides the 2014 PHB/MM/DMG, 5E the 2024 ones. */
  hiddenSources: string[];
  conditions: ConditionDef[];
  /** 2024 only: a creature is Bloodied while it has half its Hit Points or fewer. */
  hasBloodied: boolean;
  /** DC of the Constitution save to keep concentration after taking `damage`. */
  concentrationDc(damage: number): number;
}

const STANDARD: ConditionDef[] = [
  { key: "blinded", label: "Blinded" },
  { key: "charmed", label: "Charmed" },
  { key: "deafened", label: "Deafened" },
  { key: "exhaustion", label: "Exhaustion", maxLevel: 6 },
  { key: "frightened", label: "Frightened" },
  { key: "grappled", label: "Grappled" },
  { key: "incapacitated", label: "Incapacitated" },
  { key: "invisible", label: "Invisible" },
  { key: "paralyzed", label: "Paralyzed" },
  { key: "petrified", label: "Petrified" },
  { key: "poisoned", label: "Poisoned" },
  { key: "prone", label: "Prone" },
  { key: "restrained", label: "Restrained" },
  { key: "stunned", label: "Stunned" },
  { key: "unconscious", label: "Unconscious" },
];
/** Butler's own statuses, in both systems. */
const BUTLER: ConditionDef[] = [
  { key: "concentration", label: "Concentration" },
  /** Holding a creature in a grapple: half speed, the grappled creature stays adjacent, +2 AC through it (grapple.ts). */
  { key: "grappling", label: "Grappling" },
  { key: "dead", label: "Dead" },
  /** Party member at 0 HP who no longer makes death saves (set by hand or by 3 successes); supersedes Death Saves. */
  { key: "stable", label: "Stable" },
];
/** Party members at 0 HP that aren't Dead or Stable (both supersede it). Both systems. */
const DEATH_SAVES: ConditionDef = { key: "death-saves", label: "Death Saves", automatic: true };
const BUTLER_AUTO = [DEATH_SAVES];
const BLOODIED: ConditionDef = { key: "bloodied", label: "Bloodied", automatic: true };

const halfDown = (n: number) => Math.floor(Math.max(0, n) / 2);

export const DND5E_2024: GameSystem = {
  id: "dnd5e-2024",
  label: "D&D 5.5E (2024 rules)",
  short: "5.5E",
  rules: "2024",
  hiddenSources: ["PHB", "MM", "DMG"],
  conditions: [...STANDARD, ...BUTLER, ...BUTLER_AUTO, BLOODIED],
  hasBloodied: true,
  // PHB 2024: "10 or half the damage taken (round down), whichever number is higher, up to a maximum DC of 30."
  concentrationDc: (damage) => Math.min(30, Math.max(10, halfDown(damage))),
};

export const DND5E_2014: GameSystem = {
  id: "dnd5e-2014",
  label: "D&D 5E (2014 rules)",
  short: "5E",
  rules: "2014",
  hiddenSources: ["XPHB", "XMM", "XDMG"],
  conditions: [...STANDARD, ...BUTLER, ...BUTLER_AUTO],
  hasBloodied: false,
  // PHB 2014: "DC equals 10 or half the damage you take, whichever number is higher."
  concentrationDc: (damage) => Math.max(10, halfDown(damage)),
};

export const SYSTEMS: Record<SystemId, GameSystem> = { "dnd5e-2024": DND5E_2024, "dnd5e-2014": DND5E_2014 };
export const getSystem = (id: unknown): GameSystem => SYSTEMS[id as SystemId] ?? SYSTEMS[DEFAULT_SYSTEM];

/** Whether creatures from this 5etools source appear in the search under this system (other books: always). */
export const searchableSource = (system: Pick<GameSystem, "hiddenSources">, source: string) => !system.hiddenSources.includes(source.toUpperCase());

export const isDead = (state: Pick<UnitState, "conditions">) => state.conditions.some((c) => c.key === "dead");

/** 5.5E: HP at or below half max (not shown once the unit is Dead). Always false in 5E. */
export function isBloodied(system: GameSystem, sheet: Pick<UnitSheet, "hp">, state: Pick<UnitState, "hp" | "maxHpOverride" | "conditions">): boolean {
  // Rules-faithful: a unit at 0 HP is also at "half or fewer", so a dying PC shows Bloodied and Death Saves.
  if (!system.hasBloodied || isDead(state)) return false;
  return state.hp * 2 <= maxHp(sheet, state);
}

export const isStable = (state: Pick<UnitState, "conditions">) => state.conditions.some((c) => c.key === "stable");

/** Party member at 0 HP and neither Dead nor Stable: making death saving throws. Dead and Stable supersede it. */
export function needsDeathSaves(state: Pick<UnitState, "hp" | "party" | "conditions">): boolean {
  return state.party && state.hp <= 0 && !isDead(state) && !isStable(state);
}

export interface ShownCondition { key: string; label: string; level?: number; automatic?: boolean; detail?: string }

/** Conditions to display: stored ones plus the automatic ones the rules derive (Death Saves, Bloodied). */
export function displayConditions(system: GameSystem, sheet: Pick<UnitSheet, "hp">, state: UnitState): ShownCondition[] {
  const defs = new Map(system.conditions.map((c) => [c.key, c]));
  const out: ShownCondition[] = state.conditions
    .filter((c) => !defs.get(c.key)?.automatic)
    .map((c) => ({ key: c.key, label: c.label ?? defs.get(c.key)?.label ?? c.key, level: c.level }));
  if (needsDeathSaves(state)) {
    const ds = state.deathSaves ?? { successes: 0, failures: 0 };
    out.push({ key: "death-saves", label: "Death Saves", automatic: true, detail: `${ds.successes} ✓ / ${ds.failures} ✗` });
  }
  if (isBloodied(system, sheet, state)) out.push({ key: "bloodied", label: "Bloodied", automatic: true });
  return out;
}
