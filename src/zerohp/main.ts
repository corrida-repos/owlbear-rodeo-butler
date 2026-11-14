/**
 * 0 HP popover (zerohp.html), opened automatically on the controller's client when a unit drops to 0 HP (and at the
 * start of a dying unit's turn):
 *  - Units waiting on a choice: Dead, Death saves, Stable or Alive.
 *  - Units making death saves: roll them here (recorded automatically) or track rolls made at the table.
 * A player sees the units they control; the GM sees the units nobody connected controls, and can show every unit.
 * Closes itself once nothing is left to answer.
 */
import "../extension/devlog";
import OBR from "@owlbear-rodeo/sdk";
import { cryptoRng } from "../core/dice";
import { makeRoll, ROLL_CHANNEL, rollDestination, type Role, type RollMessage, type RollVisibility } from "../core/rolls";
import { zeroHpUnits, type TrackerUnit } from "../core/tracker";
import { h, store, type Child } from "../extension/dom";
import { obrGateway } from "../extension/obrGateway";
import { initRoomSettings } from "../extension/roomSettings";
import { openCard } from "../extension/cardPopover";
import { zeroHpSection } from "../extension/zeroHp";
import { ZERO_HP_POPOVER } from "../extension/zeroHpPopover";

const app = document.getElementById("app")!;
let role: Role = "PLAYER";
let me = { id: "", name: "" };
let playerIds: string[] = [];
let lists: { pending: TrackerUnit[]; dying: TrackerUnit[] } = { pending: [], dying: [] };
let showAll = false;
let hadAny = false;
const notes = new Map<string, { text: string; bad: boolean }>();
let renderPending = false;
document.addEventListener("focusout", () => { if (renderPending) { renderPending = false; setTimeout(render, 0); } });

async function refresh() {
  const items = await obrGateway.getItems();
  lists = zeroHpUnits(items, { id: me.id, role }, playerIds, { all: showAll });
  const any = lists.pending.length + lists.dying.length > 0;
  if (hadAny && !any && !showAll) { await OBR.popover.close(ZERO_HP_POPOVER).catch(() => {}); return; }
  hadAny ||= any;
  render();
}

/** A digital death save: a public d20 (or private, following the card's Public / Private choice). */
async function rollFor(u: TrackerUnit, ev: MouseEvent): Promise<RollMessage | null> {
  const visibility: RollVisibility = store.get("butler.rollVisibility") === "private" ? "private" : "public";
  const mode = ev.shiftKey ? "advantage" : ev.ctrlKey || ev.metaKey ? "disadvantage" : "normal";
  const name = visibility === "public" && u.state.alias?.trim() ? u.state.alias.trim() : u.name;
  const msg = makeRoll("1d20", "Death save", { id: me.id, name: me.name, role }, visibility, { rng: cryptoRng, unit: { id: u.id, name }, kind: "save", mode });
  await OBR.broadcast.sendMessage(ROLL_CHANNEL, msg, { destination: rollDestination(msg) });
  return msg;
}

function unitBlock(u: TrackerUnit): HTMLElement {
  const report = (text: string, bad = false) => { notes.set(u.id, { text, bad }); render(); };
  const note = notes.get(u.id);
  return h("div", { className: "stack tight" },
    h("div", { className: "zero-unit" },
      u.imageUrl ? h("img", { className: "thumb round small", src: u.imageUrl, alt: "" }) : h("div", { className: "thumb empty small" }, "?"),
      h("div", { className: "grow" },
        h("button", { className: "linkish", title: "Open its card", onclick: () => void openCard(u.id) }, u.name),
        h("div", { className: "small muted" }, `${u.hp}/${u.maxHp} HP${u.party ? " · party" : ""}`))),
    zeroHpSection({ unitId: u.id, role, report }, u.state, !u.state.zeroHpPending, (ev) => rollFor(u, ev)),
    note ? h("div", { className: `small ${note.bad ? "bad" : "ok"}` }, note.text) : null);
}

function render() {
  const focused = document.activeElement as HTMLElement | null;
  if (focused && /^(INPUT|SELECT|TEXTAREA)$/.test(focused.tagName) && (focused as HTMLInputElement).type !== "checkbox") { renderPending = true; return; }
  const nodes: Child[] = [];
  const units = [...lists.pending, ...lists.dying];
  if (!units.length) nodes.push(h("div", { className: "panel small muted" }, "Nobody you answer for is at 0 HP."));
  for (const u of units) nodes.push(unitBlock(u));
  if (role === "GM") {
    nodes.push(h("label", { className: "small muted row", title: "Also show units controlled by connected players (they answer for those themselves)" },
      h("input", { type: "checkbox", checked: showAll, onchange: (e: Event) => { showAll = (e.target as HTMLInputElement).checked; void refresh(); } }),
      "Show players' units too"));
  }
  app.replaceChildren(...nodes.filter((n): n is Node | string => !!n));
}

OBR.onReady(async () => {
  const [r, name] = await Promise.all([OBR.player.getRole(), OBR.player.getName()]);
  role = r;
  me = { id: OBR.player.id, name };
  await initRoomSettings();
  const readPlayers = (ps: { id: string; role: Role }[]) => { playerIds = ps.filter((p) => p.role === "PLAYER").map((p) => p.id); };
  readPlayers(await OBR.party.getPlayers());
  OBR.party.onChange((ps) => { readPlayers(ps); void refresh(); });
  await refresh();
  OBR.scene.items.onChange(() => void refresh());
});
