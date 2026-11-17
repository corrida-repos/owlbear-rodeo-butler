/**
 * Cast results (see core/cast.ts): party members' saves to roll (for the player who controls them, or the GM), and
 * the GM's Tracker panel to apply each target's damage.
 */
import OBR from "@owlbear-rodeo/sdk";
import { controls } from "../core/card";
import { CASTS_KEY, readCasts, targetLine, upsertCast, type CastRecord, type CastTarget } from "../core/cast";
import { d20Penalty } from "../core/conditions";
import { cryptoRng, fmtMod } from "../core/dice";
import { makeRoll, ROLL_CHANNEL, rollDestination } from "../core/rolls";
import { ABILITY_NAMES, saveBonus } from "../core/sheet";
import { changeHp, type TrackerUnit } from "../core/tracker";
import { action, h, type Child } from "./dom";
import { obrGateway } from "./obrGateway";
import { sendRequest } from "./requests";
import { roomSettings, roomSystem } from "./roomSettings";

export interface PendingSave { rec: CastRecord; target: CastTarget; unit: TrackerUnit }

/** Saves waiting on `viewer`: a player's own units; the GM, every party member's (to roll for them if needed). */
export function pendingSaves(meta: Record<string, unknown>, units: TrackerUnit[], items: { id: string; createdUserId?: string }[], viewer: { id: string; role: "GM" | "PLAYER" }): PendingSave[] {
  const out: PendingSave[] = [];
  for (const rec of readCasts(meta)) for (const target of rec.targets) {
    if (target.outcome !== "awaiting-save") continue;
    const unit = units.find((u) => u.id === target.id);
    const item = items.find((i) => i.id === target.id);
    if (!unit || !item) continue;
    if (viewer.role === "GM" || controls(viewer, item, unit.state)) out.push({ rec, target, unit });
  }
  return out;
}

/** Rolls the save (public, the unit's save bonus and exhaustion) and sends it to the GM's client. */
export async function rollPendingSave(p: PendingSave, role: "GM" | "PLAYER") {
  const ab = p.rec.ability ?? "dex";
  const bonus = saveBonus(p.unit.sheet, ab) + d20Penalty(roomSystem(), p.unit.state);
  const [name, myRole] = await Promise.all([OBR.player.getName(), OBR.player.getRole()]);
  const msg = makeRoll(`1d20${fmtMod(bonus)}`, `${ABILITY_NAMES[ab]} save · ${p.rec.spell} (DC ${p.rec.dc})`, { id: OBR.player.id, name, role: myRole }, "public",
    { rng: cryptoRng, unit: { id: p.unit.id, name: p.unit.name }, kind: "save" });
  await OBR.broadcast.sendMessage(ROLL_CHANNEL, msg, { destination: rollDestination(msg) });
  await sendRequest({ type: "cast-save", unitId: p.unit.id, castId: p.rec.id, total: msg.total }, role);
}

/** "Saves to roll" box (players' popover and action bar). */
export function pendingSavesBox(list: PendingSave[], role: "GM" | "PLAYER"): Child {
  if (!list.length) return null;
  return h("div", { className: "panel warn small stack tight" }, h("strong", {}, "Saving throws to roll"),
    ...list.map((p) => h("div", { className: "row between" },
      h("span", {}, `${p.unit.name}: DC ${p.rec.dc} ${ABILITY_NAMES[p.rec.ability ?? "dex"]} save against ${p.rec.caster.name}'s ${p.rec.spell}`),
      h("button", { className: "small", onclick: action(() => rollPendingSave(p, role)) }, `Roll (${fmtMod(saveBonus(p.unit.sheet, p.rec.ability ?? "dex"))})`))));
}

const saveAll = async (list: CastRecord[]) => OBR.scene.setMetadata({ [CASTS_KEY]: list.length ? list : undefined });

/** Tracker (GM): each cast's results, to apply damage per target or all at once. */
export function castResultsPanel(units: TrackerUnit[], meta: Record<string, unknown>): Child {
  const casts = readCasts(meta);
  if (!casts.length) return null;
  const apply = (rec: CastRecord, ids: string[]) => action(async () => {
    const opts = { autoDeadAtZero: roomSettings().autoDeadAtZero, system: roomSystem() };
    for (const t of rec.targets) if (ids.includes(t.id) && !t.applied && t.damage > 0) await changeHp(obrGateway, [t.id], { kind: "damage", amount: t.damage }, opts);
    const fresh = readCasts(await OBR.scene.getMetadata());
    const cur = fresh.find((c) => c.id === rec.id) ?? rec;
    await saveAll(upsertCast(fresh, { ...cur, targets: cur.targets.map((t) => (ids.includes(t.id) && t.outcome !== "awaiting-save" ? { ...t, applied: true } : t)) }));
  });
  return h("div", { className: "panel small stack tight" }, h("strong", {}, "Spell and attack results"),
    ...casts.slice().reverse().map((rec) => {
      const ready = rec.targets.filter((t) => !t.applied && t.outcome !== "awaiting-save");
      return h("div", { className: "dm-item", style: "flex-direction:column; align-items:stretch" },
        h("div", { className: "row between" },
          h("span", {}, h("strong", {}, `${rec.caster.name}: ${rec.spell}`), rec.kind === "save" ? ` · DC ${rec.dc} ${ABILITY_NAMES[rec.ability ?? "dex"]}` : ""),
          h("span", { className: "row" },
            ready.some((t) => t.damage > 0) ? h("button", { className: "small", onclick: apply(rec, ready.map((t) => t.id)) }, "Apply all") : null,
            h("button", { className: "icon tiny", title: "Dismiss", onclick: action(async () => saveAll(readCasts(await OBR.scene.getMetadata()).filter((c) => c.id !== rec.id))) }, "✕"))),
        ...rec.targets.map((t) => h("div", { className: "row between" },
          h("span", { className: t.applied ? "muted" : "" }, targetLine(rec, t)),
          t.outcome === "awaiting-save"
            ? h("button", { className: "secondary small", title: "Roll it for them", onclick: action(async () => {
              const u = units.find((x) => x.id === t.id);
              if (u) await rollPendingSave({ rec, target: t, unit: u }, "GM");
            }) }, "Roll for them")
            : !t.applied && t.damage > 0 ? h("button", { className: "secondary small", onclick: apply(rec, [t.id]) }, `Apply ${t.damage}`) : null)));
    }));
}
