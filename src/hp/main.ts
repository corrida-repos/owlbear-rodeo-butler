/**
 * Damage / heal popover (hp.html?ids=a,b,c), opened from the context menu on one or more selected units:
 * one amount applied to all of them (e.g. every goblin caught in a Fireball).
 */
import "../extension/devlog";
import OBR from "@owlbear-rodeo/sdk";
import type { HpChange } from "../core/hp";
import { changeHp, trackerUnits, type HpReport, type TrackerUnit } from "../core/tracker";
import { h, type Child } from "../extension/dom";
import { obrGateway } from "../extension/obrGateway";
import { initRoomSettings, roomSettings } from "../extension/roomSettings";

const app = document.getElementById("app")!;
const ids = (new URLSearchParams(location.search).get("ids") ?? "").split(",").filter(Boolean);
let units: TrackerUnit[] = [];
let results: HpReport[] | null = null;
let error = "";
let half = false;

const EVENTS: Record<string, string> = {
  "creature-at-zero": "at 0 HP", "dropped-to-zero": "down: death saves", "death-save-failure": "death save failure",
  "three-failures": "three failures", "massive-damage": "massive damage", "stable-lost": "no longer Stable", "revived-from-zero": "back up",
};

async function apply(kind: HpChange["kind"]) {
  const amount = Math.floor(Number((document.getElementById("amt") as HTMLInputElement).value));
  if (!(amount >= 0)) { error = "Enter a number."; render(); return; }
  try {
    const n = kind === "damage" && half ? Math.floor(amount / 2) : amount;
    results = await changeHp(obrGateway, ids, { kind, amount: n }, { autoDeadAtZero: roomSettings().autoDeadAtZero });
    error = "";
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  render();
}

function render() {
  const nodes: Child[] = [
    h("div", { className: "panel stack tight" },
      h("strong", {}, units.length === 1 ? units[0]!.name : `${units.length} units`),
      h("div", { className: "small muted" }, units.map((u) => `${u.name} ${u.hp}/${u.maxHp}${u.tempHp ? ` +${u.tempHp}` : ""}`).join(" · ")),
      h("input", { id: "amt", type: "text", inputmode: "numeric", placeholder: "Amount", autofocus: true,
        onkeydown: (e: KeyboardEvent) => { if (e.key === "Enter") void apply(e.shiftKey ? "heal" : "damage"); } }),
      h("label", { className: "small" }, h("input", { type: "checkbox", checked: half, onchange: (e: Event) => { half = (e.target as HTMLInputElement).checked; } }), "Half damage (a successful save)"),
      h("div", { className: "row", style: "flex-wrap:nowrap" },
        h("button", { className: "grow danger-bg", onclick: () => void apply("damage") }, "Damage"),
        h("button", { className: "grow ok-bg", onclick: () => void apply("heal") }, "Heal"),
        h("button", { className: "grow secondary", onclick: () => void apply("temp") }, "Temp HP")),
      h("div", { className: "small muted" }, "Enter = damage · Shift+Enter = heal")),
  ];
  if (error) nodes.push(h("div", { className: "panel bad small" }, error));
  if (results) nodes.push(h("div", { className: "panel small" }, ...results.map((r) =>
    h("div", {}, h("strong", {}, r.name), r.markedDead ? ": at 0 HP, marked dead" : r.events.length ? `: ${r.events.map((e) => EVENTS[e] ?? e).join(", ")}` : ": done"))));
  const focusWasOnInput = document.activeElement?.id === "amt";
  const val = (document.getElementById("amt") as HTMLInputElement | null)?.value ?? "";
  app.replaceChildren(...nodes.filter((n): n is Node | string => !!n));
  const inp = document.getElementById("amt") as HTMLInputElement;
  inp.value = results ? "" : val;
  if (focusWasOnInput || !results) inp.focus();
}

OBR.onReady(async () => {
  await initRoomSettings();
  const read = async () => { units = trackerUnits(await obrGateway.getItems()).filter((u) => ids.includes(u.id)); };
  await read();
  render();
  OBR.scene.items.onChange(async () => { await read(); render(); });
});
