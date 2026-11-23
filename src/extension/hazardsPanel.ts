/**
 * DM Tools → Hazards and traps: place one of the 2024 DMG's hazards or any official trap (traps start hidden from
 * players), see how it works and how to find it, arm or disarm it, and set it off by hand on the selected tokens
 * (for "when touched", a lock opened, a rockslide's path, a complex trap's element…). Entering it or starting a turn in
 * it sets it off by itself.
 */
import OBR, { type Item } from "@owlbear-rodeo/sdk";
import { ABILITY_NAMES } from "../core/sheet";
import { HAZARD_KEY, HAZARD_SOURCES, HAZARDS, hazardDef, hazardOptions, readHazard, SOURCE_NAMES, type HazardDef, type HazardEffect } from "../core/hazards";
import type { TrackerUnit } from "../core/tracker";
import { action, h, rerender, type Child } from "./dom";
import { placeHazard, triggerHazard } from "./hazardRun";

const st = { key: HAZARDS[0]!.key, hidden: false };
let placed: Item[] = [];
let log: string[] = [];
/** Which option (main effect or element) "Trigger on selected" sets off, per placed item. */
const chosen = new Map<string, number>();

export async function refreshHazards() {
  placed = (await OBR.scene.items.getItems()).filter((i) => readHazard(i.metadata));
}

const condLabel = (c: { key: string; label?: string }) => c.label ?? c.key[0]!.toUpperCase() + c.key.slice(1);

/** One effect in words: attack, save, damage, conditions. */
const effectText = (e: HazardEffect) => {
  const atk = e.attack ? `${e.attack.count && e.attack.count > 1 ? `${e.attack.count} attacks` : "Attack"} ${e.attack.bonus >= 0 ? "+" : ""}${e.attack.bonus} to hit.` : "";
  const always = (e.damage ?? []).filter((x) => x.always), saved = (e.damage ?? []).filter((x) => !x.always);
  const dmg = (list: typeof always) => list.map((x) => `${x.formula} ${x.type}`).join(" + ");
  const hitWord = e.attack ? (e.attack.count && e.attack.count > 1 ? " per hit" : " on a hit") : "";
  const conds = (e.conditions ?? []).filter((c) => !c.always), alwaysConds = (e.conditions ?? []).filter((c) => c.always);
  return [
    e.says ?? "",
    atk,
    e.save ? `DC ${e.save.dc} ${ABILITY_NAMES[e.save.ability]} save.` : "",
    always.length ? `${e.times ? `${e.times} × ` : ""}${dmg(always)}${hitWord}${e.save ? " whatever the save" : ""}.` : "",
    saved.length ? `${e.times ? `${e.times} × ` : ""}${dmg(saved)}${hitWord}${e.save ? (e.half ? ", half on a success" : " on a failure") : ""}.` : "",
    alwaysConds.length ? `${alwaysConds.map(condLabel).join(", ")}.` : "",
    conds.length ? `${e.save ? "On a failure: " : e.attack ? "On a hit: " : ""}${conds.map(condLabel).join(", ")}.` : "",
  ].filter(Boolean).join(" ");
};

const how = (d: HazardDef) => [
  d.triggers.length ? `Sets off when a creature ${d.triggers.map((t) => (t === "enter" ? "enters it (first time on a turn)" : "starts its turn in it")).join(" or ")}.` : "You set it off (button below).",
  effectText(d),
].filter(Boolean).join(" ");

export function hazardsPanel(units: TrackerUnit[]): Child {
  const d = hazardDef(st.key)!;
  return h("details", { className: "panel" }, h("summary", {}, h("strong", {}, `Hazards and traps${placed.length ? ` (${placed.length})` : ""}`)),
    h("div", { className: "small muted" }, "The DMG's hazards and every official trap (2014 and 2024 DMG, Xanathar's, Van Richten's, The Book of Many Things, adventures), with their rules running: a unit that enters one (or starts its turn in one) gets the save rolled, damage applied and conditions added; you get a notice. Resistances, Vulnerabilities and Immunities on the sheet apply (conditional ones, like “from nonmagical attacks”, are reported, not applied)."),
    h("div", { className: "row wrap", style: "margin-top:6px" },
      h("select", { onchange: (e: Event) => { st.key = (e.target as HTMLSelectElement).value; st.hidden = hazardDef(st.key)!.kind === "trap"; rerender(); } },
        h("optgroup", { label: "Hazards" }, ...HAZARDS.filter((x) => x.kind === "hazard").map((x) => h("option", { value: x.key, selected: x.key === st.key }, x.name))),
        ...HAZARD_SOURCES.map((src) => h("optgroup", { label: `Traps · ${SOURCE_NAMES[src] ?? src}` },
          ...HAZARDS.filter((x) => x.kind === "trap" && x.source === src).map((x) => h("option", { value: x.key, selected: x.key === st.key }, x.name))))),
      h("label", { className: "small" }, h("input", { type: "checkbox", checked: st.hidden, onchange: (e: Event) => { st.hidden = (e.target as HTMLInputElement).checked; } }), "hidden from players"),
      h("button", { className: "small", onclick: action(async () => { await placeHazard(d, st.hidden); await refreshHazards(); }) }, "Place")),
    h("div", { className: "row", style: "margin-top:4px; align-items:flex-start" },
      h("img", { src: new URL(`hazards/${d.image}`, location.href).href, width: 56, height: 56, alt: "" }),
      h("div", { className: "small grow" }, h("strong", {}, `${d.name} `), h("span", { className: "muted" }, `${d.kind} · ${SOURCE_NAMES[d.source] ?? d.source} · ${d.rating} · ${d.cells * 5}-ft square`),
        h("div", {}, how(d)),
        ...(d.elements ?? []).map((el) => h("div", {}, "• ", h("strong", {}, `${el.name}: `), effectText(el), el.note ? h("span", { className: "muted" }, ` ${el.note}`) : null)),
        h("div", { className: "muted" }, d.note), d.detect ? h("div", {}, d.kind === "trap" ? "Find and disarm it: " : "Find it: ", d.detect) : null)),
    placed.length ? h("div", { className: "dm-list" }, ...placed.map((it) => {
      const p = readHazard(it.metadata)!;
      const def = hazardDef(p.key)!;
      const options = hazardOptions(def);
      const pick = Math.min(chosen.get(it.id) ?? 0, Math.max(0, options.length - 1));
      return h("div", { className: "dm-item" },
        h("div", { className: "grow" }, h("strong", {}, def.name), h("span", { className: "small muted" }, `${it.visible ? "" : " · hidden"}${p.armed ? "" : " · spent / disarmed"}`)),
        options.length > 1 ? h("select", { className: "small", title: "What to set off", onchange: (e: Event) => { chosen.set(it.id, Number((e.target as HTMLSelectElement).value)); } },
          ...options.map((o, i) => h("option", { value: String(i), selected: i === pick }, o.name === def.name ? "Main effect" : o.name.slice(def.name.length + 2)))) : null,
        h("button", { className: "secondary small", title: "Set it off on the selected tokens", onclick: action(async () => {
          const sel = (await OBR.player.getSelection()) ?? [];
          const targets = units.filter((u) => sel.includes(u.id));
          if (!targets.length) throw new Error("Select the tokens it affects first.");
          const option = options[Math.min(chosen.get(it.id) ?? 0, options.length - 1)];
          for (const u of targets) log = [...log, await triggerHazard(def, it, u, option)].slice(-8);
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
