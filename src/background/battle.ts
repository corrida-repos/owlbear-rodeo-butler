/**
 * Mass combat on every client: a badge under each battle unit (the GM sees BR and morale; players see only what the
 * unit is doing, plus BR for a unit they command if the GM allows it), and a notice to a player whose unit's turn
 * starts. Local items only.
 */
import OBR, { buildLabel, type Item } from "@owlbear-rodeo/sdk";
import { BUTLER_NS } from "../core/constants";
import { fmtBonus, readBattle, readBattleUnit, unitBrNow, unitMoraleOf, type BattleState, type BattleUnit } from "../core/massCombat";

const BADGE = `${BUTLER_NS}/battle-badge/`;
const shown = new Map<string, string>();
let lastKey: string | null = null;

export function badgeFor(u: BattleUnit, b: BattleState, active: boolean, viewer: { id: string; role: "GM" | "PLAYER" }): string {
  if (u.removed) return "";
  const parts: string[] = [];
  if (active) parts.push("▶ acting");
  const seesNumbers = viewer.role === "GM" || (b.showCommandedBr && u.commandedBy === viewer.id);
  if (seesNumbers) parts.push(`BR ${unitBrNow(u)}`, `morale ${fmtBonus(unitMoraleOf(u))}`);
  if (u.defendUntil !== undefined) parts.push("defending");
  if (u.guardRound !== undefined) parts.push("guarding");
  if (u.shakenRound !== undefined) parts.push("shaken");
  return parts.join(" · ");
}

export async function updateBattle(items: Item[], meta: Record<string, unknown>, role: "GM" | "PLAYER", notify: (text: string) => Promise<unknown>) {
  const b = readBattle(meta);
  const me = { id: OBR.player.id, role };
  const want = new Map<string, { attach: string; text: string }>();
  for (const it of items) {
    const u = readBattleUnit(it.metadata);
    if (!u || (role === "PLAYER" && !it.visible)) continue;
    const text = badgeFor(u, b, b.active && b.turnId === it.id, me);
    if (text) want.set(BADGE + it.id, { attach: it.id, text });
  }
  const stale = [...shown.keys()].filter((id) => !want.has(id));
  if (stale.length) { await OBR.scene.local.deleteItems(stale).catch(() => {}); stale.forEach((id) => shown.delete(id)); }
  const changed = [...want.entries()].filter(([id, w]) => shown.get(id) !== w.text);
  if (changed.length) {
    const dpi = await OBR.scene.grid.getDpi();
    const bounds = await Promise.all(changed.map(([, w]) => OBR.scene.items.getItemBounds([w.attach]).catch(() => null)));
    await OBR.scene.local.deleteItems(changed.map(([id]) => id)).catch(() => {});
    const build = changed.flatMap(([id, w], i) => {
      const bb = bounds[i];
      if (!bb) return [];
      return [buildLabel().id(id).plainText(w.text).position({ x: bb.center.x, y: bb.max.y + dpi * 0.04 }).pointerDirection("UP").pointerHeight(0)
        .fontSize(11).fontWeight(600).padding(3).backgroundColor("#5b3a1e").backgroundOpacity(0.85).fillColor("#ffffff").cornerRadius(4)
        .textAlignVertical("TOP").attachedTo(w.attach).layer("TEXT").locked(true).disableHit(true).build()];
    });
    if (build.length) await OBR.scene.local.addItems(build);
    for (const [id, w] of changed) shown.set(id, w.text);
  }

  // A player's unit starts its turn.
  const key = b.active && b.turnId ? `${b.round}:${b.turnId}` : "";
  const first = lastKey === null;
  if (key === lastKey) return;
  lastKey = key;
  if (first || !key || role !== "PLAYER") return;
  const it = items.find((i) => i.id === b.turnId);
  const u = it ? readBattleUnit(it.metadata) : null;
  if (u?.commandedBy === me.id) await notify(`Your unit acts: ${u.name} (round ${b.round}). Tell the GM where it moves and what it does.`);
}

export function resetBattle() { shown.clear(); lastKey = null; }
