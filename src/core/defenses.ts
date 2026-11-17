/**
 * A creature's damage Resistances, Vulnerabilities and Immunities, and condition Immunities, read from its sheet's
 * defense lines ("Fire, Cold; Bludgeoning, Piercing, and Slashing from Nonmagical Attacks"), for damage Butler applies
 * itself (hazards and traps). PHB 2024 order: other adjustments first (half on a save), then Resistance (halved,
 * rounded down), then Vulnerability (doubled); Immunity means none.
 *
 * Qualified entries ("…from Nonmagical Attacks", "…that aren't Silvered", "…while in Dim Light") are conditional: they
 * aren't applied automatically, only reported, so the GM can rule on them. In a qualified clause the types named
 * right before the qualifier are the conditional ones (in practice Bludgeoning, Piercing and Slashing).
 */
import type { UnitSheet } from "./sheet";

const TYPES = ["Acid", "Bludgeoning", "Cold", "Fire", "Force", "Lightning", "Necrotic", "Piercing", "Poison", "Psychic", "Radiant", "Slashing", "Thunder"];
const QUALIFIER = /\b(from|that|except|while|unless|if|when|in)\b/i;

export interface DefenseList { always: Set<string>; conditional: Set<string>; all: boolean }

/** Damage types in one defense line, split into those that always apply and the conditional ones. */
export function parseDefenses(text: string | undefined): DefenseList {
  const out: DefenseList = { always: new Set(), conditional: new Set(), all: false };
  if (!text) return out;
  for (const clause of text.split(/;/)) {
    const q = QUALIFIER.exec(clause);
    const head = q ? clause.slice(0, q.index) : clause;
    // Types before the qualifier: the last run of them is what the qualifier is about.
    const found = TYPES.map((t) => ({ t, i: head.search(new RegExp(`\\b${t}\\b`, "i")) })).filter((x) => x.i >= 0).sort((a, b) => a.i - b.i);
    if (/^\s*all damage\b/i.test(clause) && !q) out.all = true;
    if (!q) { for (const f of found) out.always.add(f.t); continue; }
    // A qualified clause: B/P/S are the conditional group (5etools lists unconditional types before it).
    for (const f of found) (/^(Bludgeoning|Piercing|Slashing)$/.test(f.t) ? out.conditional : out.always).add(f.t);
  }
  return out;
}

export interface DamageAfterDefenses { amount: number; note: string }

/** `amount` of `type` damage after the sheet's Immunities, Resistances and Vulnerabilities. */
export function damageAgainst(defenses: UnitSheet["defenses"] | undefined, amount: number, type: string): DamageAfterDefenses {
  const t = TYPES.find((x) => x.toLowerCase() === type.toLowerCase()) ?? type;
  const imm = parseDefenses(defenses?.immune), res = parseDefenses(defenses?.resist), vul = parseDefenses(defenses?.vulnerable);
  const n = Math.max(0, Math.floor(amount));
  if (imm.all || imm.always.has(t)) return { amount: 0, note: `Immunity to ${t}` };
  const notes: string[] = [];
  let out = n;
  if (res.all || res.always.has(t)) { out = Math.floor(out / 2); notes.push(`Resistance to ${t}`); }
  if (vul.always.has(t)) { out *= 2; notes.push(`Vulnerability to ${t}`); }
  const cond = [imm, res, vul].some((l) => l.conditional.has(t));
  if (cond) notes.push(`a conditional ${t} defense on its sheet wasn't applied`);
  return { amount: out, note: notes.join(", ") };
}

/** Whether the sheet lists Immunity to this condition ("Poisoned", "Charmed, Frightened"). */
export function immuneToCondition(defenses: UnitSheet["defenses"] | undefined, key: string): boolean {
  if (!defenses?.conditionImmune || key === "custom") return false;
  return new RegExp(`\\b${key}\\b`, "i").test(defenses.conditionImmune);
}
