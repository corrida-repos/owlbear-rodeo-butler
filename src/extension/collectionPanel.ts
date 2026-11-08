/**
 * "Your collection" panel (F8) in the Add Creatures / Add Party tabs: search and tag filters over the GM's saved units,
 * put one on the list to add (quantities, HP, hidden work as for any creature), edit it (name, tags, AC, HP, CR, or the
 * full stat block as JSON), make a new one, delete, export and import the whole collection as a file.
 * Keeps its own DOM (like the search box) so typing and editing aren't interrupted by the popover's re-renders.
 */
import { allTags, blankSheet, exportCollection, importCollection, newEntry, parseTags, searchCollection, updateEntry, type CollectionEntry } from "../core/collection";
import { crLabel } from "../core/combat";
import type { ResolvedImage } from "../core/importer";
import type { UnitSheet } from "../core/sheet";
import { deleteEntry, listCollection, onCollectionChange, putEntries } from "./collectionStore";
import { h } from "./dom";

export function createCollectionPanel(onAdd: (sheet: UnitSheet, image: ResolvedImage | null, label: string) => void) {
  let entries: CollectionEntry[] = [];
  let loaded = false;
  let query = "";
  let tags: string[] = [];
  let editing: string | null = null;
  let note = "";
  let open = false;

  const el = h("details", { className: "panel", ontoggle: () => { open = el.open; if (open && !loaded) void reload(); } }) as HTMLDetailsElement;
  const summary = h("summary", {});
  const body = h("div", { className: "stack tight", style: "margin-top:8px" });
  el.append(summary, body);

  async function reload() {
    try { entries = await listCollection(); loaded = true; } catch (e) { note = e instanceof Error ? e.message : String(e); }
    draw();
  }
  onCollectionChange(() => { if (loaded) void reload(); });

  const search = h("input", { type: "text", placeholder: "Search your collection (name, type, tag)…", oninput: (e: Event) => { query = (e.target as HTMLInputElement).value; drawList(); } }) as HTMLInputElement;
  const list = h("div", { className: "stack tight" });
  const tagRow = h("div", { className: "chips" });
  const noteEl = h("div", { className: "small" });

  function downloadFile() {
    const blob = new Blob([JSON.stringify(exportCollection(entries), null, 1)], { type: "application/json" });
    const a = h("a", { href: URL.createObjectURL(blob), download: `encounter-butler-collection-${new Date().toISOString().slice(0, 10)}.json` }) as HTMLAnchorElement;
    document.body.append(a); a.click(); a.remove();
  }
  const fileInput = h("input", { type: "file", accept: ".json,application/json", onchange: async (e: Event) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    try {
      const r = importCollection(entries, JSON.parse(await f.text()));
      await putEntries(r.entries);
      note = `Imported: ${r.added} new, ${r.updated} updated, ${r.skipped} already up to date${r.errors.length ? `; ${r.errors.length} skipped (${r.errors[0]})` : ""}.`;
    } catch (err) { note = err instanceof Error ? err.message : String(err); }
    (e.target as HTMLInputElement).value = "";
    await reload();
  } }) as HTMLInputElement;

  function editor(e: CollectionEntry): HTMLElement {
    const s = e.sheet;
    const name = h("input", { type: "text", value: s.name }) as HTMLInputElement;
    const tagIn = h("input", { type: "text", value: e.tags.join(", "), placeholder: "boss, undead, act 2" }) as HTMLInputElement;
    const ac = h("input", { type: "text", inputmode: "numeric", value: String(s.ac) }) as HTMLInputElement;
    const hp = h("input", { type: "text", inputmode: "numeric", value: String(s.hp.max) }) as HTMLInputElement;
    const hpf = h("input", { type: "text", value: s.hp.formula ?? "", placeholder: "e.g. 8d10+16" }) as HTMLInputElement;
    const cr = h("input", { type: "text", value: s.cr !== undefined ? crLabel(s.cr) : "", placeholder: "e.g. 1/2, 5" }) as HTMLInputElement;
    const json = h("textarea", { className: "tall" }, JSON.stringify(s, null, 1)) as HTMLTextAreaElement;
    const save = async () => {
      try {
        const sheet = JSON.parse(json.value) as UnitSheet;
        const crv = cr.value.trim() ? (cr.value.includes("/") ? Number(cr.value.split("/")[0]) / Number(cr.value.split("/")[1]) : Number(cr.value)) : undefined;
        // The quick fields win over the same values in the JSON.
        const next: UnitSheet = { ...sheet, name: name.value.trim() || sheet.name, ac: Number(ac.value) || sheet.ac,
          hp: { ...sheet.hp, max: Number(hp.value) || sheet.hp.max, ...(hpf.value.trim() ? { formula: hpf.value.trim() } : {}) },
          ...(crv !== undefined && Number.isFinite(crv) ? { cr: crv } : {}) };
        await putEntries([updateEntry(e, { sheet: next, tags: parseTags(tagIn.value) })]);
        editing = null; note = `Saved ${next.name}. Tokens already in a scene keep their own copy.`;
        await reload();
      } catch (err) { note = `Not saved: ${err instanceof Error ? err.message : String(err)}`; drawNote(); }
    };
    return h("div", { className: "editbox stack tight" },
      h("div", { className: "grid2" },
        h("label", { className: "span2" }, "Name", name),
        h("label", { className: "span2" }, "Tags (comma-separated)", tagIn),
        h("label", {}, "AC", ac), h("label", {}, "CR", cr),
        h("label", {}, "HP", hp), h("label", {}, "HP dice", hpf)),
      h("details", { className: "small" }, h("summary", {}, "Full stat block (JSON)"),
        h("div", { className: "small muted" }, "Everything else: abilities, saves, skills, senses, traits, actions, spells… Write rolls as [1d20+4] or [2d6+3] to make them clickable on the card."),
        json),
      h("div", { className: "row" },
        h("button", { onclick: () => void save() }, "Save"),
        h("button", { className: "secondary", onclick: () => { editing = null; drawList(); } }, "Cancel"),
        h("span", { className: "grow" }),
        h("button", { className: "secondary small", onclick: async () => { await deleteEntry(e.id); editing = null; note = `Deleted ${e.sheet.name}.`; await reload(); } }, "Delete")));
  }

  function row(e: CollectionEntry): HTMLElement {
    const s = e.sheet;
    return h("div", { className: "entry" },
      e.image ? h("img", { className: "thumb round small", src: e.image.url, alt: "" }) : h("div", { className: "thumb empty small" }, "?"),
      h("div", { className: "grow" },
        h("div", {}, h("strong", {}, s.name)),
        h("div", { className: "small muted" }, [s.cr !== undefined ? `CR ${crLabel(s.cr)}` : s.level ? `Level ${s.level}` : "", s.type, `AC ${s.ac}`, `HP ${s.hp.max}`].filter(Boolean).join(" · ")),
        e.tags.length ? h("div", { className: "chips" }, ...e.tags.map((t) => h("span", { className: "cond" }, `#${t}`))) : null,
        editing === e.id ? editor(e) : null),
      h("div", { className: "stack tight" },
        h("button", { className: "small", title: "Put it on the list below, then add it to the scene", onclick: () => { onAdd(structuredClone(s), e.image ?? null, `from your collection${e.from ? ` (${e.from})` : ""}`); note = `${s.name} is on the list below.`; drawNote(); } }, "+ List"),
        editing === e.id ? null : h("button", { className: "secondary small", onclick: () => { editing = e.id; drawList(); } }, "Edit")));
  }

  function drawNote() { noteEl.textContent = note; }
  function drawList() {
    const known = allTags(entries);
    tags = tags.filter((t) => known.includes(t));
    tagRow.replaceChildren(...known.map((t) => h("button", { className: `fchip${tags.includes(t) ? " on" : ""}`, onclick: () => { tags = tags.includes(t) ? tags.filter((x) => x !== t) : [...tags, t]; drawList(); } }, `#${t}`)));
    const shown = searchCollection(entries, query, tags);
    list.replaceChildren(...(shown.length ? shown.map(row) : [h("div", { className: "small muted" }, entries.length ? "Nothing matches." : "Nothing saved yet. Save a homebrew creature with “Save to collection”, save a token from its card (Edit unit) or its right-click menu, or start a new one.")]));
    summary.textContent = `Your collection${loaded ? ` (${entries.length})` : ""}`;
    drawNote();
  }
  function draw() {
    body.replaceChildren(
      h("div", { className: "row", style: "flex-wrap:nowrap" }, search,
        h("button", { className: "secondary small", title: "Start a new homebrew unit", onclick: async () => {
          const e = newEntry(blankSheet(), { from: "homebrew" });
          await putEntries([e]); editing = e.id; query = ""; search.value = ""; await reload();
        } }, "New")),
      tagRow, list, noteEl,
      h("div", { className: "row small" },
        h("button", { className: "secondary small", disabled: !entries.length, onclick: downloadFile }, "Export file"),
        h("label", { className: "filebtn small" }, "Import file", fileInput),
        h("span", { className: "muted" }, "Saved in this browser only: export to back it up or move it.")));
    drawList();
  }
  draw();

  return { el, reload: () => { if (open) void reload(); } };
}

/** Saves units to the collection (homebrew form, card, right-click menu). */
export async function saveToCollection(sheets: UnitSheet[], image: ResolvedImage | null, from: string) {
  await putEntries(sheets.map((s) => newEntry(s, { image: image ?? undefined, from })));
}
