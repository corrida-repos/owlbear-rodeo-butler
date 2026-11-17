/**
 * DM Tools → Hazards and traps: place one of the 2024 DMG's hazards or traps on the map (traps start hidden from
 * players), see how it works and how to find it, arm or disarm it, and set it off by hand on the selected tokens
 * (for "when touched", a lock opened, a rockslide's path…). Entering it or starting a turn in it sets it off by itself.
 */
import OBR, { type Item } from "@owlbear-rodeo/sdk";
import { ABILITY_NAMES } from "../core/sheet";
import { HAZARD_KEY, HAZARDS, hazardDef, readHazard, type HazardDef } from "../core/hazards";
import type { TrackerUnit } from "../core/tracker";
import { action, h, rerender, type Child } from "./dom";
import { placeHazard, triggerHazard } from "./hazardRun";

const st = { key: HAZARDS[0]!.key, hidden: false };
let placed: Item[] = [];
let log: string[] = [];

export async function refreshHazards() {
  placed = (await OBR.scene.items.getItems()).filter((i) => readHazard(i.metadata));
}

const how = (d: HazardDef) => [
  d.triggers.length ? `Sets off when a creature ${d.triggers.map((t) => (t === "enter" ? "enters it (first time on a turn)" : "starts its turn in it")).join(" or ")}.` : "You set it off (button below).",
  d.save ? `DC ${d.save.dc} ${ABILITY_NAMES[d.save.ability]} save.` : "",
  d.damage ? `${d.times ? `${d.times} × ` : ""}${d.damage.map((x) => `${x.formula} ${x.type}`).join(" + ")}${d.save ? (d.half ? ", half on a success" : " on a failure") : ""}.` : "",
  d.conditions?.length ? `${d.save ? "On a failure: " : ""}${d.conditions.map((c) => c.label ?? c.key[0]!.toUpperCase() + c.key.slice(1)).join(", ")}.` : "",
].filter(Boolean).join(" ");

export function hazardsPanel(units: TrackerUnit[]): Child {
  const d = hazardDef(st.key)!;
  return h("details", { className: "panel" }, h("summary", {}, h("strong", {}, `Hazards and traps${placed.length ? ` (${placed.length})` : ""}`)),
    h("div", { className: "small muted" }, "The DMG's hazards and traps, with their rules running: a unit that enters one (or starts its turn in one) gets the save rolled, damage applied and conditions added; you get a notice. Resistances, Vulnerabilities and Immunities on the sheet apply (conditional ones, like “from nonmagical attacks”, are reported, not applied)."),
    h("div", { className: "row wrap", style: "margin-top:6px" },
      h("select", { onchange: (e: Event) => { st.key = (e.target as HTMLSelectElement).value; st.hidden = hazardDef(st.key)!.kind === "trap"; rerender(); } },
        h("optgroup", { label: "Hazards" }, ...HAZARDS.filter((x) => x.kind === "hazard").map((x) => h("option", { value: x.key, selected: x.key === st.key }, x.name))),
        h("optgroup", { label: "Traps" }, ...HAZARDS.filter((x) => x.kind === "trap").map((x) => h("option", { value: x.key, selected: x.key === st.key }, x.name)))),
      h("label", { className: "small" }, h("input", { type: "checkbox", checked: st.hidden, onchange: (e: Event) => { st.hidden = (e.target as HTMLInputElement).checked; } }), "hidden from players"),
      h("button", { className: "small", onclick: action(async () => { await placeHazard(d, st.hidden); await refreshHazards(); }) }, "Place")),
    h("div", { className: "row", style: "margin-top:4px; align-items:flex-start" },
      h("img", { src: new URL(`hazards/${d.image}`, location.href).href, width: 56, height: 56, alt: "" }),
      h("div", { className: "small grow" }, h("strong", {}, `${d.name} `), h("span", { className: "muted" }, `${d.kind} · ${d.rating} · ${d.cells * 5}-ft square`),
        h("div", {}, how(d)), h("div", { className: "muted" }, d.note), d.detect ? h("div", {}, "Find it: ", d.detect) : null)),
    placed.length ? h("div", { className: "dm-list" }, ...placed.map((it) => {
      const p = readHazard(it.metadata)!;
      const def = hazardDef(p.key)!;
      return h("div", { className: "dm-item" },
        h("div", { className: "grow" }, h("strong", {}, def.name), h("span", { className: "small muted" }, `${it.visible ? "" : " · hidden"}${p.armed ? "" : " · spent / disarmed"}`)),
        h("button", { className: "secondary small", title: "Set it off on the selected tokens", onclick: action(async () => {
          const sel = (await OBR.player.getSelection()) ?? [];
          const targets = units.filter((u) => sel.includes(u.id));
          if (!targets.length) throw new Error("Select the tokens it affects first.");
          for (const u of targets) log = [...log, await triggerHazard(def, it, u)].slice(-8);
          await refreshHazards();
        }) }, "Trigger on selected"),
        h("button", { className: "secondary small", title: p.armed ? "Disarm it: entering won't set it off" : "Arm it again", onclick: action(async () => {
          await OBR.scene.items.updateItems([it.id], (ds) => { for (const x of ds) x.metadata[HAZARD_KEY] = { key: p.key, armed: !p.armed }; });
          await refreshHazards();
        }) }, p.armed ? "Disarm" : "Arm"),
        h("button", { className: "secondary small", onclick: action(async () => { await OBR.scene.items.updateItems([it.id], (ds) => { for (const x of ds) x.visible = !x.visible; }); await refreshHazards(); }) }, it.visible ? "Hide" : "Reveal"),
        h("button", { className: "icon tiny", title: "Remove", onclick: action(async () => { await OBR.scene.items.deleteItems([it.id]); await refreshHazards(); }) }, "✕"));
    })) : null,
    log.length ? h("div", { className: "small stack tight", style: "margin-top:4px" }, ...log.slice().reverse().map((l) => h("div", {}, "• ", l))) : null);
}
