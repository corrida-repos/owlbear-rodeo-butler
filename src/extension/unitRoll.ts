/** Sending a roll for a unit, shared by the unit card and the action bar. */
import OBR from "@owlbear-rodeo/sdk";
import { unitName } from "../core/card";
import { d20Penalty } from "../core/conditions";
import { cryptoRng, fmtMod } from "../core/dice";
import { makeRoll, ROLL_CHANNEL, rollDestination, type Role, type RollMessage, type RollVisibility } from "../core/rolls";
import type { RollMode } from "../core/schema";
import type { UnitSheet, UnitState } from "../core/sheet";
import { roomSystem } from "./roomSettings";

export interface RollUnit { id: string; info: { label?: string; name: string }; sheet: UnitSheet; state: UnitState }

/** Rolls and broadcasts. 2024 exhaustion (−2 per level) applies to d20 tests; public rolls name the unit by its alias. */
export async function sendUnitRoll(u: RollUnit, formula: string, label: string, kind: RollMessage["kind"],
  opts: { by: { id: string; name: string; role: Role }; visibility: RollVisibility; mode: RollMode; crit?: boolean }): Promise<RollMessage> {
  const penalty = kind === "attack" || kind === "save" || kind === "check" ? d20Penalty(roomSystem(), u.state) : 0;
  if (penalty) { formula = `${formula.replace(/\s+/g, "")}${fmtMod(penalty)}`; label = `${label} (exhaustion ${fmtMod(penalty)})`; }
  const name = opts.visibility === "public" && u.state.alias?.trim() ? u.state.alias.trim() : unitName(u.info, u.sheet, u.state);
  const msg = makeRoll(formula, label, opts.by, opts.visibility, { rng: cryptoRng, unit: { id: u.id, name }, kind, mode: opts.mode, crit: opts.crit });
  await OBR.broadcast.sendMessage(ROLL_CHANNEL, msg, { destination: rollDestination(msg) });
  return msg;
}
