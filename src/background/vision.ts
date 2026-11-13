/**
 * Light & vision auras (local, per browser): in a dim or dark scene, circles around units for the light they carry
 * (bright and dim) and for their senses (darkvision, blindsight, truesight, Devil's Sight, tremorsense), so the table
 * can see at a glance what is lit, lightly obscured or heavily obscured for each creature.
 *  - Lights are drawn for every unit this browser can see, since a torch lights the room for everyone.
 *  - Senses follow this browser's choice: selected tokens, the party, or every unit. Players only get senses for their
 *    own units and party members (a monster's darkvision is the GM's business).
 */
import OBR, { buildLabel, buildShape, type Item } from "@owlbear-rodeo/sdk";
import { controls } from "../core/card";
import { BUTLER_NS } from "../core/constants";
import type { TrackerUnit } from "../core/tracker";
import {
  lightRings, readAuraScope, readSceneLight, resolveLight, RING_STYLE, senseRings, sensesOf, HUD_KEY, hudOn, AURA_SCOPE_KEY, type Ring,
} from "../core/vision";
import { store } from "../extension/dom";

const PREFIX = `${BUTLER_NS}/vision/`;
const shown = new Map<string, string>(); // local item id → signature

interface Want { id: string; unit: string; ring: Ring }

export async function updateVision(units: TrackerUnit[], items: Item[], role: "GM" | "PLAYER", sceneMeta: Record<string, unknown>,
  selection: string[], rules: "2024" | "2014") {
  const scene = readSceneLight(sceneMeta);
  const on = hudOn(store.get(HUD_KEY)) && scene !== "bright";
  const scope = readAuraScope(store.get(AURA_SCOPE_KEY));
  const byId = new Map(items.map((i) => [i.id, i]));
  const me = { id: OBR.player.id, role };
  const want: Want[] = [];
  if (on) {
    for (const u of units) {
      const it = byId.get(u.id);
      if (!it || (role !== "GM" && !it.visible)) continue;
      for (const ring of lightRings(resolveLight(u.state.light, rules), scene)) want.push({ id: `${PREFIX}${u.id}/${ring.kind}`, unit: u.id, ring });
      const allowed = role === "GM" || u.state.party || controls(me, it, u.state);
      const inScope = scope === "all" || (scope === "party" ? u.state.party || (role !== "GM" && controls(me, it, u.state)) : selection.includes(u.id));
      if (!allowed || !inScope || u.dead) continue;
      for (const ring of senseRings(sensesOf(u.sheet), scene)) want.push({ id: `${PREFIX}${u.id}/${ring.kind}`, unit: u.id, ring });
    }
  }

  const wantIds = new Set(want.flatMap((w) => [w.id, `${w.id}/label`]));
  const stale = [...shown.keys()].filter((id) => !wantIds.has(id));
  if (stale.length) { await OBR.scene.local.deleteItems(stale).catch(() => {}); stale.forEach((id) => shown.delete(id)); }
  if (!want.length) return;

  const [dpi, scale] = await Promise.all([OBR.scene.grid.getDpi(), OBR.scene.grid.getScale()]);
  const feetPerCell = scale.parsed?.multiplier || 5;
  const unitIds = [...new Set(want.map((w) => w.unit))];
  const bounds = new Map(await Promise.all(unitIds.map(async (id) => [id, await OBR.scene.items.getItemBounds([id]).catch(() => null)] as const)));

  const build: Item[] = [];
  const replaced: string[] = [];
  const sigs: [string, string][] = [];
  for (const w of want) {
    const b = bounds.get(w.unit);
    if (!b) continue;
    // Ranges are measured from the edge of the creature's space.
    const r = (w.ring.feet / feetPerCell) * dpi + Math.max(b.width, b.height) / 2;
    // Attached items follow the token, so only a new size or label needs a redraw.
    const sig = `${r.toFixed(1)}|${w.ring.label}`;
    if (shown.get(w.id) === sig && shown.get(`${w.id}/label`) === sig) continue;
    const st = RING_STYLE[w.ring.kind];
    const stroke = Math.max(2, dpi * 0.04);
    let shape = buildShape()
      .id(w.id)
      .shapeType("CIRCLE")
      .width(r * 2).height(r * 2)
      .position(b.center)
      .strokeColor(st.color).strokeWidth(stroke).strokeOpacity(0.85)
      .fillColor(st.color).fillOpacity(st.fill)
      .attachedTo(w.unit)
      .disableAttachmentBehavior(["SCALE", "ROTATION"])
      .layer("DRAWING")
      .zIndex(st.fill ? (w.ring.kind === "bright" ? 2 : 1) : 3)
      .locked(true)
      .disableHit(true);
    if (st.dash) shape = shape.strokeDash([dpi * 0.2, dpi * 0.12]);
    const label = buildLabel()
      .id(`${w.id}/label`)
      .plainText(w.ring.label)
      .position({ x: b.center.x, y: b.center.y - r })
      .pointerDirection("DOWN").pointerHeight(0)
      .fontSize(10).fontWeight(600).padding(2)
      .backgroundColor(st.color).backgroundOpacity(0.75)
      .fillColor("#ffffff").cornerRadius(3)
      .attachedTo(w.unit)
      .disableAttachmentBehavior(["SCALE", "ROTATION"])
      .layer("DRAWING")
      .locked(true)
      .disableHit(true)
      .build();
    build.push(shape.build(), label);
    replaced.push(w.id, `${w.id}/label`);
    sigs.push([w.id, sig], [`${w.id}/label`, sig]);
  }
  if (!build.length) return;
  await OBR.scene.local.deleteItems(replaced).catch(() => {});
  await OBR.scene.local.addItems(build);
  for (const [id, sig] of sigs) shown.set(id, sig);
}

export function resetVision() { shown.clear(); }
