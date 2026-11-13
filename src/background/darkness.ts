/**
 * Darkness fog (local, per browser, part of the Vision HUD): in a dark or dim scene, a player's map is covered with black where none of their
 * units can see, and a haze where it's only lightly obscured. Their units' senses and every visible light cut through.
 * Drawn above tokens and labels (so a monster in the dark stays hidden) but below rulers. Shown only while this browser's
 * Vision HUD is on, or for players when the GM forces it. The GM's is see-through and shows what the party sees.
 */
import OBR, { buildPath, type Item } from "@owlbear-rodeo/sdk";
import { controls } from "../core/card";
import { darknessGrid, DARKNESS_ID, fogRects, rectCommands, type Area, type Emitter, type Viewer } from "../core/darkness";
import type { TrackerUnit } from "../core/tracker";
import { HUD_KEY, hudOn, readForcedFog, readSceneLight, resolveLight, sensesOf } from "../core/vision";
import { store } from "../extension/dom";

const LAYERS = [{ id: `${DARKNESS_ID}/heavy`, level: 2 as const }, { id: `${DARKNESS_ID}/light`, level: 1 as const }];
const shown = new Map<string, string>(); // local item id → signature

async function clear() {
  if (!shown.size) return;
  await OBR.scene.local.deleteItems([...shown.keys()]).catch(() => {});
  shown.clear();
}

export async function updateDarkness(units: TrackerUnit[], items: Item[], role: "GM" | "PLAYER", sceneMeta: Record<string, unknown>, rules: "2024" | "2014") {
  const scene = readSceneLight(sceneMeta);
  // Only with the Vision HUD on (or, for players, when the GM forces it in this scene). The GM's is see-through.
  const hud = hudOn(store.get(HUD_KEY));
  if (scene === "bright" || !(hud || (role === "PLAYER" && readForcedFog(sceneMeta)))) return clear();
  const preview = role === "GM";

  const byId = new Map(items.map((i) => [i.id, i]));
  // Only what players can see: hidden tokens neither look nor shed light.
  const seen = units.filter((u) => byId.get(u.id)?.visible);
  const me = { id: OBR.player.id, role };
  const mine = role === "PLAYER" ? seen.filter((u) => !u.dead && controls(me, byId.get(u.id)!, u.state)) : [];
  const lookers = mine.length ? mine : seen.filter((u) => !u.dead && u.state.party);
  const shining = seen.flatMap((u) => { const l = resolveLight(u.state.light, rules); return l ? [{ u, l }] : []; });

  const [dpi, scale] = await Promise.all([OBR.scene.grid.getDpi(), OBR.scene.grid.getScale()]);
  const feetPerCell = scale.parsed?.multiplier || 5;
  const need = [...new Set([...lookers, ...shining.map((s) => s.u), ...seen].map((u) => u.id))];
  const bounds = new Map(await Promise.all(need.map(async (id) => [id, await OBR.scene.items.getItemBounds([id]).catch(() => null)] as const)));
  const half = (b: { width: number; height: number }) => Math.max(b.width, b.height) / 2;

  const viewers: Viewer[] = lookers.flatMap((u) => { const b = bounds.get(u.id); return b ? [{ center: b.center, half: half(b), senses: sensesOf(u.sheet) }] : []; });
  const lights: Emitter[] = shining.flatMap(({ u, l }) => { const b = bounds.get(u.id); return b ? [{ center: b.center, half: half(b), bright: l.bright, dim: l.dim }] : []; });

  // The map's extent (every MAP-layer item), grown to take in every unit, with a margin.
  const maps = items.filter((i) => i.layer === "MAP").map((i) => i.id);
  const boxes = [...(maps.length ? [await OBR.scene.items.getItemBounds(maps).catch(() => null)] : []), ...[...bounds.values()]].filter((b) => !!b);
  if (!boxes.length) return clear();
  const margin = maps.length ? dpi : dpi * 20;
  const area: Area = {
    minX: Math.min(...boxes.map((b) => b!.min.x)) - margin, minY: Math.min(...boxes.map((b) => b!.min.y)) - margin,
    maxX: Math.max(...boxes.map((b) => b!.max.x)) + margin, maxY: Math.max(...boxes.map((b) => b!.max.y)) + margin,
  };
  const grid = darknessGrid({ scene, area, cell: dpi, feetPerCell, viewers, lights });

  const opacity = { 2: preview ? 0.5 : 1, 1: preview ? 0.22 : 0.5 };
  const add: Item[] = [];
  for (const { id, level } of LAYERS) {
    const commands = rectCommands(fogRects(grid, level));
    const sig = `${opacity[level]}|${JSON.stringify(commands)}`;
    if (shown.get(id) === sig) continue;
    if (!commands.length) { await OBR.scene.local.deleteItems([id]).catch(() => {}); shown.delete(id); continue; }
    if (shown.has(id)) {
      await OBR.scene.local.updateItems([id], (ds) => {
        for (const d of ds as any[]) { d.commands = commands; d.style = { ...d.style, fillOpacity: opacity[level] }; }
      });
    } else {
      add.push(buildPath()
        .id(id)
        .commands(commands as any)
        .fillRule("nonzero")
        .fillColor("#000000").fillOpacity(opacity[level])
        .strokeWidth(0).strokeOpacity(0)
        .position({ x: 0, y: 0 })
        // Above tokens and their labels; zIndex 0 keeps rulers (same layer, drawn later) on top.
        .layer("RULER")
        .zIndex(level === 2 ? 1 : 0)
        .locked(true)
        .disableHit(true)
        .build());
    }
    shown.set(id, sig);
  }
  if (add.length) await OBR.scene.local.addItems(add);
}

export function resetDarkness() { shown.clear(); }
