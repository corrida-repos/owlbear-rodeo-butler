/**
 * "DM Tools" tab (GM): the 2024 DMG's combat tools that aren't tied to one unit: mob rolls, fight or flight, objects,
 * chases, hazards and traps, and area templates. Each tool is its own panel module; this file reads the scene.
 */
import OBR from "@owlbear-rodeo/sdk";
import { trackerView, type TrackerView } from "../core/tracker";
import { h, rerender, type Child } from "./dom";
import { mobPanel } from "./mobPanel";
import { moralePanel } from "./moralePanel";
import { objectsPanel } from "./objectsPanel";
import { chasePanel } from "./chasePanel";
import { aoePanel, refreshAreas } from "./aoePanel";
import { hazardsPanel, refreshHazards } from "./hazardsPanel";
import { obrGateway } from "./obrGateway";

let view: TrackerView | null = null;
let sceneMeta: Record<string, unknown> = {};
let timer: ReturnType<typeof setTimeout> | null = null;
let pending = false;

export const dmScene = () => ({ view, sceneMeta });

export function refreshDmTab(immediate = false) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(async () => {
    try { sceneMeta = await OBR.scene.getMetadata(); view = trackerView(await obrGateway.getItems(), sceneMeta); await refreshAreas(); await refreshHazards(); } catch { return; }
    const a = document.activeElement;
    if (a && a.closest("#app") && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName) && (a as HTMLInputElement).type !== "checkbox") { pending = true; return; }
    rerender();
  }, immediate ? 0 : 150);
}
document.addEventListener("focusout", () => { if (pending) { pending = false; setTimeout(rerender, 0); } });
export function resetDmTab() { view = null; }

export function renderDmTab(): Child[] {
  if (!view) { refreshDmTab(true); return [h("div", { className: "panel small muted" }, "Reading the scene…")]; }
  const units = [...view.order, ...view.waiting, ...view.outside];
  return [moralePanel(units, sceneMeta), chasePanel(units, sceneMeta, view.encounter.started), aoePanel(units), hazardsPanel(units), mobPanel(units), objectsPanel(sceneMeta)];
}
