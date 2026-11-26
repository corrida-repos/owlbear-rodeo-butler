import { martialArmorClass } from "../core/martial";
/**
 * Casts from the action bar, primary GM client (see core/cast.ts): stores the record, rolls creatures' saving throws
 * privately, works out damage with each target's defenses, and records party members' saves when they roll them.
 * Damage waits in the Tracker for the GM to apply.
 */
import OBR from "@owlbear-rodeo/sdk";
import { attackOutcome, CASTS_KEY, damageFor, readCasts, resolveSave, targetLine, upsertCast, type CastRecord } from "../core/cast";
import { applyCast } from "../extension/castApply";
import { d20Penalty } from "../core/conditions";
import { fmtMod } from "../core/dice";
import { ABILITY_NAMES, saveBonus } from "../core/sheet";
import { trackerView, type TrackerUnit } from "../core/tracker";
import { gmRoll } from "../extension/gmRoll";
import { obrGateway } from "../extension/obrGateway";
import { roomSettings, roomSystem } from "../extension/roomSettings";

async function units(): Promise<TrackerUnit[]> {
  const v = trackerView(await obrGateway.getItems(), await OBR.scene.getMetadata());
  return [...v.order, ...v.waiting, ...v.outside];
}

const save = async (rec: CastRecord) => OBR.scene.setMetadata({ [CASTS_KEY]: upsertCast(readCasts(await OBR.scene.getMetadata()), rec) });

/** A new cast: creatures save now (privately), party members get a prompt; damage worked out where it's known. */
export async function receiveCast(rec: CastRecord): Promise<string> {
  const all = await units();
  const unit = (id: string) => all.find((u) => u.id === id);
  let r: CastRecord = { ...rec, targets: rec.targets.map((t) => ({ ...t, party: unit(t.id)?.party ?? t.party, applied: false })) };
  if (r.kind === "save") {
    for (const t of r.targets) {
      const u = unit(t.id);
      if (!u || u.party || t.outcome !== "awaiting-save") continue;
      const bonus = saveBonus(u.sheet, r.ability ?? "dex") + d20Penalty(roomSystem(), u.state);
      const roll = await gmRoll(`1d20${fmtMod(bonus)}`, `${ABILITY_NAMES[r.ability ?? "dex"]} save · ${r.spell} (DC ${r.dc})`, { unit: { id: u.id, name: u.name }, kind: "save" });
      r = resolveSave(r, t.id, roll.total, u.sheet.defenses);
    }
  } else {
    r = { ...r, targets: r.targets.map((t) => {
      const u = unit(t.id);
      // Attack rolls: the hit is decided here, against the target's AC (the caster may not see it).
      const outcome = r.kind === "attack" && t.roll !== undefined && u ? attackOutcome(t.roll, t.natural, martialArmorClass(u.sheet, u.state.conditions)) : t.outcome;
      const resolved = { ...t, outcome, ...(outcome === "miss" ? { rolled: undefined } : {}) };
      const d = damageFor(r, resolved, u?.sheet.defenses);
      return { ...resolved, damage: d.amount, ...(d.notes.length ? { notes: d.notes } : {}) };
    }) };
  }
  const slotNote = r.slotLevel ? ` (level ${r.slotLevel} slot)` : "";
  await save(r);
  if (roomSettings().autoApplyCasts) await applyCast(r, r.targets.map((t) => t.id));
  const waiting = r.targets.filter((t) => t.outcome === "awaiting-save").map((t) => t.name);
  return `${r.caster.name} → ${r.spell}${slotNote}: ${r.targets.filter((t) => t.outcome !== "awaiting-save").map((t) => targetLine(r, t)).join("; ") || "no results yet"}${waiting.length ? `. Waiting for ${waiting.join(", ")} to save.` : ""} ${roomSettings().autoApplyCasts ? "Applied." : "Apply it in the Tracker."}`;
}

/** A party member's save against a cast. */
export async function receiveCastSave(castId: string, unitId: string, total: number): Promise<string | null> {
  const rec = readCasts(await OBR.scene.getMetadata()).find((c) => c.id === castId);
  const t = rec?.targets.find((x) => x.id === unitId);
  if (!rec || !t || t.outcome !== "awaiting-save") return null;
  const u = (await units()).find((x) => x.id === unitId);
  const next = resolveSave(rec, unitId, total, u?.sheet.defenses);
  await save(next);
  if (roomSettings().autoApplyCasts) await applyCast(next, [unitId]);
  return `${rec.spell}: ${targetLine(next, next.targets.find((x) => x.id === unitId)!)}.`;
}
