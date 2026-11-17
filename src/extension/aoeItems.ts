/**
 * Area templates as map items (see core/aoe.ts): building one, and reading where each one is now (position,
 * rotation, scale: a template resized with Owlbear's handles changes size accordingly).
 */
import OBR, { buildCurve, buildShape, type Item } from "@owlbear-rodeo/sdk";
import { AOE_KEY, aoeName, coveredCells, outline, readAoe, tokenCells, tokenInArea, type AoeMeta, type Cell, type Placement, type Vec } from "../core/aoe";

const COLOR = "#ff7043";

export function buildTemplate(a: AoeMeta, origin: Vec, dpi: number, feetPerCell: number, attachTo?: string): Item {
  const ppf = dpi / feetPerCell;
  const s = a.size * ppf;
  const meta = { [AOE_KEY]: a };
  const common = <T extends { fillColor(c: string): T; fillOpacity(n: number): T; strokeColor(c: string): T; strokeWidth(n: number): T; strokeOpacity(n: number): T }>(b: T) =>
    b.fillColor(COLOR).fillOpacity(0.12).strokeColor(COLOR).strokeWidth(Math.max(3, dpi * 0.04)).strokeOpacity(0.95);
  if (a.shape === "cone" || a.shape === "line") {
    let b = common(buildCurve()).points(outline(a, ppf)).tension(0).closed(true).position(origin).name(`Area: ${aoeName(a)}`).metadata(meta).layer("DRAWING");
    if (attachTo) b = b.attachedTo(attachTo).disableAttachmentBehavior(["SCALE"]);
    return b.build();
  }
  if (a.shape === "cube") return common(buildShape()).shapeType("RECTANGLE").width(s).height(s).position(origin).name(`Area: ${aoeName(a)}`).metadata(meta).layer("DRAWING").build();
  const r = a.shape === "emanation" ? s + Math.max(a.half?.w ?? 0, a.half?.h ?? 0) : s;
  let b = common(buildShape()).shapeType("CIRCLE").width(r * 2).height(r * 2).position(origin).name(`Area: ${aoeName(a)}`).metadata(meta).layer("DRAWING");
  if (attachTo) b = b.attachedTo(attachTo).disableAttachmentBehavior(["SCALE", "ROTATION"]);
  return b.build();
}

export interface PlacedArea { item: Item; meta: AoeMeta; placement: Placement; cells: Cell[] }

/** Every template in the scene with the squares it affects (square grids only). */
export async function placedAreas(items: Item[]): Promise<{ areas: PlacedArea[]; dpi: number; square: boolean }> {
  const [dpi, scale, type] = await Promise.all([OBR.scene.grid.getDpi(), OBR.scene.grid.getScale(), OBR.scene.grid.getType().catch(() => "SQUARE")]);
  const feetPerCell = scale.parsed?.multiplier || 5;
  const square = type === "SQUARE";
  const areas: PlacedArea[] = [];
  for (const item of items) {
    const m = readAoe(item.metadata);
    if (!m) continue;
    const meta: AoeMeta = { ...m, size: m.size * Math.abs(item.scale.x), ...(m.width ? { width: m.width * Math.abs(item.scale.y) } : {}) };
    const placement: Placement = { origin: item.position, rotation: item.rotation, dpi, feetPerCell };
    areas.push({ item, meta, placement, cells: square ? coveredCells(meta, placement) : [] });
  }
  return { areas, dpi, square };
}

/** The units (Butler tokens) with a square in the area. */
export async function unitsInArea(area: PlacedArea, units: Item[], dpi: number): Promise<string[]> {
  const out: string[] = [];
  for (const u of units) {
    if (u.id === area.meta.unitId) continue;
    const b = await OBR.scene.items.getItemBounds([u.id]).catch(() => null);
    if (b && tokenInArea(area.cells, tokenCells(b, dpi))) out.push(u.id);
  }
  return out;
}

/** Places a template at the view's centre, or on the selected token (the origin of a Cone, Line or Emanation). */
export async function placeTemplate(a: AoeMeta, onUnitId?: string) {
  const [dpi, scale] = await Promise.all([OBR.scene.grid.getDpi(), OBR.scene.grid.getScale()]);
  const fpc = scale.parsed?.multiplier || 5;
  let origin: { x: number; y: number };
  let meta = a;
  let attach: string | undefined;
  const unit = onUnitId ? (await OBR.scene.items.getItems([onUnitId]))[0] : undefined;
  if (unit) {
    const b = await OBR.scene.items.getItemBounds([unit.id]);
    origin = b.center;
    if (a.shape === "emanation") { meta = { ...a, half: { w: b.width / 2, h: b.height / 2 }, unitId: unit.id }; attach = unit.id; }
    // A Cone or Line starts at the edge of the space, pointing right; rotate it with Owlbear's handle.
    if (a.shape === "cone" || a.shape === "line") origin = { x: b.max.x, y: b.center.y };
  } else {
    if (a.shape === "emanation") throw new Error("Select the token the Emanation comes from first.");
    const [w, hgt] = await Promise.all([OBR.viewport.getWidth(), OBR.viewport.getHeight()]);
    const c = await OBR.viewport.inverseTransformPoint({ x: w / 2, y: hgt / 2 });
    // Spheres and Cubes start on a grid intersection, as the DMG suggests.
    origin = a.shape === "cone" || a.shape === "line" ? c : { x: Math.round(c.x / dpi) * dpi, y: Math.round(c.y / dpi) * dpi };
  }
  await OBR.scene.items.addItems([buildTemplate(meta, origin, dpi, fpc, attach)]);
}

