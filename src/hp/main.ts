/**
 * Change status popover (hp.html?ids=a,b,c), opened from the context menu on one or more selected units. One screen
 * for everything about a unit's state, applied to all selected units at once (e.g. every goblin caught in a Fireball):
 *  - HP: damage (or half damage on a save), heal, temporary HP, or set HP to a number.
 *  - Conditions as toggles: Dead, Stable and Death Saves (the 0-HP statuses, which exclude each other) next to every
 *    other condition, Exhaustion with its level, Concentration and custom effects already on the units.
 *  - A condition with a duration, a note or a custom name, from the shared editor.
 */
import "../extension/devlog";
import OBR from "@owlbear-rodeo/sdk";
import type { HpChange, LifeStatus } from "../core/hp";
import { addConditionTo, changeHp, setLifeStatus, toggleConditionOn, trackerUnits, type HpReport, type TrackerUnit } from "../core/tracker";
import { turnOrder } from "../core/encounter";
import { isBloodied, isDead, isStable, needsDeathSaves } from "../core/systems";
import { conditionEditor } from "../extension/conditionEditor";
import { h, type Child } from "../extension/dom";
import { obrGateway } from "../extension/obrGateway";
import { initRoomSettings, roomSettings, roomSystem } from "../extension/roomSettings";

const app = document.getElementById("app")!;
const ids = (new URLSearchParams(location.search).get("ids") ?? "").split(",").filter(Boolean);
let units: TrackerUnit[] = [];
let allUnits: TrackerUnit[] = [];
let results: HpReport[] | null = null;
let error = "";
let note = "";
let half = false;
let busy = false;

const EVENTS: Record<string, string> = {
  "creature-at-zero": "at 0 HP: Dead, Death saves, Stable or Alive?", "dropped-to-zero": "down: death saves (or Dead, Stable, Alive)", "death-save-failure": "death save failure",
  "three-failures": "three failures: dead", "massive-damage": "massive damage", "stable-lost": "no longer Stable", "revived-from-zero": "back up",
  "concentration-check": "Concentration check (on its card)", "concentration-lost": "Concentration lost",
  "wild-shape-ended": "Wild Shape ended (back to normal form)",
};

async function run(fn: () => Promise<unknown>) {
  if (busy) return;
  busy = true;
  try { await fn(); error = ""; } catch (e) { error = e instanceof Error ? e.message : String(e); note = ""; }
  busy = false;
  render();
}

function applyHp(kind: HpChange["kind"]) {
  const amount = Math.floor(Number((document.getElementById("amt") as HTMLInputElement).value));
  if (!(amount >= 0) || (document.getElementById("amt") as HTMLInputElement).value.trim() === "") { error = "Enter a number."; render(); return; }
  void run(async () => {
    const n = kind === "damage" && half ? Math.floor(amount / 2) : amount;
    results = await changeHp(obrGateway, ids, { kind, amount: n }, { autoDeadAtZero: roomSettings().autoDeadAtZero, system: roomSystem() });
    note = "";
  });
}

// ------------------------------------------------------------------ conditions as toggles

type Has = "all" | "some" | "none";
const has = (test: (u: TrackerUnit) => boolean): Has => {
  const n = units.filter(test).length;
  return n === 0 ? "none" : n === units.length ? "all" : "some";
};

function chip(label: string, state: Has, title: string, onclick: (() => void) | null, extra = ""): HTMLElement {
  return h("button", {
    className: `fchip status-chip ${state === "all" ? "on" : state === "some" ? "some" : ""} ${extra}`.trim(),
    title: `${title}${state === "some" ? " (some of the selected units have it)" : ""}`, disabled: busy || !onclick,
    onclick: onclick ?? undefined,
  }, label);
}

const lifeOf = (u: TrackerUnit): LifeStatus => isDead(u.state) ? "dead" : isStable(u.state) ? "stable" : needsDeathSaves(u.state) ? "dying" : "none";

function lifeChips(): Child[] {
  const life = (to: Exclude<LifeStatus, "none">, label: string, onTitle: string, offTitle: string) => {
    const state = has((u) => lifeOf(u) === to);
    const turnOff = state === "all";
    // Death Saves ends by healing, Stable or Dead, not by switching it off.
    const click = to === "dying" && turnOff ? null : () => void run(async () => {
      await setLifeStatus(obrGateway, ids, turnOff ? "none" : to);
      note = "";
    });
    return chip(label, state, turnOff ? offTitle : onTitle, click, `life life-${to}`);
  };
  return [
    life("dead", "💀 Dead", "Mark as dead: out of initiative, death saves and Stable cleared", "Revive: remove Dead (heal to bring it back above 0 HP)"),
    life("stable", "Stable", "Stable: at 0 HP but no longer dying (sets HP to 0 if needed)", "Remove Stable (a party member at 0 HP goes back to death saves)"),
    life("dying", "Death Saves", "Making death saving throws: sets HP to 0 and resets the counters (any unit)", "Ends when the unit is healed, made Stable or marked Dead"),
  ];
}

function conditionChips(): Child[] {
  const sys = roomSystem();
  const defs = sys.conditions.filter((c) => !c.automatic && c.key !== "dead" && c.key !== "stable");
  const out: Child[] = defs.map((d) => {
    const state = has((u) => u.state.conditions.some((c) => c.key === d.key));
    return chip(d.label, state, state === "all" ? `Remove ${d.label}` : `Add ${d.label} (no duration)`,
      () => void run(() => toggleConditionOn(obrGateway, ids, d.key, state !== "all", { level: 1 })));
  });
  // Bloodied is worked out from HP: shown, not set.
  const bloodied = has((u) => isBloodied(sys, u.sheet, u.state));
  if (bloodied !== "none") out.push(chip("Bloodied", bloodied, "Bloodied: at half HP or less (automatic, from HP)", null, "auto"));
  // Custom effects on the units, by name.
  const customs = [...new Set(units.flatMap((u) => u.state.conditions.filter((c) => c.key === "custom" && c.label).map((c) => c.label!)))];
  for (const label of customs) {
    const state = has((u) => u.state.conditions.some((c) => c.key === "custom" && c.label === label));
    out.push(chip(`✧ ${label}`, state, `Remove ${label}`, () => void run(() => toggleConditionOn(obrGateway, ids, "custom", false, { label }))));
  }
  return out;
}

function exhaustionRow(): Child {
  const levels = units.map((u) => u.state.conditions.find((c) => c.key === "exhaustion")?.level ?? 0);
  if (!levels.some(Boolean)) return null;
  const same = levels.every((l) => l === levels[0]);
  const lvl = Math.max(...levels);
  const set = (n: number) => void run(() => n <= 0 ? toggleConditionOn(obrGateway, ids, "exhaustion", false) : toggleConditionOn(obrGateway, ids, "exhaustion", true, { level: n }));
  return h("div", { className: "row small", style: "align-items:center;gap:4px" },
    "Exhaustion level",
    h("button", { className: "icon tiny", disabled: busy, onclick: () => set(lvl - 1) }, "−"),
    h("strong", {}, same ? String(lvl) : `up to ${lvl}`),
    h("button", { className: "icon tiny", disabled: busy || lvl >= 6, onclick: () => set(lvl + 1) }, "+"),
    lvl >= 6 ? h("span", { className: "bad" }, "level 6: dead") : null);
}

// ------------------------------------------------------------------ page

function render() {
  const sys = roomSystem();
  const order = turnOrder(allUnits);
  const nodes: Child[] = [
    h("div", { className: "panel stack tight" },
      h("strong", {}, units.length === 1 ? `Change status: ${units[0]!.name}` : `Change status: ${units.length} units`),
      h("div", { className: "small muted" }, units.map((u) => `${u.name} ${u.hp}/${u.maxHp}${u.tempHp ? ` +${u.tempHp}` : ""}`).join(" · ")),
      h("input", { id: "amt", type: "text", inputmode: "numeric", placeholder: "Amount", autofocus: true,
        onkeydown: (e: KeyboardEvent) => { if (e.key === "Enter") applyHp(e.shiftKey ? "heal" : "damage"); } }),
      h("label", { className: "small" }, h("input", { type: "checkbox", checked: half, onchange: (e: Event) => { half = (e.target as HTMLInputElement).checked; } }), "Half damage (a successful save)"),
      h("div", { className: "row", style: "flex-wrap:nowrap" },
        h("button", { className: "grow danger-bg", disabled: busy, onclick: () => applyHp("damage") }, "Damage"),
        h("button", { className: "grow ok-bg", disabled: busy, onclick: () => applyHp("heal") }, "Heal"),
        h("button", { className: "grow secondary", disabled: busy, title: "Temporary HP (keeps the higher value)", onclick: () => applyHp("temp") }, "Temp"),
        h("button", { className: "grow secondary", disabled: busy, title: "Set current HP to this number (up to max HP)", onclick: () => applyHp("set") }, "Set HP")),
      h("div", { className: "small muted" }, "Enter = damage · Shift+Enter = heal")),
    h("div", { className: "panel stack tight" },
      h("strong", { className: "small" }, "Conditions"),
      h("div", { className: "chips status-chips" }, ...lifeChips()),
      h("div", { className: "chips status-chips" }, ...conditionChips()),
      exhaustionRow(),
      h("div", { className: "small muted" }, units.length > 1 ? "Click to turn a condition on or off for all of them." : "Click to turn a condition on or off."),
      h("details", { className: "small" },
        h("summary", {}, "With a duration, a note, or a custom effect…"),
        conditionEditor(sys, [...order, ...allUnits.filter((u) => !order.includes(u))].map((u) => ({ id: u.id, name: u.name })), (c) => void run(async () => {
          await addConditionTo(obrGateway, ids, c.key, c);
          note = `Added ${c.label ?? sys.conditions.find((d) => d.key === c.key)?.label ?? c.key}.`;
        })))),
  ];
  if (note) nodes.push(h("div", { className: "panel small" }, note));
  if (error) nodes.push(h("div", { className: "panel bad small" }, error));
  if (results) nodes.push(h("div", { className: "panel small" }, ...results.map((r) =>
    h("div", {}, h("strong", {}, r.name), r.markedDead ? (r.deadBy === "setting" ? ": at 0 HP, marked dead (room setting)" : r.deadBy === "three-failures" ? ": third death save failure, dead" : ": massive damage at 0 HP, dead") : r.events.length ? `: ${r.events.map((e) => EVENTS[e] ?? e).join(", ")}` : ": done"))));
  const focusWasOnInput = document.activeElement?.id === "amt";
  const val = (document.getElementById("amt") as HTMLInputElement | null)?.value ?? "";
  const openDetails = !!document.querySelector("details[open]");
  app.replaceChildren(...nodes.filter((n): n is Node | string => !!n));
  if (openDetails) document.querySelector("details")?.setAttribute("open", "");
  const inp = document.getElementById("amt") as HTMLInputElement;
  inp.value = results ? "" : val;
  if (focusWasOnInput || (!results && !openDetails && !document.activeElement?.closest(".panel"))) inp.focus();
}

OBR.onReady(async () => {
  await initRoomSettings();
  const read = async () => { allUnits = trackerUnits(await obrGateway.getItems()); units = allUnits.filter((u) => ids.includes(u.id)); };
  await read();
  render();
  OBR.scene.items.onChange(async () => { await read(); if (!document.activeElement?.closest(".condeditor")) render(); });
});
