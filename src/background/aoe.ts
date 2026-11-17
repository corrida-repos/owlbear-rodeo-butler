/**
 * Area templates: every client highlights, locally, the squares each template covers by at least half (2024 DMG).
 */
import OBR, { buildPath, type Item } from "@owlbear-rodeo/sdk";
import { BUTLER_NS } from "../core/constants";
import { rectCommands, type Rect } from "../core/darkness";
import { placedAreas } from "../extension/aoeItems";

const PREFIX = `${BUTLER_NS}/aoe-cells/`;
const shown = new Map<string, string>();

export async function updateAreas(items: Item[]) {
  const { areas, dpi, square } = await placedAreas(items);
  const want = new Map<string, { sig: string; item: Item }>();
  if (square) for (const a of areas) {
    if (!a.cells.length) continue;
    const rects: Rect[] = a.cells.map((c) => ({ x: c.col * dpi, y: c.row * dpi, w: dpi, h: dpi }));
    const commands = rectCommands(rects);
    const id = `${PREFIX}${a.item.id}`;
    want.set(id, { sig: JSON.stringify(commands), item: buildPath().id(id).commands(commands as any).fillRule("nonzero")
      .fillColor("#ff7043").fillOpacity(0.28).strokeColor("#ff7043").strokeWidth(Math.max(1, dpi * 0.015)).strokeOpacity(0.6)
      .position({ x: 0, y: 0 }).layer("DRAWING").zIndex(0).locked(true).disableHit(true).build() });
  }
  const remove = [...shown.keys()].filter((id) => !want.has(id) || want.get(id)!.sig !== shown.get(id));
  if (remove.length) { await OBR.scene.local.deleteItems(remove).catch(() => {}); remove.forEach((id) => shown.delete(id)); }
  const add = [...want].filter(([id]) => !shown.has(id));
  if (add.length) { await OBR.scene.local.addItems(add.map(([, w]) => w.item)); for (const [id, w] of add) shown.set(id, w.sig); }
}

export function resetAreas() { shown.clear(); }
