/** Rolls made by Butler on the GM's behalf (DM Tools, chases, hazards…): broadcast like a card roll, so they show as a
 *  notification and land in the roll log. Private rolls stay in the GM's browser. */
import OBR from "@owlbear-rodeo/sdk";
import { cryptoRng } from "../core/dice";
import { makeRoll, ROLL_CHANNEL, rollDestination, type RollMessage, type RollVisibility } from "../core/rolls";
import type { RollMode } from "../core/schema";

export async function gmRoll(formula: string, label: string, opts: { unit?: { id: string; name: string }; kind?: RollMessage["kind"]; mode?: RollMode; visibility?: RollVisibility } = {}): Promise<RollMessage> {
  const [name, role] = await Promise.all([OBR.player.getName(), OBR.player.getRole()]);
  const msg = makeRoll(formula, label, { id: OBR.player.id, name, role }, opts.visibility ?? "private", { rng: cryptoRng, unit: opts.unit, kind: opts.kind, mode: opts.mode });
  await OBR.broadcast.sendMessage(ROLL_CHANNEL, msg, { destination: rollDestination(msg) });
  return msg;
}
