/**
 * Local (per-client) overlays on the map: condition badges under each unit (plus situational notes such as a
 * grappler's "+2 AC"), and the active unit's movement label.
 * Local items are only drawn for this client, so players get badges for visible tokens only.
 */
import OBR, { buildLabel, type Item } from "@owlbear-rodeo/sdk";
import { badgeText } from "../core/conditions";
import { BUTLER_NS } from "../core/constants";
import type { TrackerUnit } from "../core/tracker";
import { displayConditions, type GameSystem } from "../core/systems";

const BADGE = `${BUTLER_NS}/badge/`;
const MOVE = `${BUTLER_NS}/move-label`;

interface Want { id: string; attach: string; text: string; color: string; below: boolean }
const shown = new Map<string, string>(); // local item id → "text|color"

export async function updateOverlays(units: TrackerUnit[], items: Item[], role: "GM" | "PLAYER", system: GameSystem,
  movement: { unitId: string; text: string; over: boolean } | null, extra: Map<string, string[]> = new Map()) {
  const visible = new Set(items.filter((i) => role === "GM" || i.visible).map((i) => i.id));
  const want: Want[] = [];
  for (const u of units) {
    if (!visible.has(u.id)) continue;
    const labels = [...displayConditions(system, u.sheet, u.state).map((c) => `${c.label}${c.level ? ` ${c.level}` : ""}`), ...(extra.get(u.id) ?? [])];
    const text = badgeText(labels);
    if (text) want.push({ id: BADGE + u.id, attach: u.id, text, color: labels.includes("Dead") ? "#555555" : "#3a2f6b", below: true });
  }
  if (movement && visible.has(movement.unitId)) want.push({ id: MOVE, attach: movement.unitId, text: movement.text, color: movement.over ? "#c62828" : "#1f6f43", below: false });

  const wantIds = new Set(want.map((w) => w.id));
  const stale = [...shown.keys()].filter((id) => !wantIds.has(id));
  if (stale.length) { await OBR.scene.local.deleteItems(stale).catch(() => {}); stale.forEach((id) => shown.delete(id)); }

  const changed = want.filter((w) => shown.get(w.id) !== `${w.text}|${w.color}`);
  if (!changed.length) return;
  const dpi = await OBR.scene.grid.getDpi();
  const bounds = await Promise.all(changed.map((w) => OBR.scene.items.getItemBounds([w.attach]).catch(() => null)));
  await OBR.scene.local.deleteItems(changed.map((w) => w.id)).catch(() => {});
  const build = changed.flatMap((w, i) => {
    const b = bounds[i];
    if (!b) return [];
    return [buildLabel()
      .id(w.id)
      .plainText(w.text)
      .position({ x: b.center.x, y: w.below ? b.max.y + dpi * 0.12 : b.min.y - dpi * 0.04 })
      // The position is the label's pointer tip: "UP" puts the label below that point, "DOWN" above it.
      .pointerDirection(w.below ? "UP" : "DOWN")
      .pointerHeight(0)
      // Labels are drawn at a fixed screen size (they don't scale with zoom), so sizes are in screen pixels.
      .fontSize(11)
      .fontWeight(600)
      .padding(3)
      .backgroundColor(w.color).backgroundOpacity(0.85)
      .fillColor("#ffffff")
      .cornerRadius(4)
      .textAlignVertical(w.below ? "TOP" : "BOTTOM")
      .attachedTo(w.attach)
      .layer("TEXT")
      .locked(true)
      .disableHit(true)
      .build()];
  });
  if (build.length) await OBR.scene.local.addItems(build);
  for (const w of changed) shown.set(w.id, `${w.text}|${w.color}`);
}

export function resetOverlays() { shown.clear(); }
