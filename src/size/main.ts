/**
 * Token size popover (size.html?ids=a,b,…), from the right-click menu: Tiny to Gargantuan for the selected tokens.
 * Changes the token on the map only (image grid, scale, snapped position); the stat block keeps its own size, so a
 * temporary change (Enlarge/Reduce) doesn't rewrite the creature.
 */
import "../extension/devlog";
import OBR, { type Image, type Item } from "@owlbear-rodeo/sdk";
import { SIZE_NAMES } from "../core/constants";
import { resizeFor, sizeForCells, tokenCells, TOKEN_SIZES, type TokenSize } from "../core/layout";
import { h } from "../extension/dom";

const app = document.getElementById("app")!;
const ids = (new URLSearchParams(location.search).get("ids") ?? "").split(",").filter(Boolean);
const POPOVER_ID = "dev.owlbear-butler/size";

let tokens: Image[] = [];
let error = "";
let busy = false;

const isImage = (i: Item): i is Image => i.type === "IMAGE" && !!(i as Image).image && !!(i as Image).grid;
const current = (t: Image) => sizeForCells(tokenCells(t.image, t.grid, t.scale));
const label = (t: Image) => (t as Image & { text?: { plainText?: string } }).text?.plainText || t.name;

async function setSize(size: TokenSize) {
  busy = true; error = ""; render();
  try {
    const plans = new Map(tokens.map((t) => [t.id, resizeFor(t.image, size)]));
    // Snap each token's centre for its new footprint (corners for Large/Gargantuan, cell centres otherwise).
    const positions = new Map<string, { x: number; y: number }>();
    for (const t of tokens) {
      const p = plans.get(t.id)!;
      positions.set(t.id, await OBR.scene.grid.snapPosition(t.position, 1, p.snap === "corners", p.snap === "center"));
    }
    await OBR.scene.items.updateItems(tokens.map((t) => t.id), (drafts) => {
      for (const d of drafts as Image[]) {
        const p = plans.get(d.id)!;
        d.grid = { ...d.grid, dpi: p.grid.dpi, offset: p.grid.offset };
        d.scale = p.scale;
        d.position = positions.get(d.id)!;
      }
    });
    await OBR.popover.close(POPOVER_ID);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    busy = false;
    render();
  }
}

function render() {
  const sizes = new Set(tokens.map(current));
  const shared = sizes.size === 1 ? [...sizes][0] : undefined;
  app.replaceChildren(h("div", { className: "panel stack tight" },
    h("strong", {}, tokens.length === 1 ? `Size: ${label(tokens[0]!)}` : `Size: ${tokens.length} tokens`),
    tokens.length ? h("div", { className: "sizegrid" }, ...TOKEN_SIZES.map((s) =>
      h("button", {
        className: s === shared || (s === "S" && shared === "M") ? "" : "secondary",
        disabled: busy,
        title: s === "S" ? "Small fills one cell, like Medium" : undefined,
        onclick: () => void setSize(s),
      }, SIZE_NAMES[s]!))) : h("div", { className: "small muted" }, "These tokens aren't on the map any more."),
    h("div", { className: "small muted" }, "Changes the token on the map. The stat block keeps its own size."),
    error ? h("div", { className: "small bad" }, error) : null));
}

OBR.onReady(async () => {
  tokens = (await OBR.scene.items.getItems(ids)).filter(isImage);
  render();
});
