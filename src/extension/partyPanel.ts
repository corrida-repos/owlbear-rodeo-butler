/**
 * Party view (F13), top of the GM's "Add Party" tab: which units are party members (PCs, companions, sidekicks),
 * which player controls each (stored by Owlbear user id, so it survives reconnects), level and HP, quick add/remove.
 * The controller is who gets "your turn" notices, the full card and the player's edits.
 */
import OBR, { type Player } from "@owlbear-rodeo/sdk";
import { STATE_KEY } from "../core/sheet";
import { setParty, trackerUnits, type TrackerUnit } from "../core/tracker";
import { openCard } from "./cardPopover";
import { action, h, rerender, type Child } from "./dom";
import { obrGateway } from "./obrGateway";

let units: TrackerUnit[] | null = null;
let players: Player[] = [];
let addOpen = false;
let subscribed = false;

export async function refreshPartyPanel() {
  units = trackerUnits(await obrGateway.getItems());
  if (!subscribed) {
    subscribed = true;
    players = await OBR.party.getPlayers();
    OBR.party.onChange((p) => { players = p; rerender(); });
  }
  const a = document.activeElement;
  if (a && a.closest("#app") && a.tagName === "SELECT") return; // don't close an open player list
  rerender();
}
export function resetPartyPanel() { units = null; }

const setController = (id: string, playerId: string) =>
  obrGateway.patchMetadata([{ id, key: STATE_KEY, patch: { controlledBy: playerId || undefined } }]);

export function renderPartyPanel(): Child {
  if (!units) { void refreshPartyPanel(); return h("div", { className: "panel small muted" }, "Reading the party…"); }
  const party = units.filter((u) => u.party).sort((a, b) => a.name.localeCompare(b.name));
  const others = units.filter((u) => !u.party && !u.dead).sort((a, b) => a.name.localeCompare(b.name));
  const known = [...new Map(players.filter((p) => p.role === "PLAYER").map((p) => [p.id, p])).values()];
  const playerSelect = (u: TrackerUnit) => h("select", { className: "small", onchange: (e: Event) => void action(() => setController(u.id, (e.target as HTMLSelectElement).value))() },
    h("option", { value: "", selected: !u.state.controlledBy }, "GM"),
    ...known.map((p) => h("option", { value: p.id, selected: p.id === u.state.controlledBy }, p.name)),
    u.state.controlledBy && !known.some((p) => p.id === u.state.controlledBy) ? h("option", { value: u.state.controlledBy, selected: true }, "(not connected)") : null);
  return h("div", { className: "panel" },
    h("h2", {}, `Party (${party.length})`),
    party.length
      ? h("table", {},
        h("thead", {}, h("tr", {}, h("th", {}, "Name"), h("th", {}, "Lvl"), h("th", {}, "HP"), h("th", {}, "Player"), h("th", {}, ""))),
        h("tbody", {}, ...party.map((u) => h("tr", {},
          h("td", {}, h("button", { className: "linkish", onclick: () => void openCard(u.id) }, u.name)),
          h("td", { className: "num" }, u.sheet.level ? String(u.sheet.level) : "–"),
          h("td", { className: "num" }, `${u.hp}/${u.maxHp}`),
          h("td", {}, playerSelect(u)),
          h("td", {}, h("button", { className: "icon tiny", title: "Remove from the party", onclick: action(() => setParty(obrGateway, [u.id], false)) }, "✕"))))))
      : h("div", { className: "small muted" }, "No party members in this scene yet: sync from D&D Beyond below, or add a unit that's already here."),
    h("div", { className: "small muted", style: "margin-top:4px" }, "The player chosen here gets turn notices, the unit's full card and its edits."),
    others.length ? h("details", { open: addOpen, style: "margin-top:6px", ontoggle: (e: Event) => { addOpen = (e.target as HTMLDetailsElement).open; } },
      h("summary", { className: "small" }, `Add a unit that's already in the scene (${others.length})`),
      ...others.map((u) => h("div", { className: "row between small", style: "margin-top:4px" },
        h("button", { className: "linkish", onclick: () => void openCard(u.id) }, u.name),
        h("button", { className: "secondary small", onclick: action(() => setParty(obrGateway, [u.id], true)) }, "Add to party")))) : null);
}
