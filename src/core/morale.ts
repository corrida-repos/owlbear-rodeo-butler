/**
 * Fight or Flight (2024 DMG, "Running Combat"). Before combat, a creature unsure whether to fight makes a DC 10 Wisdom
 * save (the leader for a group): a failure means it flees or parleys. In combat, a monster is likely to flee if it
 * starts its turn Bloodied and either has the Frightened condition, or more than half its allies are dead or
 * Incapacitated while nobody on the other side is. Pure; the background page and DM Tools use it.
 */
import { BUTLER_NS } from "./constants";
import { maxHp, type UnitSheet, type UnitState } from "./sheet";

export const MORALE_KEY = `${BUTLER_NS}/morale`;
export const MORALE_DC = 10;

/** A pending "likely to flee" prompt for the GM (scene metadata), cleared when rolled or dismissed. */
export interface MoralePrompt { unitId: string; name: string; round: number; reason: string }

export function readMorale(meta: Record<string, unknown>): MoralePrompt | null {
  const m = meta[MORALE_KEY] as MoralePrompt | undefined;
  return m && typeof m.unitId === "string" && typeof m.reason === "string" ? m : null;
}

interface Side { id: string; party: boolean; inEncounter: boolean; sheet: Pick<UnitSheet, "hp">; state: Pick<UnitState, "hp" | "maxHpOverride" | "conditions"> }

const INCAPACITATING = ["incapacitated", "paralyzed", "petrified", "stunned", "unconscious", "dead"];
/** Out of the fight: dead, at 0 HP, or Incapacitated (or a condition that includes it). */
export const outOfFight = (u: Pick<Side, "state">) => u.state.hp <= 0 || u.state.conditions.some((c) => INCAPACITATING.includes(c.key));
const bloodied = (u: Side) => u.state.hp * 2 <= maxHp(u.sheet, u.state);

/**
 * Why `unit` is likely to flee at the start of its turn, or null. Only non-party units (monsters); sides are the party
 * and everyone else in the encounter.
 */
export function fleeReason(unit: Side, all: Side[]): string | null {
  if (unit.party || outOfFight(unit) || !bloodied(unit)) return null;
  if (unit.state.conditions.some((c) => c.key === "frightened")) return "it starts its turn Bloodied and Frightened";
  const fighters = all.filter((u) => u.inEncounter || u.id === unit.id);
  const allies = fighters.filter((u) => !u.party && u.id !== unit.id);
  const foes = fighters.filter((u) => u.party);
  const down = allies.filter(outOfFight).length;
  if (allies.length && down * 2 > allies.length && foes.length && !foes.some(outOfFight))
    return `it starts its turn Bloodied, ${down} of its ${allies.length} allies are dead or Incapacitated, and nobody on the other side is`;
  return null;
}

/** The save's outcome in words. */
export const moraleOutcome = (total: number, dc = MORALE_DC) => total >= dc
  ? `succeeds (${total} vs DC ${dc}): it keeps fighting.`
  : `fails (${total} vs DC ${dc}): it flees or tries to parley.`;
