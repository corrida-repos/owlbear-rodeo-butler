/**
 * "DM Tools" tab (GM): the 2024 DMG's combat tools that aren't tied to one unit: mob rolls, fight or flight, objects,
 * chases, hazards and traps, area templates, mass combat (UA 2017), and naval and aerial combat. Each tool is its own panel module; this file reads the scene.
 */
import OBR from "@owlbear-rodeo/sdk";
import { trackerView, type TrackerView } from "../core/tracker";
import { h, rerender, type Child } from "./dom";
import { mobPanel } from "./mobPanel";
import { moralePanel } from "./moralePanel";
import { objectsPanel } from "./objectsPanel";
import { chasePanel } from "./chasePanel";
import { sceneGrid } from "./chaseRun";
import { aoePanel, refreshAreas } from "./aoePanel";
import { hazardsPanel, refreshHazards } from "./hazardsPanel";
import { battlePanel, refreshBattle } from "./battlePanel";
import { navalPanel } from "./navalPanel";
import { visionPanel } from "./visionPanel";
import { obrGateway } from "./obrGateway";
import { roomSettings } from "./roomSettings";

let view: TrackerView | null = null;
let sceneMeta: Record<string, unknown> = {};
let grid: { multiplier: number; unit: string } | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let pending = false;

export const dmScene = () => ({ view, sceneMeta });

export function refreshDmTab(immediate = false) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(async () => {
    try { sceneMeta = await OBR.scene.getMetadata(); view = trackerView(await obrGateway.getItems(), sceneMeta); grid = await sceneGrid(); await refreshAreas(); await refreshHazards(); await refreshBattle(); } catch { return; }
    const a = document.activeElement;
    if (a && a.closest("#app") && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName) && (a as HTMLInputElement).type !== "checkbox") { pending = true; return; }
    rerender();
  }, immediate ? 0 : 150);
}
document.addEventListener("focusout", () => { if (pending) { pending = false; setTimeout(rerender, 0); } });
export function resetDmTab() { view = null; }

const openTools = new Map<string, boolean>();

function toolPanel(key: string, panel: Child): Child {
  if (!(panel instanceof HTMLDetailsElement)) return panel;
  panel.open = openTools.get(key) ?? panel.open;
  const initialOpen = panel.open;
  panel.addEventListener("toggle", () => {
    if (panel.isConnected && (panel.open !== initialOpen || openTools.has(key))) openTools.set(key, panel.open);
  });
  return panel;
}

export function renderDmTab(): Child[] {
  if (!view) { refreshDmTab(true); return [h("div", { className: "panel small muted" }, "Reading the scene…")]; }
  const units = [...view.order, ...view.waiting, ...view.outside];
  return [
    h("section", { className: "stack", "aria-labelledby": "map-tools" },
      h("h2", { id: "map-tools" }, "Map tools"),
      toolPanel("areas", aoePanel(units)),
      toolPanel("hazards", hazardsPanel(units)),
      toolPanel("vision", visionPanel("GM", rerender, units)),
      toolPanel("objects", objectsPanel(sceneMeta))),
    h("section", { className: "stack", "aria-labelledby": "rules-tools" },
      h("h2", { id: "rules-tools" }, "Rules tools"),
      toolPanel("morale", moralePanel(units, sceneMeta)),
      chasePanel(units, sceneMeta, view.encounter.started, grid),
      toolPanel("mob", mobPanel(units)),
      roomSettings().massCombat ? battlePanel(units) : null,
      roomSettings().naval ? navalPanel(units, sceneMeta) : null),
  ];
}
