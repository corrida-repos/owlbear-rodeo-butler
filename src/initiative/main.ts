/**
 * Manage initiative popover (initiative.html?ids=a,b,c), opened from the context menu on one or more selected units:
 * add them to the fight or take them out, roll their initiative (all, or only those without one), or type a value.
 * Each unit's row shows its modifier, its current initiative (and how it was rolled) and where it stands in the order.
 */
import "../extension/devlog";
import OBR from "@owlbear-rodeo/sdk";
import { describeInitiative, fmtMod } from "../core/dice";
import { rollInitiativeFor, setInEncounter, setInitiative, trackerView, type TrackerView, type TrackerUnit } from "../core/tracker";
import { h, type Child } from "../extension/dom";
import { obrGateway } from "../extension/obrGateway";
import { initRoomSettings, roomSystem } from "../extension/roomSettings";

const app = document.getElementById("app")!;
const ids = (new URLSearchParams(location.search).get("ids") ?? "").split(",").filter(Boolean);
let view: TrackerView | null = null;
let units: TrackerUnit[] = [];
let error = "";
let busy = false;

async function run(fn: () => Promise<unknown>) {
  if (busy) return;
  busy = true;
  try { await fn(); error = ""; } catch (e) { error = e instanceof Error ? e.message : String(e); }
  busy = false;
  await read();
  render();
}

const roll = (which: string[]) => run(() => rollInitiativeFor(obrGateway, which, { rules: roomSystem().rules }));

async function typed(u: TrackerUnit, raw: string) {
  const v = raw.trim();
  if (v === "" ? u.initiative === null : Number(v) === u.initiative) return;
  if (v !== "" && !/^-?\d{1,3}$/.test(v)) { error = "Initiative is a whole number."; render(); return; }
  await run(async () => {
    await setInitiative(obrGateway, u.id, v === "" ? null : Number(v));
    // Typing a value for someone outside the fight brings them in.
    if (v !== "" && !u.inEncounter) await setInEncounter(obrGateway, [u.id], true);
  });
}

function row(u: TrackerUnit): HTMLElement {
  const pos = view!.order.findIndex((o) => o.id === u.id);
  const rolled = u.state.initiativeRoll;
  return h("div", { className: "init-row" },
    h("label", { className: "init-in", title: u.inEncounter ? "In the fight: uncheck to take it out" : "Not in the fight: check to add it" },
      h("input", { type: "checkbox", checked: u.inEncounter, disabled: busy, onchange: (e: Event) => void run(() => setInEncounter(obrGateway, [u.id], (e.target as HTMLInputElement).checked)) })),
    h("div", { className: "grow" },
      h("div", {}, h("strong", {}, u.name), view!.active === u.id ? h("span", { className: "small ok" }, " · their turn") : null),
      h("div", { className: "small muted" },
        `Initiative ${fmtMod(u.initMod)}`,
        rolled && u.initiative === rolled.total ? ` · rolled ${describeInitiative(rolled)}` : "",
        !u.inEncounter ? " · not in the fight" : pos >= 0 ? ` · ${ordinal(pos + 1)} of ${view!.order.length}` : " · waiting for initiative")),
    h("input", { type: "text", inputmode: "numeric", className: "lvl init-val", value: u.initiative === null ? "" : String(u.initiative), placeholder: "–", disabled: busy, title: "Type an initiative (Enter); empty clears it",
      onkeydown: (e: KeyboardEvent) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); },
      onchange: (e: Event) => void typed(u, (e.target as HTMLInputElement).value) }),
    h("button", { className: "icon tiny", title: `Roll initiative for ${u.name}`, disabled: busy, onclick: () => void roll([u.id]) }, "🎲"));
}

const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th"}`;

function render() {
  if (!view) return;
  const out = units.filter((u) => !u.inEncounter).map((u) => u.id);
  const unrolled = units.filter((u) => u.initiative === null).map((u) => u.id);
  const enc = view.encounter;
  const nodes: Child[] = [
    h("div", { className: "panel stack tight" },
      h("strong", {}, units.length === 1 ? `Manage initiative: ${units[0]!.name}` : `Manage initiative: ${units.length} units`),
      h("div", { className: "small muted" }, enc.started ? `Combat: round ${enc.round}, ${view.order.length} in the order.` : "Combat hasn't started (Tracker tab → Start combat)."),
      h("div", { className: "row", style: "flex-wrap:wrap;gap:4px" },
        h("button", { className: "grow", disabled: busy || !units.length, onclick: () => void roll(ids) }, units.length === 1 ? "Roll initiative" : "Roll for all"),
        units.length > 1 && unrolled.length && unrolled.length < units.length ? h("button", { className: "grow secondary", disabled: busy, onclick: () => void roll(unrolled) }, `Roll for the ${unrolled.length} without one`) : null),
      h("div", { className: "row", style: "flex-wrap:wrap;gap:4px" },
        out.length ? h("button", { className: "grow secondary", disabled: busy, title: "Join the fight (they wait for an initiative if they have none)", onclick: () => void run(() => setInEncounter(obrGateway, out, true)) }, units.length === 1 ? "Add to initiative" : `Add ${out.length === units.length ? "all" : out.length} to initiative`) : null,
        out.length < units.length ? h("button", { className: "grow secondary", disabled: busy, title: "Leave the fight (the turn passes on if it was theirs)", onclick: () => void run(() => setInEncounter(obrGateway, units.filter((u) => u.inEncounter).map((u) => u.id), false)) }, units.length === 1 ? "Remove from initiative" : `Remove ${out.length ? units.length - out.length : "all"} from initiative`) : null),
      h("div", { className: "small muted" }, "Rolling uses each unit's modifier and advantage, and adds it to the fight.")),
    h("div", { className: "panel stack tight" }, ...units.map(row)),
  ];
  if (error) nodes.push(h("div", { className: "panel bad small" }, error));
  const focused = (document.activeElement as HTMLElement | null)?.classList.contains("init-val");
  if (focused) return; // don't wipe a value being typed
  app.replaceChildren(...nodes.filter((n): n is Node | string => !!n));
}

async function read() {
  const [items, meta] = await Promise.all([obrGateway.getItems(), OBR.scene.getMetadata()]);
  view = trackerView(items, meta);
  const all = [...view.order, ...view.waiting, ...view.outside];
  units = ids.map((id) => all.find((u) => u.id === id)).filter((u): u is TrackerUnit => !!u);
}

OBR.onReady(async () => {
  await initRoomSettings();
  await read();
  render();
  OBR.scene.items.onChange(async () => { await read(); render(); });
  OBR.scene.onMetadataChange(async () => { await read(); render(); });
});
