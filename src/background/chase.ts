/**
 * Chase mode, run by the primary GM client on each forward turn change (see core/chase.ts for the rules):
 * the Dash budget and complication for the participant whose turn ended, then the count-0 escape checks when the
 * round wraps. Returns lines for the GM's notifications; everything also goes in the chase log.
 */
import OBR from "@owlbear-rodeo/sdk";
import {
  CHASE_KEY, complicationFor, DASH_SAVE_DC, DROP_OUT_EXHAUSTION, escapes, failText, freeDashes, nextParticipant, participants, readChase, withLog,
  type ChaseState,
} from "../core/chase";
import { skillBonus } from "../core/combatOptions";
import { damageAgainst, immuneToCondition } from "../core/defenses";
import { addCondition, exhaustionLevel, type TurnPoint } from "../core/conditions";
import { fmtMod } from "../core/dice";
import type { MovementState } from "../core/movement";
import { abilityMod, ABILITY_NAMES, saveBonus, STATE_KEY } from "../core/sheet";
import { changeHp, trackerView, type TrackerUnit } from "../core/tracker";
import { gmRoll } from "../extension/gmRoll";
import { obrGateway } from "../extension/obrGateway";
import { roomSettings, roomSystem } from "../extension/roomSettings";

const passive = (u: TrackerUnit) => u.sheet.passivePerception ?? 10 + skillBonus(u.sheet, "Perception", "wis");

export async function chaseTurnEnded(ended: TurnPoint, next: TurnPoint, prevMovement: MovementState | null): Promise<string[]> {
  let c = readChase(await OBR.scene.getMetadata());
  if (!c.active) return [];
  const view = trackerView(await obrGateway.getItems(), await OBR.scene.getMetadata());
  const units = [...view.order, ...view.waiting, ...view.outside];
  const unit = (id: string) => units.find((u) => u.id === id);
  const order = view.order.map((u) => u.id);
  const vis = c.publicRolls ? "public" as const : "private" as const;
  const lines: string[] = [];
  const say = (line: string) => { lines.push(line); c = withLog(c, line); };
  const me = unit(ended.turnId);

  if (me && participants(c).includes(me.id)) {
    // Dashing: count it; past the free ones, a DC 10 Constitution save or 1 Exhaustion level.
    if (prevMovement?.unitId === me.id && prevMovement.dash) {
      const n = (c.dashes[me.id] ?? 0) + 1;
      c = { ...c, dashes: { ...c.dashes, [me.id]: n } };
      const free = freeDashes(abilityMod(me.sheet.abilities.con));
      if (n > free) {
        const r = await gmRoll(`1d20${fmtMod(saveBonus(me.sheet, "con"))}`, `Constitution save · extra Dash in the chase (DC ${DASH_SAVE_DC})`, { unit: { id: me.id, name: me.name }, kind: "save", visibility: vis });
        if (r.total >= DASH_SAVE_DC) say(`${me.name} pushed through Dash ${n} (${free} free): Constitution save ${r.total}, no Exhaustion.`);
        else {
          const level = exhaustionLevel(me.state) + 1;
          await obrGateway.patchMetadata([{ id: me.id, key: STATE_KEY, patch: addCondition(me.state, "exhaustion", { level }) }]);
          say(`${me.name} Dashed past its limit (${n} of ${free}): Constitution save ${r.total} fails, Exhaustion ${level}.`);
          if (level >= DROP_OUT_EXHAUSTION) { c = { ...c, out: [...c.out, me.id] }; say(`${me.name} has ${level} Exhaustion levels and drops out of the chase.`); }
        }
      }
    }
    // Complication: 1d12 at the end of its turn; it affects the next participant.
    const d12 = await gmRoll("1d12", `Chase complication (${c.env === "urban" ? "Urban" : "Wilderness"})`, { unit: { id: me.id, name: me.name }, kind: "dice", visibility: vis });
    const comp = complicationFor(c.env, d12.total);
    const targetId = comp ? nextParticipant(order, c, me.id) : null;
    const target = targetId ? unit(targetId) : undefined;
    if (comp && target) {
      let failed = true;
      let saveText = "";
      if (comp.save) {
        const best = [...comp.save.abilities].sort((a, b) => saveBonus(target.sheet, b) - saveBonus(target.sheet, a))[0]!;
        const r = await gmRoll(`1d20${fmtMod(saveBonus(target.sheet, best))}`, `${ABILITY_NAMES[best]} save · chase complication (DC ${comp.save.dc})`, { unit: { id: target.id, name: target.name }, kind: "save", visibility: vis });
        failed = r.total < comp.save.dc;
        saveText = ` ${ABILITY_NAMES[best]} save ${r.total} vs DC ${comp.save.dc}: ${failed ? "fails" : "succeeds"}.`;
      }
      let dmg: number | undefined;
      let defNote = "";
      const skipped: string[] = [];
      if (failed) {
        if (comp.fail.damage) {
          const raw = (await gmRoll(comp.fail.damage, `${comp.fail.damageType ?? ""} damage · chase complication`.trim(), { unit: { id: target.id, name: target.name }, kind: "damage", visibility: vis })).total;
          // The target's Resistances, Vulnerabilities and Immunities (see core/defenses.ts).
          const adj = damageAgainst(target.sheet.defenses, raw, comp.fail.damageType ?? "");
          dmg = adj.amount;
          if (adj.note) defNote = ` (${adj.note})`;
          await changeHp(obrGateway, [target.id], { kind: "damage", amount: dmg }, { autoDeadAtZero: roomSettings().autoDeadAtZero, system: roomSystem() });
        }
        const fresh = trackerView(await obrGateway.getItems(), await OBR.scene.getMetadata());
        const t = [...fresh.order, ...fresh.waiting, ...fresh.outside].find((u) => u.id === target.id) ?? target;
        let state = t.state;
        if (comp.fail.prone) { if (immuneToCondition(target.sheet.defenses, "prone")) skipped.push("Prone"); else state = { ...state, ...addCondition(state, "prone") }; }
        if (comp.fail.blindedThisTurn && immuneToCondition(target.sheet.defenses, "blinded")) skipped.push("Blinded");
        else if (comp.fail.blindedThisTurn) state = { ...state, ...addCondition(state, "blinded", { duration: { kind: "turn", turnOf: target.id, at: "end" }, now: ended, note: "chase: Speed halved while Blinded this way" }) };
        if (state !== t.state) await obrGateway.patchMetadata([{ id: target.id, key: STATE_KEY, patch: { conditions: state.conditions } }]);
      }
      say(`Chase (d12 ${d12.total}, after ${me.name}): ${comp.text} ${target.name} is affected.${saveText}${failed ? ` ${target.name} ${failText(comp, dmg)}${defNote}.${skipped.length ? ` Immune to ${skipped.join(", ")}.` : ""}` : ""}`);
    } else if (comp) say(`Chase (d12 ${d12.total}): ${comp.text} Nobody after ${me.name} to affect.`);
  }

  // Initiative count 0: each quarry tries to slip away.
  if (next.round > ended.round) {
    const pursuers = c.pursuers.filter((id) => !c.out.includes(id)).map(unit).filter((u): u is TrackerUnit => !!u && !u.dead);
    const dc = Math.max(0, ...pursuers.map(passive));
    for (const id of c.quarry.filter((q) => !c.escaped.includes(q) && !c.out.includes(q))) {
      const q = unit(id);
      if (!q || q.dead) continue;
      const sight = c.inSight.includes(id);
      const mode = c.escapeFactor === "normal" ? undefined : c.escapeFactor;
      const r = await gmRoll(`1d20${fmtMod(skillBonus(q.sheet, "Stealth", "dex"))}`, `Stealth · escape the chase (vs Passive Perception ${dc})`, { unit: { id: q.id, name: q.name }, kind: "check", mode, visibility: vis });
      if (escapes(r.total, pursuers.map(passive), sight)) { c = { ...c, escaped: [...c.escaped, id] }; say(`${q.name} escapes! Stealth ${r.total} beats the pursuers' best Passive Perception (${dc}).`); }
      else say(`${q.name} doesn't escape: Stealth ${r.total}${sight ? " (never out of the lead pursuer's sight: automatic failure)" : ` vs Passive Perception ${dc}`}.`);
    }
    const left = c.quarry.filter((q) => !c.escaped.includes(q) && !c.out.includes(q));
    if (!left.length || !pursuers.length) { c = { ...c, active: false }; say(!left.length ? "The chase is over: every quarry escaped or dropped out." : "The chase is over: no pursuers left."); }
  }

  await OBR.scene.setMetadata({ [CHASE_KEY]: c satisfies ChaseState });
  return lines;
}
