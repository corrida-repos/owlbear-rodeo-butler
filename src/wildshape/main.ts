/**
 * Wild Shape popover (wildshape.html?id=<itemId>), opened from the token's context menu or the unit card.
 *  - Known Shapes: pick beasts from the 5etools bestiary (Beast type, up to the druid's max CR; swim/fly speeds
 *    checked when added), within the edition's limit on Known Forms.
 *  - Transform into a Known Shape (token picture and stat block change) and revert.
 * The GM acts directly; the druid's player sends requests that the GM's client checks and applies (core/turns.ts).
 */
import "../extension/devlog";
import OBR, { type Item } from "@owlbear-rodeo/sdk";
import { controls, unitName } from "../core/card";
import { SIZE_NAMES } from "../core/constants";
import { convertMonster } from "../core/fivetools";
import { crValue, type IndexRow } from "../core/search";
import { searchableSource } from "../core/systems";
import type { WildShapeOp } from "../core/turns";
import { readUnit } from "../core/unit";
import {
  addKnownShape, crText, detectWildShape, isBeast, knownShapeFrom, readWildShape, removeKnownShape, removeWildShape, resetWildShapeUses,
  revertWildShape, setupWildShape, shapeProblem, transformUnit, wildShapeLimits, type KnownShape, type WildShapeData,
} from "../core/wildshape";
import { fetchMonsterIndex, fivetoolsImage, getLib } from "../extension/bestiary";
import { h, type Child } from "../extension/dom";
import { obrGateway } from "../extension/obrGateway";
import { sendRequest } from "../extension/requests";
import { initRoomSettings, onRoomSettings, roomSystem } from "../extension/roomSettings";

const app = document.getElementById("app")!;
const itemId = new URLSearchParams(location.search).get("id") ?? "";

let item: Item | null = null;
let role: "GM" | "PLAYER" = "PLAYER";
let meId = "";
let index: IndexRow[] | null = null;
let query = "";
let busy = "";
let error = "";
let note = "";
let renderPending = false;
document.addEventListener("focusout", () => { if (renderPending) { renderPending = false; setTimeout(render, 0); } });

const rules = () => roomSystem().rules;
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** GM-only actions (druid level, removing Wild Shape). */
async function gmAct(label: string, fn: () => Promise<unknown>) {
  busy = label; error = ""; note = ""; render();
  try { await fn(); } catch (e) { error = msg(e); }
  busy = ""; render();
}

/** GM: straight to the scene. Player: a request the GM's client applies (it needs a GM in the room). */
async function act(label: string, gm: () => Promise<unknown>, player: WildShapeOp, sent: string) {
  busy = label; error = ""; note = ""; render();
  try {
    if (role === "GM") await gm();
    else { await sendRequest({ type: "wild-shape", unitId: itemId, ...player }); note = sent; }
  } catch (e) { error = msg(e); }
  busy = ""; render();
}

async function loadBeast(name: string, source: string) {
  const L = await getLib();
  const ft = await L.prepare(name, source);
  const sheet = convertMonster(ft.monster, { catalogEntry: ft.catalogEntry, copyChain: ft.copyChain, copyNotes: ft.copyNotes });
  return { sheet, monster: ft.monster };
}

async function addShape(r: IndexRow, ws: WildShapeData) {
  busy = `Checking ${r.name}…`; error = ""; note = ""; render();
  let shape: KnownShape;
  try {
    const { sheet } = await loadBeast(r.name, r.source);
    if (!isBeast(sheet.type)) throw new Error(`${r.name} isn't a beast.`);
    shape = knownShapeFrom(sheet, r.source, r.book);
    const problem = shapeProblem(shape, wildShapeLimits(rules(), ws.druidLevel, ws.moon));
    if (problem) throw new Error(`${r.name}: ${problem}.`);
  } catch (e) { error = msg(e); busy = ""; render(); return; }
  query = "";
  await act(`Adding ${r.name}…`, () => addKnownShape(obrGateway, itemId, shape, rules()), { op: "known-add", shape }, `Asked the GM's client to add ${r.name}.`);
}

async function transform(k: KnownShape) {
  busy = `Loading ${k.name}…`; error = ""; note = ""; render();
  let beast: Awaited<ReturnType<typeof loadBeast>>;
  let image: Awaited<ReturnType<typeof fivetoolsImage>>["image"];
  try {
    beast = await loadBeast(k.name, k.source);
    image = (await fivetoolsImage(beast.monster)).image;
  } catch (e) { error = msg(e); busy = ""; render(); return; }
  const form = { name: k.name, source: k.source };
  await act(`Turning into ${k.name}…`, async () => {
    const r = await transformUnit(obrGateway, itemId, beast.sheet, image, { rules: rules(), form });
    await OBR.notification.show(`${r.name} turns into a ${r.form}.${r.warnings.length ? ` ${r.warnings.join(" ")}` : ""}`, r.warnings.length ? "WARNING" : "SUCCESS");
  }, { op: "transform", form, sheet: beast.sheet, image }, `Asked the GM's client to turn you into a ${k.name}.`);
}

// ------------------------------------------------------------------ rendering

function setupPanel(ws: WildShapeData | null, detected: ReturnType<typeof detectWildShape>): Child {
  if (role !== "GM") return ws ? null : h("div", { className: "panel warn" }, "Wild Shape isn't set up for this character yet. Ask the GM to set it up (right-click the token → Set up Wild Shape).");
  const level = h("input", { type: "text", inputmode: "numeric", value: String(ws?.druidLevel ?? detected?.druidLevel ?? 2), style: "width:60px" }) as HTMLInputElement;
  const moon = h("input", { type: "checkbox", checked: ws?.moon ?? detected?.moon ?? false }) as HTMLInputElement;
  const save = () => void gmAct("Saving…", () => setupWildShape(obrGateway, itemId, { druidLevel: Number(level.value), moon: moon.checked }));
  const body = [
    h("div", { className: "row" }, h("span", { className: "small" }, "Druid level"), level,
      h("label", { className: "small", style: "align-items:center" }, moon, "Circle of the Moon")),
    ws?.auto ? h("div", { className: "small muted" }, "Read from the character sheet; follows level-ups until you change it here.") : null,
    !ws && detected ? h("div", { className: "small muted" }, `Found on the sheet: druid level ${detected.druidLevel}${detected.moon ? ", Circle of the Moon" : ""}.`) : null,
    h("div", { className: "row" }, h("button", { onclick: save }, ws ? "Save" : "Set up Wild Shape"),
      ws ? h("button", { className: "secondary", onclick: () => void gmAct("Removing…", () => removeWildShape(obrGateway, itemId)) }, "Remove Wild Shape") : null),
  ];
  return ws
    ? h("details", { className: "panel" }, h("summary", { className: "small" }, "Druid level and circle (GM)"), h("div", { className: "stack tight", style: "margin-top:8px" }, ...body))
    : h("div", { className: "panel stack tight" }, h("strong", {}, "Set up Wild Shape"), ...body);
}

function rulesPanel(ws: WildShapeData): Child {
  const lim = wildShapeLimits(rules(), ws.druidLevel, ws.moon);
  const spent = ws.usesSpent ?? 0;
  const usesText = lim.uses === Infinity ? "Unlimited uses" : `Uses: ${Math.max(0, lim.uses - spent)} of ${lim.uses} left`;
  return h("div", { className: "panel stack tight" },
    h("div", { className: "row between" },
      h("strong", {}, `Druid ${ws.druidLevel}${ws.moon ? " · Circle of the Moon" : ""}`),
      h("span", { className: "small muted" }, roomSystem().label)),
    !lim.available ? h("div", { className: "small warn" }, "Wild Shape starts at druid level 2.") : null,
    h("ul", { className: "plain small" }, ...lim.summary.map((l) => h("li", {}, l))),
    h("div", { className: "row between" },
      h("span", { className: `small${lim.uses !== Infinity && spent >= lim.uses ? " warn" : ""}` }, usesText),
      spent ? h("button", { className: "secondary small", disabled: !!busy, onclick: () => void act("Resting…", () => resetWildShapeUses(obrGateway, itemId), { op: "rest" }, "Asked the GM's client to restore your uses.") }, "Rest: restore uses") : null));
}

function activePanel(ws: WildShapeData, hp: { hp: number; tempHp: number; max: number }): Child {
  const a = ws.active;
  if (!a) return null;
  return h("div", { className: "panel stack tight", style: "border-color:var(--ok)" },
    h("div", { className: "row between" },
      h("strong", {}, `In the shape of a ${a.form.name}`),
      h("span", { className: "small" }, `HP ${hp.hp}/${hp.max}${hp.tempHp ? ` +${hp.tempHp}` : ""}`)),
    h("div", { className: "small muted" }, a.rules === "2014"
      ? `At 0 HP you return to your normal form with ${a.original.hp} HP, minus any leftover damage.`
      : "At 0 HP you return to your normal form."),
    h("button", { disabled: !!busy, onclick: () => void act("Reverting…", () => revertWildShape(obrGateway, itemId), { op: "revert" }, "Asked the GM's client to end your Wild Shape.") }, "Revert to normal form"));
}

function knownPanel(ws: WildShapeData): Child {
  const lim = wildShapeLimits(rules(), ws.druidLevel, ws.moon);
  const speeds = (k: KnownShape) => [k.swim ? "swim" : "", k.fly ? "fly" : ""].filter(Boolean).join(", ");
  return h("div", { className: "panel" },
    h("div", { className: "row between" }, h("strong", {}, "Known Shapes"),
      h("span", { className: "small muted" }, lim.maxKnown === null ? `${ws.known.length} known` : `${ws.known.length} of ${lim.maxKnown}`)),
    ws.known.length ? h("div", {}, ...ws.known.map((k) => {
      const problem = shapeProblem(k, lim);
      const current = ws.active && ws.active.form.name === k.name && ws.active.form.source === k.source;
      return h("div", { className: "entry", style: "align-items:center" },
        h("div", { className: "grow" },
          h("div", {}, h("strong", {}, k.name), current ? h("span", { className: "badge", style: "margin-left:6px" }, "current") : null),
          h("div", { className: "small muted" }, `CR ${k.cr || "—"} · ${SIZE_NAMES[k.size] ?? k.size}${speeds(k) ? ` · ${speeds(k)}` : ""} · ${k.book ?? k.source}`),
          problem ? h("div", { className: "small warn" }, `Not now: ${problem}`) : null),
        h("button", { disabled: !!busy || !!problem || !!current, onclick: () => void transform(k), title: problem ?? `Turn into ${k.name}` }, "Transform"),
        h("button", { className: "secondary", disabled: !!busy, title: "Forget this shape",
          onclick: () => void act(`Removing ${k.name}…`, () => removeKnownShape(obrGateway, itemId, k), { op: "known-remove", shape: { name: k.name, source: k.source } }, `Asked the GM's client to remove ${k.name}.`) }, "✕"));
    })) : h("div", { className: "small muted", style: "margin-top:6px" }, "No Known Shapes yet. Add beasts below."));
}

function addPanel(ws: WildShapeData): Child {
  const lim = wildShapeLimits(rules(), ws.druidLevel, ws.moon);
  if (!lim.available) return null;
  const full = lim.maxKnown !== null && ws.known.length >= lim.maxKnown;
  const input = h("input", { type: "text", id: "beast-q", autocomplete: "off", value: query, placeholder: index ? `Search beasts up to CR ${crText(lim.maxCr)}…` : "Loading the 5etools list…",
    oninput: (e: Event) => { query = (e.target as HTMLInputElement).value; drawResults(); } }) as HTMLInputElement;
  const results = h("div", { id: "beast-results" });
  const drawResults = () => results.replaceChildren(...beastResults(ws).filter((n): n is Node | string => !!n));
  drawResults();
  return h("div", { className: "panel stack tight" },
    h("strong", {}, "Add a Known Shape"),
    full ? h("div", { className: "small warn" }, `You know ${lim.maxKnown} forms, the most at druid level ${ws.druidLevel}. Remove one to learn another.`) : null,
    full ? null : input,
    full ? null : results,
    full ? null : h("div", { className: "small muted" }, `5etools beasts of CR ${crText(lim.maxCr)} or lower${!lim.fly ? "; flying speeds are checked when you add one" : ""}${!lim.swim ? ", and swimming speeds" : ""}.`));
}

function beastResults(ws: WildShapeData): Child[] {
  if (!index) return [];
  const lim = wildShapeLimits(rules(), ws.druidLevel, ws.moon);
  const sys = roomSystem();
  const q = query.trim().toLowerCase();
  const pool = index.filter((r) => r.type.toLowerCase().split("/").includes("beast") && searchableSource(sys, r.source)
    && (crValue(r.cr) ?? 99) <= lim.maxCr && !ws.known.some((k) => k.name === r.name && k.source === r.source));
  const rows = (q.length >= 2 ? pool.filter((r) => r.name.toLowerCase().includes(q)) : pool)
    .sort((a, b) => (q && a.name.toLowerCase().startsWith(q) ? 0 : 1) - (q && b.name.toLowerCase().startsWith(q) ? 0 : 1)
      || (b.rules === sys.rules ? 1 : 0) - (a.rules === sys.rules ? 1 : 0) || (crValue(b.cr) ?? 0) - (crValue(a.cr) ?? 0) || a.name.localeCompare(b.name));
  const shown = rows.slice(0, 40);
  if (!shown.length) return [h("div", { className: "small muted" }, q.length >= 2 ? "No beast by that name within your CR." : "No beasts found.")];
  return [
    h("div", { className: "small muted" }, rows.length > shown.length ? `${rows.length} beasts, showing ${shown.length}${q ? "" : " (highest CR first)"}` : `${rows.length} beast${rows.length === 1 ? "" : "s"}`),
    h("ul", { className: "results" }, ...shown.map((r) =>
      h("li", { onclick: () => { if (!busy) void addShape(r, ws); }, title: `Add ${r.name}` },
        h("span", { className: "rname" }, r.name),
        h("span", { className: "muted small" }, ` CR ${r.cr} · ${SIZE_NAMES[r.size] ?? r.size} · ${r.book}`),
        r.rules === "2024" ? h("span", { className: "badge" }, "2024") : null,
        h("span", { className: "add" }, "+")))),
  ];
}

function render() {
  const focused = document.activeElement as HTMLElement | null;
  if (focused && /^(INPUT|SELECT|TEXTAREA)$/.test(focused.tagName) && (focused as HTMLInputElement).type !== "checkbox" && focused.id !== "beast-q") { renderPending = true; return; }
  const keepFocus = focused?.id === "beast-q";
  const nodes: Child[] = [];
  const u = item ? readUnit(item.metadata) : null;
  if (!item || !u) nodes.push(h("div", { className: "panel warn" }, item ? "This token isn't an Encounter Butler unit." : "This token is no longer in the scene."));
  else {
    const info = { createdUserId: item.createdUserId, label: (item as any).text?.plainText || undefined, name: item.name };
    if (role !== "GM" && !controls({ id: meId, role }, info, u.state)) {
      nodes.push(h("div", { className: "panel warn" }, "Only the character's player or the GM can use Wild Shape."));
    } else {
      const ws = readWildShape(item.metadata);
      const original = ws?.active?.original.sheet ?? u.sheet;
      nodes.push(h("div", { className: "panel" }, h("h1", {}, `Wild Shape: ${unitName(info, u.sheet, u.state)}`),
        ws?.active ? h("div", { className: "small muted" }, `${original.name} as a ${ws.active.form.name}`) : null));
      if (ws) {
        nodes.push(activePanel(ws, { hp: u.state.hp, tempHp: u.state.tempHp, max: u.state.maxHpOverride ?? u.sheet.hp.max }), rulesPanel(ws), knownPanel(ws), addPanel(ws));
      }
      nodes.push(setupPanel(ws, detectWildShape(original)));
      if (role === "PLAYER") nodes.push(h("div", { className: "small muted" }, "Your changes are applied by the GM's client, so the GM needs to be in the room."));
    }
  }
  if (busy) nodes.push(h("div", { className: "panel small muted" }, busy));
  if (note) nodes.push(h("div", { className: "panel small ok" }, note));
  if (error) nodes.push(h("div", { className: "panel bad small" }, error));
  app.replaceChildren(...nodes.filter((n): n is Node | string => !!n));
  if (keepFocus) {
    const inp = document.getElementById("beast-q") as HTMLInputElement | null;
    if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
  }
}

OBR.onReady(async () => {
  role = await OBR.player.getRole();
  meId = OBR.player.id;
  await initRoomSettings();
  onRoomSettings(() => render());
  [item = null] = await OBR.scene.items.getItems([itemId]);
  render();
  fetchMonsterIndex().then((rows) => { index = rows; render(); }).catch((e) => { error = msg(e); render(); });
  OBR.scene.items.onChange((items) => { item = items.find((i) => i.id === itemId) ?? null; render(); });
});
