/**
 * Unit card popover (opened from the token context menu with ?id=<itemId>).
 * Phase 0 spike: shows the token, sends test rolls (public / private) and, for the GM, measures how much metadata
 * Owlbear accepts on one token. The full card (F2) replaces this in phase 2.
 */
import "../extension/devlog";
import OBR, { type Item } from "@owlbear-rodeo/sdk";
import { BUTLER_NS } from "../core/constants";
import { cryptoRng, fmtMod } from "../core/dice";
import { maxHp } from "../core/sheet";
import { readUnit } from "../core/unit";
import { makeRoll, ROLL_CHANNEL, rollDestination, type Role, type RollVisibility } from "../core/rolls";
import { h, store, type Child } from "../extension/dom";

const app = document.getElementById("app")!;
const itemId = new URLSearchParams(location.search).get("id") ?? "";
const SPIKE_KEY = `${BUTLER_NS}/spike-size`;

let item: Item | null = null;
let role: Role = "PLAYER";
let visibility: RollVisibility = store.get("butler.rollVisibility") === "private" ? "private" : "public";
let formula = "1d20+5";
const log: string[] = [];

function render() {
  const nodes: Child[] = [];
  if (!item) {
    nodes.push(h("div", { className: "panel warn" }, "This token is no longer in the scene."));
  } else {
    const img = (item as any).image?.url as string | undefined;
    const name = (item as any).text?.plainText || item.name;
    nodes.push(h("div", { className: "panel row" },
      img ? h("img", { src: img, alt: "", width: 56, height: 56, style: "border-radius:50%;object-fit:cover" }) : null,
      h("div", {}, h("strong", {}, name), h("div", { className: "small muted" }, (() => {
        const u = readUnit(item.metadata);
        if (!u) return "Not a Butler unit";
        const { sheet, state } = u;
        return `${sheet.name} · AC ${sheet.ac} · HP ${state.hp}/${maxHp(sheet, state)}${state.tempHp ? ` (+${state.tempHp} temp)` : ""} · Init ${fmtMod(sheet.initiative.modifier)}`;
      })()))));

    nodes.push(h("div", { className: "panel stack" },
      h("strong", {}, "Test roll"),
      h("div", { className: "row" },
        h("input", { type: "text", value: formula, oninput: (e: Event) => { formula = (e.target as HTMLInputElement).value; } }),
        h("button", { onclick: () => void roll(name) }, "Roll")),
      h("label", { className: "row small" },
        h("input", { type: "checkbox", checked: visibility === "private", onchange: (e: Event) => {
          visibility = (e.target as HTMLInputElement).checked ? "private" : "public";
          store.set("butler.rollVisibility", visibility);
        } }),
        role === "GM" ? "Private (only you see it)" : "Private (only you and the GM see it)")));

    if (role === "GM") {
      nodes.push(h("details", { className: "panel" },
        h("summary", {}, "Diagnostics: metadata size limit"),
        h("p", { className: "small muted" }, "Writes test data of growing size to this token, reads it back, then removes it."),
        h("button", { onclick: () => void sizeTest() }, "Run size test")));
    }
  }
  if (log.length) nodes.push(h("pre", { className: "panel small", style: "white-space:pre-wrap" }, log.join("\n")));
  app.replaceChildren(...nodes.filter((n): n is Node | string => !!n));
}

async function roll(unitName: string) {
  try {
    const msg = makeRoll(formula, "test roll", { id: OBR.player.id, name: await OBR.player.getName(), role }, visibility,
      { rng: cryptoRng, unit: item ? { id: item.id, name: unitName } : undefined });
    await OBR.broadcast.sendMessage(ROLL_CHANNEL, msg, { destination: rollDestination(msg) });
    console.log("[Butler] roll sent", rollDestination(msg), msg.total);
  } catch (e) {
    log.push(`Roll failed: ${e instanceof Error ? e.message : e}`);
    render();
  }
}

async function sizeTest() {
  log.length = 0;
  for (const kb of [8, 16, 32, 64, 128, 256]) {
    const payload = "x".repeat(kb * 1024);
    try {
      await OBR.scene.items.updateItems([itemId], (ds) => { for (const d of ds) d.metadata[SPIKE_KEY] = payload; });
      await new Promise((r) => setTimeout(r, 400));
      const [back] = await OBR.scene.items.getItems([itemId]);
      const got = back?.metadata[SPIKE_KEY];
      log.push(`${kb} kB: ${typeof got === "string" && got.length === payload.length ? "OK" : `not stored (read back ${typeof got === "string" ? got.length : 0} bytes)`}`);
    } catch (e) {
      log.push(`${kb} kB: error: ${e instanceof Error ? e.message : JSON.stringify(e)}`);
    }
    render();
  }
  try {
    await OBR.scene.items.updateItems([itemId], (ds) => { for (const d of ds) delete d.metadata[SPIKE_KEY]; });
    log.push("Test data removed.");
  } catch (e) {
    log.push(`Cleanup failed: ${e instanceof Error ? e.message : e}`);
  }
  console.log("[Butler] metadata size test", log.join(" | "));
  render();
}

OBR.onReady(async () => {
  role = await OBR.player.getRole();
  [item = null] = await OBR.scene.items.getItems([itemId]);
  render();
  OBR.scene.items.onChange((items) => { item = items.find((i) => i.id === itemId) ?? null; render(); });
});
