/**
 * Shared "add to the scene" flow behind the Add Creatures and Add Party Members tabs:
 *  - Import Published …: search the 5etools catalog.
 *  - Import Homebrewed …: a stat block from pasted/uploaded JSON, from a published creature (editable), or quick
 *    stats; any token (Owlbear library upload, https link, the 5etools token, or the placeholder); a custom name.
 * Both feed one list with quantities, then one button adds everything (with Undo). Party members are flagged as
 * party members.
 */
import OBR from "@owlbear-rodeo/sdk";
import { customFromFivetools, parseFivetoolsJson, quickStatblock } from "../core/custom";
import { describeInitiative, fmtMod } from "../core/dice";
import { convertMonster } from "../core/fivetools";
import { resolveCopy } from "../core/fivetools-copy";
import { fetchMonsterIndex, fivetoolsImage, getLib } from "./bestiary";
import { rollbackImport, type ResolvedImage } from "../core/importer";
import { quickAdd, type QuickAddReport } from "../core/quickadd";
import type { Statblock } from "../core/schema";
import { action, h, measure, mimeFromUrl, rerender, showError, ui, type Child } from "./dom";
import { obrGateway } from "./obrGateway";
import { roomSystem } from "./roomSettings";
import { createCollectionPanel, saveToCollection } from "./collectionPanel";
import { searchableSource } from "../core/systems";

// ------------------------------------------------------------------ 5etools index + library (shared, lazy)

import { activeFilterCount, browse, CR_STEPS, CREATURE_TYPES, matchesFilters, NO_FILTERS, SIZES, type IndexRow, type SearchFilters } from "../core/search";
import { ENV_LABEL, ENVS } from "../core/habitat";
import { SIZE_NAMES } from "../core/constants";
import { store } from "./dom";

/** Search filters (F16), shared by every search box and remembered per browser. */
let filters: SearchFilters = (() => {
  try { return { ...NO_FILTERS, ...JSON.parse(store.get("butler.searchFilters") ?? "{}") }; } catch { return { ...NO_FILTERS }; }
})();
const filterListeners = new Set<() => void>();
function setFilters(f: SearchFilters) {
  filters = f;
  store.set("butler.searchFilters", JSON.stringify(f));
  for (const fn of filterListeners) fn();
}
let index: IndexRow[] | null = null;
let indexLoading: Promise<void> | null = null;
const indexListeners = new Set<() => void>();
function loadIndex() {
  indexLoading ??= (async () => {
    index = await fetchMonsterIndex();
    for (const f of indexListeners) f(); // only the result lists: a full re-render would steal focus from a search box
  })().catch((e) => { indexLoading = null; showError(e); });
  return indexLoading;
}

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
/** Text search (2+ letters), narrowed by the filters; with filters and no text, every match by CR then name. */
function search(q: string): { rows: IndexRow[]; total: number } {
  if (!index) return { rows: [], total: 0 };
  const system = roomSystem();
  // Only the room edition's PHB / MM / DMG are offered (F9); every other book stays in both.
  const pool = index.filter((r) => searchableSource(system, r.source) && matchesFilters(r, filters));
  if (q.trim().length < 2) {
    if (!activeFilterCount(filters)) return { rows: [], total: 0 };
    const all = browse(pool, filters);
    return { rows: all.slice(0, 100), total: all.length };
  }
  const n = norm(q.trim());
  const scored = pool.map((r) => {
    const name = norm(r.name);
    const s = name === n ? 0 : name.startsWith(n) ? 1 : name.split(/[\s,(]+/).some((w) => w.startsWith(n)) ? 2 : name.includes(n) ? 3 : 9;
    return { r, s };
  }).filter((x) => x.s < 9);
  // The room's game system decides which edition comes first when a creature exists in both (5.5E → 2024 books).
  const pref = system.rules;
  scored.sort((a, b) => a.s - b.s || (b.r.rules === pref ? 1 : 0) - (a.r.rules === pref ? 1 : 0) || a.r.name.localeCompare(b.r.name));
  return { rows: scored.slice(0, activeFilterCount(filters) ? 50 : 12).map((x) => x.r), total: scored.length };
}

/** The filter panel under a search box; changes refresh the result lists only (focus stays put). */
function filterPanel(): HTMLElement {
  const toggleIn = <T extends string>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const chips = <T extends string>(all: readonly T[], on: T[], label: (v: T) => string, set: (next: T[]) => void) =>
    h("div", { className: "chips" }, ...all.map((v) => h("button", { className: `fchip${on.includes(v) ? " on" : ""}`, onclick: () => set(toggleIn(on, v)) }, label(v))));
  const crSel = (value: string | undefined, set: (v: string | undefined) => void, placeholder: string) =>
    h("select", { className: "crsel", onchange: (e: Event) => set((e.target as HTMLSelectElement).value || undefined) },
      h("option", { value: "", selected: !value }, placeholder), ...CR_STEPS.map((c) => h("option", { value: c, selected: c === value }, c)));
  const cap = (x: string) => x[0]!.toUpperCase() + x.slice(1);
  const panel = h("div", { className: "filters stack tight" });
  // A CR select changes on every arrow key: redrawing then would take its focus (and close its list).
  const draw = () => (panel.contains(document.activeElement) && document.activeElement?.tagName === "SELECT") ? undefined : panel.replaceChildren(
    h("div", { className: "row" }, h("strong", { className: "small" }, "CR"),
      crSel(filters.crMin, (v) => setFilters({ ...filters, crMin: v }), "min"), h("span", { className: "small muted" }, "to"),
      crSel(filters.crMax, (v) => setFilters({ ...filters, crMax: v }), "max"),
      h("span", { className: "grow" }),
      h("button", { className: "linkish small", onclick: () => setFilters({ ...NO_FILTERS }) }, "Clear filters")),
    h("strong", { className: "small" }, "Type"), chips(CREATURE_TYPES, filters.types as (typeof CREATURE_TYPES)[number][], cap, (t) => setFilters({ ...filters, types: t })),
    h("strong", { className: "small" }, "Environment"), chips(ENVS, filters.envs, (e) => ENV_LABEL[e], (e) => setFilters({ ...filters, envs: e })),
    h("strong", { className: "small" }, "Size"), chips(SIZES, filters.sizes as (typeof SIZES)[number][], (z) => SIZE_NAMES[z] ?? z, (z) => setFilters({ ...filters, sizes: z })),
    h("div", { className: "row" }, h("strong", { className: "small" }, "Spellcaster"),
      h("div", { className: "seg" }, ...(["any", "yes", "no"] as const).map((c) => h("button", { className: filters.caster === c ? "on" : "", onclick: () => setFilters({ ...filters, caster: c }) }, c === "any" ? "Any" : c === "yes" ? "Yes" : "No")))),
    h("div", { className: "small muted" }, "Environments marked ≈ in the results were assigned by Butler (5etools gives none for that creature)."));
  filterListeners.add(draw);
  draw();
  return panel;
}

/** A persistent search box: typing only refreshes its results list (no full re-render, so focus is kept). */
function createSearchBox(placeholder: string, onPick: (r: IndexRow) => Promise<void>) {
  let query = "";
  let filtersOpen = false;
  const input = h("input", { type: "text", autocomplete: "off", oninput: (e: Event) => { query = (e.target as HTMLInputElement).value; update(); } }) as HTMLInputElement;
  const results = h("div");
  const filterBtn = h("button", { className: "secondary small", title: "Filter by CR, type, environment, size, spellcaster" }) as HTMLButtonElement;
  const panelWrap = h("div");
  filterBtn.onclick = () => {
    filtersOpen = !filtersOpen;
    panelWrap.replaceChildren(...(filtersOpen ? [filterPanel()] : []));
    update();
  };
  const envText = (r: IndexRow) => (r.envs === "any" ? "any environment" : `${r.envAssigned ? "≈" : ""}${r.envs.map((e) => ENV_LABEL[e]).join(", ")}`);
  function update() {
    input.placeholder = index ? placeholder : "Loading the 5etools list…";
    const n = activeFilterCount(filters);
    filterBtn.textContent = n ? `Filters (${n})` : "Filters";
    filterBtn.classList.toggle("on", n > 0);
    const { rows, total } = search(query);
    const browsing = query.trim().length < 2;
    results.replaceChildren(
      rows.length ? h("div", {},
        n ? h("div", { className: "small muted", style: "margin-top:6px" }, total > rows.length ? `${total} matches, showing the first ${rows.length}${browsing ? " (by CR)" : ""}` : `${total} match${total === 1 ? "" : "es"}`) : null,
        h("ul", { className: "results" }, ...rows.map((r) =>
          h("li", { onclick: action(async () => { await onPick(r); query = ""; input.value = ""; update(); input.focus(); }), title: "Choose" },
            h("span", { className: "rname" }, r.name),
            h("span", { className: "muted small" }, ` CR ${r.cr || "—"} · ${r.type} · ${r.book}${n ? ` · ${envText(r)}${r.caster ? " · spellcaster" : ""}` : ""}`),
            r.rules === "2024" ? h("span", { className: "badge" }, "2024") : null,
            h("span", { className: "add" }, "+")))))
        : (query.trim().length >= 2 || n) && index ? h("div", { className: "small muted", style: "margin-top:6px" }, n ? "No creature matches these filters." : "No match. Try another spelling.") : "");
  }
  indexListeners.add(update);
  filterListeners.add(update);
  const el = h("div", {}, h("div", { className: "row", style: "flex-wrap:nowrap" }, input, filterBtn), panelWrap, results);
  return { el, refresh: () => { if (!index) void loadIndex(); update(); } };
}

const placeholderImage = (): ResolvedImage => ({ url: new URL("tokens/party-placeholder.png", location.href).toString(), width: 256, height: 256, mime: "image/png" });

// ------------------------------------------------------------------ the builder

export type RosterKind = "creature" | "party";

interface Entry {
  id: number;
  statblock: Statblock;
  image: ResolvedImage | null;
  imageNote: string;
  count: number;
  hp: "average" | "roll";
  hidden: boolean;
  advantage: boolean;
  label: string;
}

export function createRoster(kind: RosterKind) {
  const one = kind === "party" ? "party member" : "creature";
  const many = kind === "party" ? "party members" : "creatures";
  const One = one[0]!.toUpperCase() + one.slice(1);
  const Many = many[0]!.toUpperCase() + many.slice(1);

  const entries: Entry[] = [];
  let nextId = 1;
  let lastAdd: QuickAddReport | null = null;

  // ---- published
  async function addPublished(r: IndexRow) {
    const L = await getLib();
    const ft = await L.prepare(r.name, r.source);
    const sb = convertMonster(ft.monster, { catalogEntry: ft.catalogEntry, copyChain: ft.copyChain, copyNotes: ft.copyNotes });
    const existing = entries.find((e) => e.statblock.name === sb.name && e.statblock.source.book === sb.source.book && e.label.startsWith(r.book));
    if (existing) { existing.count++; rerender(); return; }
    const e: Entry = { id: nextId++, statblock: sb, image: null, imageNote: "loading artwork…", count: 1, hp: "average", hidden: false, advantage: false,
      label: `${r.book}${sb.source.page ? `, p. ${sb.source.page}` : ""}` };
    entries.push(e);
    rerender();
    void fivetoolsImage(ft.monster).then((img) => { e.image = img.image; e.imageNote = img.note; rerender(); });
  }
  const publishedSearch = createSearchBox(`Search 5etools (e.g. wolf, goblin, Strahd)…`, addPublished);

  // ---- homebrew
  const hb = {
    name: "", mode: "json" as "json" | "quick", json: "", base: null as null | { name: string; book: string; monster: any },
    size: "M", type: "", ac: "12", hp: "10", init: "0", speed: "30", cr: "", level: "", attacks: "", notes: "",
    imageUrl: "", image: null as ResolvedImage | null, imageNote: "", homebrew: true,
  };
  async function useAsBase(r: IndexRow) {
    const L = await getLib();
    const ft = await L.prepare(r.name, r.source);
    const { _copiedFrom, ...monster } = ft.monster;
    hb.base = { name: r.name, book: r.book, monster: ft.monster };
    hb.json = JSON.stringify(monster, null, 2);
    hb.mode = "json";
    rerender();
  }
  const baseSearch = createSearchBox("Start from a published creature…", useAsBase);

  async function pickLibraryImage() {
    const picked = await OBR.assets.downloadImages(false, hb.name || undefined, "CHARACTER");
    const img = picked[0]?.image;
    if (img) { hb.image = { url: img.url, width: img.width, height: img.height, mime: img.mime }; hb.imageNote = "from your Owlbear library"; }
  }
  async function useImageUrl() {
    const url = hb.imageUrl.trim();
    if (!/^https:\/\//i.test(url)) throw new Error("Image link must start with https:// (players need to load it too).");
    hb.image = { url, ...(await measure(url)), mime: mimeFromUrl(url) };
    hb.imageNote = "image link";
  }
  async function useBaseToken() {
    if (!hb.base) return;
    const img = await fivetoolsImage(hb.base.monster);
    if (!img.image) throw new Error(`${hb.base.name} has no 5etools artwork.`);
    hb.image = img.image;
    hb.imageNote = `${hb.base.name}: ${img.note}`;
  }
  async function loadJsonFile(f: File) {
    hb.json = await f.text();
    hb.base = null;
    hb.mode = "json";
  }

  /** The homebrew form's stat block(s), picture and label (shared by "Put on the list" and "Save to collection"). */
  async function buildHomebrew(): Promise<{ statblocks: Statblock[]; image: ResolvedImage; imageNote: string; label: string }> {
    const prov = hb.base ? "adapted" : hb.homebrew ? "homebrew" : "user-provided";
    let statblocks: Statblock[];
    if (hb.mode === "json") {
      if (!hb.json.trim()) throw new Error("Paste or upload a stat block first, or start from a published creature.");
      const raws = parseFivetoolsJson(hb.json);
      const L = raws.some((r) => r._copy) ? await getLib() : null;
      statblocks = [];
      for (const raw of raws) {
        let m = raw;
        if (raw._copy && L) {
          await L.prepare(raw._copy.name, raw._copy.source); // loads the base creature's book
          m = resolveCopy(raw, { getMonster: (n) => (n.toLowerCase() === raw._copy.name.toLowerCase() ? L.get(raw._copy.name, raw._copy.source).monster : undefined) }).monster;
        }
        const sb = customFromFivetools(m, prov);
        if (hb.name.trim() && raws.length === 1) sb.name = hb.name.trim();
        if (hb.base) sb.source.notes = [`Adapted from ${hb.base.name} (${hb.base.book}).`];
        statblocks.push(sb);
      }
    } else {
      if (!hb.name.trim()) throw new Error("Give it a name.");
      const sb = quickStatblock({
        name: hb.name, size: hb.size, type: hb.type, ac: Number(hb.ac), hp: Number(hb.hp), initiative: Number(hb.init),
        speed: Number(hb.speed) || 30, cr: hb.cr ? Number(hb.cr) : undefined, attacks: hb.attacks, notes: hb.notes,
      }, prov);
      if (kind === "party" && Number(hb.level) > 0) sb.level = Number(hb.level);
      statblocks = [sb];
    }
    if (!hb.image) { hb.image = placeholderImage(); hb.imageNote = "placeholder"; }
    const label = hb.base ? `adapted from ${hb.base.name}` : hb.homebrew ? "Homebrew (not official)" : "Your stat block";
    return { statblocks, image: hb.image, imageNote: hb.imageNote, label };
  }
  const clearHomebrew = () => Object.assign(hb, { name: "", json: "", base: null, attacks: "", notes: "", level: "", image: null, imageNote: "", imageUrl: "" });

  async function addHomebrew() {
    const b = await buildHomebrew();
    for (const sb of b.statblocks) {
      entries.push({ id: nextId++, statblock: sb, image: b.image, imageNote: b.imageNote, count: 1, hp: "average", hidden: false, advantage: false, label: b.label });
    }
    clearHomebrew();
  }

  async function saveHomebrew() {
    const b = await buildHomebrew();
    await saveToCollection(b.statblocks, b.image, b.label);
    await OBR.notification.show(`Saved ${b.statblocks.map((x) => x.name).join(", ")} to your collection.`, "SUCCESS");
    clearHomebrew();
    collection.reload();
  }

  // ---- collection (F8)
  const collection = createCollectionPanel((sheet, image, label) => {
    entries.push({ id: nextId++, statblock: sheet, image: image ?? placeholderImage(), imageNote: image ? "saved picture" : "placeholder", count: 1, hp: "average", hidden: false, advantage: false, label });
    rerender();
  });

  // ---- add + undo
  async function viewCenter() {
    const [w, hgt] = await Promise.all([OBR.viewport.getWidth(), OBR.viewport.getHeight()]);
    return OBR.viewport.inverseTransformPoint({ x: w / 2, y: hgt / 2 });
  }
  async function addToScene() {
    const ready = entries.filter((e) => e.image && e.count > 0);
    if (!ready.length) throw new Error(`Nothing ready to add (each ${one} needs an image).`);
    lastAdd = await quickAdd(ready.map((e) => ({ statblock: e.statblock, image: e.image!, count: e.count, hp: e.hp, hidden: e.hidden, advantage: e.advantage })),
      await viewCenter(), obrGateway, { inParty: kind === "party" });
    if (lastAdd.ok) {
      await OBR.notification.show(`Added ${lastAdd.creatures.length} ${lastAdd.creatures.length === 1 ? one : many}${kind === "party" ? " to the party" : ""}.`, "SUCCESS");
      entries.splice(0, entries.length);
    } else {
      await OBR.notification.show(`Couldn't add the ${many} — see the panel.`, "ERROR");
    }
  }
  async function undoAdd() {
    if (!lastAdd) return;
    const n = await rollbackImport(lastAdd.createdItemIds, obrGateway);
    await OBR.notification.show(`Removed ${n} token(s).`, "INFO");
    lastAdd = null;
  }

  // ---- rendering
  const input = (value: string, oninput: (v: string) => void, attrs: Record<string, any> = {}) =>
    h("input", { type: "text", value, oninput: (e: Event) => oninput((e.target as HTMLInputElement).value), ...attrs }) as HTMLInputElement;

  function renderEntry(e: Entry): Child {
    const sb = e.statblock;
    const cond = sb.initiative.conditional ?? [];
    return h("div", { className: "entry" },
      e.image ? h("img", { src: e.image.url, className: "thumb", alt: "" }) : h("div", { className: "thumb empty" }, "?"),
      h("div", { className: "grow" },
        h("div", { className: "row between" },
          h("strong", {}, sb.name),
          h("button", { className: "icon", title: "Remove", onclick: () => { entries.splice(entries.indexOf(e), 1); rerender(); } }, "✕")),
        h("div", { className: "small muted" }, `AC ${sb.ac} · HP ${sb.hp.max}${sb.hp.formula ? ` (${sb.hp.formula})` : ""} · Init ${fmtMod(sb.initiative.modifier)}${sb.initiative.advantage ? " adv" : ""} · ${e.label}`),
        h("div", { className: "row", style: "margin-top:4px" },
          h("button", { className: "icon", title: "Fewer", onclick: () => { e.count = Math.max(1, e.count - 1); rerender(); } }, "−"),
          h("span", { className: "small" }, "×"),
          input(String(e.count), () => {}, { className: "qty", inputmode: "numeric", title: "How many to add",
            onchange: (ev: Event) => { e.count = Math.max(1, Math.min(99, Math.round(Number((ev.target as HTMLInputElement).value)) || 1)); rerender(); } }),
          h("button", { className: "icon", title: "More", onclick: () => { e.count++; rerender(); } }, "+"),
          h("label", { className: "small" }, h("input", { type: "checkbox", checked: e.hp === "roll", onchange: (ev: Event) => { e.hp = (ev.target as HTMLInputElement).checked ? "roll" : "average"; } }), "roll HP"),
          h("label", { className: "small" }, h("input", { type: "checkbox", checked: e.hidden, onchange: (ev: Event) => { e.hidden = (ev.target as HTMLInputElement).checked; } }), "hidden")),
        cond.length ? h("label", { className: "small warn" }, h("input", { type: "checkbox", checked: e.advantage, onchange: (ev: Event) => { e.advantage = (ev.target as HTMLInputElement).checked; } }),
          `Starts with initiative advantage (${cond[0]!.split(":")[0]!.replace(/"/g, "")} applies)`) : null,
        h("div", { className: "small muted" }, e.imageNote)));
  }

  function renderPublished(): Child {
    publishedSearch.refresh();
    return h("div", { className: "panel" },
      h("h2", {}, `Import published ${one}`),
      publishedSearch.el,
      h("div", { className: "small muted", style: "margin-top:4px" }, `Pick a result to put it on the list below, then set how many there.`));
  }

  function renderHomebrew(): Child {
    const f = hb;
    baseSearch.refresh();
    const fileInput = h("input", { type: "file", accept: ".json,application/json", onchange: action(async () => { const file = fileInput.files?.[0]; if (file) await loadJsonFile(file); }) }) as HTMLInputElement;
    const json = h("div", {},
      baseSearch.el,
      f.base ? h("div", { className: "small ok", style: "margin-top:4px" }, `✔ Stat block of ${f.base.name} (${f.base.book}) loaded below. Edit anything you like.`) : null,
      h("div", { className: "row", style: "margin-top:6px" },
        h("label", { className: "filebtn secondary" }, "Upload .json…", fileInput),
        h("span", { className: "small muted" }, "or paste below")),
      h("textarea", { className: "tall", style: "margin-top:6px", placeholder: "5etools stat block JSON (5etools → creature → View JSON), a homebrew file, or JSON Claude prepared.",
        oninput: (e: Event) => { f.json = (e.target as HTMLTextAreaElement).value; } }, f.json));
    const quick = h("div", { className: "grid2" },
      h("label", {}, "Size", h("select", { onchange: (e: Event) => { f.size = (e.target as HTMLSelectElement).value; } },
        ...["T", "S", "M", "L", "H", "G"].map((s) => h("option", { value: s, selected: f.size === s }, { T: "Tiny", S: "Small", M: "Medium", L: "Large", H: "Huge", G: "Gargantuan" }[s]!)))),
      h("label", {}, "Type", input(f.type, (v) => { f.type = v; }, { placeholder: kind === "party" ? "humanoid (elf)" : "humanoid" })),
      h("label", {}, "AC", input(f.ac, (v) => { f.ac = v; }, { inputmode: "numeric" })),
      h("label", {}, "HP", input(f.hp, (v) => { f.hp = v; }, { inputmode: "numeric" })),
      h("label", {}, "Initiative bonus", input(f.init, (v) => { f.init = v; }, { inputmode: "numeric" })),
      h("label", {}, "Speed", input(f.speed, (v) => { f.speed = v; }, { inputmode: "numeric" })),
      kind === "party"
        ? h("label", {}, "Level", input(f.level, (v) => { f.level = v; }, { inputmode: "numeric", placeholder: "for the difficulty" }))
        : h("label", {}, "CR", input(f.cr, (v) => { f.cr = v; }, { inputmode: "decimal", placeholder: "e.g. 2 or 0.5" })),
      h("label", { className: "span2" }, "Attacks (one per line)",
        h("textarea", { placeholder: "Scimitar: +4, 1d6+2 slashing", oninput: (e: Event) => { f.attacks = (e.target as HTMLTextAreaElement).value; } }, f.attacks)),
      h("label", { className: "span2" }, "Notes", h("textarea", { oninput: (e: Event) => { f.notes = (e.target as HTMLTextAreaElement).value; } }, f.notes)));

    return h("div", { className: "panel" },
      h("h2", {}, `Import homebrewed ${one}`),
      h("div", { className: "seg", style: "margin-bottom:8px" },
        h("button", { className: f.mode === "json" ? "on" : "", onclick: () => { f.mode = "json"; rerender(); } }, "Stat block (JSON)"),
        h("button", { className: f.mode === "quick" ? "on" : "", onclick: () => { f.mode = "quick"; rerender(); } }, "Quick stats")),
      f.mode === "json" ? json : quick,
      h("label", { style: "margin-top:8px;flex-direction:column;gap:2px" }, f.mode === "json" ? "Name (optional: replaces the stat block's name)" : "Name",
        input(f.name, (v) => { f.name = v; }, { placeholder: f.base ? f.base.name : kind === "party" ? "Brother Garrow" : "Goblin Boss" })),
      h("div", { className: "small muted", style: "margin-top:8px" }, "Token"),
      h("div", { className: "row" },
        h("button", { className: "secondary", onclick: action(pickLibraryImage), title: "Opens Owlbear's library, where you can also upload a new image" }, "Upload / choose in Owlbear…"),
        f.base ? h("button", { className: "secondary", onclick: action(useBaseToken) }, `${f.base.name}'s token`) : null,
        h("button", { className: "secondary", onclick: () => { hb.image = placeholderImage(); hb.imageNote = "placeholder"; rerender(); } }, "Placeholder")),
      h("div", { className: "row", style: "margin-top:4px;flex-wrap:nowrap" },
        input(f.imageUrl, (v) => { f.imageUrl = v; }, { placeholder: "…or an https:// image link" }),
        h("button", { className: "secondary", onclick: action(useImageUrl) }, "Use")),
      f.image ? h("div", { className: "row small", style: "margin-top:4px" }, h("img", { src: f.image.url, className: "thumb" }), `✔ ${f.imageNote}`) : h("div", { className: "small muted", style: "margin-top:4px" }, "No token chosen: the placeholder is used."),
      h("div", { className: "row", style: "margin-top:8px" },
        f.base ? null : h("label", { className: "small", style: "align-items:center" }, h("input", { type: "checkbox", checked: f.homebrew, onchange: (e: Event) => { f.homebrew = (e.target as HTMLInputElement).checked; } }), "homebrew (not official)")),
      h("div", { className: "row", style: "margin-top:8px;flex-wrap:nowrap" },
        h("button", { className: "grow", onclick: action(addHomebrew) }, "Put on the list"),
        h("button", { className: "secondary", title: "Keep it in your collection (this browser) to add again later", onclick: action(saveHomebrew) }, "Save to collection")));
  }

  function renderLastAdd(r: QuickAddReport): Child {
    return h("div", { className: "panel" },
      h("div", { className: "row between" },
        h("h2", {}, r.ok ? `Added ${r.creatures.length} ${r.creatures.length === 1 ? one : many}` : "Couldn't add"),
        r.ok && r.createdItemIds.length ? h("button", { className: "secondary", onclick: action(undoAdd) }, "Undo") : null),
      r.error ? h("div", { className: "bad small" }, r.error) : null,
      h("ul", { className: "plain small" }, ...r.creatures.map((c) => h("li", {}, `${c.name}: HP ${c.hp.max}${c.hp.dice ? ` (${c.hp.formula}: ${c.hp.dice.join("+")})` : " (average)"} · init ${describeInitiative(c.initiative)}`)),
        ...r.warnings.map((w) => h("li", { className: "warn" }, w))));
  }

  function render(): Child[] {
    const total = entries.reduce((s, e) => s + e.count, 0);
    const notReady = entries.filter((e) => !e.image).length;
    return [
      renderPublished(),
      renderHomebrew(),
      collection.el,
      h("div", { className: "panel" },
        h("h2", {}, `${Many} to add (${total})`),
        entries.length ? h("div", {}, ...entries.map(renderEntry)) : h("div", { className: "small muted" }, `Nothing yet. Pick a published ${one} or put a homebrewed one on the list.`)),
      h("button", { className: "wide big", disabled: ui.busy || !total || notReady > 0, onclick: action(addToScene) },
        total ? `Add ${total} ${total === 1 ? one : many} to the scene` : `Add ${many} to the scene`),
      h("div", { className: "small muted center" }, `Placed at the centre of your view, each with its own HP and rolled initiative${kind === "party" ? ", in the party" : ", in the initiative tracker"}.`),
      lastAdd ? renderLastAdd(lastAdd) : null,
    ];
  }

  return { render, One };
}
