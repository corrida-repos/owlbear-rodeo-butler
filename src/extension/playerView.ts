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

let items: Item[] = [];
let subscribed = false;

export function renderPlayerView(meId: string): Child[] {
  const mine = items.flatMap((i) => {
    const u = i.layer === "CHARACTER" ? readUnit(i.metadata) : null;
    if (!u || !controls({ id: meId, role: "PLAYER" }, i, u.state)) return [];
    return [{ item: i, ...u }];
  });
  return [
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
  items = await OBR.scene.items.getItems();
  if (subscribed) return;
  subscribed = true;
  OBR.scene.items.onChange((i) => { items = i; onChange(); });
}
