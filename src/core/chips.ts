/**
 * Dice chips in sheet text. Converters write rollable values as "[formula]" right after their printed form:
 *   "Melee Attack Roll: +4 [1d20+4], reach 5 ft. Hit: 5 (1d6 + 2 [1d6+2]) Piercing damage."
 * parseChips splits such text into plain text and roll segments, folding the printed form ("+4", "1d6 + 2") into
 * the roll so the card shows one clickable value. Brackets that aren't a valid formula ("[Concentration]") stay text.
 */
import { fmtMod, isD20Test, isRollable } from "./dice";

export type RollKind = "attack" | "save" | "check" | "damage" | "dice";

export interface TextSegment { t: "text"; text: string }
export interface RollSegment {
  t: "roll";
  formula: string;
  /** What the card shows on the button: the printed form ("+4", "1d6 + 2"), or the formula. */
  display: string;
  kind: RollKind;
  /** "Piercing" for "... [1d6+2]) Piercing damage". */
  damageType?: string;
}
export type Segment = TextSegment | RollSegment;

const CHIP = /\[([^\[\]]{1,500})\]/g;

/** The printed form of `formula` at the end of `before` (e.g. "+4 " or "1d6 + 2 "), as [start index, display]. */
function printedBefore(before: string, formula: string): [number, string] | null {
  const tail = before.replace(/\s+$/, "");
  const d20 = /^1d20([+-]\d+)$/i.exec(formula);
  if (d20) {
    const mod = fmtMod(Number(d20[1]));
    if (tail.endsWith(mod) && (tail.length === mod.length || /[\s(:]/.test(tail[tail.length - mod.length - 1]!))) {
      return [tail.length - mod.length, mod];
    }
  }
  // Longest suffix starting at a token boundary whose spaceless form equals the formula ("1d6 + 2" → "1d6+2").
  const from = Math.max(0, tail.length - 60);
  for (let i = from; i < tail.length; i++) {
    if (/\s/.test(tail[i]!) || (i > 0 && !/[\s(:]/.test(tail[i - 1]!))) continue;
    const cand = tail.slice(i);
    if (cand.replace(/\s+/g, "").toLowerCase() === formula.toLowerCase()) return [i, cand];
  }
  return null;
}

function kindOf(formula: string, before: string, after: string): Pick<RollSegment, "kind" | "damageType"> {
  // Only look back within the current clause (since the previous roll or sentence-ish break).
  const ctx = before.slice(-80);
  // A bare "1d20" with no bonus outside an attack/save/check context is just a number roll ("returns in 1d20 days").
  if (isD20Test(formula) && !(/^1d20$/i.test(formula) && !/attack|to hit|sav(e|ing throw)|check/i.test(ctx))) {
    if (/attack|to hit/i.test(ctx)) return { kind: "attack" };
    if (/sav(e|ing throw)/i.test(ctx)) return { kind: "save" };
    return { kind: "check" };
  }
  const type = /^\)?\s*([A-Za-z]+)\s+damage/i.exec(after);
  if (type) return { kind: "damage", damageType: type[1]![0]!.toUpperCase() + type[1]!.slice(1).toLowerCase() };
  if (/^\)?\s*damage/i.test(after) || /(hit|damage|takes?)\b[^.]*$/i.test(ctx)) return { kind: "damage" };
  return { kind: "dice" };
}

/** Dice printed in parentheses without a chip, as some 5etools books write them: "Hit: 13 (2d6 + 6) slashing". */
const BARE_PAREN = /\((\d+d\d+(?:\s*[+-]\s*\d+)?)\)/g;
const addBareChips = (text: string) =>
  text.replace(BARE_PAREN, (m, f: string) => (isRollable(f) ? `(${f} [${f.replace(/\s+/g, "")}])` : m));

export function parseChips(raw: string): Segment[] {
  const text = addBareChips(raw);
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(CHIP)) {
    const formula = m[1]!.replace(/\s+/g, "");
    if (!isRollable(formula)) continue;
    const start = m.index!;
    let before = text.slice(last, start);
    const after = text.slice(start + m[0].length, start + m[0].length + 40);
    const printed = printedBefore(before, formula);
    let display = formula;
    if (printed) {
      display = printed[1];
      before = before.slice(0, printed[0]);
    }
    const context = text.slice(Math.max(0, start - 80), start);
    if (before) out.push({ t: "text", text: before });
    out.push({ t: "roll", formula, display, ...kindOf(formula, context, after) });
    last = start + m[0].length;
  }
  const rest = text.slice(last);
  if (rest) out.push({ t: "text", text: rest });
  return out;
}

export const rollSegments = (segs: Segment[]) => segs.filter((s): s is RollSegment => s.t === "roll");

/** The damage rolls that follow an attack roll in the same entry, up to the next attack. */
export function damageAfter(segs: Segment[], attack: RollSegment): RollSegment[] {
  const rolls = rollSegments(segs);
  const i = rolls.indexOf(attack);
  const out: RollSegment[] = [];
  for (const r of rolls.slice(i + 1)) {
    if (r.kind === "attack") break;
    if (r.kind === "damage") out.push(r);
  }
  return out;
}

/** Text of a roll's label, e.g. "Bite · to hit", "Bite · Piercing damage". */
export function rollLabel(entryName: string, seg: Pick<RollSegment, "kind" | "damageType">): string {
  const what = seg.kind === "attack" ? "to hit" : seg.kind === "damage" ? `${seg.damageType ? `${seg.damageType} ` : ""}damage`
    : seg.kind === "save" ? "save" : seg.kind === "check" ? "check" : "roll";
  return `${entryName} · ${what}`;
}

/** Plain text without chips (for search or tooltips): "+4 [1d20+4]" → "+4". */
export const stripChips = (text: string) => parseChips(text).map((s) => (s.t === "text" ? s.text : s.display)).join("");
