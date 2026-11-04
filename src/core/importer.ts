import { BUTLER_ITEM_KEY, BUTLER_SCENE_KEY, FORGE_KEYS, SIZE_CELLS } from "./constants";
import { cryptoRng, describeInitiative, rollForStatblock, type Rng } from "./dice";
import { buildForgeMetadata, detectForgeSystem, validateForgeMetadata, type ForgeSystemStatus } from "./forge";
import { checkPlacements, chooseMapOrigin, mapGeometry, tokenCenter, tokenImageGrid, type Bounds, type Vec2 } from "./layout";
import { validatePackage, type EncounterPackage, type InitiativeRoll } from "./schema";

// ------------------------------------------------------------------ gateway (implemented by OBR adapter or a fake)

export interface SceneItemLite {
  id: string;
  type: string;
  layer: string;
  name: string;
  /** Visible text label (Owlbear image items' text), if any. */
  label?: string;
  /** Current picture (image items only). */
  image?: { url: string; width: number; height: number; mime: string };
  metadata: Record<string, unknown>;
}

export interface ImageItemSpec {
  id: string;
  name: string;
  layer: "MAP" | "CHARACTER";
  image: { url: string; mime: string; width: number; height: number };
  grid: { dpi: number; offset: Vec2 };
  position: Vec2;
  visible: boolean;
  locked: boolean;
  label?: string;
  description?: string;
  metadata: Record<string, unknown>;
}

export interface SceneGateway {
  getRole(): Promise<"GM" | "PLAYER">;
  getItems(): Promise<SceneItemLite[]>;
  getItemBounds(ids: string[]): Promise<Bounds>;
  addImages(specs: ImageItemSpec[]): Promise<void>;
  deleteItems(ids: string[]): Promise<void>;
  /** Replaces image items' picture (and image grid, so the on-map size stays the same). */
  updateImages(updates: { id: string; image: ResolvedImage; grid: { dpi: number; offset: Vec2 } }[]): Promise<void>;
  /** Shallow-merges keys into each item's metadata (other keys untouched). */
  updateMetadata(updates: { id: string; metadata: Record<string, unknown> }[]): Promise<void>;
  getSceneMetadata(): Promise<Record<string, unknown>>;
  setSceneMetadata(update: Record<string, unknown>): Promise<void>;
  getRoomMetadata(): Promise<Record<string, unknown>>;
  getGrid(): Promise<{ dpi: number; scale: string; type: string }>;
  setGridScale(scale: string): Promise<void>;
  setGridType(type: "SQUARE"): Promise<void>;
}

export interface ResolvedImage { url: string; width: number; height: number; mime: string }

/** Per-item record this importer stores on every item it creates. */
export interface ButlerItemRecord {
  packageId: string;
  revision: string;
  importId: string;
  role: "map" | "creature";
  creatureKey?: string;
  initiative?: InitiativeRoll;
  hp?: { max: number; method: string; formula?: string; dice?: number[] };
  source?: string;
}

export interface SceneImportRecord {
  packageId: string;
  revision: string;
  importId: string;
  title: string;
  importedAt: string;
  itemIds: string[];
}

// ------------------------------------------------------------------ asset URL policy

/** Images must load for every player: public https only, no blob/data/file/localhost/LAN. */
export function checkAssetUrl(url: string): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return `not an absolute URL: ${url}`; }
  if (u.protocol !== "https:") return `${u.protocol} URLs only work on this computer — use a public https URL`;
  const h = u.hostname;
  if (h === "localhost" || h.endsWith(".local") || /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h))
    return `${h} is not reachable by players`;
  return null;
}

export function resolveRelativeUrl(url: string, base?: string): string {
  if (/^[a-z]+:/i.test(url)) return url;
  if (!base) throw new Error(`Relative asset URL "${url}" needs the package to be loaded from a URL`);
  return new URL(url, base).toString();
}

// ------------------------------------------------------------------ preview

export interface CreatureRow {
  key: string;
  name: string;
  statblock: string;
  source: string;
  provenance: string;
  size: string;
  cell: Vec2;
  hp: string;
  ac: number | string;
  initiative: string;
  initiativeTotal: number | null;
  flags: string[];
}

export interface Preview {
  validation: { ok: boolean; errors: string[]; warnings: string[] };
  isGM: boolean;
  system: ForgeSystemStatus;
  systemWarning: string | null;
  duplicates: { importIds: string[]; revisions: string[]; itemIds: string[] };
  grid: { current: { dpi: number; scale: string; type: string }; wanted: { scale: string; type: string }; differs: boolean };
  existingMapCount: number;
  existingForgeUnits: number;
  placementWarnings: string[];
  creatures: CreatureRow[];
  forgeErrors: string[];
}

function provenanceLabel(p: string): string {
  return p === "official" ? "official" : p === "user-provided" ? "user-provided" : p === "adapted" ? "adapted (not pure official)" : "HOMEBREW (not official)";
}

export async function analyse(pkgInput: unknown, gw: SceneGateway): Promise<Preview> {
  const validation = validatePackage(pkgInput);
  const pkg = pkgInput as EncounterPackage;
  const [role, items, room, grid] = await Promise.all([gw.getRole(), gw.getItems(), gw.getRoomMetadata(), gw.getGrid()]);
  const system = detectForgeSystem(room);
  const systemWarning =
    system.kind === "custom"
      ? `Forge has a custom system loaded ("${system.name}", snapshot ${system.snapshotId}). This package targets the built-in "${pkg.forgeDictionary}" attribute IDs; values may land in the wrong fields. Load the default system (Forge → System → Load Default System) or confirm the BIDs match.`
      : null;

  const prev = validation.ok ? items.filter((i) => (i.metadata[BUTLER_ITEM_KEY] as ButlerItemRecord | undefined)?.packageId === pkg.id) : [];
  const duplicates = {
    importIds: [...new Set(prev.map((i) => (i.metadata[BUTLER_ITEM_KEY] as ButlerItemRecord).importId))],
    revisions: [...new Set(prev.map((i) => (i.metadata[BUTLER_ITEM_KEY] as ButlerItemRecord).revision))],
    itemIds: prev.map((i) => i.id),
  };

  const creatures: CreatureRow[] = [];
  const forgeErrors: string[] = [];
  let placementWarnings: string[] = [];
  if (validation.ok) {
    placementWarnings = checkPlacements(pkg);
    let n = 0;
    for (const c of pkg.creatures) {
      const sb = pkg.statblocks[c.statblock]!;
      const ac = sb.forge.Z007;
      creatures.push({
        key: c.key,
        name: c.name,
        statblock: sb.name,
        source: [sb.source.bookTitle ?? sb.source.book, sb.source.page ? `p. ${sb.source.page}` : ""].filter(Boolean).join(", ") || "—",
        provenance: provenanceLabel(sb.source.provenance),
        size: sb.size,
        cell: c.cell,
        hp: `${c.hp.current}/${c.hp.max} (${c.hp.method}${c.hp.dice ? ` ${c.hp.formula}: [${c.hp.dice.join(",")}]` : ""})`,
        ac: typeof ac === "number" ? ac : "?",
        initiative: c.initiative ? `${describeInitiative(c.initiative)}` : `will roll at import (${sb.initiative.modifier >= 0 ? "+" : ""}${sb.initiative.modifier})`,
        initiativeTotal: c.initiative?.total ?? null,
        flags: sb.flags,
      });
      const fake = c.initiative ?? { total: 0 } as InitiativeRoll;
      const errs = validateForgeMetadata(buildForgeMetadata(c, sb, fake, () => `x${n++}`));
      for (const e of errs) forgeErrors.push(`${c.name}: ${e}`);
    }
  }

  return {
    validation,
    isGM: role === "GM",
    system,
    systemWarning,
    duplicates,
    grid: {
      current: grid,
      wanted: validation.ok ? { scale: pkg.map.grid.scale, type: pkg.map.grid.type } : { scale: "", type: "" },
      differs: validation.ok && (normScale(grid.scale) !== normScale(pkg.map.grid.scale) || grid.type !== pkg.map.grid.type),
    },
    existingMapCount: items.filter((i) => i.layer === "MAP").length,
    existingForgeUnits: items.filter((i) => i.metadata[FORGE_KEYS.ON_LIST] === true).length,
    placementWarnings,
    creatures,
    forgeErrors: [...new Set(forgeErrors)],
  };
}

const normScale = (s: string) => s.replace(/\s+/g, "").toLowerCase();

// ------------------------------------------------------------------ execution

export interface ImportOptions {
  applyGrid: boolean;
  mapPlacement: "auto" | "origin";
  duplicatePolicy: "abort" | "replace" | "add";
  /** Required if the package's Forge system check said "custom". */
  acceptCustomSystem?: boolean;
  allowLocalAssets?: boolean;
  resolvedAssets: Record<string, ResolvedImage>;
  rng?: Rng;
  newId?: () => string;
  now?: () => Date;
}

export interface StepResult { step: string; ok: boolean; detail: string }

export interface ImportReport {
  ok: boolean;
  importId: string;
  steps: StepResult[];
  createdItemIds: string[];
  /** Creatures that had no pre-rolled initiative and were rolled by the importer. */
  rolledAtImport: { name: string; roll: InitiativeRoll }[];
  error?: string;
}

export class ImportAborted extends Error {}

export async function executeImport(pkg: EncounterPackage, opts: ImportOptions, gw: SceneGateway): Promise<ImportReport> {
  const newId = opts.newId ?? (() => globalThis.crypto.randomUUID());
  const rng = opts.rng ?? cryptoRng;
  const now = opts.now ?? (() => new Date());
  const importId = newId();
  const steps: StepResult[] = [];
  const created: string[] = [];
  const rolledAtImport: ImportReport["rolledAtImport"] = [];
  const report = (ok: boolean, error?: string): ImportReport => ({ ok, importId, steps, createdItemIds: [...created], rolledAtImport, error });

  try {
    // ---------------- preflight: nothing in the scene is touched until all of this passes
    const v = validatePackage(pkg);
    if (!v.ok) throw new ImportAborted(`Package invalid:\n${v.errors.join("\n")}`);
    if ((await gw.getRole()) !== "GM") throw new ImportAborted("Only the GM can import encounters.");
    const sys = detectForgeSystem(await gw.getRoomMetadata());
    if (sys.kind === "custom" && !opts.acceptCustomSystem)
      throw new ImportAborted(`Custom Forge system "${sys.name}" loaded; confirm BID compatibility before importing.`);

    for (const key of new Set([pkg.map.asset, ...pkg.creatures.map((c) => c.token)])) {
      const r = opts.resolvedAssets[key];
      if (!r) throw new ImportAborted(`Asset "${key}" has not been resolved (pick it from the Owlbear library or fix its URL).`);
      const problem = checkAssetUrl(r.url);
      if (problem && !opts.allowLocalAssets) throw new ImportAborted(`Asset "${key}": ${problem}`);
    }

    const items = await gw.getItems();
    const prevIds = items.filter((i) => (i.metadata[BUTLER_ITEM_KEY] as ButlerItemRecord | undefined)?.packageId === pkg.id).map((i) => i.id);
    if (prevIds.length && opts.duplicatePolicy === "abort")
      throw new ImportAborted(`"${pkg.title}" is already in this scene (${prevIds.length} items). Choose "replace" or "add another copy" to continue.`);

    // Build all items up-front so metadata errors abort before any scene change.
    const grid = await gw.getGrid();
    const sceneDpi = grid.dpi;
    const mapItems = items.filter((i) => i.layer === "MAP" && !prevIds.includes(i.id));
    const bounds = mapItems.length ? await gw.getItemBounds(mapItems.map((i) => i.id)) : null;
    const origin = chooseMapOrigin(bounds, sceneDpi, opts.mapPlacement);
    const mapImg = opts.resolvedAssets[pkg.map.asset]!;
    const geo = mapGeometry(pkg.map, mapImg, origin);
    const baseRecord = { packageId: pkg.id, revision: pkg.revision, importId };

    const mapSpec: ImageItemSpec = {
      id: newId(),
      name: pkg.map.name,
      layer: "MAP",
      image: mapImg,
      grid: { dpi: geo.dpi, offset: geo.offset },
      position: geo.position,
      visible: true,
      locked: true,
      description: pkg.title,
      metadata: { [BUTLER_ITEM_KEY]: { ...baseRecord, role: "map" } satisfies ButlerItemRecord },
    };

    const tokenSpecs: ImageItemSpec[] = pkg.creatures.map((c) => {
      const sb = pkg.statblocks[c.statblock]!;
      const img = opts.resolvedAssets[c.token]!;
      let initiative = c.initiative;
      if (!initiative) {
        initiative = rollForStatblock(sb.initiative, rng, "importer");
        rolledAtImport.push({ name: c.name, roll: initiative });
      }
      const size = SIZE_CELLS[sb.size] ?? 1;
      const forge = buildForgeMetadata(c, sb, initiative, newId);
      const errs = validateForgeMetadata(forge);
      if (errs.length) throw new ImportAborted(`${c.name}: Forge metadata invalid:\n${errs.join("\n")}`);
      const record: ButlerItemRecord = {
        ...baseRecord,
        role: "creature",
        creatureKey: c.key,
        initiative,
        hp: { max: c.hp.max, method: c.hp.method, formula: c.hp.formula, dice: c.hp.dice },
        source: [sb.source.provenance, sb.source.book, sb.source.page].filter(Boolean).join(" "),
      };
      return {
        id: newId(),
        name: c.name,
        layer: "CHARACTER",
        image: img,
        grid: tokenImageGrid(img.width, img.height, size),
        position: tokenCenter(c.cell, size, origin, sceneDpi),
        visible: !c.hidden,
        locked: false,
        label: c.showLabel === false ? undefined : c.name,
        metadata: { ...forge, [BUTLER_ITEM_KEY]: record },
      };
    });
    const metaSize = Math.max(...tokenSpecs.map((t) => JSON.stringify(t.metadata).length));
    steps.push({ step: "Preflight", ok: true, detail: `package valid, Forge system "${sys.name}", ${tokenSpecs.length} tokens built (largest metadata ${(metaSize / 1024).toFixed(1)} KB)` });

    // ---------------- scene changes
    if (opts.applyGrid && (normScale(grid.scale) !== normScale(pkg.map.grid.scale) || grid.type !== pkg.map.grid.type)) {
      await gw.setGridType(pkg.map.grid.type);
      await gw.setGridScale(pkg.map.grid.scale);
      steps.push({ step: "Grid", ok: true, detail: `scene grid ${grid.type} ${grid.scale} → ${pkg.map.grid.type} ${pkg.map.grid.scale}` });
    } else {
      steps.push({ step: "Grid", ok: true, detail: `unchanged (${grid.type} ${grid.scale})` });
    }

    await gw.addImages([mapSpec]);
    created.push(mapSpec.id);
    steps.push({ step: "Map", ok: true, detail: `"${pkg.map.name}" at (${origin.x}, ${origin.y}), ${pkg.map.grid.cols}×${pkg.map.grid.rows} cells` });

    await gw.addImages(tokenSpecs);
    created.push(...tokenSpecs.map((t) => t.id));
    steps.push({ step: "Tokens", ok: true, detail: `${tokenSpecs.length} creatures added to the scene and Forge tracker` });

    // ---------------- verify
    const after = new Set((await gw.getItems()).map((i) => i.id));
    const missing = created.filter((id) => !after.has(id));
    if (missing.length) throw new Error(`${missing.length} created items are missing from the scene after import`);
    steps.push({ step: "Verify", ok: true, detail: `all ${created.length} items present` });

    // Replace: only remove the earlier copy once the new one is verified, so a failure never loses it.
    if (prevIds.length && opts.duplicatePolicy === "replace") {
      await gw.deleteItems(prevIds);
      steps.push({ step: "Remove previous import", ok: true, detail: `deleted ${prevIds.length} items from the earlier import of this package` });
    }

    // ---------------- record (scene metadata is size-limited: keep a short history)
    const sceneMeta = await gw.getSceneMetadata();
    const history = (Array.isArray(sceneMeta[BUTLER_SCENE_KEY]) ? (sceneMeta[BUTLER_SCENE_KEY] as SceneImportRecord[]) : [])
      .filter((r) => opts.duplicatePolicy !== "replace" || r.packageId !== pkg.id);
    history.push({ packageId: pkg.id, revision: pkg.revision, importId, title: pkg.title, importedAt: now().toISOString(), itemIds: created });
    await gw.setSceneMetadata({ [BUTLER_SCENE_KEY]: history.slice(-10) });
    steps.push({ step: "Record", ok: true, detail: `import ${importId.slice(0, 8)} recorded in scene metadata` });

    return report(true);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    steps.push({ step: e instanceof ImportAborted ? "Aborted (scene unchanged)" : "FAILED", ok: false, detail: msg });
    return report(false, msg);
  }
}

/** Deletes items created by a (possibly partial) import. */
export async function rollbackImport(createdItemIds: string[], gw: SceneGateway): Promise<number> {
  const present = new Set((await gw.getItems()).map((i) => i.id));
  const ids = createdItemIds.filter((id) => present.has(id));
  if (ids.length) await gw.deleteItems(ids);
  return ids.length;
}
