/**
 * "Tracker" tab (GM): the initiative order with turn controls, round counter, HP boxes, initiative boxes, ties,
 * Mark as dead / Revive, and the units not yet in the encounter.
 */
import OBR from "@owlbear-rodeo/sdk";
import { fmtMod } from "../core/dice";
import { parseHpInput, type HpEvent } from "../core/hp";
import { displayConditions } from "../core/systems";
import {
  changeHp, encounterAction, markUnitsDead, moveTie, reviveUnits, rollInitiativeFor, setInEncounter, setInitiative, trackerView,
  type EncounterAction, type HpReport, type TrackerUnit, type TrackerView,
} from "../core/tracker";
import { rollSceneInitiative } from "../core/combat";
import { openCard } from "./cardPopover";
import { followToggle } from "./follow";
import { movementInfo } from "./movementView";
import { action, h, rerender, ui, type Child } from "./dom";
import { obrGateway } from "./obrGateway";
import { roomSettings, roomSystem } from "./roomSettings";
import { visionPanel } from "./visionPanel";

let view: TrackerView | null = null;
let sceneMeta: Record<string, unknown> = {};
let notes: string[] = [];
let outsideOpen = false;
let pending = false;
let timer: ReturnType<typeof setTimeout> | null = null;

/** Re-reads the scene; waits while the GM is typing so the re-render doesn't eat the keystrokes. */
export function refreshTracker(immediate = false) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(async () => {
    try { sceneMeta = await OBR.scene.getMetadata(); view = trackerView(await obrGateway.getItems(), sceneMeta); } catch { return; }
    const a = document.activeElement;
    if (a && a.closest("#app") && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName) && (a as HTMLInputElement).type !== "checkbox") { pending = true; return; }
    rerender();
  }, immediate ? 0 : 120);
}
document.addEventListener("focusout", () => { if (pending) { pending = false; setTimeout(rerender, 0); } });
export function resetTrackerTab() { view = null; notes = []; }

const EVENT_TEXT: Partial<Record<HpEvent, (n: string) => string>> = {
  "creature-at-zero": (n) => `${n} is at 0 HP: choose Dead, Death saves, Stable or Alive (the 0 HP prompt).`,
  "dropped-to-zero": (n) => `${n} dropped to 0 HP: on death saves until their controller chooses (Dead, Death saves, Stable or Alive).`,
  "death-save-failure": (n) => `${n} took damage at 0 HP: one death save failure.`,
  "three-failures": (n) => `${n} has three death save failures and is dead.`,
  "massive-damage": (n) => `${n} took massive damage (at least their max HP past 0): instant death by the rules. Choose Dead in the 0 HP prompt (☠)?`,
  "stable-lost": (n) => `${n} is no longer Stable.`,
  "revived-from-zero": (n) => `${n} is back above 0 HP.`,
  "concentration-check": (n) => `${n} must make a Concentration save: the prompt is on its card.`,
  "concentration-lost": (n) => `${n} dropped to 0 HP and lost Concentration.`,
  "wild-shape-ended": (n) => `${n}'s Wild Shape ended: back to their normal form.`,
};

function report(rs: HpReport[]) {
  notes = rs.flatMap((r) => r.deadBy === "setting" ? [`${r.name} is at 0 HP and was marked dead (room setting).`]
    : r.deadBy === "three-failures" ? [`${r.name} took damage at 0 HP: third death save failure. ${r.name} is dead.`]
    : r.deadBy === "massive-damage" ? [`${r.name} took massive damage at 0 HP (at least their max HP) and is dead.`]
    : r.events.flatMap((e) => EVENT_TEXT[e] ? [EVENT_TEXT[e]!(r.name)] : []));
}

function hpBox(u: TrackerUnit): HTMLInputElement {
  const inp = h("input", { type: "text", className: "hpbox", placeholder: "−7 / +5", title: "-7 damage · +5 heal · 12 set · t5 temp HP; Enter applies" }) as HTMLInputElement;
  inp.onkeydown = (e: KeyboardEvent) => {
    if (e.key !== "Enter") return;
    const change = parseHpInput(inp.value);
    if (!change) { ui.error = `"${inp.value}" isn't an HP change: use -7, +5, 12 or t5.`; rerender(); return; }
    inp.value = "";
    inp.blur();
    void action(async () => report(await changeHp(obrGateway, [u.id], change, { autoDeadAtZero: roomSettings().autoDeadAtZero, system: roomSystem() })))();
  };
  return inp;
}

function initBox(u: TrackerUnit): HTMLInputElement {
  const inp = h("input", { type: "text", inputmode: "numeric", className: "initbox", value: u.initiative === null ? "" : String(u.initiative), placeholder: "–", title: "Type a player's initiative roll" }) as HTMLInputElement;
  inp.onchange = action(async () => {
    const v = inp.value.trim();
    const n = Number(v);
    await setInitiative(obrGateway, u.id, v === "" ? null : Number.isFinite(n) ? Math.round(n) : u.initiative);
  });
  return inp;
}

function row(u: TrackerUnit, v: TrackerView, tie: { up: boolean; down: boolean }): Child {
  const isActive = v.active === u.id;
  const conds = displayConditions(roomSystem(), u.sheet, u.state);
  const offerDead = !u.dead && u.hp <= 0 && (!u.party || (u.state.deathSaves?.failures ?? 0) >= 3);
  return h("div", { className: `trow${isActive ? " active" : ""}${v.next === u.id ? " next" : ""}${u.hp <= 0 ? " down" : ""}` },
    h("div", { className: "tinit" }, initBox(u)),
    u.imageUrl ? h("img", { className: "thumb round small", src: u.imageUrl, alt: "" }) : h("div", { className: "thumb empty small" }, "?"),
    h("div", { className: "grow" },
      h("div", { className: "row", style: "gap:4px" },
        h("button", { className: "linkish", onclick: () => void openCard(u.id) }, u.name),
        u.hidden ? h("span", { className: "small muted", title: "Hidden from players" }, "(hidden)") : null,
        u.party ? h("span", { className: "small muted" }, "party") : null),
      h("div", { className: "small muted" }, `AC ${u.ac} · init ${fmtMod(u.initMod)}`),
      conds.length ? h("div", { className: "conds tight" }, ...conds.map((c) => h("span", { className: `cond${c.automatic ? " auto" : ""}` }, c.label, c.detail ? ` ${c.detail}` : ""))) : null,
      u.state.concentrationCheck ? h("div", { className: "small warn" }, `Concentration check: DC ${u.state.concentrationCheck.dc} (on its card)`) : null,
      isActive ? movementInfo(sceneMeta, u, "GM") : null),
    h("div", { className: "thp" },
      h("div", { className: `hpval${u.hp * 2 <= u.maxHp ? " low" : ""}` }, `${u.hp}/${u.maxHp}`, u.tempHp ? h("span", { className: "ok small" }, ` +${u.tempHp}`) : null),
      hpBox(u)),
    h("div", { className: "tbtns" },
      tie.up ? h("button", { className: "icon tiny", title: "Move up among tied units", onclick: action(() => moveTie(obrGateway, u.id, "up")) }, "▲") : null,
      tie.down ? h("button", { className: "icon tiny", title: "Move down among tied units", onclick: action(() => moveTie(obrGateway, u.id, "down")) }, "▼") : null,
      h("button", { className: `icon tiny${offerDead ? " danger" : ""}`, title: "Mark as dead (leaves initiative)", onclick: action(() => markUnitsDead(obrGateway, [u.id])) }, "☠"),
      h("button", { className: "icon tiny", title: "Remove from initiative", onclick: action(() => setInEncounter(obrGateway, [u.id], false)) }, "✕")));
}

function controls(v: TrackerView): Child {
  const e = v.encounter;
  const act = (a: EncounterAction) => action(async () => { notes = []; await encounterAction(obrGateway, a); });
  const activeName = v.order.find((u) => u.id === v.active)?.name;
  return h("div", { className: "panel stack tight" },
    h("div", { className: "row between" },
      h("div", {}, e.started ? h("span", {}, h("strong", { className: "round" }, `Round ${e.round}`), activeName ? ` · ${activeName}'s turn` : "") : h("strong", {}, "Not in combat")),
      e.started
        ? h("div", { className: "row" },
          h("button", { className: "secondary", disabled: ui.busy || !e.history.length, onclick: act("previous") }, "◀ Prev"),
          h("button", { disabled: ui.busy || !v.order.length, onclick: act("next") }, "Next turn ▶"))
        : h("button", { disabled: ui.busy || !v.order.length, onclick: act("start") }, "Start combat")),
    h("div", { className: "row" },
      h("button", { className: "secondary small", disabled: ui.busy || !(v.order.length + v.waiting.length), onclick: action(async () => { await rollSceneInitiative(obrGateway, "all", { rules: roomSystem().rules }); }) }, "Roll all"),
      h("button", { className: "secondary small", disabled: ui.busy || !(v.order.length + v.waiting.length), onclick: action(async () => { await rollSceneInitiative(obrGateway, "creatures", { rules: roomSystem().rules }); }) }, "Roll creatures"),
      h("button", { className: "secondary small", disabled: ui.busy, title: "Clear initiative values and the round; units stay in the encounter", onclick: act("reset") }, "Reset round & initiative"),
      e.started ? h("button", { className: "secondary small", disabled: ui.busy, onclick: act("end") }, "End combat") : null),
    followToggle());
}

export function renderTrackerTab(): Child[] {
  if (!view) { refreshTracker(true); return [h("div", { className: "panel small muted" }, "Reading the scene…")]; }
  const v = view;
  const out: Child[] = [controls(v)];
  if (notes.length) out.push(h("div", { className: "panel warn small" }, ...notes.map((n) => h("div", {}, n)), h("button", { className: "icon tiny", onclick: () => { notes = []; rerender(); } }, "OK")));
  out.push(h("div", { className: "panel tracker" },
    v.order.length ? null : h("div", { className: "small muted" }, "Nobody has an initiative yet. Roll above, or type players' rolls in the boxes below."),
    ...v.order.map((u, i) => {
      const prev = v.order[i - 1], next = v.order[i + 1];
      return row(u, v, { up: prev?.initiative === u.initiative, down: next?.initiative === u.initiative });
    })));
  if (v.waiting.length) {
    out.push(h("div", { className: "panel tracker" }, h("h2", {}, `Waiting for initiative (${v.waiting.length})`),
      ...v.waiting.map((u) => row(u, v, { up: false, down: false }))));
  }
  const dead = v.outside.filter((u) => u.dead);
  const others = v.outside.filter((u) => !u.dead);
  if (others.length || dead.length) {
    out.push(h("details", { className: "panel", open: outsideOpen, ontoggle: (e: Event) => { outsideOpen = (e.target as HTMLDetailsElement).open; } }, h("summary", {}, `Not in initiative (${others.length + dead.length})`),
      ...others.map((u) => h("div", { className: "row between small", style: "margin-top:6px" },
        h("button", { className: "linkish", onclick: () => void openCard(u.id) }, u.name),
        h("div", { className: "row" },
          h("button", { className: "secondary small", onclick: action(() => setInEncounter(obrGateway, [u.id], true)) }, "Add"),
          h("button", { className: "secondary small", onclick: action(async () => { await rollInitiativeFor(obrGateway, [u.id], { rules: roomSystem().rules }); }) }, "Add + roll")))),
      ...dead.map((u) => h("div", { className: "row between small", style: "margin-top:6px" },
        h("span", {}, "☠ ", h("button", { className: "linkish", onclick: () => void openCard(u.id) }, u.name)),
        h("button", { className: "secondary small", onclick: action(() => reviveUnits(obrGateway, [u.id])) }, "Revive")))));
  }
  out.push(visionPanel("GM", rerender, [...v.order, ...v.waiting, ...v.outside].map((u) => ({ id: u.id, name: u.name, party: u.party }))));
  return out;
}
