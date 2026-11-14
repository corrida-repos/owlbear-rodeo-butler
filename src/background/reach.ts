/**
 * Reach and range on the map (local, per browser): while someone looks at an action on the action bar, the bands of
 * its reach around the unit (reach, range, long range, an area on itself, how far a cone goes) and a ring on every
 * creature it can reach, coloured by band, so they can see at a glance who's an eligible target.
 * Only the browser that has the action bar open draws it. Players only get rings on tokens they can see.
 */
import OBR, { buildLabel, buildShape, type Item } from "@owlbear-rodeo/sdk";
import { BUTLER_NS } from "../core/constants";
import { BAND_STYLE, bandFor, gridFeet, isAim, showReach, SHOW_REACH_KEY, type Aim, type Measurement } from "../core/reach";
import { store } from "../extension/dom";

const PREFIX = `${BUTLER_NS}/reach/`;
/** The action bar repeats its aim while open; a page that closed without saying so stops being drawn after this. */
const STALE_MS = 6000;

let aim: Aim | null = null;
let aimAt = 0;
let staleTimer: ReturnType<typeof setTimeout> | undefined;
const shown = new Map<string, string>(); // local item id → signature

/** A message from the action bar. Returns true when what's drawn should change. */
export function receiveAim(data: unknown, redraw: () => void): boolean {
  const next = isAim(data) ? data : null;
  const changed = JSON.stringify(next) !== JSON.stringify(aim);
  aim = next;
  aimAt = Date.now();
  clearTimeout(staleTimer);
  if (aim) staleTimer = setTimeout(() => { if (Date.now() - aimAt >= STALE_MS) { aim = null; redraw(); } }, STALE_MS + 100);
  return changed;
}

interface Want { id: string; item: Item; sig: string }

export async function updateReach(items: Item[], role: "GM" | "PLAYER") {
  const unit = aim && showReach(store.get(SHOW_REACH_KEY)) ? items.find((i) => i.id === aim!.unitId) : undefined;
  const want: Want[] = [];
  if (aim && unit) {
    const [dpi, scale, measurement, type] = await Promise.all([
      OBR.scene.grid.getDpi(), OBR.scene.grid.getScale(), OBR.scene.grid.getMeasurement().catch(() => "CHEBYSHEV" as Measurement), OBR.scene.grid.getType().catch(() => "SQUARE"),
    ]);
    const feetPerCell = scale.parsed?.multiplier || 5;
    const others = items.filter((i) => i.id !== unit.id && i.layer === "CHARACTER" && i.type === "IMAGE" && (role === "GM" || i.visible));
    const boxes = new Map(await Promise.all([unit, ...others].map(async (i) => [i.id, await OBR.scene.items.getItemBounds([i.id]).catch(() => null)] as const)));
    const b = boxes.get(unit.id);
    if (b) {
      // The bands: a square on a grid that counts diagonals as one square, else a circle; from the edge of the space.
      const square = measurement === "CHEBYSHEV" && type === "SQUARE";
      const stroke = Math.max(2, dpi * 0.05);
      const bands = [...aim.reach.bands].reverse(); // widest first, so the nearer ones draw on top
      bands.forEach((band, i) => {
        const st = BAND_STYLE[band.kind];
        const extra = (band.feet / feetPerCell) * dpi;
        const w = b.width + extra * 2, h = b.height + extra * 2;
        const r = Math.max(w, h) / 2;
        const id = `${PREFIX}band/${i}`;
        const sig = `${band.kind}|${band.label}|${w.toFixed(1)}|${h.toFixed(1)}|${square}|${unit.id}`;
        let shape = buildShape()
          .id(id).shapeType(square ? "RECTANGLE" : "CIRCLE")
          .width(square ? w : r * 2).height(square ? h : r * 2)
          .position(square ? { x: b.center.x - w / 2, y: b.center.y - h / 2 } : b.center)
          .strokeColor(st.color).strokeWidth(stroke).strokeOpacity(0.9)
          .fillColor(st.color).fillOpacity(band.kind === "area" ? 0.14 : 0.06)
          .attachedTo(unit.id).disableAttachmentBehavior(["SCALE", "ROTATION"])
          .layer("DRAWING").zIndex(10 + bands.length - i).locked(true).disableHit(true);
        if (band.kind === "long" || band.kind === "aim") shape = shape.strokeDash([dpi * 0.25, dpi * 0.15]);
        want.push({ id, item: shape.build(), sig });
        const top = square ? b.center.y - h / 2 : b.center.y - r;
        want.push({ id: `${id}/label`, sig, item: buildLabel()
          .id(`${id}/label`).plainText(i === bands.length - 1 ? `${aim!.name} · ${band.label}` : band.label)
          .position({ x: b.center.x, y: top }).pointerDirection("DOWN").pointerHeight(0)
          .fontSize(11).fontWeight(700).padding(3)
          .backgroundColor(st.color).backgroundOpacity(0.85).fillColor("#ffffff").cornerRadius(3)
          .attachedTo(unit.id).disableAttachmentBehavior(["SCALE", "ROTATION"])
          .layer("DRAWING").zIndex(30).locked(true).disableHit(true).build() });
      });
      if (aim.reach.note) {
        const extra = ((aim.reach.bands.at(-1)?.feet ?? 0) / feetPerCell) * dpi;
        const bottom = b.center.y + Math.max(b.width, b.height) / 2 + extra;
        const sig = `${aim.reach.note}|${bottom.toFixed(1)}`;
        want.push({ id: `${PREFIX}note`, sig, item: buildLabel()
          .id(`${PREFIX}note`).plainText(aim.reach.note)
          .position({ x: b.center.x, y: bottom }).pointerDirection("UP").pointerHeight(0)
          .fontSize(10).fontWeight(600).padding(3)
          .backgroundColor("#37474f").backgroundOpacity(0.85).fillColor("#ffffff").cornerRadius(3)
          .attachedTo(unit.id).disableAttachmentBehavior(["SCALE", "ROTATION"])
          .layer("DRAWING").zIndex(30).locked(true).disableHit(true).build() });
      }
      // Each creature it reaches: a ring in the colour of the nearest band that reaches it.
      for (const o of others) {
        const ob = boxes.get(o.id);
        if (!ob) continue;
        const feet = gridFeet(b, ob, dpi, feetPerCell, measurement as Measurement);
        const band = bandFor(aim.reach, feet);
        if (!band) continue;
        const st = BAND_STYLE[band.kind];
        const r = Math.max(ob.width, ob.height) / 2 + dpi * 0.08;
        const id = `${PREFIX}target/${o.id}`;
        const sig = `${band.kind}|${r.toFixed(1)}|${feet}`;
        let ring = buildShape()
          .id(id).shapeType("CIRCLE").width(r * 2).height(r * 2).position(ob.center)
          .strokeColor(st.color).strokeWidth(Math.max(3, dpi * 0.08)).strokeOpacity(1)
          .fillColor(st.color).fillOpacity(0.12)
          .attachedTo(o.id).disableAttachmentBehavior(["SCALE", "ROTATION"])
          .layer("DRAWING").zIndex(20).locked(true).disableHit(true);
        if (band.kind === "aim" || band.kind === "long") ring = ring.strokeDash([dpi * 0.15, dpi * 0.1]);
        want.push({ id, item: ring.build(), sig });
        want.push({ id: `${id}/label`, sig, item: buildLabel()
          .id(`${id}/label`).plainText(`${feet} ft · ${st.target}`)
          .position({ x: ob.center.x, y: ob.center.y + r }).pointerDirection("UP").pointerHeight(0)
          .fontSize(9).fontWeight(600).padding(2)
          .backgroundColor(st.color).backgroundOpacity(0.85).fillColor("#ffffff").cornerRadius(3)
          .attachedTo(o.id).disableAttachmentBehavior(["SCALE", "ROTATION"])
          .layer("DRAWING").zIndex(31).locked(true).disableHit(true).build() });
      }
    }
  }

  const wantIds = new Set(want.map((w) => w.id));
  const stale = [...shown.keys()].filter((id) => !wantIds.has(id));
  const changed = want.filter((w) => shown.get(w.id) !== w.sig);
  const remove = [...stale, ...changed.map((w) => w.id).filter((id) => shown.has(id))];
  if (remove.length) { await OBR.scene.local.deleteItems(remove).catch(() => {}); remove.forEach((id) => shown.delete(id)); }
  if (!changed.length) return;
  await OBR.scene.local.addItems(changed.map((w) => w.item));
  for (const w of changed) shown.set(w.id, w.sig);
}

export function resetReach() { shown.clear(); }
