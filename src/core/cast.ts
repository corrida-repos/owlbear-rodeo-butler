/**
 * Casting a spell (or using an attack) at targets from the action bar, end to end:
 *  - An attack roll: one roll per target against its AC (a natural 20 is a critical hit, a natural 1 misses), damage
 *    rolled for each hit.
 *  - A saving throw: the damage is rolled once (as the rules say); each target saves. Creatures' saves are rolled by
 *    the GM's client (privately); party members roll their own from a prompt.
 *  - Neither (Magic Missile): the damage hits every target.
 * The results wait in the Tracker for the GM to apply; damage follows each target's defenses (see defenses.ts), after
 * halving on a successful save. Records live in scene metadata, newest last, a few at most.
 */
import { attackProfile, saveOf } from "./actions";
import { BUTLER_NS } from "./constants";
import { hitAgainst } from "./defenses";
import type { Ability, UnitSheet } from "./sheet";

export const CASTS_KEY = `${BUTLER_NS}/casts`;
export const CASTS_MAX = 8;

export type CastKind = "attack" | "save" | "damage";
export interface DamagePart { formula: string; type?: string }
export interface CastPlan { kind: CastKind; bonus?: number; dc?: number; ability?: Ability; half: boolean; damage: DamagePart[] }

const ABILITY_KEY: Record<string, Ability> = { strength: "str", dexterity: "dex", constitution: "con", intelligence: "int", wisdom: "wis", charisma: "cha" };

/** What casting this entry at targets means, from its text; null when there's nothing to resolve (no attack, save or damage). */
export function castPlan(text: string): CastPlan | null {
  const p = attackProfile(text);
  const save = saveOf(text);
  const half = /half (as much )?damage|Success:\s*Half/i.test(text);
  if (p.bonus !== undefined) return { kind: "attack", bonus: p.bonus, half: false, damage: p.damage };
  if (save) return { kind: "save", dc: save.dc, ability: ABILITY_KEY[save.ability.toLowerCase()] ?? "dex", half, damage: p.damage };
  if (p.damage.length) return { kind: "damage", half: false, damage: p.damage };
  return null;
}

export type Outcome = "awaiting-save" | "saved" | "failed" | "hit" | "crit" | "miss" | "auto";

export interface CastTarget {
  id: string;
  name: string;
  party: boolean;
  outcome: Outcome;
  /** The attack roll or save total. */
  roll?: number;
  /** Attack spells: this target's damage rolls (doubled dice on a crit). */
  rolled?: { amount: number; type?: string }[];
  /** Damage after halving and the target's defenses (set once resolved). */
  damage: number;
  notes?: string[];
  applied?: boolean;
}

export interface CastRecord {
  id: string;
  at: string;
  caster: { id: string; name: string };
  spell: string;
  kind: CastKind;
  dc?: number;
  ability?: Ability;
  half: boolean;
  /** Save and damage spells: the damage, rolled once for everyone. */
  rolled?: { amount: number; type?: string }[];
  targets: CastTarget[];
}

export function readCasts(meta: Record<string, unknown>): CastRecord[] {
  const raw = meta[CASTS_KEY];
  return Array.isArray(raw) ? raw.filter((c): c is CastRecord => !!c && typeof c.id === "string" && Array.isArray(c.targets)) : [];
}

/** The records with this one added (or replaced), keeping the newest CASTS_MAX. */
export const upsertCast = (list: CastRecord[], rec: CastRecord) => [...list.filter((c) => c.id !== rec.id), rec].slice(-CASTS_MAX);

/** Damage to one target for an outcome: per damage type, halved on a successful save (when the spell says), then defenses. */
export function damageFor(rec: Pick<CastRecord, "half" | "rolled">, t: Pick<CastTarget, "outcome" | "rolled">, defenses?: UnitSheet["defenses"]): { amount: number; notes: string[] } {
  const parts = t.rolled ?? rec.rolled ?? [];
  if (t.outcome === "miss" || t.outcome === "awaiting-save" || (t.outcome === "saved" && !rec.half)) return { amount: 0, notes: [] };
  const base = t.outcome === "saved" ? parts.map((p) => ({ ...p, amount: Math.floor(p.amount / 2) })) : parts;
  return hitAgainst(defenses, base);
}

/** Resolves a target's saving throw (the total) and works out its damage. */
export function resolveSave(rec: CastRecord, targetId: string, total: number, defenses?: UnitSheet["defenses"]): CastRecord {
  return {
    ...rec,
    targets: rec.targets.map((t) => {
      if (t.id !== targetId) return t;
      const outcome: Outcome = total >= (rec.dc ?? 0) ? "saved" : "failed";
      const d = damageFor(rec, { outcome }, defenses);
      return { ...t, outcome, roll: total, damage: d.amount, ...(d.notes.length ? { notes: d.notes } : {}) };
    }),
  };
}

/** An attack roll against a target's AC: natural 20 always hits (critical), natural 1 always misses. */
export function attackOutcome(total: number, natural: number | undefined, ac: number): Outcome {
  if (natural === 20) return "crit";
  if (natural === 1) return "miss";
  return total >= ac ? "hit" : "miss";
}

const OUTCOME_TEXT: Record<Outcome, string> = { "awaiting-save": "rolling its save…", saved: "saves", failed: "fails", hit: "hit", crit: "critical hit", miss: "miss", auto: "hit" };

/** "Goblin 1: fails (8) · 28 Fire" for the Tracker and notices. */
export function targetLine(rec: Pick<CastRecord, "kind" | "dc">, t: CastTarget): string {
  const roll = t.roll !== undefined ? ` (${t.roll}${rec.kind === "save" ? ` vs DC ${rec.dc}` : ""})` : "";
  const dmg = t.outcome === "awaiting-save" ? "" : ` · ${t.damage} damage${t.notes?.length ? ` (${t.notes.join("; ")})` : ""}`;
  return `${t.name}: ${OUTCOME_TEXT[t.outcome]}${roll}${dmg}${t.applied ? " · applied" : ""}`;
}
