/**
 * DM Tools → Area templates: place a Sphere, Cylinder, Cube, Cone, Line or Emanation on the map. Every square it covers
 * by at least half is highlighted (background/aoe.ts); here, the units caught in each area, to select them or damage
 * them all at once.
 */
import OBR from "@owlbear-rodeo/sdk";
import { AOE_SHAPES, aoeName, type AoeMeta, type AoeShape } from "../core/aoe";
import { parseHpInput } from "../core/hp";
import { SHEET_KEY, STATE_KEY } from "../core/sheet";
import { changeHp, type TrackerUnit } from "../core/tracker";
import { placedAreas, placeTemplate, unitsInArea } from "./aoeItems";
import { action, h, rerender, type Child } from "./dom";
import { obrGateway } from "./obrGateway";
import { roomSettings, roomSystem } from "./roomSettings";

const st = { shape: "sphere" as AoeShape, size: 20, width: 5, label: "", onSelected: false };
let areas: { id: string; name: string; units: string[] }[] = [];
let square = true;
const dmg: Record<string, string> = {};
let note = "";

/** Re-reads the templates and who's in them (called by the DM Tools tab's refresh). */
export async function refreshAreas() {
  const items = await OBR.scene.items.getItems();
  const r = await placedAreas(items);
  square = r.square;
  // Dead units aren't caught (they'd only clutter the list and take damage).
  const units = items.filter((i) => SHEET_KEY in i.metadata && i.layer === "CHARACTER"
    && !((i.metadata[STATE_KEY] as { conditions?: { key: string }[] } | undefined)?.conditions ?? []).some((c) => c.key === "dead"));
  areas = await Promise.all(r.areas.map(async (a) => ({ id: a.item.id, name: aoeName(a.meta), units: await unitsInArea(a, units, r.dpi) })));
}

export function aoePanel(units: TrackerUnit[]): Child {
  const name = (id: string) => units.find((u) => u.id === id)?.name ?? "?";
  const meta = (): AoeMeta => ({ shape: st.shape, size: st.size, ...(st.shape === "line" ? { width: st.width } : {}), ...(st.label.trim() ? { label: st.label.trim() } : {}) });
  return h("details", { className: "panel" }, h("summary", {}, h("strong", {}, `Area templates${areas.length ? ` (${areas.length})` : ""}`)),
    h("div", { className: "small muted" }, "Place an area on the map; drag it, rotate a Cone or Line with Owlbear's handle, or resize it. Squares it covers by at least half are highlighted (DMG), and the units in them are listed here."),
    square ? null : h("div", { className: "small warn" }, "Highlighting works on square grids only."),
    h("div", { className: "row wrap", style: "margin-top:6px" },
      h("select", { onchange: (e: Event) => { st.shape = (e.target as HTMLSelectElement).value as AoeShape; rerender(); } },
        ...AOE_SHAPES.map((s) => h("option", { value: s.key, selected: s.key === st.shape }, s.label))),
      h("input", { type: "number", className: "num", min: 5, step: 5, value: String(st.size), onchange: (e: Event) => { st.size = Math.max(5, Number((e.target as HTMLInputElement).value) || 5); } }), "ft",
      st.shape === "line" ? h("label", { className: "small" }, "wide ", h("input", { type: "number", className: "num", min: 5, step: 5, value: String(st.width), onchange: (e: Event) => { st.width = Math.max(5, Number((e.target as HTMLInputElement).value) || 5); } })) : null,
      h("input", { type: "text", placeholder: "Name (Fireball…)", value: st.label, onchange: (e: Event) => { st.label = (e.target as HTMLInputElement).value; } }),
      h("label", { className: "small", title: "The origin of a Cone, Line or Emanation; otherwise the view's centre" },
        h("input", { type: "checkbox", checked: st.onSelected || st.shape === "emanation", disabled: st.shape === "emanation", onchange: (e: Event) => { st.onSelected = (e.target as HTMLInputElement).checked; } }), "on the selected token"),
      h("button", { className: "small", onclick: action(async () => {
        const sel = (await OBR.player.getSelection()) ?? [];
        await placeTemplate(meta(), st.onSelected || st.shape === "emanation" ? sel[0] : undefined);
        await refreshAreas();
      }) }, "Place")),
    areas.length ? h("div", { className: "dm-list" }, ...areas.map((a) => h("div", { className: "dm-item" },
      h("div", { className: "grow" }, h("strong", {}, a.name), h("div", { className: "small muted" }, a.units.length ? `In it: ${a.units.map(name).join(", ")}` : "Nobody in it")),
      a.units.length ? h("button", { className: "secondary small", title: "Select these tokens on the map", onclick: () => void OBR.player.select(a.units) }, "Select") : null,
      a.units.length ? h("input", { type: "text", className: "num", placeholder: "28", title: "Damage (28) or healing (+5) to everyone in it; Enter applies", value: dmg[a.id] ?? "",
        oninput: (e: Event) => { dmg[a.id] = (e.target as HTMLInputElement).value; },
        onkeydown: (e: KeyboardEvent) => {
          if (e.key !== "Enter") return;
          const parsed = parseHpInput(dmg[a.id] ?? "");
          // A bare number here is damage (not "set HP to").
          const change = parsed?.kind === "set" ? { kind: "damage" as const, amount: parsed.amount } : parsed;
          if (!change || change.kind === "temp") return;
          dmg[a.id] = "";
          void action(async () => {
            await changeHp(obrGateway, a.units, change, { autoDeadAtZero: roomSettings().autoDeadAtZero, system: roomSystem() });
            note = `${a.name}: ${change.kind} ${change.amount} applied to ${a.units.map(name).join(", ")}.`;
          })();
        } }) : null,
      h("button", { className: "icon tiny", title: "Remove the template", onclick: action(async () => { await OBR.scene.items.deleteItems([a.id]); await refreshAreas(); }) }, "✕")))) : null,
    note ? h("div", { className: "small ok" }, note) : null);
}

