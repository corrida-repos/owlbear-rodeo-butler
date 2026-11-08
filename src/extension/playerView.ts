/**
 * The popover for players: their own units (open the card to roll) and this session's roll log.
 * The full player tracker (F12) builds on this in phase 5.
 */
import OBR, { type Item } from "@owlbear-rodeo/sdk";
import { controls, portraitUrl, unitName } from "../core/card";
import { maxHp } from "../core/sheet";
import { readUnit } from "../core/unit";
import { openCard } from "./cardPopover";
import { h, type Child } from "./dom";
import { renderRollLog } from "./rollLogView";
import { trackerView } from "../core/tracker";
import { obrGateway } from "./obrGateway";
import { sendRequest } from "./requests";
import { roomSettings } from "./roomSettings";
import { followToggle } from "./follow";
import { movementInfo } from "./movementView";
import type { SceneItemLite } from "../core/importer";

let items: Item[] = [];
let lite: SceneItemLite[] = [];
let sceneMeta: Record<string, unknown> = {};
let subscribed = false;
let sent: string | null = null;

/** Round, whose turn it is (players never see hidden units or real names behind an alias), and End my turn. */
function turnPanel(meId: string): Child {
  const v = trackerView(lite, sceneMeta);
  if (!v.encounter.started) return h("div", { className: "panel small muted" }, "Not in combat.", followToggle());
  const visible = v.order.filter((u) => !u.hidden);
  const nameOf = (id?: string) => {
    const u = visible.find((x) => x.id === id);
    if (!u) return null;
    const mine = controls({ id: meId, role: "PLAYER" }, items.find((i) => i.id === u.id) ?? {}, u.state);
    return mine ? u.name : u.state.alias?.trim() || u.name;
  };
  const active = v.order.find((u) => u.id === v.active);
  const activeItem = active && items.find((i) => i.id === active.id);
  const myTurn = !!(active && activeItem && controls({ id: meId, role: "PLAYER" }, activeItem, active.state));
  const key = `${v.encounter.round}:${v.active}`;
  return h("div", { className: `panel${myTurn ? " myturn" : ""}` },
    h("div", { className: "row between" },
      h("span", {}, h("strong", { className: "round" }, `Round ${v.encounter.round}`), nameOf(v.active) ? ` · ${nameOf(v.active)}'s turn` : " · the GM's turn"),
      myTurn && roomSettings().playerEdits
        ? h("button", { disabled: sent === key, onclick: async () => { sent = key; await sendRequest({ type: "end-turn", unitId: active!.id, round: v.encounter.round }); renderAgain(); } }, sent === key ? "Sent…" : "End my turn")
        : null),
    myTurn ? movementInfo(sceneMeta, active!, "PLAYER") : null,
    nameOf(v.next) ? h("div", { className: "small muted" }, `Next: ${nameOf(v.next)}`) : null,
    followToggle());
}
let renderAgain = () => {};

export function renderPlayerView(meId: string): Child[] {
  const turn = turnPanel(meId);
  const mine = items.flatMap((i) => {
    const u = i.layer === "CHARACTER" ? readUnit(i.metadata) : null;
    if (!u || !controls({ id: meId, role: "PLAYER" }, i, u.state)) return [];
    return [{ item: i, ...u }];
  });
  return [
    turn,
    h("div", { className: "panel" },
      h("h2", {}, "My units"),
      mine.length
        ? h("div", {}, ...mine.map(({ item, sheet, state }) => {
          const img = portraitUrl({ imageUrl: (item as any).image?.url }, state);
          return h("div", { className: "entry" },
            img ? h("img", { className: "thumb round", src: img, alt: "" }) : h("div", { className: "thumb empty" }, "?"),
            h("div", { className: "grow" },
              h("div", {}, h("strong", {}, unitName({ label: (item as any).text?.plainText, name: item.name }, sheet))),
              h("div", { className: "small muted" }, `HP ${state.hp}/${maxHp(sheet, state)}${state.tempHp ? ` (+${state.tempHp})` : ""} · AC ${sheet.ac}`)),
            h("button", { onclick: () => void openCard(item.id) }, "Card"));
        }))
        : h("div", { className: "small muted" }, "No units yet. Ask the GM to set you as the controller of your character (unit card → Edit unit → Controlled by).")),
    renderRollLog(),
  ];
}

/** Keeps the player's view current. */
export async function initPlayerItems(onChange: () => void) {
  renderAgain = onChange;
  [items, lite, sceneMeta] = await Promise.all([OBR.scene.items.getItems(), obrGateway.getItems(), OBR.scene.getMetadata()]);
  if (subscribed) return;
  subscribed = true;
  OBR.scene.items.onChange(async (i) => { items = i; lite = await obrGateway.getItems(); onChange(); });
  OBR.scene.onMetadataChange((m) => { sceneMeta = m; onChange(); });
}
