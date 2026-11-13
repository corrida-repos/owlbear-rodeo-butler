/**
 * Token size popover (size.html?ids=a,b,…), from the right-click menu: Tiny to Gargantuan for the selected tokens.
 * Changes the token on the map only (image grid, scale, snapped position); the stat block keeps its own size, so a
 * temporary change (Enlarge/Reduce) doesn't rewrite the creature.
 *  - GM: resized straight away.
 *  - Player (their own tokens): a request the GM's client checks and applies, like other player edits, so it follows
 *    the room's Player edits setting.
 */
import "../extension/devlog";
import OBR, { type Image, type Item } from "@owlbear-rodeo/sdk";
import { SIZE_NAMES } from "../core/constants";
import { sizeForCells, tokenCells, TOKEN_SIZES, type TokenSize } from "../core/layout";
import { h } from "../extension/dom";
import { sendRequest } from "../extension/requests";
import { initRoomSettings, onRoomSettings, roomSettings } from "../extension/roomSettings";
import { applyTokenSize } from "../extension/tokenSize";

const app = document.getElementById("app")!;
const ids = (new URLSearchParams(location.search).get("ids") ?? "").split(",").filter(Boolean);
const POPOVER_ID = "dev.owlbear-butler/size";

let tokens: Image[] = [];
let role: "GM" | "PLAYER" = "PLAYER";
let error = "";
let note = "";
let busy = false;

const isImage = (i: Item): i is Image => i.type === "IMAGE" && !!(i as Image).image && !!(i as Image).grid;
const current = (t: Image) => sizeForCells(tokenCells(t.image, t.grid, t.scale));
const label = (t: Image) => (t as Image & { text?: { plainText?: string } }).text?.plainText || t.name;

async function setSize(size: TokenSize) {
  busy = true; error = ""; note = ""; render();
  try {
    if (role === "GM") {
      await applyTokenSize(tokens.map((t) => t.id), size);
      await OBR.popover.close(POPOVER_ID);
      return;
    }
    for (const t of tokens) await sendRequest({ type: "token-size", unitId: t.id, size });
    note = `Sent: the GM's Encounter Butler resizes ${tokens.length === 1 ? "your token" : "your tokens"} to ${SIZE_NAMES[size]} in a moment.`;
    setTimeout(() => void OBR.popover.close(POPOVER_ID), 1500);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  busy = false;
  render();
}

function render() {
  const sizes = new Set(tokens.map(current));
  const shared = sizes.size === 1 ? [...sizes][0] : undefined;
  const blocked = role === "PLAYER" && !roomSettings().playerEdits;
  app.replaceChildren(h("div", { className: "panel stack tight" },
    h("strong", {}, tokens.length === 1 ? `Size: ${label(tokens[0]!)}` : `Size: ${tokens.length} tokens`),
    blocked ? h("div", { className: "small warn" }, "The GM has turned player edits off, so only the GM can resize tokens right now.")
      : tokens.length ? h("div", { className: "sizegrid" }, ...TOKEN_SIZES.map((s) =>
        h("button", {
          className: s === shared || (s === "S" && shared === "M") ? "" : "secondary",
          disabled: busy,
          title: s === "S" ? "Small fills one cell, like Medium" : undefined,
          onclick: () => void setSize(s),
        }, SIZE_NAMES[s]!))) : h("div", { className: "small muted" }, "These tokens aren't on the map any more."),
    h("div", { className: "small muted" }, role === "GM" ? "Changes the token on the map. The stat block keeps its own size."
      : "Changes your token on the map. The GM's Encounter Butler applies it, so the GM needs to be in the room."),
    note ? h("div", { className: "small ok" }, note) : null,
    error ? h("div", { className: "small bad" }, error) : null));
}

OBR.onReady(async () => {
  role = await OBR.player.getRole();
  await initRoomSettings();
  onRoomSettings(() => render());
  tokens = (await OBR.scene.items.getItems(ids)).filter(isImage);
  render();
});
