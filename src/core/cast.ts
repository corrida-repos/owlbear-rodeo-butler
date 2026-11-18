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
  /** Attack rolls: the kept d20 (the GM's client decides the hit from it and the target's AC). */
  natural?: number;
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
  /** Conditions the spell gives (on a failed save, a hit, or always), with how long they last. */
  conditions?: CastCondition[];
  /** The spell slot level used (spent from the caster when the GM's client receives it). */
  slotLevel?: number;
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

// ------------------------------------------------------------------ upcasting

/**
 * Casting with a higher slot: the spell's own "the damage increases by 1d6 for each spell slot level above 3" (2024)
 * or "…for each slot level above 3rd" (2014) adds dice to the matching damage part (the first one otherwise).
 */
export function upcastDamage(text: string, damage: DamagePart[], castLevel: number): { damage: DamagePart[]; extra?: string } {
  const m = /damage increases by (\d+)d(\d+) for each (?:spell )?slot level above (\d+)/i.exec(text);
  if (!m || !damage.length) return { damage };
  const steps = castLevel - Number(m[3]);
  if (steps <= 0) return { damage };
  const n = Number(m[1]) * steps, die = Number(m[2]);
  let i = damage.findIndex((d) => new RegExp(`d${die}(?!\\d)`).test(d.formula));
  if (i < 0) i = 0;
  const out = damage.map((d, k) => {
    if (k !== i) return d;
    const solo = new RegExp(`^(\\d+)d${die}$`).exec(d.formula.replace(/\s+/g, ""));
    return { ...d, formula: solo ? `${Number(solo[1]) + n}d${die}` : `${d.formula}+${n}d${die}` };
  });
  return { damage: out, extra: `+${n}d${die}` };
}

// ------------------------------------------------------------------ spell slots

export interface SlotInfo { max: number; used: number }

/** Spell slots per level from the sheet: D&D Beyond's "Slots: L1 4 (1 used), L2 3" or a stat block's "Level 3 (2 slots)". */
export function slotTable(sheet: Pick<UnitSheet, "traits" | "spells" | "actions">, state?: { slotsUsed?: Record<string, number> }): Record<number, SlotInfo> {
  const out: Record<number, SlotInfo> = {};
  for (const e of [...sheet.traits, ...sheet.spells, ...sheet.actions]) {
    const slots = /Slots:\s*([^.]*)/.exec(e.text)?.[1];
    if (slots) for (const m of slots.matchAll(/L(\d)\s+(\d+)(?:\s*\((\d+) used\))?/g)) {
      const lvl = Number(m[1]);
      const cur = out[lvl] ?? { max: 0, used: 0 };
      out[lvl] = { max: cur.max + Number(m[2]), used: cur.used + Number(m[3] ?? 0) };
    }
    const lv = /^Level (\d) \((\d+) slots?\)$/.exec(e.name);
    if (lv) out[Number(lv[1])] = { max: Number(lv[2]), used: 0 };
  }
  for (const [k, v] of Object.entries(state?.slotsUsed ?? {})) if (out[Number(k)]) out[Number(k)]!.used = Math.max(0, Math.min(out[Number(k)]!.max, v));
  return out;
}

/** Slots left at a level (0 when unknown or spent). */
export const slotsLeft = (t: Record<number, SlotInfo>, level: number) => Math.max(0, (t[level]?.max ?? 0) - (t[level]?.used ?? 0));

/** The lowest slot level at or above `level` with a slot left, or null. */
export function lowestSlot(t: Record<number, SlotInfo>, level: number): number | null {
  for (let l = Math.max(1, level); l <= 9; l++) if (slotsLeft(t, l) > 0) return l;
  return null;
}

// ------------------------------------------------------------------ conditions

export const CAST_CONDITIONS = ["blinded", "charmed", "deafened", "frightened", "grappled", "incapacitated", "paralyzed", "petrified", "poisoned", "prone", "restrained", "stunned", "unconscious"] as const;

export interface CastCondition {
  key: string;
  /** How long: until the end or start of the caster's next turn, the end of the target's next turn, or rounds. */
  until?: "caster-end" | "caster-start" | "target-end";
  rounds?: number;
}

/** Conditions an entry gives ("has the Frightened condition", "is knocked Prone", 2014 "be frightened"), with the
 *  duration written right after (until the end of your next turn, for 1 minute…). Immunities it grants are ignored. */
export function conditionsIn(text: string): CastCondition[] {
  const out: CastCondition[] = [];
  for (const c of CAST_CONDITIONS) {
    const re = new RegExp(`\\b(?:has|have|having|is|be|becomes?|falls?|knocked|knocks? (?:it|them|the target))\\s+(?:the\\s+)?${c}\\b|\\b${c} condition\\b`, "ig");
    for (const m of text.matchAll(re)) {
      const before = text.slice(Math.max(0, m.index! - 40), m.index!);
      if (/immun|can't be|cannot be|ends? the|end the|remove|isn't|aren't|already/i.test(before)) continue;
      const after = text.slice(m.index!, m.index! + 160);
      const cond: CastCondition = { key: c };
      if (/until the end of your next turn/i.test(after)) cond.until = "caster-end";
      else if (/until the start of your next turn/i.test(after)) cond.until = "caster-start";
      else if (/until the end of (its|the target's|their) next turn/i.test(after)) cond.until = "target-end";
      else { const r = /for 1 (minute|round)\b/i.exec(after); if (r) cond.rounds = r[1]!.toLowerCase() === "minute" ? 10 : 1; }
      out.push(cond);
      break;
    }
  }
  return out;
}

/** Whether this outcome gives the spell's conditions: a failed save, a hit, or a spell that just happens. */
export const givesConditions = (o: Outcome) => o === "failed" || o === "hit" || o === "crit" || o === "auto";
