/**
 * Dice roll messages shared through Owlbear's broadcast API (messages ≤ 16 kB, not stored).
 * Visibility:
 *  - public: everyone sees it.
 *  - private by the GM: never leaves the GM's browser (sent LOCAL only).
 *  - private by a player: sent to everyone, but only the roller and GMs show it. Owlbear has no per-player
 *    destination, so a determined player could still read it from the network traffic; acceptable for dice.
 */
import type { RollKind } from "./chips";
import { BUTLER_NS } from "./constants";
import { critFormula, fmtMod, naturalD20, rollFormula, withRollMode, type Rng } from "./dice";
import type { RollMode } from "./schema";

export const ROLL_CHANNEL = `${BUTLER_NS}/roll`;

export type Role = "GM" | "PLAYER";
export type RollVisibility = "public" | "private";

/** Dice of one term as shown: all rolled dice and which ones counted. */
export interface RollGroupShown { sides: number; rolls: number[]; kept: number[]; sign: 1 | -1 }

export interface RollMessage {
  v: 1;
  id: string;
  at: string;
  by: { id: string; name: string; role: Role };
  unit?: { id: string; name: string };
  /** What was rolled, e.g. "Scimitar · to hit". */
  label: string;
  /** The formula actually rolled (after advantage / crit), spaceless. */
  formula: string;
  dice: number[];
  modifier: number;
  total: number;
  visibility: RollVisibility;
  kind?: RollKind;
  mode?: RollMode;
  crit?: boolean;
  /** The kept d20 of a d20 test (1 and 20 are called out). */
  natural?: number;
  groups?: RollGroupShown[];
}

export interface Viewer { id: string; role: Role }

export function canSeeRoll(msg: RollMessage, viewer: Viewer): boolean {
  if (msg.visibility === "public") return true;
  return msg.by.id === viewer.id || viewer.role === "GM";
}

/** Where to send the message: a GM's private roll stays in the GM's own browser. */
export function rollDestination(msg: RollMessage): "ALL" | "LOCAL" {
  return msg.visibility === "private" && msg.by.role === "GM" ? "LOCAL" : "ALL";
}

/** "13 / 8" for advantage, "4 + 3" for plain dice. */
function groupText(g: RollGroupShown): string {
  if (g.kept.length < g.rolls.length) return g.rolls.join(" / ");
  return g.rolls.join(" + ");
}

/** The breakdown after the total: "adv 13 / 8 +4", "1d6+2 → 4 +2". */
export function rollDetail(msg: RollMessage): string {
  const mod = msg.modifier ? ` ${fmtMod(msg.modifier)}` : "";
  if (msg.groups?.length) {
    const dice = msg.groups.map((g, i) => `${i > 0 ? (g.sign < 0 ? "- " : "+ ") : g.sign < 0 ? "-" : ""}${groupText(g)}`).join(" ");
    const tag = msg.mode === "advantage" ? "adv " : msg.mode === "disadvantage" ? "dis " : "";
    return `${tag}${msg.formula} → ${dice}${mod}`;
  }
  return msg.dice.length ? `${msg.formula} → ${msg.dice.join(" + ")}${mod}` : msg.formula;
}

/** "Goblin 2 · Scimitar · to hit: 17 (1d20+4 → 13 +4)", with "(private)" and natural 20 / 1 call-outs. */
export function rollText(msg: RollMessage): string {
  const who = msg.unit?.name ?? msg.by.name;
  const nat = msg.natural === 20 ? " NATURAL 20!" : msg.natural === 1 ? " natural 1" : "";
  const crit = msg.crit ? " (critical)" : "";
  return `${msg.visibility === "private" ? "(private) " : ""}${who} · ${msg.label}${crit}: ${msg.total}${nat} (${rollDetail(msg)})`;
}

export interface RollOptions {
  rng: Rng;
  unit?: RollMessage["unit"];
  kind?: RollKind;
  /** Advantage / disadvantage for d20 tests (ignored for other rolls). */
  mode?: RollMode;
  /** Critical hit: damage dice doubled. */
  crit?: boolean;
  newId?: () => string;
  now?: () => Date;
}

export function makeRoll(formula: string, label: string, by: RollMessage["by"], visibility: RollVisibility, opts: RollOptions): RollMessage {
  let f = formula.replace(/\s+/g, "");
  if (opts.crit) f = critFormula(f);
  const mode = opts.mode && opts.mode !== "normal" ? opts.mode : undefined;
  if (mode) f = withRollMode(f, mode);
  const r = rollFormula(f, opts.rng);
  const natural = naturalD20(r);
  return {
    v: 1,
    id: (opts.newId ?? (() => globalThis.crypto.randomUUID()))(),
    at: (opts.now ?? (() => new Date()))().toISOString(),
    by, unit: opts.unit, label, formula: f, dice: r.dice, modifier: r.modifier, total: r.total, visibility,
    ...(opts.kind ? { kind: opts.kind } : {}),
    ...(mode && f !== formula.replace(/\s+/g, "") ? { mode } : {}),
    ...(opts.crit ? { crit: true } : {}),
    ...(natural !== undefined ? { natural } : {}),
    groups: r.groups.map((g) => ({ sides: g.sides, rolls: g.rolls, kept: g.kept, sign: g.sign })),
  };
}

export function isRollMessage(x: unknown): x is RollMessage {
  const m = x as RollMessage;
  return !!m && m.v === 1 && typeof m.id === "string" && typeof m.label === "string" && typeof m.total === "number"
    && Array.isArray(m.dice) && (m.visibility === "public" || m.visibility === "private") && !!m.by && typeof m.by.id === "string";
}

// ------------------------------------------------------------------ session roll log (per browser, per room)

export const ROLL_LOG_MAX = 40;

/** Adds a roll to a log (newest first), ignoring duplicates and keeping the newest ROLL_LOG_MAX. */
export function appendRollLog(log: RollMessage[], msg: RollMessage): RollMessage[] {
  if (log.some((m) => m.id === msg.id)) return log;
  return [msg, ...log].slice(0, ROLL_LOG_MAX);
}
