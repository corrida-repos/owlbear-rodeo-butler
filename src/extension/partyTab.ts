/**
 * "Add Party Members" tab:
 *  - Sync from D&D Beyond: opens your campaign on dndbeyond.com; the bookmark there reads the sheets and posts
 *    them straight back here, then the party tokens are updated — press it whenever a sheet changes.
 *  - Import published / homebrewed party members (shared roster flow, flagged as party members).
 */
import OBR from "@owlbear-rodeo/sdk";
import bookmarkletSource from "../../scripts/ddb-export.browser.js?raw";
import { describeInitiative, fmtMod } from "../core/dice";
import { circularTokenUrl } from "../core/images";
import { rollbackImport, type ResolvedImage } from "../core/importer";
import { DDB_EXPORT_SCHEMA, PARTY_SCHEMA, partyFromDdbExport, previewParty, restoreTokenImages, syncParty, type PartyPackage, type PartyPreview, type PartySyncReport } from "../core/party";
import { action, check, h, measure, rerender, store, ui, type Child } from "./dom";
import { obrGateway } from "./obrGateway";
import { createRoster } from "./roster";

const DDB_ORIGIN = "https://www.dndbeyond.com";
const MSG_TYPE = "encounter-butler/ddb-export";
/** The bookmark posts the party back only to this extension's own origin (when this page opened the D&D Beyond tab). */
const BOOKMARKLET = `javascript:${encodeURIComponent(`(async()=>{${bookmarkletSource}\nawait ddbExport(undefined,{targetOrigin:${JSON.stringify(location.origin)}});})()`)}`;

const roster = createRoster("party");

let party: PartyPackage | null = null;
let preview: PartyPreview | null = null;
let report: PartySyncReport | null = null;
let waiting = false;
let showFallback = false;
let pasteOpen = false;
let pasteText = "";
let pasteHint = "";
let setupOpen = !store.get("butler.ddbCampaign");
const portraits: Record<number, { status: "ok" | "error" | "pending"; img?: ResolvedImage }> = {};

type InitChoice = "keep" | "unset" | "all";
const saved = store.get("butler.partyInitiative");
const opts = {
  hp: "ddb" as "ddb" | "keep",
  initiative: (saved === "unset" || saved === "all" ? saved : "keep") as InitChoice,
  portraits: store.get("butler.partyPortraits") !== "0",
  createMissing: true,
};

const campaign = () => {
  try { return JSON.parse(store.get("butler.ddbCampaign") ?? "null") as { id: number; name: string } | null; } catch { return null; }
};

/** Circular D&D Beyond avatar through the image proxy (D&D Beyond itself blocks cross-site use). */
function loadPortraits(p: PartyPackage): Promise<unknown> {
  return Promise.all(p.members.map(async (m) => {
    if (!m.avatarUrl || portraits[m.ddbId]?.status === "ok") return;
    const url = circularTokenUrl(m.avatarUrl.split("?")[0]!);
    portraits[m.ddbId] = { status: "pending" };
    try { portraits[m.ddbId] = { status: "ok", img: { url, ...(await measure(url)), mime: "image/png" } }; }
    catch { portraits[m.ddbId] = { status: "error" }; }
    rerender();
  }));
}

async function loadParty(data: unknown) {
  const j: any = typeof data === "string" ? (() => {
    try { return JSON.parse(data); } catch { throw new Error("That isn't a party export. On D&D Beyond, open your campaign page and click the “Copy party” bookmark first."); }
  })() : data;
  const p: PartyPackage = j?.schema === DDB_EXPORT_SCHEMA ? partyFromDdbExport(j) : j?.schema === PARTY_SCHEMA ? j : (() => { throw new Error("Not a D&D Beyond party export."); })();
  party = p;
  report = null;
  preview = await previewParty(p, obrGateway);
  pasteOpen = false;
  pasteText = "";
  if (p.campaign.id) { store.set("butler.ddbCampaign", JSON.stringify({ id: p.campaign.id, name: p.campaign.name })); setupOpen = false; }
  return p;
}

function canSync(pv: PartyPreview) {
  return pv.isGM && !pv.errors.length && pv.rows.some((r) => r.item || opts.createMissing);
}

/** Auto-sync after the bookmark posts back, unless something needs a look first (ambiguous tokens, errors). */
async function receive(bundle: unknown) {
  waiting = false;
  const p = await loadParty(bundle);
  await Promise.race([loadPortraits(p), new Promise((r) => setTimeout(r, 8000))]);
  if (preview && canSync(preview) && preview.rows.every((r) => r.item || (opts.createMissing && !r.ambiguous.length))) await doSync();
  else await OBR.notification.show("Party received from D&D Beyond — check the preview, then press Sync party.", "WARNING");
}

window.addEventListener("message", (e) => {
  if (e.origin !== DDB_ORIGIN || e.data?.type !== MSG_TYPE) return;
  void action(() => receive(e.data.bundle))();
});

function openDdb() {
  const c = campaign();
  const url = c ? `${DDB_ORIGIN}/campaigns/${c.id}` : `${DDB_ORIGIN}/my-campaigns`;
  const w = window.open(url, "_blank"); // keeps window.opener so the bookmark can post back
  waiting = true;
  showFallback = !w;
  if (!w) pasteHint = "Your browser didn't open the D&D Beyond tab. Open your campaign there yourself, click the bookmark, then paste here:";
  rerender();
}

async function pasteFromClipboard() {
  // Chrome may show its "allow clipboard" prompt (address bar); don't hang on it — offer the paste box meanwhile.
  const timeout = new Promise<null>((r) => setTimeout(() => r(null), 3000));
  let text: string | null = null;
  try { text = await Promise.race([navigator.clipboard.readText(), timeout]); }
  catch { pasteHint = "Clipboard access was blocked. Paste here instead (Ctrl+V):"; pasteOpen = true; return; }
  if (text === null) { pasteHint = "Waiting for clipboard permission (check the prompt by the address bar), or paste here (Ctrl+V):"; pasteOpen = true; return; }
  if (!text.trim()) { pasteHint = "Your clipboard is empty — click the D&D Beyond bookmark first, or paste here:"; pasteOpen = true; return; }
  waiting = false;
  const p = await loadParty(text);
  void loadPortraits(p);
}

async function doSync() {
  if (!party) return;
  const avatars: Record<number, ResolvedImage> = {};
  if (opts.portraits) for (const [k, v] of Object.entries(portraits)) if (v.img) avatars[Number(k)] = v.img;
  const placeholder = new URL("tokens/party-placeholder.png", location.href).toString();
  for (const m of party.members) if (!avatars[m.ddbId] && opts.createMissing) avatars[m.ddbId] = { url: placeholder, width: 256, height: 256, mime: "image/png" };
  // portraits replace existing pictures only when enabled; the placeholder is only for new tokens
  const replace: Record<number, ResolvedImage> = {};
  if (opts.portraits) for (const [k, v] of Object.entries(portraits)) if (v.img) replace[Number(k)] = v.img;
  report = await syncParty(party, { hp: opts.hp, createMissing: opts.createMissing, initiative: opts.initiative, avatars, replaceWith: opts.portraits ? replace : undefined }, obrGateway);
  await OBR.notification.show(report.ok ? `Party synced from D&D Beyond (${report.updated.length} updated, ${report.created.length} new).` : "Party sync failed — see the panel.", report.ok ? "SUCCESS" : "ERROR");
  preview = await previewParty(party, obrGateway);
}

/** Undo the party members a sync added (new tokens) and the portraits it put on existing tokens. */
async function undoSync() {
  if (!report) return;
  const removed = await rollbackImport(report.createdItemIds, obrGateway);
  const restored = await restoreTokenImages(report.previousImages, obrGateway);
  report = { ...report, createdItemIds: [], previousImages: {} };
  await OBR.notification.show(`Removed ${removed} new token(s), restored ${restored} previous picture(s).`, "INFO");
  if (party) preview = await previewParty(party, obrGateway);
}

// ------------------------------------------------------------------ rendering

function renderSync(): Child {
  const c = campaign();
  const fileInput = h("input", { type: "file", accept: ".json,application/json", onchange: action(async () => {
    const f = fileInput.files?.[0];
    if (f) { waiting = false; const p = await loadParty(await f.text()); void loadPortraits(p); }
  }) }) as HTMLInputElement;
  const bookmark = h("a", { className: "bookmarklet", href: BOOKMARKLET, onclick: (e: Event) => e.preventDefault(), title: "Drag me to the bookmarks bar" }, "⭳ Copy party for Encounter Butler");
  return h("div", { className: "panel" },
    h("h2", {}, "Sync from D&D Beyond"),
    h("button", { className: "wide big", disabled: ui.busy, onclick: openDdb }, "⟳ Sync from D&D Beyond"),
    h("div", { className: "small muted", style: "margin-top:4px" },
      c ? `Opens “${c.name}” on D&D Beyond. Click the bookmark there and the party is updated here.`
        : "Opens your campaigns on D&D Beyond. Open the campaign you DM, click the bookmark, and the party is updated here."),
    waiting ? h("div", { className: "small warn", style: "margin-top:6px" }, "Waiting for the bookmark on the D&D Beyond tab…") : null,
    h("details", { open: setupOpen, ontoggle: (e: Event) => { setupOpen = (e.target as HTMLDetailsElement).open; }, style: "margin-top:8px" },
      h("summary", { className: "small" }, c ? "Bookmark setup and other ways to load" : "First time: set up the bookmark"),
      h("p", { className: "small" }, "Drag this button to your browser's bookmarks bar once (drag it again if you set it up before this version):"),
      bookmark,
      h("div", { className: "row", style: "margin-top:8px" },
        h("button", { className: "secondary", onclick: action(pasteFromClipboard) }, "Paste party"),
        h("label", { className: "filebtn secondary" }, "Choose file…", fileInput),
        c ? h("button", { className: "secondary", onclick: () => { store.set("butler.ddbCampaign", "null"); rerender(); } }, "Forget campaign") : null),
      h("div", { className: "small muted", style: "margin-top:4px" }, "Use these if the D&D Beyond tab didn't send the party back: the bookmark also copies it to your clipboard.")),
    pasteOpen || showFallback ? h("div", { style: "margin-top:6px" },
      h("div", { className: "small warn" }, pasteHint),
      h("textarea", { placeholder: "Paste the party here (Ctrl+V)", oninput: (e: Event) => { pasteText = (e.target as HTMLTextAreaElement).value; } }, pasteText),
      h("button", { onclick: action(async () => { const p = await loadParty(pasteText); showFallback = false; void loadPortraits(p); }) }, "Load")) : null);
}

function renderPreview(p: PartyPackage, pv: PartyPreview): Child[] {
  const checks: HTMLElement[] = [];
  if (!pv.isGM) checks.push(check("bad", "You are not the GM — sync disabled"));
  for (const e of pv.errors) checks.push(check("bad", e));

  const rows = pv.rows.map((r) => {
    const m = r.member;
    const pt = portraits[m.ddbId];
    return h("div", { className: "entry" },
      pt?.img ? h("img", { src: pt.img.url, className: "thumb round" }) : h("div", { className: "thumb empty round" }, pt?.status === "pending" ? "…" : "?"),
      h("div", { className: "grow" },
        h("strong", {}, m.name),
        h("div", { className: "small muted" }, `Level ${m.level} · ${m.classes} · ${m.species}`),
        h("div", { className: "small" }, `HP ${m.hp.current}/${m.hp.max} · AC ${m.ac} · Init ${fmtMod(m.initiative.modifier)}${m.initiative.advantage ? " adv" : ""}`),
        h("div", { className: "small " + (r.item ? "ok" : "warn") },
          r.item ? `✔ token “${r.item.label ?? r.item.name}”` : r.ambiguous.length ? `several tokens could match: ${r.ambiguous.join(", ")} — rename one` : opts.createMissing ? "no token yet — one will be created" : "no token — will be skipped")));
  });
  const notes = p.members.flatMap((m) => m.flags.filter((f) => !/^Saving throw proficiencies|^AC \d+ =/.test(f)).map((f) => `${m.name}: ${f}`));
  return [
    h("div", { className: "panel" },
      h("h2", {}, p.campaign.name),
      h("div", { className: "small muted" }, `D&D Beyond data from ${new Date(p.fetchedAt).toLocaleString()}`),
      checks.length ? h("ul", { className: "checks" }, ...checks) : null,
      ...rows,
      h("details", { className: "small", style: "margin-top:8px" }, h("summary", {}, "Sync options"),
        h("label", {}, h("input", { type: "checkbox", checked: opts.portraits, onchange: (e: Event) => { opts.portraits = (e.target as HTMLInputElement).checked; store.set("butler.partyPortraits", opts.portraits ? "1" : "0"); } }),
          "Use D&D Beyond portraits as round tokens"),
        h("label", {}, h("input", { type: "checkbox", checked: opts.createMissing, onchange: (e: Event) => { opts.createMissing = (e.target as HTMLInputElement).checked; rerender(); } }),
          "Create tokens for characters without one"),
        h("label", { style: "flex-direction:column;gap:2px" }, "Initiative",
          h("select", { onchange: (e: Event) => { opts.initiative = (e.target as HTMLSelectElement).value as InitChoice; store.set("butler.partyInitiative", opts.initiative); } },
            h("option", { value: "keep", selected: opts.initiative === "keep" }, "don't touch (roll it in the Combat tab)"),
            h("option", { value: "unset", selected: opts.initiative === "unset" }, "roll for anyone without one"),
            h("option", { value: "all", selected: opts.initiative === "all" }, "re-roll for everyone"))),
        h("label", { style: "flex-direction:column;gap:2px" }, "Current HP",
          h("select", { onchange: (e: Event) => { opts.hp = (e.target as HTMLSelectElement).value as "ddb" | "keep"; } },
            h("option", { value: "ddb", selected: opts.hp === "ddb" }, "from D&D Beyond"),
            h("option", { value: "keep", selected: opts.hp === "keep" }, "keep what the token has (mid-session)"))))),
    h("button", { className: "wide", disabled: ui.busy || !canSync(pv), onclick: action(doSync) }, "Sync party"),
    notes.length ? h("details", { className: "panel small" }, h("summary", {}, `Notes from D&D Beyond (${notes.length})`), h("ul", { className: "plain" }, ...notes.map((n) => h("li", {}, n)))) : null,
  ];
}

function renderReport(r: PartySyncReport): Child {
  const canUndo = r.createdItemIds.length > 0 || Object.keys(r.previousImages ?? {}).length > 0;
  return h("div", { className: "panel" },
    h("div", { className: "row between" },
      h("h2", {}, r.ok ? "Party synced" : "Sync failed"),
      canUndo ? h("button", { className: "secondary", onclick: action(undoSync), title: "Removes the tokens this sync created and restores replaced pictures" }, "Undo") : null),
    r.error ? h("div", { className: "bad small" }, r.error) : null,
    h("ul", { className: "plain small" },
      ...r.rolled.map((x) => h("li", {}, `${x.name}: initiative ${describeInitiative(x.roll)}`)),
      ...r.updated.map((x) => h("li", { className: "ok" }, `updated ${x}`)),
      ...r.created.map((x) => h("li", { className: "ok" }, `created ${x}`)),
      ...r.skipped.map((x) => h("li", { className: "warn" }, x))));
}

export function renderPartyTab(): Child[] {
  const nodes: Child[] = [renderSync()];
  if (report) nodes.push(renderReport(report));
  if (party && preview) nodes.push(...renderPreview(party, preview));
  nodes.push(...roster.render());
  return nodes;
}
export function resetPartyTab() { party = null; preview = null; report = null; waiting = false; }
