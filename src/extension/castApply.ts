/**
 * Applying a cast's results (see core/cast.ts): each target's damage and the spell's conditions (on a failed save, a
 * hit, or always), then the record marked applied. Used by the Tracker's Apply buttons and by the GM's client when
 * the room applies casts automatically.
 */
import OBR from "@owlbear-rodeo/sdk";
import { CASTS_KEY, givesConditions, readCasts, upsertCast, type CastCondition, type CastRecord } from "../core/cast";
import { addCondition, type Duration, type TurnPoint } from "../core/conditions";
import { readEncounter } from "../core/encounter";
import { STATE_KEY } from "../core/sheet";
import { changeHp, trackerView } from "../core/tracker";
import { obrGateway } from "./obrGateway";
import { roomSettings, roomSystem } from "./roomSettings";

function durationOf(c: CastCondition, casterId: string, targetId: string): Duration {
  if (c.until === "caster-end") return { kind: "turn", turnOf: casterId, at: "end" };
  if (c.until === "caster-start") return { kind: "turn", turnOf: casterId, at: "start" };
  if (c.until === "target-end") return { kind: "turn", turnOf: targetId, at: "end" };
  if (c.rounds) return { kind: "rounds", rounds: c.rounds };
  return { kind: "none" };
}

/** Applies damage and conditions to the given targets of a cast (those resolved and not yet applied). Returns lines. */
export async function applyCast(rec: CastRecord, ids: string[]): Promise<string[]> {
  const lines: string[] = [];
  const opts = { autoDeadAtZero: roomSettings().autoDeadAtZero, system: roomSystem() };
  const todo = rec.targets.filter((t) => ids.includes(t.id) && !t.applied && t.outcome !== "awaiting-save");
  for (const t of todo) if (t.damage > 0) { await changeHp(obrGateway, [t.id], { kind: "damage", amount: t.damage }, opts); lines.push(`${t.name} takes ${t.damage} damage.`); }
  const conds = rec.conditions ?? [];
  const takers = todo.filter((t) => givesConditions(t.outcome));
  if (conds.length && takers.length) {
    const meta = await OBR.scene.getMetadata();
    const enc = readEncounter(meta);
    const now: TurnPoint | null = enc.started && enc.turnId ? { round: enc.round, turnId: enc.turnId } : null;
    const v = trackerView(await obrGateway.getItems(), meta);
    const all = [...v.order, ...v.waiting, ...v.outside];
    const patches = takers.flatMap((t) => {
      const u = all.find((x) => x.id === t.id);
      if (!u) return [];
      let state = u.state;
      for (const c of conds) {
        if (u.sheet.defenses.conditionImmune && new RegExp(`\\b${c.key}\\b`, "i").test(u.sheet.defenses.conditionImmune)) continue;
        const d = durationOf(c, rec.caster.id, t.id);
        state = { ...state, ...addCondition(state, c.key, { note: `${rec.spell} (${rec.caster.name})`, ...(d.kind !== "none" && now ? { duration: d, now } : {}) }) };
      }
      lines.push(`${t.name}: ${conds.map((c) => c.key[0]!.toUpperCase() + c.key.slice(1)).join(", ")}.`);
      return [{ id: t.id, key: STATE_KEY, patch: { conditions: state.conditions } }];
    });
    if (patches.length) await obrGateway.patchMetadata(patches);
  }
  const fresh = readCasts(await OBR.scene.getMetadata());
  const cur = fresh.find((c) => c.id === rec.id) ?? rec;
  await OBR.scene.setMetadata({ [CASTS_KEY]: upsertCast(fresh, { ...cur, targets: cur.targets.map((t) => (todo.some((x) => x.id === t.id) ? { ...t, applied: true } : t)) }) });
  return lines;
}
