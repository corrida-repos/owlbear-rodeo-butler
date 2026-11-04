/**
 * "Party" tab: sync the characters of a D&D Beyond campaign you DM onto your party tokens
 * (Forge stats, HP, optional rolled initiative, circular D&D Beyond portraits).
 */
import OBR from "@owlbear-rodeo/sdk";
import bookmarkletSource from "../../scripts/ddb-export.browser.js?raw";
import { describeInitiative, fmtMod } from "../core/dice";
import { circularTokenUrl } from "../core/images";
import type { ResolvedImage } from "../core/importer";
import { DDB_EXPORT_SCHEMA, PARTY_SCHEMA, partyFromDdbExport, previewParty, restoreTokenImages, syncParty, type PartyPackage, type PartyPreview, type PartySyncReport } from "../core/party";
import { action, check, h, measure, rerender, store, ui, type Child } from "./dom";
import { obrGateway } from "./obrGateway";

const BOOKMARKLET = `javascript:${encodeURIComponent(`(async()=>{${bookmarkletSource}\nawait ddbExport();})()`)}`;

let party: PartyPackage | null = null;
let preview: PartyPreview | null = null;
let report: PartySyncReport | null = null;
let pasteOpen = false;
let pasteText = "";
const portraits: Record<number, { status: "ok" | "error" | "pending"; img?: ResolvedImage }> = {};

type InitChoice = "keep" | "unset" | "all";
const saved = store.get("butler.partyInitiative");
const opts = {
  hp: "ddb" as "ddb" | "keep",
  initiative: (saved === "keep" || saved === "all" ? saved : "unset") as InitChoice,
  portraits: store.get("butler.partyPortraits") !== "0",
  createMissing: true,
};

/** Circular D&D Beyond avatar through the image proxy (D&D Beyond itself blocks cross-site use). */
function loadPortraits(p: PartyPackage) {
  for (const m of p.members) {
    if (!m.avatarUrl || portraits[m.ddbId]) continue;
    const url = circularTokenUrl(m.avatarUrl.split("?")[0]!);
    portraits[m.ddbId] = { status: "pending" };
    measure(url).then((size) => { portraits[m.ddbId] = { status: "ok", img: { url, ...size, mime: "image/png" } }; rerender(); })
      .catch(() => { portraits[m.ddbId] = { status: "error" }; rerender(); });
  }
}

async function loadParty(text: string) {
  let j: any;
  try { j = JSON.parse(text); } catch { throw new Error("That isn't a party export. On D&D Beyond, open your campaign page and click the “Copy party” bookmarklet first."); }
  const p: PartyPackage = j?.schema === DDB_EXPORT_SCHEMA ? partyFromDdbExport(j) : j?.schema === PARTY_SCHEMA ? j : (() => { throw new Error("Not a D&D Beyond party export."); })();
  party = p;
  report = null;
  preview = await previewParty(p, obrGateway);
  pasteOpen = false;
  pasteText = "";
  loadPortraits(p);
}

let pasteHint = "";
async function pasteFromClipboard() {
  // Chrome may show its "allow clipboard" prompt (address bar); don't hang on it — offer the paste box meanwhile.
  const timeout = new Promise<null>((r) => setTimeout(() => r(null), 3000));
  let text: string | null = null;
  try { text = await Promise.race([navigator.clipboard.readText(), timeout]); }
  catch { pasteHint = "Clipboard access was blocked. Paste here instead (Ctrl+V):"; pasteOpen = true; return; }
  if (text === null) { pasteHint = "Waiting for clipboard permission (check the prompt by the address bar), or paste here (Ctrl+V):"; pasteOpen = true; return; }
  if (!text.trim()) { pasteHint = "Your clipboard is empty — click the D&D Beyond bookmarklet first, or paste here:"; pasteOpen = true; return; }
  await loadParty(text);
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
  await OBR.notification.show(report.ok ? `Party synced (${report.updated.length} updated, ${report.created.length} new).` : "Party sync failed — see the panel.", report.ok ? "SUCCESS" : "ERROR");
  preview = await previewParty(party, obrGateway);
}

async function undoPortraits() {
  if (!report) return;
  const n = await restoreTokenImages(report.previousImages, obrGateway);
  report = { ...report, previousImages: {} };
  await OBR.notification.show(`Restored ${n} previous token picture(s).`, "INFO");
}

function renderSteps(): Child {
  return h("div", { className: "panel" },
    h("h2", {}, "1 · Copy your party from D&D Beyond"),
    h("p", { className: "small" }, "Drag this button to your bookmarks bar once. Then open your campaign page on dndbeyond.com (you must be its DM) and click it — it copies your party."),
    h("a", { className: "bookmarklet", href: BOOKMARKLET, onclick: (e: Event) => e.preventDefault(), title: "Drag me to the bookmarks bar" }, "⭳ Copy party for Encounter Butler"),
    h("h2", { style: "margin-top:12px" }, "2 · Paste it here"),
    h("div", { className: "row" },
      h("button", { onclick: action(pasteFromClipboard) }, "Paste party"),
      h("label", { className: "filebtn secondary" }, "Choose file…",
        h("input", { type: "file", accept: ".json,application/json", onchange: action(async () => {
          const f = (document.querySelector(".filebtn input") as HTMLInputElement).files?.[0];
          if (f) await loadParty(await f.text());
        }) }))),
    pasteOpen ? h("div", { style: "margin-top:6px" },
      h("div", { className: "small warn" }, pasteHint),
      h("textarea", { placeholder: "Paste the party here (Ctrl+V)", oninput: (e: Event) => { pasteText = (e.target as HTMLTextAreaElement).value; } }, pasteText),
      h("button", { onclick: action(() => loadParty(pasteText)) }, "Load")) : null);
}

function renderPreview(p: PartyPackage, pv: PartyPreview): Child[] {
  const checks: HTMLElement[] = [];
  if (!pv.isGM) checks.push(check("bad", "You are not the GM — sync disabled"));
  if (pv.system.kind !== "default") checks.push(check("warn", `Forge has a custom system ("${pv.system.name}"): switch to the default system first`));
  for (const e of [...pv.errors, ...pv.forgeErrors]) checks.push(check("bad", e));

  const rows = pv.rows.map((r) => {
    const m = r.member;
    const pt = portraits[m.ddbId];
    return h("div", { className: "entry" },
      pt?.img ? h("img", { src: pt.img.url, className: "thumb round" }) : h("div", { className: "thumb empty round" }, pt?.status === "pending" ? "…" : "?"),
      h("div", { className: "grow" },
        h("strong", {}, m.name),
        h("div", { className: "small muted" }, `${m.classes} · ${m.species}`),
        h("div", { className: "small" }, `HP ${m.hp.current}/${m.hp.max} · AC ${m.ac} · Init ${fmtMod(m.initiative.modifier)}${m.initiative.advantage ? " adv" : ""}`),
        h("div", { className: "small " + (r.item ? "ok" : "warn") },
          r.item ? `✔ token “${r.item.label ?? r.item.name}”` : r.ambiguous.length ? `several tokens could match: ${r.ambiguous.join(", ")}` : opts.createMissing ? "no token yet — one will be created" : "no token — will be skipped")));
  });
  const canSync = pv.isGM && !pv.errors.length && !pv.forgeErrors.length && pv.system.kind === "default" && pv.rows.some((r) => r.item || opts.createMissing);
  const notes = p.members.flatMap((m) => m.flags.filter((f) => !/^Saving throw proficiencies|^AC \d+ =/.test(f)).map((f) => `${m.name}: ${f}`));
  return [
    h("div", { className: "panel" },
      h("h2", {}, `3 · ${p.campaign.name}`),
      h("div", { className: "small muted" }, `D&D Beyond data from ${new Date(p.fetchedAt).toLocaleString()}`),
      checks.length ? h("ul", { className: "checks" }, ...checks) : null,
      ...rows),
    h("div", { className: "panel" },
      h("label", {}, h("input", { type: "checkbox", checked: opts.portraits, onchange: (e: Event) => { opts.portraits = (e.target as HTMLInputElement).checked; store.set("butler.partyPortraits", opts.portraits ? "1" : "0"); } }),
        "Use D&D Beyond portraits as round tokens"),
      h("label", {}, h("input", { type: "checkbox", checked: opts.createMissing, onchange: (e: Event) => { opts.createMissing = (e.target as HTMLInputElement).checked; rerender(); } }),
        "Create tokens for characters without one"),
      h("label", {}, "Initiative",
        h("select", { onchange: (e: Event) => { opts.initiative = (e.target as HTMLSelectElement).value as InitChoice; store.set("butler.partyInitiative", opts.initiative); } },
          h("option", { value: "unset", selected: opts.initiative === "unset" }, "roll for anyone without one"),
          h("option", { value: "all", selected: opts.initiative === "all" }, "re-roll for everyone"),
          h("option", { value: "keep", selected: opts.initiative === "keep" }, "don't touch (players roll)"))),
      h("label", {}, "Current HP",
        h("select", { onchange: (e: Event) => { opts.hp = (e.target as HTMLSelectElement).value as "ddb" | "keep"; } },
          h("option", { value: "ddb", selected: opts.hp === "ddb" }, "from D&D Beyond"),
          h("option", { value: "keep", selected: opts.hp === "keep" }, "keep what the token has (mid-session)")))),
    h("button", { className: "wide big", disabled: ui.busy || !canSync, onclick: action(doSync) }, "Sync party"),
    notes.length ? h("details", { className: "panel small" }, h("summary", {}, `Notes from D&D Beyond (${notes.length})`), h("ul", { className: "plain" }, ...notes.map((n) => h("li", {}, n)))) : null,
  ];
}

function renderReport(r: PartySyncReport): Child {
  return h("div", { className: "panel" },
    h("div", { className: "row between" },
      h("h2", {}, r.ok ? "Party synced" : "Sync failed"),
      Object.keys(r.previousImages ?? {}).length ? h("button", { className: "secondary", onclick: action(undoPortraits) }, "Undo portraits") : null),
    r.error ? h("div", { className: "bad small" }, r.error) : null,
    h("ul", { className: "plain small" },
      ...r.rolled.map((x) => h("li", {}, `${x.name}: initiative ${describeInitiative(x.roll)}`)),
      ...r.updated.map((x) => h("li", { className: "ok" }, `updated ${x}`)),
      ...r.created.map((x) => h("li", { className: "ok" }, `created ${x}`)),
      ...r.skipped.map((x) => h("li", { className: "warn" }, x))));
}

export function renderPartyTab(): Child[] {
  const nodes: Child[] = [renderSteps()];
  if (report) nodes.push(renderReport(report));
  if (party && preview) nodes.push(...renderPreview(party, preview));
  return nodes;
}
export function resetPartyTab() { party = null; preview = null; report = null; }
