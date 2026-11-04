/**
 * "Monsters" tab: search 5etools or add a custom creature, set quantities, then add them all to the
 * current scene (view centre) with Forge stats, separate HP and rolled initiative.
 */
import OBR from "@owlbear-rodeo/sdk";
import { customFromFivetools, parseFivetoolsJson, quickStatblock } from "../core/custom";
import { describeInitiative, fmtMod } from "../core/dice";
import { convertMonster, fivetoolsArtUrl, fivetoolsTokenUrl } from "../core/fivetools";
import { FivetoolsLibrary } from "../core/fivetools-library";
import { rollbackImport, type ResolvedImage } from "../core/importer";
import { quickAdd, type QuickAddReport } from "../core/quickadd";
import type { Statblock } from "../core/schema";
import { action, h, measure, mimeFromUrl, rerender, showError, ui, type Child } from "./dom";
import { obrGateway } from "./obrGateway";

// ------------------------------------------------------------------ index + library (lazy)

interface IndexRow { name: string; source: string; cr: string; type: string; size: string; token: boolean; book: string; rules: string }
let index: IndexRow[] | null = null;
let indexLoading: Promise<void> | null = null;
function loadIndex() {
  indexLoading ??= (async () => {
    const res = await fetch(new URL("data/monsters.json", location.href));
    if (!res.ok) throw new Error(`monster index: HTTP ${res.status}`);
    const j = await res.json();
    index = (j.rows as any[]).map(([name, source, cr, type, size, token]) => ({
      name, source, cr, type, size, token: !!token, book: j.books[source]?.[0] ?? source, rules: j.books[source]?.[1] ?? "",
    }));
    rerender();
  })().catch((e) => { indexLoading = null; showError(e); });
  return indexLoading;
}
let lib: Promise<FivetoolsLibrary> | null = null;
const getLib = () => (lib ??= new FivetoolsLibrary().init());

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
function search(q: string): IndexRow[] {
  if (!index || q.trim().length < 2) return [];
  const n = norm(q.trim());
  const scored = index.map((r) => {
    const name = norm(r.name);
    const s = name === n ? 0 : name.startsWith(n) ? 1 : name.split(/[\s,(]+/).some((w) => w.startsWith(n)) ? 2 : name.includes(n) ? 3 : 9;
    return { r, s };
  }).filter((x) => x.s < 9);
  scored.sort((a, b) => a.s - b.s || (b.r.rules === "2024" ? 1 : 0) - (a.r.rules === "2024" ? 1 : 0) || a.r.name.localeCompare(b.r.name));
  return scored.slice(0, 12).map((x) => x.r);
}

// ------------------------------------------------------------------ encounter list

interface Entry {
  id: number;
  statblock: Statblock;
  image: ResolvedImage | null;
  imageNote: string;
  count: number;
  hp: "average" | "roll";
  hidden: boolean;
  advantage: boolean;
  label: string; // source line
}
const entries: Entry[] = [];
let nextId = 1;
let query = "";
let lastAdd: QuickAddReport | null = null;
let customOpen = false;

/** 5etools artwork exactly as before: own token, then own art, then the base creature's token/art. */
async function fivetoolsImage(m: any): Promise<{ image: ResolvedImage | null; note: string }> {
  const c = [fivetoolsTokenUrl(m.source, m.name), fivetoolsArtUrl(m.source, m.name)];
  if (m._copiedFrom) c.push(fivetoolsTokenUrl(m._copiedFrom.source, m._copiedFrom.name), fivetoolsArtUrl(m._copiedFrom.source, m._copiedFrom.name));
  for (const [i, url] of c.entries()) {
    try {
      const size = await measure(url);
      const note = i === 0 ? "5etools token" : i === 1 ? "5etools artwork (no token)" : i === 2 ? "base creature's token" : "base creature's artwork";
      return { image: { url, ...size, mime: "image/webp" }, note };
    } catch { /* try next */ }
  }
  return { image: null, note: "no 5etools artwork — choose an image" };
}

async function addFromIndex(r: IndexRow) {
  const L = await getLib();
  const ft = await L.prepare(r.name, r.source);
  const sb = convertMonster(ft.monster, { catalogEntry: ft.catalogEntry, copyChain: ft.copyChain, copyNotes: ft.copyNotes });
  const existing = entries.find((e) => e.statblock.name === sb.name && e.statblock.source.book === sb.source.book);
  if (existing) { existing.count++; return; }
  const e: Entry = { id: nextId++, statblock: sb, image: null, imageNote: "loading artwork…", count: 1, hp: "average", hidden: false, advantage: false,
    label: `${r.book}${sb.source.page ? `, p. ${sb.source.page}` : ""}` };
  entries.push(e);
  query = "";
  searchInput?.focus();
  rerender();
  void fivetoolsImage(ft.monster).then((img) => { e.image = img.image; e.imageNote = img.note; rerender(); });
}

async function viewCenter() {
  const [w, hgt] = await Promise.all([OBR.viewport.getWidth(), OBR.viewport.getHeight()]);
  return OBR.viewport.inverseTransformPoint({ x: w / 2, y: hgt / 2 });
}

async function addToScene() {
  const ready = entries.filter((e) => e.image && e.count > 0);
  if (!ready.length) throw new Error("Nothing ready to add (each creature needs an image).");
  lastAdd = await quickAdd(ready.map((e) => ({ statblock: e.statblock, image: e.image!, count: e.count, hp: e.hp, hidden: e.hidden, advantage: e.advantage })), await viewCenter(), obrGateway);
  if (lastAdd.ok) {
    await OBR.notification.show(`Added ${lastAdd.creatures.length} creature(s) with rolled initiative.`, "SUCCESS");
    entries.splice(0, entries.length);
  } else {
    await OBR.notification.show("Couldn't add the creatures — see the panel.", "ERROR");
  }
}

async function undoAdd() {
  if (!lastAdd) return;
  const n = await rollbackImport(lastAdd.createdItemIds, obrGateway);
  await OBR.notification.show(`Removed ${n} token(s).`, "INFO");
  lastAdd = null;
}

// ------------------------------------------------------------------ custom creature form

const custom = {
  name: "", mode: "quick" as "quick" | "json", json: "", size: "M", type: "", ac: "12", hp: "10", init: "0", speed: "30", cr: "", attacks: "", notes: "",
  imageUrl: "", image: null as ResolvedImage | null, imageNote: "", count: "1", homebrew: true,
};

async function pickCustomImage() {
  const picked = await OBR.assets.downloadImages(false, custom.name || undefined, "CHARACTER");
  const img = picked[0]?.image;
  if (img) { custom.image = { url: img.url, width: img.width, height: img.height, mime: img.mime }; custom.imageNote = "from your Owlbear library"; }
}
async function useCustomUrl() {
  const url = custom.imageUrl.trim();
  if (!/^https:\/\//i.test(url)) throw new Error("Image link must start with https:// (players need to load it too).");
  const size = await measure(url);
  custom.image = { url, ...size, mime: mimeFromUrl(url) };
  custom.imageNote = "image link";
}
function usePlaceholder() {
  const url = new URL("tokens/party-placeholder.png", location.href).toString();
  custom.image = { url, width: 256, height: 256, mime: "image/png" };
  custom.imageNote = "placeholder";
}

async function addCustom() {
  const prov = custom.homebrew ? "homebrew" : "user-provided";
  let statblocks: Statblock[];
  if (custom.mode === "json") {
    const raws = parseFivetoolsJson(custom.json);
    const L = raws.some((r) => r._copy) ? await getLib() : null;
    statblocks = [];
    for (const raw of raws) {
      let m = raw;
      if (raw._copy && L) {
        await L.prepare(raw._copy.name, raw._copy.source); // loads the base creature's book
        const { resolveCopy } = await import("../core/fivetools-copy");
        m = resolveCopy(raw, { getMonster: (n, s) => (n.toLowerCase() === raw._copy.name.toLowerCase() ? L.get(raw._copy.name, raw._copy.source).monster : undefined) }).monster;
      }
      const sb = customFromFivetools(m, prov);
      if (custom.name.trim() && raws.length === 1) sb.name = custom.name.trim();
      statblocks.push(sb);
    }
  } else {
    statblocks = [quickStatblock({
      name: custom.name, size: custom.size, type: custom.type, ac: Number(custom.ac), hp: Number(custom.hp), initiative: Number(custom.init),
      speed: Number(custom.speed) || 30, cr: custom.cr ? Number(custom.cr) : undefined, attacks: custom.attacks, notes: custom.notes,
    }, prov)];
  }
  if (!custom.image) usePlaceholder();
  for (const sb of statblocks) {
    entries.push({ id: nextId++, statblock: sb, image: custom.image, imageNote: custom.imageNote, count: Math.max(1, Number(custom.count) || 1),
      hp: "average", hidden: false, advantage: false, label: custom.homebrew ? "Homebrew (not official)" : "Your stat block" });
  }
  Object.assign(custom, { name: "", json: "", attacks: "", notes: "", image: null, imageNote: "", imageUrl: "", count: "1" });
  customOpen = false;
}

// ------------------------------------------------------------------ rendering

const input = (value: string, oninput: (v: string) => void, attrs: Record<string, any> = {}) =>
  h("input", { type: "text", value, oninput: (e: Event) => oninput((e.target as HTMLInputElement).value), ...attrs }) as HTMLInputElement;

// The search box is a persistent element: typing only refreshes the results list (no full re-render, focus kept).
let searchPanel: HTMLElement | null = null;
let searchInput: HTMLInputElement | null = null;
let resultsEl: HTMLElement | null = null;

function updateResults() {
  if (!resultsEl || !searchInput) return;
  searchInput.placeholder = index ? "Search 5etools monsters (e.g. wolf, goblin, Strahd)…" : "Loading monster list…";
  const results = search(query);
  resultsEl.replaceChildren(
    results.length ? h("ul", { className: "results" }, ...results.map((r) =>
      h("li", { onclick: action(() => addFromIndex(r)), title: "Add to encounter" },
        h("span", { className: "rname" }, r.name),
        h("span", { className: "muted small" }, ` CR ${r.cr || "—"} · ${r.type} · ${r.book}`),
        r.rules === "2024" ? h("span", { className: "badge" }, "2024") : null,
        h("span", { className: "add" }, "+"))))
      : query.trim().length >= 2 && index ? h("div", { className: "small muted", style: "margin-top:6px" }, "No match. Try another spelling, or add it as a custom creature.") : "");
}

function renderSearch(): Child {
  if (!index) void loadIndex().then(updateResults);
  if (!searchPanel) {
    searchInput = h("input", { type: "text", autocomplete: "off", oninput: (e: Event) => { query = (e.target as HTMLInputElement).value; updateResults(); } }) as HTMLInputElement;
    resultsEl = h("div");
    searchPanel = h("div", { className: "panel" }, searchInput, resultsEl);
  }
  if (searchInput!.value !== query) searchInput!.value = query;
  updateResults();
  return searchPanel;
}

function renderEntry(e: Entry): Child {
  const sb = e.statblock;
  const ac = sb.forge.Z007;
  const cond = sb.initiative.conditional ?? [];
  return h("div", { className: "entry" },
    e.image ? h("img", { src: e.image.url, className: "thumb", alt: "" }) : h("div", { className: "thumb empty" }, "?"),
    h("div", { className: "grow" },
      h("div", { className: "row between" },
        h("strong", {}, sb.name),
        h("button", { className: "icon", title: "Remove", onclick: () => { entries.splice(entries.indexOf(e), 1); rerender(); } }, "✕")),
      h("div", { className: "small muted" }, `AC ${ac ?? "?"} · HP ${sb.hp.average}${sb.hp.formula ? ` (${sb.hp.formula})` : ""} · Init ${fmtMod(sb.initiative.modifier)}${sb.initiative.advantage ? " adv" : ""} · ${e.label}`),
      h("div", { className: "row", style: "margin-top:4px" },
        h("button", { className: "icon", onclick: () => { e.count = Math.max(1, e.count - 1); rerender(); } }, "−"),
        h("span", { className: "count" }, `× ${e.count}`),
        h("button", { className: "icon", onclick: () => { e.count++; rerender(); } }, "+"),
        h("label", { className: "small" }, h("input", { type: "checkbox", checked: e.hp === "roll", onchange: (ev: Event) => { e.hp = (ev.target as HTMLInputElement).checked ? "roll" : "average"; } }), "roll HP"),
        h("label", { className: "small" }, h("input", { type: "checkbox", checked: e.hidden, onchange: (ev: Event) => { e.hidden = (ev.target as HTMLInputElement).checked; } }), "hidden")),
      cond.length ? h("label", { className: "small warn" }, h("input", { type: "checkbox", checked: e.advantage, onchange: (ev: Event) => { e.advantage = (ev.target as HTMLInputElement).checked; } }),
        `Starts with initiative advantage (${cond[0]!.split(":")[0]!.replace(/"/g, "")} applies)`) : null,
      h("div", { className: "small muted" }, e.imageNote)));
}

function renderCustom(): Child {
  if (!customOpen) return h("button", { className: "secondary wide", onclick: () => { customOpen = true; rerender(); } }, "+ Custom creature (your own stat block / artwork)");
  const f = custom;
  const quick = h("div", { className: "grid2" },
    h("label", {}, "Size", h("select", { onchange: (e: Event) => { f.size = (e.target as HTMLSelectElement).value; } },
      ...["T", "S", "M", "L", "H", "G"].map((s) => h("option", { value: s, selected: f.size === s }, { T: "Tiny", S: "Small", M: "Medium", L: "Large", H: "Huge", G: "Gargantuan" }[s]!)))),
    h("label", {}, "Type", input(f.type, (v) => { f.type = v; }, { placeholder: "humanoid" })),
    h("label", {}, "AC", input(f.ac, (v) => { f.ac = v; }, { inputmode: "numeric" })),
    h("label", {}, "HP", input(f.hp, (v) => { f.hp = v; }, { inputmode: "numeric" })),
    h("label", {}, "Initiative bonus", input(f.init, (v) => { f.init = v; }, { inputmode: "numeric" })),
    h("label", {}, "Speed", input(f.speed, (v) => { f.speed = v; }, { inputmode: "numeric" })),
    h("label", { className: "span2" }, "Attacks (one per line)",
      h("textarea", { placeholder: "Scimitar: +4, 1d6+2 slashing", oninput: (e: Event) => { f.attacks = (e.target as HTMLTextAreaElement).value; } }, f.attacks)),
    h("label", { className: "span2" }, "Notes", h("textarea", { oninput: (e: Event) => { f.notes = (e.target as HTMLTextAreaElement).value; } }, f.notes)));
  const json = h("label", {}, "5etools stat block JSON",
    h("textarea", { className: "tall", placeholder: "Paste a 5etools monster (5etools → creature → View JSON), a homebrew file, or JSON Claude prepared.", oninput: (e: Event) => { f.json = (e.target as HTMLTextAreaElement).value; } }, f.json));
  return h("div", { className: "panel" },
    h("div", { className: "row between" }, h("h2", {}, "Custom creature"), h("button", { className: "icon", onclick: () => { customOpen = false; rerender(); } }, "✕")),
    h("label", {}, "Name", input(f.name, (v) => { f.name = v; }, { placeholder: "Brother Garrow" })),
    h("div", { className: "seg", style: "margin:8px 0" },
      h("button", { className: f.mode === "quick" ? "on" : "", onclick: () => { f.mode = "quick"; rerender(); } }, "Quick stats"),
      h("button", { className: f.mode === "json" ? "on" : "", onclick: () => { f.mode = "json"; rerender(); } }, "Paste stat block")),
    f.mode === "quick" ? quick : json,
    h("div", { className: "small muted", style: "margin-top:8px" }, "Artwork"),
    h("div", { className: "row" },
      h("button", { className: "secondary", onclick: action(pickCustomImage) }, "From Owlbear library…"),
      h("button", { className: "secondary", onclick: () => { usePlaceholder(); rerender(); } }, "Placeholder")),
    h("div", { className: "row", style: "margin-top:4px" },
      input(f.imageUrl, (v) => { f.imageUrl = v; }, { placeholder: "…or an https:// image link" }),
      h("button", { className: "secondary", onclick: action(useCustomUrl) }, "Use")),
    f.image ? h("div", { className: "row small", style: "margin-top:4px" }, h("img", { src: f.image.url, className: "thumb" }), `✔ ${f.imageNote}`) : null,
    h("div", { className: "row", style: "margin-top:8px" },
      h("label", { className: "small" }, "Quantity ", input(f.count, (v) => { f.count = v; }, { style: "width:56px", inputmode: "numeric" })),
      h("label", { className: "small" }, h("input", { type: "checkbox", checked: f.homebrew, onchange: (e: Event) => { f.homebrew = (e.target as HTMLInputElement).checked; } }), "homebrew (not official)")),
    h("button", { className: "wide", style: "margin-top:8px", onclick: action(addCustom) }, "Add to encounter"));
}

function renderLastAdd(r: QuickAddReport): Child {
  return h("div", { className: "panel" },
    h("div", { className: "row between" },
      h("h2", {}, r.ok ? `Added ${r.creatures.length} creature(s)` : "Couldn't add"),
      r.ok && r.createdItemIds.length ? h("button", { className: "secondary", onclick: action(undoAdd) }, "Undo") : null),
    r.error ? h("div", { className: "bad small" }, r.error) : null,
    h("ul", { className: "plain small" }, ...r.creatures.map((c) => h("li", {}, `${c.name}: HP ${c.hp.max}${c.hp.dice ? ` (${c.hp.dice.join("+")}…)` : ""} · init ${describeInitiative(c.initiative)}`)),
      ...r.warnings.map((w) => h("li", { className: "warn" }, w))));
}

export function renderMonstersTab(): Child[] {
  const total = entries.reduce((s, e) => s + e.count, 0);
  const notReady = entries.filter((e) => !e.image).length;
  const nodes: Child[] = [renderSearch()];
  if (entries.length) {
    nodes.push(h("div", { className: "panel" }, h("h2", {}, "Encounter"), ...entries.map(renderEntry)));
  }
  nodes.push(renderCustom());
  nodes.push(h("button", { className: "wide big", disabled: ui.busy || !total || notReady > 0, onclick: action(addToScene) },
    total ? `Add ${total} creature${total === 1 ? "" : "s"} to the scene` : "Add creatures to the scene"));
  nodes.push(h("div", { className: "small muted center" }, "Placed at the centre of your view, each with its own HP and rolled initiative, and added to Forge."));
  if (lastAdd) nodes.push(renderLastAdd(lastAdd));
  return nodes;
}

export function afterRenderMonsters() { /* search box keeps focus by itself */ }
