/**
 * Dice roll messages shared through Owlbear's broadcast API (messages ≤ 16 kB, not stored).
 * Visibility:
 *  - public: everyone sees it.
 *  - private by the GM: never leaves the GM's browser (sent LOCAL only).
 *  - private by a player: sent to everyone, but only the roller and GMs show it. Owlbear has no per-player
 *    destination, so a determined player could still read it from the network traffic; acceptable for dice.
 */
import { BUTLER_NS } from "./constants";
import { fmtMod, rollFormula, type Rng } from "./dice";

export const ROLL_CHANNEL = `${BUTLER_NS}/roll`;

export type Role = "GM" | "PLAYER";
export type RollVisibility = "public" | "private";

export interface RollMessage {
  v: 1;
  id: string;
  at: string;
  by: { id: string; name: string; role: Role };
  unit?: { id: string; name: string };
  /** What was rolled, e.g. "Scimitar · to hit". */
  label: string;
  formula: string;
  dice: number[];
  modifier: number;
  total: number;
  visibility: RollVisibility;
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

/** "Goblin 2 · Scimitar · to hit: 17 (1d20+4 → 13 +4)", with a "(private)" prefix when hidden. */
export function rollText(msg: RollMessage): string {
  const who = msg.unit?.name ?? msg.by.name;
  const detail = msg.dice.length ? `${msg.formula} → ${msg.dice.join(" + ")}${msg.modifier ? ` ${fmtMod(msg.modifier)}` : ""}` : msg.formula;
  return `${msg.visibility === "private" ? "(private) " : ""}${who} · ${msg.label}: ${msg.total} (${detail})`;
}

export function makeRoll(formula: string, label: string, by: RollMessage["by"], visibility: RollVisibility,
  opts: { rng: Rng; unit?: RollMessage["unit"]; newId?: () => string; now?: () => Date }): RollMessage {
  const r = rollFormula(formula, opts.rng);
  return {
    v: 1,
    id: (opts.newId ?? (() => globalThis.crypto.randomUUID()))(),
    at: (opts.now ?? (() => new Date()))().toISOString(),
    by, unit: opts.unit, label, formula: formula.replace(/\s+/g, ""), dice: r.dice, modifier: r.modifier, total: r.total, visibility,
  };
}

export function isRollMessage(x: unknown): x is RollMessage {
  const m = x as RollMessage;
  return !!m && m.v === 1 && typeof m.id === "string" && typeof m.label === "string" && typeof m.total === "number"
    && Array.isArray(m.dice) && (m.visibility === "public" || m.visibility === "private") && !!m.by && typeof m.by.id === "string";
}
