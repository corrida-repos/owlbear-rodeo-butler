/**
 * Combat HUD (hud.html), opened for players by the background page while combat runs:
 *  - each of their units in the initiative order, with its ◆ Reaction marker the whole combat;
 *  - on that unit's turn, its ● Action and ▲ Bonus Action markers too.
 * Click a marker to mark it spent (dim) or available again (lit). Markers come back when the unit's turn starts.
 * The player's clicks go to the GM's client (a request, like the other player changes); the GM writes directly.
 */
import "../extension/devlog";
import OBR, { type Item } from "@owlbear-rodeo/sdk";
import { controls, portraitUrl, unitName } from "../core/card";
import { currentEconomy, ECONOMY_GLYPH, ECONOMY_LABEL, ownTurnRound, setEconomy, type Economy, type TurnEconomy } from "../core/economy";
import type { SceneItemLite } from "../core/importer";
import { trackerView } from "../core/tracker";
import { openActions } from "../extension/actionsPopover";
import { h, type Child } from "../extension/dom";
import { setHudShown } from "../extension/hudPopover";
import { obrGateway } from "../extension/obrGateway";
import { sendRequest } from "../extension/requests";

const app = document.getElementById("app")!;
let items: Item[] = [];
let lite: SceneItemLite[] = [];
let sceneMeta: Record<string, unknown> = {};
let role: "GM" | "PLAYER" = "PLAYER";
let error = "";
/** Shown right away after a click, until the token's update arrives. */
const optimistic = new Map<string, TurnEconomy>();

async function toggle(unitId: string, k: Economy, eco: TurnEconomy) {
  const spent = !eco[k];
  optimistic.set(unitId, { ...eco, [k]: spent || undefined });
  render();
  try {
    if (role === "GM") await setEconomy(obrGateway, unitId, { [k]: spent });
    else await sendRequest({ type: "economy", unitId, change: { [k]: spent } });
    error = "";
  } catch (e) {
    optimistic.delete(unitId);
    error = e instanceof Error ? e.message : String(e);
    render();
  }
}

function marker(unitId: string, k: Economy, eco: TurnEconomy): HTMLElement {
  const spent = !!eco[k];
  return h("button", {
    className: `hudpip hud-${k}${spent ? " spent" : ""}`,
    title: `${ECONOMY_LABEL[k]}: ${spent ? "spent (click if you didn't use it)" : "available (click when you use it)"}`,
    onclick: () => void toggle(unitId, k, eco),
  }, h("span", { className: "glyph" }, ECONOMY_GLYPH[k]), h("span", { className: "lbl" }, k === "bonus" ? "Bonus" : ECONOMY_LABEL[k]));
}

function render() {
  const v = trackerView(lite, sceneMeta);
  const me = { id: OBR.player.id, role };
  const mine = v.encounter.started ? v.order.filter((u) => { const it = items.find((i) => i.id === u.id); return it && controls(me, it, u.state); }) : [];
  const rows: Child[] = mine.map((u) => {
    const it = items.find((i) => i.id === u.id)!;
    const eco = optimistic.get(u.id) ?? currentEconomy(u.state, ownTurnRound(v.encounter, v.order, u.id));
    const myTurn = v.active === u.id;
    const img = portraitUrl({ imageUrl: (it as any).image?.url }, u.state);
    return h("div", { className: `hudrow${myTurn ? " myturn" : ""}` },
      img ? h("img", { className: "thumb round small", src: img, alt: "" }) : h("div", { className: "thumb empty small" }, "?"),
      h("div", { className: "hudmain" },
        h("div", { className: "hudname" }, unitName({ label: (it as any).text?.plainText, name: it.name }, u.sheet, u.state),
          myTurn ? h("span", { className: "ok" }, " · your turn") : null),
        h("div", { className: "hudpips" },
          myTurn ? marker(u.id, "action", eco) : null,
          myTurn ? marker(u.id, "bonus", eco) : null,
          marker(u.id, "reaction", eco))),
      h("button", { className: "icon tiny", title: "Your actions, explained", onclick: () => void openActions(u.id) }, "⚔"));
  });
  app.replaceChildren(h("div", { className: "hud" },
    h("button", { className: "icon tiny hudclose", title: "Hide for this combat (Encounter Butler panel → Show my combat HUD brings it back)", onclick: () => void setHudShown(false) }, "✕"),
    ...(rows.length ? rows : [h("div", { className: "small muted" }, "Not in combat.")]),
    error ? h("div", { className: "small bad" }, error) : null));
}

OBR.onReady(async () => {
  role = await OBR.player.getRole();
  [items, lite, sceneMeta] = await Promise.all([OBR.scene.items.getItems(), obrGateway.getItems(), OBR.scene.getMetadata()]);
  render();
  OBR.scene.items.onChange(async (i) => { items = i; lite = await obrGateway.getItems(); optimistic.clear(); render(); });
  OBR.scene.onMetadataChange((m) => { sceneMeta = m; optimistic.clear(); render(); });
});
