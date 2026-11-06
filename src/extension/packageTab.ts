/** "Prepared encounter" tab: load an AI/CLI-built encounter package (map, grid, placed creatures) and import it. */
import OBR from "@owlbear-rodeo/sdk";
import { SIZE_CELLS } from "../core/constants";
import { describeInitiative } from "../core/dice";
import {
  analyse, checkAssetUrl, executeImport, resolveRelativeUrl, rollbackImport,
  type ImportOptions, type ImportReport, type Preview, type ResolvedImage,
} from "../core/importer";
import type { EncounterPackage } from "../core/schema";
import { check, h, measure, mimeFromUrl, rerender, setBusy, showError, store, ui, type Child } from "./dom";
import { obrGateway } from "./obrGateway";

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
  pkg = json as EncounterPackage;
  pkgUrl = url;
  lastReport = null;
  assetState = {};
  preview = await analyse(json, obrGateway);
  options.applyGrid = preview.grid.differs;
  options.duplicatePolicy = "abort";
  options.acceptCustomSystem = false;
  rerender();
  if (preview.validation.ok) await resolveAssets();
}


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
    rerender();
  }));
  rerender();
}

async function pickFromLibrary(key: string) {
  const a = pkg!.assets[key]!;
  if (a.image.kind !== "library") return;
  const isMap = key === pkg!.map.asset;
  const picked = await OBR.assets.downloadImages(false, a.image.search, isMap ? "MAP" : "CHARACTER");
  const img = picked[0]?.image;
  if (!img) return;
  assetState[key] = { status: "ok", resolved: { url: img.url, width: img.width, height: img.height, mime: img.mime }, message: "from Owlbear library" };
  rerender();
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
    rerender();
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
    rerender();
  }
}


// ------------------------------------------------------------------ rendering

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
    try { setBusy(true); await fn(); } catch (e) { showError(e); } finally { setBusy(false); }
  };
  file.addEventListener("change", run(async () => {
    const f = file.files?.[0];
    if (f) await setPackage(JSON.parse(await f.text()));
  }));
  return h("div", { className: "panel" },
    h("h2", {}, "Load encounter package"),
    h("div", { className: "row" }, urlInput,
      h("button", { onclick: run(() => loadFromUrl(urlInput.value.trim())), disabled: ui.busy }, "Load URL"),
      h("button", { className: "secondary", onclick: run(() => loadFromUrl("encounters/wolves-test/encounter.json")), disabled: ui.busy }, "Bundled wolves test")),
    h("div", { className: "row", style: "margin-top:6px" }, file),
    h("div", { style: "margin-top:6px" }, paste),
    h("div", { className: "row", style: "margin-top:6px" },
      h("button", { className: "secondary", onclick: run(async () => setPackage(JSON.parse(paste.value))), disabled: ui.busy }, "Load pasted JSON")),
  );
}


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
        h("input", { type: "radio", name: "dup", checked: options.duplicatePolicy === v, onchange: () => { options.duplicatePolicy = v; rerender(); } }),
        v === "abort" ? "Don't import" : v === "replace" ? "Replace the earlier copy (only items created by that import)" : "Add another copy"))) : null,
    p.system.kind === "custom" ? h("label", {}, h("input", { type: "checkbox", checked: options.acceptCustomSystem, onchange: (e: Event) => { options.acceptCustomSystem = (e.target as HTMLInputElement).checked; rerender(); } }),
      "I confirm my custom Forge system uses the same attribute IDs") : null,
    Object.values(assetState).some((s) => s.local) ? h("label", {}, h("input", { type: "checkbox", checked: options.allowLocalAssets, onchange: (e: Event) => { options.allowLocalAssets = (e.target as HTMLInputElement).checked; rerender(); } }),
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
      h("button", { onclick: doImport, disabled: ui.busy || blockers.length > 0 }, `Import ${pk.creatures.length} creatures + map`),
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
      h("button", { className: "secondary", onclick: undo, disabled: ui.busy }, r.ok ? `Undo this import (${r.createdItemIds.length} items)` : `Remove the ${r.createdItemIds.length} items this failed import created`)) : null,
    !r.ok && !r.createdItemIds.length ? h("div", { className: "small ok" }, "Nothing was added to the scene.") : null,
  );
}


export function resetPackageTab() { pkg = null; preview = null; lastReport = null; assetState = {}; }

export function renderPackageTab(): Child[] {
  const nodes: Child[] = [
    h("p", { className: "small muted" }, "For encounters prepared for you (map, grid and creature placements in one file). To just drop creatures into the current scene, use the sections above."),
    renderLoader(),
  ];
  if (lastReport) nodes.push(renderReport(lastReport));
  if (pkg && preview) nodes.push(...renderPreview(preview, pkg));
  return nodes;
}
