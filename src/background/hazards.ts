/**
 * Hazards and traps, primary GM client: sets them off when a unit enters one (the first time on a turn) or starts its
 * turn in one, as the hazard says. Nothing fires for where tokens already are when the page loads.
 */
import OBR, { type Item } from "@owlbear-rodeo/sdk";
import { tokenCells } from "../core/aoe";
import { entered, hazardDef, readHazard } from "../core/hazards";
import type { TrackerUnit } from "../core/tracker";
import { triggerHazard } from "../extension/hazardRun";

let inside = new Map<string, Set<string>>();
let primed = false;
const fired = new Set<string>();
let firedTurn = "";

export async function watchHazards(items: Item[], units: TrackerUnit[], turnKey: string, turnStarted: string | null): Promise<string[]> {
  const hazards = items.filter((i) => readHazard(i.metadata));
  if (!hazards.length) { inside = new Map(); primed = true; return []; }
  const dpi = await OBR.scene.grid.getDpi();
  const cellsOf = async (id: string) => {
    const b = await OBR.scene.items.getItemBounds([id]).catch(() => null);
    return b ? new Set(tokenCells(b, dpi).map((c) => `${c.col},${c.row}`)) : new Set<string>();
  };
  const hazardCells = new Map(await Promise.all(hazards.map(async (h) => [h.id, await cellsOf(h.id)] as const)));
  const now = new Map<string, Set<string>>();
  for (const u of units) {
    if (u.dead) continue;
    const mine = await cellsOf(u.id);
    now.set(u.id, new Set(hazards.filter((h) => [...mine].some((c) => hazardCells.get(h.id)!.has(c))).map((h) => h.id)));
  }
  const before = inside;
  inside = now;
  if (!primed) { primed = true; return []; }
  if (turnKey !== firedTurn) { fired.clear(); firedTurn = turnKey; }
  const lines: string[] = [];
  const fire = async (u: TrackerUnit, h: Item, why: "enter" | "start") => {
    const p = readHazard(h.metadata)!;
    const d = hazardDef(p.key)!;
    if (!p.armed || !d.triggers.includes(why)) return;
    const k = `${u.id}|${h.id}|${why === "start" ? "start" : "enter"}`;
    if (fired.has(k)) return;
    fired.add(k);
    lines.push(await triggerHazard(d, h, u));
  };
  for (const u of units) {
    const was = before.get(u.id) ?? new Set<string>();
    const is = now.get(u.id) ?? new Set<string>();
    for (const id of entered(was, is)) await fire(u, hazards.find((h) => h.id === id)!, "enter");
    // Outside combat, leaving lets the next entry count again.
    if (turnKey === "out") for (const id of was) if (!is.has(id)) fired.delete(`${u.id}|${id}|enter`);
  }
  if (turnStarted) {
    const u = units.find((x) => x.id === turnStarted);
    if (u) for (const id of now.get(u.id) ?? []) await fire(u, hazards.find((h) => h.id === id)!, "start");
  }
  return lines;
}

export function resetHazards() { inside = new Map(); primed = false; fired.clear(); }
