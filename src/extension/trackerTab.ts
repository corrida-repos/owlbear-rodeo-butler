/**
 * "Tracker" tab (GM): the initiative order with turn controls, round counter, HP boxes, initiative boxes, ties,
 * Mark as dead / Revive, and the units not yet in the encounter.
 */
import OBR from "@owlbear-rodeo/sdk";
import { fmtMod } from "../core/dice";
import { parseHpInput, type HpEvent } from "../core/hp";
import { displayConditions } from "../core/systems";
import {
  changeHp, encounterAction, isLairTurn, markUnitsDead, moveTie, revealUnits, reviveUnits, rollInitiativeFor, setInEncounter, setInitiative,
  setRevealOnTurn, setSurprised, trackerView, undoHp, type EncounterAction, type HpReport, type LairTurn, type TrackerUnit, type TrackerView,
} from "../core/tracker";
import { hasLairFeatures, setInLair, usesSummary } from "../core/uses";
import { rollSceneInitiative } from "../core/combat";
import { openCard } from "./cardPopover";
import { followToggle } from "./follow";
import { movementInfo } from "./movementView";
import { action, h, rerender, ui, type Child } from "./dom";
import { obrGateway } from "./obrGateway";
import { roomSettings, roomSystem } from "./roomSettings";

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
  "creature-at-zero": (n) => `${n} is at 0 HP: mark it dead (☠) when it's out.`,
  "dropped-to-zero": (n) => `${n} dropped to 0 HP and makes death saves.`,
  "death-save-failure": (n) => `${n} took damage at 0 HP: one death save failure.`,
  "three-failures": (n) => `${n} has three death save failures: mark as dead (☠)?`,
  "massive-damage": (n) => `${n} took massive damage (at least their max HP past 0): instant death by the rules. Mark as dead (☠)?`,
  "stable-lost": (n) => `${n} is no longer Stable.`,
  "revived-from-zero": (n) => `${n} is back above 0 HP.`,
  "concentration-check": (n) => `${n} must make a Concentration save: the prompt is on its card.`,
  "concentration-lost": (n) => `${n} dropped to 0 HP and lost Concentration.`,
  "wild-shape-ended": (n) => `${n}'s Wild Shape ended: back to their normal form.`,
};

function report(rs: HpReport[]) {
  notes = rs.flatMap((r) => r.markedDead ? [`${r.name} is at 0 HP and was marked dead (room setting).`] : r.events.flatMap((e) => EVENT_TEXT[e] ? [EVENT_TEXT[e]!(r.name)] : []));
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

function undoButton(u: TrackerUnit): Child {
  const last = u.state.hpLog?.at(-1);
  if (!last) return null;
  return h("button", { className: "icon tiny", title: `Undo ${last.text} (back to ${last.before.hp} HP${last.before.tempHp ? ` +${last.before.tempHp} temp` : ""})`,
    onclick: action(async () => { notes = []; const r = await undoHp(obrGateway, u.id); notes = [`Undid ${r.text} on ${u.name}: back to ${r.hp} HP.`]; }) }, "↶");
}

/** Small toggles under a unit's name: surprise (before combat), reveal on its turn (hidden units), in its lair. */
function flags(u: TrackerUnit, v: TrackerView): Child {
  const started = v.encounter.started;
  const rules = roomSystem().rules;
  const out: Child[] = [];
  if (!started || u.state.surprised) {
    out.push(h("button", { className: `usebtn${u.state.surprised ? " spent" : ""}`,
      title: rules === "2024" ? "Surprised: initiative rolled with disadvantage" : "Surprised: no move, action or reaction on its first turn",
      onclick: action(() => setSurprised(obrGateway, [u.id], !u.state.surprised)) }, u.state.surprised ? "Surprised" : "Surprise?"));
  }
  if (u.hidden) {
    out.push(h("button", { className: `usebtn${u.state.revealOnTurn ? " ready" : ""}`, title: "Show this hidden token to the players when its turn starts",
      onclick: action(() => setRevealOnTurn(obrGateway, [u.id], !u.state.revealOnTurn)) }, u.state.revealOnTurn ? "Reveals on its turn" : "Reveal on its turn?"));
    out.push(h("button", { className: "usebtn", title: "Show it to the players now", onclick: action(() => revealUnits(obrGateway, [u.id])) }, "Reveal now"));
  }
  if (hasLairFeatures(u.sheet)) {
    out.push(h("button", { className: `usebtn${u.state.inLair ? " ready" : ""}`,
      title: u.sheet.lair?.length ? "In its lair: lair actions on initiative 20 and the in-lair uses" : "In its lair: the stat block's in-lair uses",
      onclick: action(() => setInLair(obrGateway, u.id, !u.state.inLair)) }, u.state.inLair ? "In its lair" : "In its lair?"));
  }
  return out.length ? h("div", { className: "row", style: "gap:4px;margin-top:2px" }, ...out) : null;
}

function lairRow(t: LairTurn, v: TrackerView): Child {
  return h("div", { className: `trow lair${v.active === t.id ? " active" : ""}${v.next === t.id ? " next" : ""}` },
    h("div", { className: "tinit" }, "20"),
    h("div", { className: "grow" },
      h("div", {}, h("strong", {}, "Lair actions"), h("span", { className: "small muted" }, " · initiative 20, loses ties")),
      h("div", { className: "small" }, ...t.units.flatMap((u, i) => [i ? ", " : "", h("button", { className: "linkish", onclick: () => void openCard(u.id) }, u.name)]))));
}

/** The latest HP changes across units, newest first; each unit's newest change can be undone. */
function hpLogPanel(v: TrackerView): Child {
  const units = [...v.order, ...v.waiting, ...v.outside];
  const entries = units.flatMap((u) => (u.state.hpLog ?? []).map((e, i, all) => ({ u, e, newest: i === all.length - 1 })))
    .sort((a, b) => b.e.at - a.e.at).slice(0, 8);
  if (!entries.length) return null;
  return h("details", { className: "panel small" },
    h("summary", {}, "Recent HP changes"),
    h("ul", { className: "plain hplog", style: "margin-top:6px" }, ...entries.map(({ u, e, newest }) =>
      h("li", {}, h("span", {}, h("strong", {}, u.name), ` ${e.text} → ${e.after.hp} HP${e.after.tempHp ? ` +${e.after.tempHp}` : ""}`, h("span", { className: "muted" }, ` (was ${e.before.hp})`)),
        newest ? undoButton(u) : null))));
}

function row(u: TrackerUnit, v: TrackerView, tie: { up: boolean; down: boolean }): Child {
  const isActive = v.active === u.id;
  const uses = usesSummary(u.sheet, u.state);
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
      uses ? h("div", { className: "small muted", title: "Limited uses: spend and reset them on the unit's card" }, uses) : null,
      flags(u, v),
      isActive ? movementInfo(sceneMeta, u, "GM") : null),
    h("div", { className: "thp" },
      h("div", { className: `hpval${u.hp * 2 <= u.maxHp ? " low" : ""}` }, `${u.hp}/${u.maxHp}`, u.tempHp ? h("span", { className: "ok small" }, ` +${u.tempHp}`) : null),
      h("div", { className: "row", style: "gap:2px;flex-wrap:nowrap" }, hpBox(u), undoButton(u))),
    h("div", { className: "tbtns" },
      tie.up ? h("button", { className: "icon tiny", title: "Move up among tied units", onclick: action(() => moveTie(obrGateway, u.id, "up")) }, "▲") : null,
      tie.down ? h("button", { className: "icon tiny", title: "Move down among tied units", onclick: action(() => moveTie(obrGateway, u.id, "down")) }, "▼") : null,
      h("button", { className: `icon tiny${offerDead ? " danger" : ""}`, title: "Mark as dead (leaves initiative)", onclick: action(() => markUnitsDead(obrGateway, [u.id])) }, "☠"),
      h("button", { className: "icon tiny", title: "Remove from initiative", onclick: action(() => setInEncounter(obrGateway, [u.id], false)) }, "✕")));
}

function controls(v: TrackerView): Child {
  const e = v.encounter;
  const act = (a: EncounterAction) => action(async () => { notes = []; await encounterAction(obrGateway, a, { rules: roomSystem().rules }); });
  const activeName = v.turns.find((u) => u.id === v.active)?.name;
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
    ...v.turns.map((t) => {
      if (isLairTurn(t)) return lairRow(t, v);
      const i = v.order.indexOf(t);
      const prev = v.order[i - 1], next = v.order[i + 1];
      return row(t, v, { up: prev?.initiative === t.initiative, down: next?.initiative === t.initiative });
    })));
  out.push(hpLogPanel(v));
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
          undoButton(u),
          h("button", { className: "secondary small", onclick: action(() => setInEncounter(obrGateway, [u.id], true)) }, "Add"),
          h("button", { className: "secondary small", onclick: action(async () => { await rollInitiativeFor(obrGateway, [u.id], { rules: roomSystem().rules }); }) }, "Add + roll")))),
      ...dead.map((u) => h("div", { className: "row between small", style: "margin-top:6px" },
        h("span", {}, "☠ ", h("button", { className: "linkish", onclick: () => void openCard(u.id) }, u.name)),
        h("div", { className: "row" }, undoButton(u),
          h("button", { className: "secondary small", onclick: action(() => reviveUnits(obrGateway, [u.id])) }, "Revive"))))));
  }
  return out;
}
