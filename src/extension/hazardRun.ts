/**
 * Hazards and traps on the map (see core/hazards.ts): placing one, and setting one off on a unit (rolls its save,
 * rolls and applies the damage, adds the conditions). Used by the background page (automatic triggers) and DM Tools
 * (placing, manual triggers).
 */
import OBR, { buildImage, type Item } from "@owlbear-rodeo/sdk";
import { addCondition, type TurnPoint } from "../core/conditions";
import { fmtMod } from "../core/dice";
import { HAZARD_KEY, resolveHazard, type HazardDef, type PlacedHazard } from "../core/hazards";
import { readEncounter } from "../core/encounter";
import { saveBonus, STATE_KEY, ABILITY_NAMES } from "../core/sheet";
import { changeHp, trackerView, type TrackerUnit } from "../core/tracker";
import { gmRoll } from "./gmRoll";
import { obrGateway } from "./obrGateway";
import { roomSettings, roomSystem } from "./roomSettings";

const PX = 256;

/** Places a hazard's picture at the view's centre, covering its area; traps start hidden from players. */
export async function placeHazard(d: HazardDef, hidden: boolean) {
  const [dpi, w, hgt] = await Promise.all([OBR.scene.grid.getDpi(), OBR.viewport.getWidth(), OBR.viewport.getHeight()]);
  const c = await OBR.viewport.inverseTransformPoint({ x: w / 2, y: hgt / 2 });
  // Centre on a square (odd sizes) or an intersection (even sizes).
  const snap = (v: number) => (d.cells % 2 ? (Math.floor(v / dpi) + 0.5) * dpi : Math.round(v / dpi) * dpi);
  const url = new URL(`hazards/${d.image}`, location.href).href;
  const item = buildImage({ width: PX, height: PX, url, mime: "image/png" }, { dpi: PX / d.cells, offset: { x: PX / 2, y: PX / 2 } })
    .position({ x: snap(c.x), y: snap(c.y) }).layer("PROP").name(`${d.kind === "trap" ? "Trap" : "Hazard"}: ${d.name}`)
    .visible(!hidden).metadata({ [HAZARD_KEY]: { key: d.key, armed: true } satisfies PlacedHazard }).build();
  await OBR.scene.items.addItems([item]);
}

/** Sets off `d` on `unit`: save, damage, conditions. A one-shot trap is spent and revealed. Returns the GM's line. */
export async function triggerHazard(d: HazardDef, hazardItem: Item | null, unit: TrackerUnit): Promise<string> {
  const vis = "private" as const;
  const who = { id: unit.id, name: unit.name };
  let saveTotal: number | null = null;
  if (d.save) saveTotal = (await gmRoll(`1d20${fmtMod(saveBonus(unit.sheet, d.save.ability))}`, `${ABILITY_NAMES[d.save.ability]} save · ${d.name} (DC ${d.save.dc})`, { unit: who, kind: "save", visibility: vis })).total;
  const failed = !d.save || saveTotal === null || saveTotal < d.save.dc;
  const rolled: number[] = [];
  if (d.damage && (failed || d.half)) {
    const times = d.times ? (await gmRoll(d.times, `${d.name}: how many hit`, { unit: who, kind: "dice", visibility: vis })).total : 1;
    for (const dm of d.damage) {
      let sum = 0;
      for (let i = 0; i < times; i++) sum += (await gmRoll(dm.formula, `${dm.type} damage · ${d.name}`, { unit: who, kind: "damage", visibility: vis })).total;
      rolled.push(sum);
    }
  }
  const out = resolveHazard(d, unit.name, saveTotal, rolled, unit.sheet.defenses);
  if (out.damage) await changeHp(obrGateway, [unit.id], { kind: "damage", amount: out.damage }, { autoDeadAtZero: roomSettings().autoDeadAtZero, system: roomSystem() });
  if (out.conditions.length) {
    const meta = await OBR.scene.getMetadata();
    const enc = readEncounter(meta);
    const now: TurnPoint | null = enc.started && enc.turnId ? { round: enc.round, turnId: enc.turnId } : null;
    const fresh = trackerView(await obrGateway.getItems(), meta);
    const u = [...fresh.order, ...fresh.waiting, ...fresh.outside].find((x) => x.id === unit.id) ?? unit;
    let state = u.state;
    for (const c of out.conditions) {
      state = { ...state, ...addCondition(state, c.key, { ...(c.label ? { label: c.label } : {}), ...(c.note ? { note: c.note } : {}),
        ...(c.rounds && now ? { duration: { kind: "rounds" as const, rounds: c.rounds }, now } : {}) }) };
    }
    await obrGateway.patchMetadata([{ id: unit.id, key: STATE_KEY, patch: { conditions: state.conditions } }]);
  }
  if (d.once && hazardItem) {
    await OBR.scene.items.updateItems([hazardItem.id], (ds) => { for (const x of ds) { x.metadata[HAZARD_KEY] = { key: d.key, armed: false }; x.visible = true; } });
  }
  return out.text;
}
