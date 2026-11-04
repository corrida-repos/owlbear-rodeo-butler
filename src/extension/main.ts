import OBR from "@owlbear-rodeo/sdk";
import { SIZE_CELLS } from "../core/constants";
import { describeInitiative } from "../core/dice";
import {
  analyse,
  checkAssetUrl,
  executeImport,
  resolveRelativeUrl,
  rollbackImport,
  type ImportOptions,
  type ImportReport,
  type Preview,
  type ResolvedImage,
} from "../core/importer";
import type { EncounterPackage } from "../core/schema";
import { PARTY_SCHEMA, previewParty, restoreTokenImages, setPartyTokenImages, syncParty, type ImageSwapReport, type PartyPackage, type PartyPreview, type PartySyncReport } from "../core/party";
import { obrGateway } from "./obrGateway";

// ------------------------------------------------------------------ tiny DOM helper (textContent only: package text is never parsed as HTML)

type Child = Node | string | null | undefined | false;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, any> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "className") el.className = v;
    else if (k in el && typeof v !== "string") (el as any)[k] = v;
    else el.setAttribute(k, String(v));
  }
  for (const c of children) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(c));
  return el;
}
const app = document.getElementById("app")!;
const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
};

// ------------------------------------------------------------------ state

interface AssetState { status: "pending" | "ok" | "error" | "needs-pick"; resolved?: ResolvedImage; message?: string; local?: boolean }
let pkg: EncounterPackage | null = null;
let pkgUrl: string | undefined;
let preview: Preview | null = null;
let assetState: Record<string, AssetState> = {};
let lastReport: ImportReport | null = null;
const options = { applyGrid: true, mapPlacement: "auto" as "auto" | "origin", duplicatePolicy: "abort" as ImportOptions["duplicatePolicy"], acceptCustomSystem: false, allowLocalAssets: false };

// ------------------------------------------------------------------ loading

async function loadFromUrl(url: string) {
  const abs = new URL(url, location.href).toString();
  const res = await fetch(abs, { cache: "no-cache" });
  if (!res.ok) throw new Error(`HTTP ${res.status} loading ${abs}`);
  store.set("butler.lastUrl", url);
  await setPackage(await res.json(), abs);
}

async function setPackage(json: unknown, url?: string) {
  if ((json as any)?.schema === PARTY_SCHEMA) return setParty(json as PartyPackage);
  party = null;
  pkg = json as EncounterPackage;
  pkgUrl = url;
  lastReport = null;
  assetState = {};
  preview = await analyse(json, obrGateway);
  options.applyGrid = preview.grid.differs;
  options.duplicatePolicy = "abort";
  options.acceptCustomSystem = false;
  render();
  if (preview.validation.ok) await resolveAssets();
}

function measure(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const t = setTimeout(() => reject(new Error("timed out after 20 s")), 20000);
    img.onload = () => { clearTimeout(t); resolve({ width: img.naturalWidth, height: img.naturalHeight }); };
    img.onerror = () => { clearTimeout(t); reject(new Error("image failed to load (404, blocked or not an image)")); };
    img.src = url;
  });
}

const mimeFromUrl = (u: string) =>
  /\.png(\?|$)/i.test(u) ? "image/png" : /\.jpe?g(\?|$)/i.test(u) ? "image/jpeg" : /\.gif(\?|$)/i.test(u) ? "image/gif" : "image/webp";

async function resolveAssets() {
  if (!pkg) return;
  const used = new Set([pkg.map.asset, ...pkg.creatures.map((c) => c.token)]);
  await Promise.all([...used].map(async (key) => {
    const a = pkg!.assets[key]!;
    if (a.image.kind === "library") { assetState[key] = { status: "needs-pick", message: `pick "${a.image.search}" from your Owlbear library` }; return; }
    try {
      const url = resolveRelativeUrl(a.image.url, pkgUrl);
      const policy = checkAssetUrl(url);
      const size = await measure(url);
      assetState[key] = {
        status: "ok",
        resolved: { url, width: size.width, height: size.height, mime: a.image.mime ?? mimeFromUrl(url) },
        local: !!policy,
        message: policy ?? undefined,
      };
    } catch (e) {
      assetState[key] = { status: "error", message: e instanceof Error ? e.message : String(e) };
    }
    render();
  }));
  render();
}

async function pickFromLibrary(key: string) {
  const a = pkg!.assets[key]!;
  if (a.image.kind !== "library") return;
  const isMap = key === pkg!.map.asset;
  const picked = await OBR.assets.downloadImages(false, a.image.search, isMap ? "MAP" : "CHARACTER");
  const img = picked[0]?.image;
  if (!img) return;
  assetState[key] = { status: "ok", resolved: { url: img.url, width: img.width, height: img.height, mime: img.mime }, message: "from Owlbear library" };
  render();
}

// ------------------------------------------------------------------ import

async function doImport() {
  if (!pkg || !preview) return;
  const resolvedAssets: Record<string, ResolvedImage> = {};
  for (const [k, s] of Object.entries(assetState)) if (s.resolved) resolvedAssets[k] = s.resolved;
  setBusy(true);
  try {
    lastReport = await executeImport(pkg, { ...options, resolvedAssets }, obrGateway);
    if (lastReport.ok) await OBR.notification.show(`Encounter "${pkg.title}" imported (${pkg.creatures.length} creatures).`, "SUCCESS");
    else await OBR.notification.show(`Import did not complete — see the report.`, "ERROR");
    preview = await analyse(pkg, obrGateway);
  } finally {
    setBusy(false);
    render();
  }
}

async function undo() {
  if (!lastReport) return;
  setBusy(true);
  try {
    const n = await rollbackImport(lastReport.createdItemIds, obrGateway);
    await OBR.notification.show(`Removed ${n} items from that import.`, "INFO");
    lastReport = { ...lastReport, createdItemIds: [], steps: [...lastReport.steps, { step: "Undo", ok: true, detail: `removed ${n} items` }] };
    if (pkg) preview = await analyse(pkg, obrGateway);
  } finally {
    setBusy(false);
    render();
  }
}

let busy = false;
function setBusy(b: boolean) { busy = b; render(); }

// ------------------------------------------------------------------ rendering

function check(level: "ok" | "warn" | "bad", text: string, extra?: Child) {
  const icon = level === "ok" ? "✔" : level === "warn" ? "⚠" : "✖";
  return h("li", {}, h("span", { className: level }, icon), h("span", {}, text, extra ?? null));
}

function blockingIssues(): string[] {
  const out: string[] = [];
  if (!pkg || !preview) return ["no package loaded"];
  if (!preview.validation.ok) out.push("package invalid");
  if (!preview.isGM) out.push("only the GM can import");
  if (preview.forgeErrors.length) out.push("Forge metadata errors");
  if (preview.system.kind === "custom" && !options.acceptCustomSystem) out.push("confirm custom Forge system");
  if (preview.duplicates.itemIds.length && options.duplicatePolicy === "abort") out.push("choose what to do with the existing copy");
  for (const [k, s] of Object.entries(assetState)) {
    if (s.status !== "ok") out.push(`asset "${k}" not ready`);
    else if (s.local && !options.allowLocalAssets) out.push(`asset "${k}" is not publicly reachable`);
  }
  if (!Object.keys(assetState).length) out.push("assets still loading");
  return out;
}

let urlDraft = store.get("butler.lastUrl") ?? "";
let pasteDraft = "";
function renderLoader() {
  const urlInput = h("input", { type: "text", placeholder: "https://…/encounters/<id>/encounter.json", value: urlDraft, oninput: (e: Event) => { urlDraft = (e.target as HTMLInputElement).value; } }) as HTMLInputElement;
  const paste = h("textarea", { placeholder: "…or paste encounter.json here", oninput: (e: Event) => { pasteDraft = (e.target as HTMLTextAreaElement).value; } }) as HTMLTextAreaElement;
  paste.value = pasteDraft;
  const file = h("input", { type: "file", accept: ".json,application/json" }) as HTMLInputElement;
  const run = (fn: () => Promise<void>) => async () => {
    try { setBusy(true); await fn(); } catch (e) { alertError(e); } finally { setBusy(false); }
  };
  file.addEventListener("change", run(async () => {
    const f = file.files?.[0];
    if (f) await setPackage(JSON.parse(await f.text()));
  }));
  return h("div", { className: "panel" },
    h("h2", {}, "Load encounter package"),
    h("div", { className: "row" }, urlInput,
      h("button", { onclick: run(() => loadFromUrl(urlInput.value.trim())), disabled: busy }, "Load URL"),
      h("button", { className: "secondary", onclick: run(() => loadFromUrl("encounters/wolves-test/encounter.json")), disabled: busy }, "Bundled wolves test")),
    h("div", { className: "row", style: "margin-top:6px" }, file),
    h("div", { style: "margin-top:6px" }, paste),
    h("div", { className: "row", style: "margin-top:6px" },
      h("button", { className: "secondary", onclick: run(async () => setPackage(JSON.parse(paste.value))), disabled: busy }, "Load pasted JSON")),
  );
}

let errorText = "";
function alertError(e: unknown) { errorText = e instanceof Error ? e.message : String(e); render(); }

function renderPreview(p: Preview, pk: EncounterPackage) {
  const checks: HTMLElement[] = [];
  if (p.validation.ok) checks.push(check("ok", "Package valid"));
  else checks.push(check("bad", "Package invalid:", h("ul", { className: "plain small" }, ...p.validation.errors.map((e) => h("li", {}, e)))));
  for (const w of p.validation.warnings) checks.push(check("warn", w));
  checks.push(check(p.isGM ? "ok" : "bad", p.isGM ? "You are the GM" : "You are not the GM — import disabled"));
  checks.push(p.system.kind === "default"
    ? check("ok", `Forge system: ${p.system.name} (built-in; BIDs verified)`)
    : check("warn", p.systemWarning ?? "custom system"));
  if (p.duplicates.itemIds.length)
    checks.push(check("warn", `Already imported in this scene: ${p.duplicates.itemIds.length} items from ${p.duplicates.importIds.length} earlier import(s) (revision ${p.duplicates.revisions.join(", ")}).`));
  else checks.push(check("ok", "Not yet imported in this scene"));
  checks.push(check("ok", `Existing scene content kept: ${p.existingMapCount} map(s), ${p.existingForgeUnits} unit(s) in the Forge tracker`));
  checks.push(p.grid.differs
    ? check("warn", `Scene grid ${p.grid.current.type} ${p.grid.current.scale} differs from package ${p.grid.wanted.type} ${p.grid.wanted.scale}`)
    : check("ok", `Grid ${p.grid.current.type} ${p.grid.current.scale} (scene ${p.grid.current.dpi} dpi)`));
  for (const w of p.placementWarnings) checks.push(check("warn", w));
  for (const e of p.forgeErrors) checks.push(check("bad", e));
  for (const [k, s] of Object.entries(assetState)) {
    const a = pk.assets[k]!;
    const label = `${k === pk.map.asset ? "Map" : "Token"} "${k}" (${a.credit ?? "no credit"})`;
    if (s.status === "ok") checks.push(check(s.local ? "warn" : "ok", `${label}: ${s.resolved!.width}×${s.resolved!.height}${s.message ? ` — ${s.message}` : ""}`));
    else if (s.status === "needs-pick") checks.push(check("warn", `${label}: ${s.message} `, h("button", { className: "secondary", onclick: () => pickFromLibrary(k) }, "Pick…")));
    else checks.push(check(s.status === "pending" ? "warn" : "bad", `${label}: ${s.message ?? "loading…"}`));
  }

  const rows = p.creatures.map((c) =>
    h("tr", {},
      h("td", {}, c.name, h("div", { className: "muted small" }, `${c.statblock} · ${c.size} · (${c.cell.x},${c.cell.y})`)),
      h("td", { className: "num" }, c.hp),
      h("td", { className: "num" }, String(c.ac)),
      h("td", { className: "num" }, c.initiative)));

  const sources = Object.entries(pk.statblocks).map(([, sb]) =>
    h("li", {},
      h("strong", {}, sb.name), " — ", sb.source.provenance === "official" ? "official" : h("span", { className: "warn" }, sb.source.provenance.toUpperCase()),
      `, ${[sb.source.bookTitle ?? sb.source.book, sb.source.page ? `p. ${sb.source.page}` : ""].filter(Boolean).join(", ")}`,
      h("div", { className: "muted small" }, `Initiative: ${sb.initiative.reasons.join("; ")}`),
      ...sb.flags.map((f) => h("div", { className: "warn small" }, `⚠ ${f}`))));

  // options
  const opt = h("div", { className: "panel" }, h("h2", {}, "Options"),
    h("label", {}, h("input", { type: "checkbox", checked: options.applyGrid, onchange: (e: Event) => { options.applyGrid = (e.target as HTMLInputElement).checked; } }),
      `Set scene grid to ${pk.map.grid.type} ${pk.map.grid.scale}`),
    h("label", {}, "Map placement:",
      h("select", { onchange: (e: Event) => { options.mapPlacement = (e.target as HTMLSelectElement).value as any; } },
        h("option", { value: "auto", selected: options.mapPlacement === "auto" }, "beside existing maps (auto)"),
        h("option", { value: "origin", selected: options.mapPlacement === "origin" }, "at scene origin (0,0)"))),
    p.duplicates.itemIds.length ? h("div", {}, h("div", { className: "small muted" }, "This package is already in the scene:"),
      ...(["abort", "replace", "add"] as const).map((v) => h("label", {},
        h("input", { type: "radio", name: "dup", checked: options.duplicatePolicy === v, onchange: () => { options.duplicatePolicy = v; render(); } }),
        v === "abort" ? "Don't import" : v === "replace" ? "Replace the earlier copy (only items created by that import)" : "Add another copy"))) : null,
    p.system.kind === "custom" ? h("label", {}, h("input", { type: "checkbox", checked: options.acceptCustomSystem, onchange: (e: Event) => { options.acceptCustomSystem = (e.target as HTMLInputElement).checked; render(); } }),
      "I confirm my custom Forge system uses the same attribute IDs") : null,
    Object.values(assetState).some((s) => s.local) ? h("label", {}, h("input", { type: "checkbox", checked: options.allowLocalAssets, onchange: (e: Event) => { options.allowLocalAssets = (e.target as HTMLInputElement).checked; render(); } }),
      h("span", { className: "warn" }, "Allow non-public image URLs (GM-only test: players will NOT see these images)")) : null,
  );

  const blockers = blockingIssues();
  return [
    h("div", { className: "panel" },
      h("h1", {}, pk.title),
      pk.description ? h("p", { className: "small" }, pk.description) : null,
      h("div", { className: "muted small" }, `${pk.id} · revision ${pk.revision} · rules ${pk.rules}`)),
    h("div", { className: "panel" }, h("h2", {}, "Checks"), h("ul", { className: "checks" }, ...checks)),
    renderMapPreview(pk),
    h("div", { className: "panel" }, h("h2", {}, `Creatures (${p.creatures.length})`),
      h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, "Name"), h("th", {}, "HP"), h("th", {}, "AC"), h("th", {}, "Initiative"))), h("tbody", {}, ...rows))),
    h("div", { className: "panel" }, h("h2", {}, "Stat block sources"), h("ul", { className: "plain small" }, ...sources)),
    pk.assumptions.length || pk.warnings.length ? h("div", { className: "panel" }, h("h2", {}, "Assumptions & warnings"),
      h("ul", { className: "plain small" }, ...pk.assumptions.map((a) => h("li", {}, a)), ...pk.warnings.map((w) => h("li", { className: "warn" }, w)))) : null,
    opt,
    h("div", { className: "panel" },
      h("button", { onclick: doImport, disabled: busy || blockers.length > 0 }, `Import ${pk.creatures.length} creatures + map`),
      blockers.length ? h("div", { className: "small muted", style: "margin-top:6px" }, `Blocked: ${blockers.join("; ")}`) : null),
  ];
}

function renderMapPreview(pk: EncounterPackage) {
  const canvas = h("canvas") as HTMLCanvasElement;
  const s = assetState[pk.map.asset];
  const W = 400;
  const scale = W / pk.map.width;
  canvas.width = W;
  canvas.height = Math.round(pk.map.height * scale);
  const ctx = canvas.getContext("2d")!;
  const drawTokens = () => {
    const cellPx = pk.map.grid.cellPx * scale;
    const ox = pk.map.grid.offsetPx.x * scale, oy = pk.map.grid.offsetPx.y * scale;
    ctx.font = "bold 10px system-ui";
    pk.creatures.forEach((c, i) => {
      const size = SIZE_CELLS[pk.statblocks[c.statblock]!.size] ?? 1;
      const cx = ox + (c.cell.x + size / 2) * cellPx, cy = oy + (c.cell.y + size / 2) * cellPx;
      ctx.beginPath();
      ctx.arc(cx, cy, (size * cellPx) / 2 - 1, 0, Math.PI * 2);
      ctx.fillStyle = c.hidden ? "rgba(120,120,120,.8)" : "rgba(220,50,50,.85)";
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.stroke();
      ctx.fillStyle = "#fff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(i + 1), cx, cy);
    });
  };
  ctx.fillStyle = "#333";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (s?.resolved) {
    const img = new Image();
    img.onload = () => { ctx.drawImage(img, 0, 0, canvas.width, canvas.height); drawTokens(); };
    img.onerror = drawTokens;
    img.src = s.resolved.url;
  } else drawTokens();
  return h("div", { className: "panel" }, h("h2", {}, "Placement preview"), canvas,
    h("div", { className: "small muted" }, "Numbers match the creature table order. After import, tokens are ordinary Owlbear tokens — drag to adjust."));
}

function renderReport(r: ImportReport) {
  return h("div", { className: "panel" },
    h("h2", {}, r.ok ? "Import complete" : "Import did not complete"),
    h("ul", { className: "checks steps" }, ...r.steps.map((s) => check(s.ok ? "ok" : "bad", `${s.step}: ${s.detail}`))),
    r.rolledAtImport.length ? h("div", { className: "small" }, h("strong", {}, "Initiative rolled at import (package had none):"),
      h("ul", { className: "plain" }, ...r.rolledAtImport.map((x) => h("li", {}, `${x.name}: ${describeInitiative(x.roll)}`)))) : null,
    r.createdItemIds.length ? h("div", { className: "row", style: "margin-top:6px" },
      h("button", { className: "secondary", onclick: undo, disabled: busy }, r.ok ? `Undo this import (${r.createdItemIds.length} items)` : `Remove the ${r.createdItemIds.length} items this failed import created`)) : null,
    !r.ok && !r.createdItemIds.length ? h("div", { className: "small ok" }, "Nothing was added to the scene.") : null,
  );
}

// ------------------------------------------------------------------ party sync (D&D Beyond → existing party tokens)

let party: PartyPackage | null = null;
let partyPreview: PartyPreview | null = null;
let partyReport: PartySyncReport | null = null;
type InitChoice = "keep" | "unset" | "all";
const savedInit = store.get("butler.partyInitiative");
const partyOpts = {
  hp: "ddb" as "ddb" | "keep", createMissing: false, acceptCustomSystem: false,
  initiative: (savedInit === "keep" || savedInit === "all" ? savedInit : "unset") as InitChoice,
};
const avatars: Record<number, { status: "ok" | "error" | "pending"; img?: ResolvedImage; message?: string }> = {};

async function setParty(p: PartyPackage) {
  pkg = null; preview = null; lastReport = null;
  party = p;
  partyReport = null;
  partyPreview = await previewParty(p, obrGateway);
  render();
}

/** Avatars must be CORS-enabled for Owlbear to draw them; D&D Beyond's usually aren't, so fall back to the Owlbear library. */
async function checkAvatar(m: PartyPackage["members"][number]) {
  avatars[m.ddbId] = { status: "pending" };
  render();
  try {
    if (!m.avatarUrl) throw new Error("no avatar on D&D Beyond");
    const res = await fetch(m.avatarUrl, { mode: "cors" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const size = await measure(m.avatarUrl);
    avatars[m.ddbId] = { status: "ok", img: { url: m.avatarUrl, ...size, mime: res.headers.get("content-type") ?? "image/jpeg" } };
  } catch (e) {
    avatars[m.ddbId] = { status: "error", message: `D&D Beyond avatar can't be used (${e instanceof Error ? e.message : e}: D&D Beyond blocks cross-site use). Use the placeholder or an Owlbear library image.` };
  }
  render();
}

/** Generic token hosted with this extension (public + CORS). Swap later in Owlbear: right-click → Replace Image. */
async function usePlaceholder(ddbId: number) {
  const url = new URL("tokens/party-placeholder.png", location.href).toString();
  try {
    const size = await measure(url);
    avatars[ddbId] = { status: "ok", img: { url, ...size, mime: "image/png" } };
  } catch (e) {
    avatars[ddbId] = { status: "error", message: `placeholder failed to load (${e instanceof Error ? e.message : e})` };
  }
  render();
}

async function pickAvatar(ddbId: number, name: string) {
  const picked = await OBR.assets.downloadImages(false, name, "CHARACTER");
  const img = picked[0]?.image;
  if (img) avatars[ddbId] = { status: "ok", img: { url: img.url, width: img.width, height: img.height, mime: img.mime } };
  render();
}

/** D&D Beyond's image service can crop/resize: ask for a square 256 px JPEG (same public CDN URL). */
const ddbSquare = (url: string) => `${url.split("?")[0]}?width=256&height=256&fit=crop&quality=95`;

let imageSwap: ImageSwapReport | null = null;
async function useDdbAvatars() {
  if (!party) return;
  setBusy(true);
  try {
    const images: Record<number, ResolvedImage> = {};
    const failed: string[] = [];
    await Promise.all(party.members.map(async (m) => {
      if (!m.avatarUrl) { failed.push(`${m.name}: no avatar on D&D Beyond`); return; }
      const url = ddbSquare(m.avatarUrl);
      try { const size = await measure(url); images[m.ddbId] = { url, ...size, mime: "image/jpeg" }; }
      catch (e) { failed.push(`${m.name}: ${e instanceof Error ? e.message : e}`); }
    }));
    imageSwap = await setPartyTokenImages(party, images, obrGateway);
    imageSwap.skipped.push(...failed);
    await OBR.notification.show(imageSwap.ok ? `Token images updated: ${imageSwap.changed.length}` : `Couldn't update images: ${imageSwap.error}`, imageSwap.ok ? "SUCCESS" : "ERROR");
  } finally { setBusy(false); render(); }
}
async function undoAvatars() {
  if (!imageSwap) return;
  setBusy(true);
  try { const n = await restoreTokenImages(imageSwap.previous, obrGateway); imageSwap = { ...imageSwap, changed: [], previous: {}, skipped: [...imageSwap.skipped, `restored ${n} previous image(s)`] }; }
  finally { setBusy(false); render(); }
}

async function doPartySync() {
  if (!party) return;
  setBusy(true);
  try {
    const imgs: Record<number, ResolvedImage> = {};
    for (const [k, v] of Object.entries(avatars)) if (v.img) imgs[Number(k)] = v.img;
    partyReport = await syncParty(party, { ...partyOpts, avatars: imgs }, obrGateway);
    await OBR.notification.show(partyReport.ok ? `Party synced: ${partyReport.updated.length} updated, ${partyReport.created.length} created.` : "Party sync failed — see the report.", partyReport.ok ? "SUCCESS" : "ERROR");
    partyPreview = await previewParty(party, obrGateway);
  } finally {
    setBusy(false);
    render();
  }
}

function renderParty(p: PartyPackage, pv: PartyPreview): Child[] {
  const checks: HTMLElement[] = [];
  if (pv.errors.length) checks.push(check("bad", `Party file invalid: ${pv.errors.join("; ")}`));
  checks.push(check(pv.isGM ? "ok" : "bad", pv.isGM ? "You are the GM" : "You are not the GM — sync disabled"));
  checks.push(pv.system.kind === "default" ? check("ok", `Forge system: ${pv.system.name}`) : check("warn", `Custom Forge system "${pv.system.name}" — attribute IDs may differ`));
  for (const e of pv.forgeErrors) checks.push(check("bad", e));
  const unmatched = pv.rows.filter((r) => !r.item);

  const rows = pv.rows.map((r) => {
    const m = r.member;
    const av = avatars[m.ddbId];
    const tokenCell = r.item
      ? h("span", { className: "ok" }, `✔ "${r.item.label ?? r.item.name}"`, h("div", { className: "muted small" }, `by ${r.by}`))
      : h("span", { className: "warn" }, r.ambiguous.length ? `ambiguous: ${r.ambiguous.join(", ")}` : "no token",
        partyOpts.createMissing ? h("div", { className: "small" },
          av?.status === "ok" ? h("span", { className: "ok" }, `image ${av.img!.width}×${av.img!.height}`)
            : av?.status === "error" ? h("span", {}, h("span", { className: "bad" }, av.message ?? ""), " ",
              h("button", { className: "secondary", onclick: () => usePlaceholder(m.ddbId) }, "Placeholder"), " ",
              h("button", { className: "secondary", onclick: () => pickAvatar(m.ddbId, m.name) }, "Library…"))
              : av?.status === "pending" ? "checking avatar…" : h("span", {},
                h("button", { className: "secondary", onclick: () => checkAvatar(m) }, "D&D Beyond avatar"), " ",
                h("button", { className: "secondary", onclick: () => usePlaceholder(m.ddbId) }, "Placeholder"), " ",
                h("button", { className: "secondary", onclick: () => pickAvatar(m.ddbId, m.name) }, "Library…"))) : null);
    return h("tr", {},
      h("td", {}, m.name, h("div", { className: "muted small" }, `${m.classes} · ${m.species}`)),
      h("td", { className: "num" }, `${m.hp.current}/${m.hp.max}`),
      h("td", { className: "num" }, String(m.ac)),
      h("td", { className: "num" }, `${m.initiative.modifier >= 0 ? "+" : ""}${m.initiative.modifier}${m.initiative.advantage ? " adv" : ""}`),
      h("td", {}, tokenCell));
  });

  const canSync = pv.isGM && !pv.errors.length && !pv.forgeErrors.length && (pv.system.kind === "default" || partyOpts.acceptCustomSystem) &&
    pv.rows.some((r) => r.item || (partyOpts.createMissing && avatars[r.member.ddbId]?.status === "ok"));
  return [
    h("div", { className: "panel" },
      h("h1", {}, `Party: ${p.campaign.name}`),
      h("div", { className: "muted small" }, `D&D Beyond data from ${new Date(p.fetchedAt).toLocaleString()} · ${p.members.length} characters`)),
    h("div", { className: "panel" }, h("h2", {}, "Checks"), h("ul", { className: "checks" }, ...checks)),
    h("div", { className: "panel" }, h("h2", {}, "Characters → tokens"),
      h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, "Character"), h("th", {}, "HP"), h("th", {}, "AC"), h("th", {}, "Init"), h("th", {}, "Token"))), h("tbody", {}, ...rows)),
      h("div", { className: "small muted", style: "margin-top:6px" }, "Matches tokens on the Character layer by name (full or first name). Only Forge stat data is written: position, image, owner and initiative are untouched.")),
    h("div", { className: "panel" }, h("h2", {}, "Token images"),
      h("div", { className: "small muted" }, "Replace the pictures of matched party tokens with each character's D&D Beyond avatar (position, size, stats unchanged)."),
      h("div", { className: "row", style: "margin-top:6px" },
        h("button", { className: "secondary", onclick: useDdbAvatars, disabled: busy || !pv.isGM || !pv.rows.some((r) => r.item) }, "Use D&D Beyond avatars"),
        imageSwap && Object.keys(imageSwap.previous).length ? h("button", { className: "secondary", onclick: undoAvatars, disabled: busy }, "Undo") : null),
      imageSwap ? h("ul", { className: "plain small" },
        ...imageSwap.changed.map((x) => h("li", { className: "ok" }, `image set: ${x}`)),
        ...imageSwap.skipped.map((x) => h("li", { className: "warn" }, x)),
        imageSwap.error ? h("li", { className: "bad" }, imageSwap.error) : null) : null),
    h("div", { className: "panel" }, h("h2", {}, "Notes from the conversion"),
      h("ul", { className: "plain small" }, ...p.members.flatMap((m) => m.flags.map((f) => h("li", {}, `${m.name}: ${f}`))))),
    h("div", { className: "panel" }, h("h2", {}, "Options"),
      h("label", {}, h("input", { type: "radio", name: "hp", checked: partyOpts.hp === "ddb", onchange: () => { partyOpts.hp = "ddb"; } }), "Set current HP from D&D Beyond"),
      h("label", {}, h("input", { type: "radio", name: "hp", checked: partyOpts.hp === "keep", onchange: () => { partyOpts.hp = "keep"; } }), "Keep current HP already on the token (mid-session)"),
      h("div", { className: "small muted", style: "margin-top:6px" }, "Initiative:"),
      ...([["unset", "Roll for party members without initiative (missing or 0)"], ["all", "Re-roll initiative for every party member"], ["keep", "Leave party initiative alone (players roll)"]] as const)
        .map(([v, label]) => h("label", {}, h("input", { type: "radio", name: "pinit", checked: partyOpts.initiative === v,
          onchange: () => { partyOpts.initiative = v; store.set("butler.partyInitiative", v); } }), label)),
      unmatched.length ? h("label", {}, h("input", { type: "checkbox", checked: partyOpts.createMissing, onchange: (e: Event) => { partyOpts.createMissing = (e.target as HTMLInputElement).checked; render(); } }),
        `Create tokens for the ${unmatched.length} character(s) without one`) : null,
      pv.system.kind === "custom" ? h("label", {}, h("input", { type: "checkbox", checked: partyOpts.acceptCustomSystem, onchange: (e: Event) => { partyOpts.acceptCustomSystem = (e.target as HTMLInputElement).checked; render(); } }),
        "I confirm my custom Forge system uses the default attribute IDs") : null),
    h("div", { className: "panel" },
      h("button", { onclick: doPartySync, disabled: busy || !canSync }, (() => {
        const upd = pv.rows.filter((r) => r.item).length;
        const add = partyOpts.createMissing ? pv.rows.filter((r) => !r.item && avatars[r.member.ddbId]?.status === "ok").length : 0;
        return `Sync party: ${upd} update${upd === 1 ? "" : "s"}${add ? `, ${add} new token${add === 1 ? "" : "s"}` : ""}`;
      })()),
      !canSync ? h("div", { className: "small muted", style: "margin-top:6px" }, "Nothing to sync yet: add the party's tokens to the scene (named like the characters), or enable token creation.") : null),
  ];
}

function renderPartyReport(r: PartySyncReport) {
  return h("div", { className: "panel" },
    h("h2", {}, r.ok ? "Party sync complete" : "Party sync failed"),
    h("ul", { className: "checks steps" }, ...r.steps.map((s) => check(s.ok ? "ok" : "bad", `${s.step}: ${s.detail}`))),
    r.rolled.length ? h("div", { className: "small" }, h("strong", {}, "Initiative rolled:"),
      h("ul", { className: "plain" }, ...r.rolled.map((x) => h("li", {}, `${x.name}: ${describeInitiative(x.roll)}`)))) : null,
    h("ul", { className: "plain small" }, ...r.updated.map((x) => h("li", { className: "ok" }, `updated ${x}`)), ...r.created.map((x) => h("li", { className: "ok" }, `created ${x}`)), ...r.skipped.map((x) => h("li", { className: "warn" }, `skipped ${x}`))));
}

function render() {
  const nodes: Child[] = [renderLoader()];
  if (partyReport) nodes.push(renderPartyReport(partyReport));
  if (party && partyPreview) nodes.push(...renderParty(party, partyPreview));
  if (errorText) nodes.push(h("div", { className: "panel bad" }, errorText, " ", h("button", { className: "secondary", onclick: () => { errorText = ""; render(); } }, "Dismiss")));
  if (lastReport) nodes.push(renderReport(lastReport));
  if (pkg && preview) nodes.push(...renderPreview(preview, pkg));
  app.replaceChildren(...nodes.filter((n): n is Node | string => !!n));
}

// ------------------------------------------------------------------ boot

if (OBR.isAvailable) {
  OBR.onReady(async () => {
    render();
    const NO_SCENE = "Open a scene first (this panel updates when one is ready).";
    if (!(await OBR.scene.isReady())) alertError(NO_SCENE);
    OBR.scene.onReadyChange((r) => {
      if (r) { if (errorText === NO_SCENE) errorText = ""; }
      else { pkg = null; preview = null; lastReport = null; party = null; partyPreview = null; partyReport = null; }
      render();
    });
  });
} else {
  app.append(h("div", { className: "panel" }, "This page is an Owlbear Rodeo extension. Add ", h("code", {}, new URL("manifest.json", location.href).toString()), " in Owlbear → Profile → Extensions → Add Custom Extension."));
}
