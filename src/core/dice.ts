import type { InitiativeRoll, RollMode, StatblockInitiative } from "./schema";

/** Returns a float in [0, 1). */
export type Rng = () => number;

/** Cryptographically random RNG (browser + Node 19+). */
export const cryptoRng: Rng = () => {
  const buf = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buf);
  return buf[0]! / 2 ** 32;
};

/** Deterministic RNG for tests. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function rollDie(sides: number, rng: Rng): number {
  return Math.floor(rng() * sides) + 1;
}

/** One dice term of a formula, e.g. "2d20kh1": every die rolled, and the ones that count. */
export interface DiceGroup {
  count: number;
  sides: number;
  sign: 1 | -1;
  keep?: { which: "high" | "low"; n: number };
  rolls: number[];
  kept: number[];
}

export interface FormulaRoll {
  formula: string;
  /** Dice that count toward the total (all of them unless a term keeps highest/lowest). */
  dice: number[];
  modifier: number;
  total: number;
  groups: DiceGroup[];
}

const TERM = /[+-]?(\d+d\d+(?:k[hl]\d+)?|\d+)/gi;
const FORMULA = /^([+-]?(\d+d\d+(k[hl]\d+)?|\d+))+$/i;

/** True if `formula` is something rollFormula accepts within the dice limits (≤ 100 dice of 2–1000 sides). */
export function isRollable(formula: string): boolean {
  const clean = formula.replace(/\s+/g, "");
  if (!FORMULA.test(clean) || !/\d+d\d+/i.test(clean)) return false;
  for (const m of clean.matchAll(/(\d+)d(\d+)(?:k[hl](\d+))?/gi)) {
    const n = Number(m[1]), s = Number(m[2]);
    if (n < 1 || n > 100 || s < 2 || s > 1000 || (m[3] !== undefined && (Number(m[3]) < 1 || Number(m[3]) > n))) return false;
  }
  return true;
}

/** Rolls formulas like "2d8 + 2", "4d10-4", "15", "2d20kh1+5" (keep highest) and "2d20kl1" (keep lowest). */
export function rollFormula(formula: string, rng: Rng): FormulaRoll {
  const clean = formula.replace(/\s+/g, "");
  if (!FORMULA.test(clean)) throw new Error(`Unsupported dice formula: "${formula}"`);
  const dice: number[] = [];
  const groups: DiceGroup[] = [];
  let modifier = 0;
  let total = 0;
  for (const term of clean.match(TERM) ?? []) {
    const sign = term.startsWith("-") ? -1 : 1;
    const body = term.replace(/^[+-]/, "");
    const m = /^(\d+)d(\d+)(?:k([hl])(\d+))?$/i.exec(body);
    if (m) {
      const count = Number(m[1]);
      const sides = Number(m[2]);
      const rolls = Array.from({ length: count }, () => rollDie(sides, rng));
      let kept = rolls;
      let keep: DiceGroup["keep"];
      if (m[3]) {
        keep = { which: m[3].toLowerCase() === "h" ? "high" : "low", n: Math.min(count, Number(m[4])) };
        const order = rolls.map((v, i) => ({ v, i })).sort((a, b) => (keep!.which === "high" ? b.v - a.v : a.v - b.v) || a.i - b.i);
        const keepIdx = new Set(order.slice(0, keep.n).map((o) => o.i));
        kept = rolls.filter((_, i) => keepIdx.has(i));
      }
      groups.push({ count, sides, sign, ...(keep ? { keep } : {}), rolls, kept });
      for (const r of kept) { dice.push(r); total += sign * r; }
    } else {
      modifier += sign * Number(body);
      total += sign * Number(body);
    }
  }
  return { formula, dice, modifier, total, groups };
}

/** A d20 test rolled with advantage/disadvantage: the leading "1d20" becomes "2d20kh1"/"2d20kl1". */
export function withRollMode(formula: string, mode: RollMode): string {
  const clean = formula.replace(/\s+/g, "");
  if (mode === "normal") return clean;
  return clean.replace(/^\+?1d20(?![\dk])/i, mode === "advantage" ? "2d20kh1" : "2d20kl1");
}

/** True if the formula is a d20 test: starts with one d20 (any roll mode). */
export const isD20Test = (formula: string) => /^\+?(1d20|2d20k[hl]1)(?![\d])/i.test(formula.replace(/\s+/g, ""));

/** Critical hit damage: every damage die is rolled twice as many times; modifiers stay the same (2014 and 2024). */
export function critFormula(formula: string): string {
  return formula.replace(/\s+/g, "").replace(/(\d+)d(\d+)/gi, (_m, n: string, s: string) => `${Number(n) * 2}d${s}`);
}

/** The kept die of a d20 test (for natural 1 / 20), or undefined if the roll isn't one. */
export function naturalD20(r: FormulaRoll): number | undefined {
  const g = r.groups[0];
  return g && g.sides === 20 && g.kept.length === 1 && isD20Test(r.formula) ? g.kept[0] : undefined;
}

/** Advantage + disadvantage cancel to normal. */
export function resolveRollMode(advantage: boolean, disadvantage: boolean): RollMode {
  if (advantage && !disadvantage) return "advantage";
  if (disadvantage && !advantage) return "disadvantage";
  return "normal";
}

export function fmtMod(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}

export function rollInitiative(
  modifier: number,
  mode: RollMode,
  rng: Rng,
  rolledBy: InitiativeRoll["rolledBy"],
  now: () => Date = () => new Date(),
): InitiativeRoll {
  const dice = mode === "normal" ? [rollDie(20, rng)] : [rollDie(20, rng), rollDie(20, rng)];
  const kept = mode === "advantage" ? Math.max(...dice) : mode === "disadvantage" ? Math.min(...dice) : dice[0]!;
  const base = mode === "normal" ? "1d20" : mode === "advantage" ? "2d20kh1" : "2d20kl1";
  return {
    dice,
    kept,
    modifier,
    mode,
    total: kept + modifier,
    formula: modifier === 0 ? base : `${base}${fmtMod(modifier)}`,
    rolledAt: now().toISOString(),
    rolledBy,
  };
}

export function rollForStatblock(init: StatblockInitiative, rng: Rng, rolledBy: InitiativeRoll["rolledBy"]): InitiativeRoll {
  return rollInitiative(init.modifier, resolveRollMode(init.advantage, init.disadvantage), rng, rolledBy);
}

export function describeInitiative(r: InitiativeRoll): string {
  const dice = r.mode === "normal" ? `d20 ${r.kept}` : `${r.mode === "advantage" ? "adv" : "dis"} d20 [${r.dice.join(", ")}] → ${r.kept}`;
  return `${dice} ${fmtMod(r.modifier)} = ${r.total}`;
}
