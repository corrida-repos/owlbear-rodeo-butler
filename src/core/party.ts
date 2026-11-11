/**
 * Party sync: write D&D Beyond-derived stat blocks onto the party's existing Owlbear tokens.
 * Never moves, replaces or deletes tokens; only writes Butler's unit keys (and an optional new token for
 * characters that have none, if asked). A token's live state (conditions, initiative…) is kept.
 */
import { BUTLER_ITEM_KEY, SIZE_CELLS } from "./constants";
import { convertDdbCharacter, type PartyMember } from "./ddb";
import { validateSheet, type UnitState } from "./sheet";
import { readUnit, unitMetadata, unitState } from "./unit";
import { checkAssetUrl, type ImageItemSpec, type ResolvedImage, type SceneGateway, type InitiativeSetup, type SceneItemLite, type StepResult } from "./importer";
import { tokenImageGrid } from "./layout";
import { cryptoRng, resolveRollMode, rollInitiative, type Rng } from "./dice";
import type { InitiativeRoll } from "./schema";

export const PARTY_SCHEMA = "owlbear-butler/party@2";

export interface PartyPackage {
  schema: typeof PARTY_SCHEMA;
  id: string;
  campaign: { id?: number; name: string };
  fetchedAt: string;
  builtAt: string;
  members: PartyMember[];
}

export function makePartyPackage(id: string, campaign: PartyPackage["campaign"], fetchedAt: string, members: PartyMember[], now = new Date()): PartyPackage {
  return { schema: PARTY_SCHEMA, id, campaign, fetchedAt, builtAt: now.toISOString(), members };
}

export const DDB_EXPORT_SCHEMA = "owlbear-butler/ddb-export@1";

/** Converts the raw D&D Beyond export (from the bookmarklet/console snippet) into a party package, in-browser or in Node. */
export function partyFromDdbExport(exp: any, now = new Date()): PartyPackage {
  if (exp?.schema !== DDB_EXPORT_SCHEMA || !Array.isArray(exp.characters)) throw new Error("Not a D&D Beyond party export.");
  const slug = String(exp.campaign?.name ?? "party").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "party";
  const members = exp.characters.map((c: any) => convertDdbCharacter(c, { partyInventory: exp.partyInventory }));
  return makePartyPackage(slug, exp.campaign ?? { name: "Party" }, exp.fetchedAt ?? now.toISOString(), members, now);
}

export function validateParty(input: any): string[] {
  const errors: string[] = [];
  if (input?.schema !== PARTY_SCHEMA) errors.push(`schema: expected "${PARTY_SCHEMA}"`);
  if (!Array.isArray(input?.members) || !input.members.length) errors.push("members: none");
  for (const [i, m] of (input?.members ?? []).entries()) {
    if (typeof m?.name !== "string") errors.push(`members[${i}].name missing`);
    if (typeof m?.hp?.max !== "number") errors.push(`members[${i}].hp.max missing`);
    if (typeof m?.sheet !== "object") errors.push(`members[${i}].sheet missing (party file from an older version: sync again from D&D Beyond)`);
    else for (const e of validateSheet(m.sheet)) errors.push(`members[${i}].sheet: ${e}`);
  }
  return errors;
}

// ------------------------------------------------------------------ matching

export const normName = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

export interface PartyRecord { role: "party"; ddbId: number; partyId: string; syncedAt: string; initiative?: InitiativeRoll; initiativeSetup?: InitiativeSetup }

export interface MatchRow {
  member: PartyMember;
  item: SceneItemLite | null;
  by: "D&D Beyond id" | "full name" | "first name" | null;
  ambiguous: string[];
}

const labels = (i: SceneItemLite) => [i.label, i.name].filter((x): x is string => !!x);

export function matchParty(members: PartyMember[], items: SceneItemLite[]): MatchRow[] {
  const tokens = items.filter((i) => i.layer === "CHARACTER" && i.type === "IMAGE");
  const used = new Set<string>();
  const rows: MatchRow[] = members.map((member) => {
    const byId = tokens.filter((t) => (t.metadata[BUTLER_ITEM_KEY] as PartyRecord | undefined)?.ddbId === member.ddbId);
    if (byId.length === 1) return { member, item: byId[0]!, by: "D&D Beyond id", ambiguous: [] };
    const full = normName(member.name);
    const byFull = tokens.filter((t) => labels(t).some((l) => normName(l) === full));
    if (byFull.length === 1) return { member, item: byFull[0]!, by: "full name", ambiguous: [] };
    if (byFull.length > 1) return { member, item: null, by: null, ambiguous: byFull.map((t) => t.label ?? t.name) };
    const first = full.split(" ")[0]!;
    const byFirst = first.length >= 3 ? tokens.filter((t) => labels(t).some((l) => normName(l).split(" ")[0] === first)) : [];
    if (byFirst.length === 1) return { member, item: byFirst[0]!, by: "first name", ambiguous: [] };
    return { member, item: null, by: null, ambiguous: byFirst.map((t) => t.label ?? t.name) };
  });
  // the same token can't be claimed twice
  for (const r of rows) {
    if (!r.item) continue;
    if (used.has(r.item.id)) { r.ambiguous = [r.item.label ?? r.item.name]; r.item = null; r.by = null; }
    else used.add(r.item.id);
  }
  return rows;
}

// ------------------------------------------------------------------ preview + sync

export interface PartyPreview {
  errors: string[];
  isGM: boolean;
  rows: MatchRow[];
}

export async function previewParty(pkg: unknown, gw: SceneGateway): Promise<PartyPreview> {
  const errors = validateParty(pkg);
  const [role, items] = await Promise.all([gw.getRole(), gw.getItems()]);
  const p = pkg as PartyPackage;
  const rows = errors.length ? [] : matchParty(p.members, items);
  return { errors, isGM: role === "GM", rows };
}

export interface PartySyncOptions {
  /** "ddb": set current HP from D&D Beyond; "keep": keep the token's current HP (if it has one). */
  hp: "ddb" | "keep";
  createMissing: boolean;
  /** Portrait images by ddbId (e.g. circular D&D Beyond avatars): used for created tokens, and for matched ones if `replaceImages`. */
  avatars?: Record<number, ResolvedImage>;
  /** Pictures to put on EXISTING matched tokens (e.g. circular D&D Beyond portraits); never placeholders. */
  replaceWith?: Record<number, ResolvedImage>;
  /**
   * "keep": never touch party initiative. "unset": roll only for members whose token has no initiative yet
   * (missing or 0, e.g. after "Reset round & initiative"). "all": re-roll everyone.
   */
  initiative?: "keep" | "unset" | "all";
  rng?: Rng;
  newId?: () => string;
  now?: () => Date;
}

export interface PartySyncReport {
  ok: boolean;
  steps: StepResult[];
  updated: string[];
  created: string[];
  skipped: string[];
  createdItemIds: string[];
  /** Matched tokens whose picture was replaced, with their previous picture (for undo). */
  previousImages: ImageSwapReport["previous"];
  /** Initiative rolled during this sync (dice, modifier, mode recorded like monster rolls). */
  rolled: { name: string; roll: InitiativeRoll }[];
  error?: string;
}

/**
 * A party member's state after a sync: HP from D&D Beyond or kept from the token (capped at the new max), everything
 * else (initiative, conditions, controller, portrait…) kept. Shared by the GM's party sync and a player's self-sync.
 */
export function syncedState(m: PartyMember, prev: UnitState | undefined, hp: PartySyncOptions["hp"]): UnitState {
  const keepHp = hp === "keep" && prev !== undefined;
  const state: UnitState = {
    ...(prev ?? unitState(m.sheet, m.hp, null)),
    hp: keepHp ? Math.min(prev.hp, m.hp.max) : m.hp.current,
    tempHp: keepHp ? prev.tempHp : m.hp.temp,
    party: true,
    inEncounter: prev?.inEncounter ?? true,
  };
  delete state.maxHpOverride; // the sheet's max HP is the character's real max
  delete state.used; // the action bar starts again from D&D Beyond's uses and spell slots
  return state;
}

/**
 * A player's own re-sync from D&D Beyond (F15), applied by the GM's client: only the sheet (and HP, by `hp`) of the
 * one unit changes. The character must be the unit's (same D&D Beyond id once synced, else the same name).
 */
export async function applySelfSync(gw: SceneGateway, unitId: string, m: PartyMember, hp: PartySyncOptions["hp"], now: () => Date = () => new Date()): Promise<string> {
  if (!m || typeof m.ddbId !== "number" || typeof m.name !== "string" || !m.sheet || !m.hp) throw new Error("That isn't a D&D Beyond character.");
  const item = (await gw.getItems()).find((i) => i.id === unitId);
  if (!item) throw new Error("That token is no longer in the scene.");
  const prevRecord = item.metadata[BUTLER_ITEM_KEY] as PartyRecord | undefined;
  if (prevRecord?.ddbId !== undefined) {
    if (prevRecord.ddbId !== m.ddbId) throw new Error(`${m.name} on D&D Beyond isn't the character on this token.`);
  } else {
    const token = normName(item.label || item.name);
    const full = normName(m.name), first = full.split(" ")[0]!;
    if (token !== full && token !== first && !token.startsWith(first)) throw new Error(`${m.name} on D&D Beyond doesn't match the token "${item.label || item.name}".`);
  }
  const state = syncedState(m, readUnit(item.metadata)?.state, hp);
  const record: PartyRecord = { ...(prevRecord ?? {}), role: "party", ddbId: m.ddbId, partyId: prevRecord?.partyId ?? "self-sync", syncedAt: now().toISOString(),
    initiativeSetup: { modifier: m.initiative.modifier, advantage: m.initiative.advantage, disadvantage: false } };
  await gw.updateMetadata([{ id: unitId, metadata: { ...unitMetadata(m.sheet, state), [BUTLER_ITEM_KEY]: record } }]);
  return m.name;
}

export async function syncParty(pkg: PartyPackage, opts: PartySyncOptions, gw: SceneGateway): Promise<PartySyncReport> {
  const newId = opts.newId ?? (() => globalThis.crypto.randomUUID());
  const now = opts.now ?? (() => new Date());
  const steps: StepResult[] = [];
  const report: PartySyncReport = { ok: false, steps, updated: [], created: [], skipped: [], createdItemIds: [], rolled: [], previousImages: {} };
  const rng = opts.rng ?? cryptoRng;
  /** Rolls 1d20 (2d20 keep high/low with adv/dis) + the character's initiative modifier and records it. */
  const roll = (m: PartyMember, record: PartyRecord): InitiativeRoll => {
    const r = rollInitiative(m.initiative.modifier, resolveRollMode(m.initiative.advantage, false), rng, "importer", now);
    record.initiative = r;
    report.rolled.push({ name: m.name, roll: r });
    return r;
  };
  try {
    const errors = validateParty(pkg);
    if (errors.length) throw new Error(`Party file invalid: ${errors.join("; ")}`);
    if ((await gw.getRole()) !== "GM") throw new Error("Only the GM can sync the party.");

    const items = await gw.getItems();
    const rows = matchParty(pkg.members, items);
    const updates: { id: string; metadata: Record<string, unknown> }[] = [];
    const creates: ImageItemSpec[] = [];
    const grid = await gw.getGrid();
    const maps = items.filter((i) => i.layer === "MAP");
    const bounds = maps.length ? await gw.getItemBounds(maps.map((i) => i.id)) : { min: { x: 0, y: 0 }, max: { x: 0, y: 0 } };

    for (const r of rows) {
      const m = r.member;
      const record: PartyRecord = { role: "party", ddbId: m.ddbId, partyId: pkg.id, syncedAt: now().toISOString(),
        initiativeSetup: { modifier: m.initiative.modifier, advantage: m.initiative.advantage, disadvantage: false } };
      if (r.item) {
        const state = syncedState(m, readUnit(r.item.metadata)?.state, opts.hp);
        const unset = state.initiative === null || state.initiative === 0;
        if (opts.initiative === "all" || (opts.initiative === "unset" && unset)) {
          const rolled = roll(m, record);
          state.initiative = rolled.total;
          state.initiativeRoll = rolled;
        }
        const meta = { ...unitMetadata(m.sheet, state), [BUTLER_ITEM_KEY]: record };
        updates.push({ id: r.item.id, metadata: meta });
        report.updated.push(`${m.name} → token "${r.item.label ?? r.item.name}" (matched by ${r.by})`);
      } else if (opts.createMissing) {
        const img = opts.avatars?.[m.ddbId];
        if (!img) { report.skipped.push(`${m.name}: no token and no usable avatar image`); continue; }
        const problem = checkAssetUrl(img.url);
        if (problem) { report.skipped.push(`${m.name}: avatar ${problem}`); continue; }
        const size = SIZE_CELLS[m.size] ?? 1;
        const idx = creates.length;
        const rolled = opts.initiative === "all" || opts.initiative === "unset" ? roll(m, record) : null;
        const meta = { ...unitMetadata(m.sheet, unitState(m.sheet, m.hp, rolled, { party: true })), [BUTLER_ITEM_KEY]: record };
        creates.push({
          id: newId(), name: m.name, layer: "CHARACTER", image: img,
          grid: tokenImageGrid(img.width, img.height, size),
          position: { x: bounds.min.x + (idx + 0.5) * grid.dpi * Math.max(1, size), y: bounds.min.y + 0.5 * grid.dpi * Math.max(1, size) },
          visible: true, locked: false, label: m.name, metadata: meta,
        });
        report.created.push(`${m.name} (new token at the map's top-left corner — drag into place)`);
      } else {
        report.skipped.push(`${m.name}: no matching token${r.ambiguous.length ? ` (ambiguous: ${r.ambiguous.join(", ")})` : ""}`);
      }
    }
    steps.push({ step: "Plan", ok: true, detail: `${updates.length} to update, ${creates.length} to create, ${report.skipped.length} skipped` +
      `${report.rolled.length ? `, initiative rolled for ${report.rolled.length}` : opts.initiative && opts.initiative !== "keep" ? ", no initiative needed rolling" : ""}` });

    if (updates.length) {
      await gw.updateMetadata(updates);
      steps.push({ step: "Update tokens", ok: true, detail: `stat blocks written to ${updates.length} existing token(s); position, image, ownership and conditions untouched` });
    }
    if (opts.replaceWith) {
      const imgUpdates: { id: string; image: ResolvedImage; grid: { dpi: number; offset: { x: number; y: number } } }[] = [];
      for (const r of rows) {
        const img = opts.replaceWith[r.member.ddbId];
        if (!r.item || !img || !r.item.image || r.item.image.url === img.url) continue;
        const cells = SIZE_CELLS[r.member.size] ?? 1;
        report.previousImages[r.item.id] = { image: { ...r.item.image }, grid: tokenImageGrid(r.item.image.width, r.item.image.height, cells) };
        imgUpdates.push({ id: r.item.id, image: img, grid: tokenImageGrid(img.width, img.height, cells) });
      }
      if (imgUpdates.length) {
        await gw.updateImages(imgUpdates);
        steps.push({ step: "Portraits", ok: true, detail: `${imgUpdates.length} token picture(s) set to the D&D Beyond portrait` });
      }
    }
    if (creates.length) {
      await gw.addImages(creates);
      report.createdItemIds.push(...creates.map((c) => c.id));
      steps.push({ step: "Create tokens", ok: true, detail: `${creates.length} new party token(s)` });
    }
    const after = new Map((await gw.getItems()).map((i) => [i.id, i]));
    const bad = updates.filter((u) => (after.get(u.id)?.metadata[BUTLER_ITEM_KEY] as PartyRecord | undefined)?.syncedAt !== (u.metadata[BUTLER_ITEM_KEY] as PartyRecord).syncedAt);
    if (bad.length) throw new Error(`${bad.length} token(s) did not receive the update`);
    steps.push({ step: "Verify", ok: true, detail: "all changes present in the scene" });
    report.ok = true;
    return report;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    steps.push({ step: "FAILED", ok: false, detail: msg });
    report.error = msg;
    return report;
  }
}

// ------------------------------------------------------------------ token images

export interface ImageSwapReport {
  ok: boolean;
  changed: string[];
  skipped: string[];
  /** For undo: token id → the picture it had before. */
  previous: Record<string, { image: ResolvedImage; grid: { dpi: number; offset: { x: number; y: number } } }>;
  error?: string;
}

/**
 * Sets the picture of each matched party token (e.g. to the D&D Beyond avatar). Keeps position, scale,
 * label, stats and the character's footprint (image grid is recomputed from the new picture's size).
 */
export async function setPartyTokenImages(pkg: PartyPackage, images: Record<number, ResolvedImage>, gw: SceneGateway): Promise<ImageSwapReport> {
  const report: ImageSwapReport = { ok: false, changed: [], skipped: [], previous: {} };
  try {
    if ((await gw.getRole()) !== "GM") throw new Error("Only the GM can change party tokens.");
    const rows = matchParty(pkg.members, await gw.getItems());
    const updates: { id: string; image: ResolvedImage; grid: { dpi: number; offset: { x: number; y: number } } }[] = [];
    for (const r of rows) {
      const img = images[r.member.ddbId];
      if (!r.item) { report.skipped.push(`${r.member.name}: no matching token`); continue; }
      if (!img) { report.skipped.push(`${r.member.name}: no image`); continue; }
      if (!r.item.image) { report.skipped.push(`${r.member.name}: token isn't an image`); continue; }
      if (r.item.image.url === img.url) { report.skipped.push(`${r.member.name}: already using that image`); continue; }
      const sizeCells = SIZE_CELLS[r.member.size] ?? 1;
      const prevGrid = tokenImageGrid(r.item.image.width, r.item.image.height, sizeCells);
      report.previous[r.item.id] = { image: { ...r.item.image }, grid: prevGrid };
      updates.push({ id: r.item.id, image: img, grid: tokenImageGrid(img.width, img.height, sizeCells) });
      report.changed.push(`${r.member.name} → token "${r.item.label ?? r.item.name}"`);
    }
    if (updates.length) await gw.updateImages(updates);
    report.ok = true;
    return report;
  } catch (e) {
    report.error = e instanceof Error ? e.message : String(e);
    return report;
  }
}

export async function restoreTokenImages(previous: ImageSwapReport["previous"], gw: SceneGateway): Promise<number> {
  const present = new Set((await gw.getItems()).map((i) => i.id));
  const updates = Object.entries(previous).filter(([id]) => present.has(id)).map(([id, p]) => ({ id, image: p.image, grid: p.grid }));
  if (updates.length) await gw.updateImages(updates);
  return updates.length;
}
