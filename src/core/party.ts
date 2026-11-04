/**
 * Party sync: write D&D Beyond-derived Forge stat blocks onto the party's existing Owlbear tokens.
 * Never moves, replaces or deletes tokens; only merges Forge keys (and an optional new token for
 * characters that have none, if asked).
 */
import { BUTLER_ITEM_KEY, FORGE_DEFAULT_DICTIONARY_ID, FORGE_KEYS, SIZE_CELLS } from "./constants";
import type { PartyMember } from "./ddb";
import { detectForgeSystem, forgeKey, validateForgeMetadata, type ForgeSystemStatus } from "./forge";
import { checkAssetUrl, type ImageItemSpec, type ResolvedImage, type SceneGateway, type SceneItemLite, type StepResult } from "./importer";
import { tokenImageGrid } from "./layout";
import { cryptoRng, resolveRollMode, rollInitiative, type Rng } from "./dice";
import type { InitiativeRoll, ListEntry } from "./schema";

export const PARTY_SCHEMA = "owlbear-butler/party@1";

export interface PartyPackage {
  schema: typeof PARTY_SCHEMA;
  id: string;
  campaign: { id?: number; name: string };
  fetchedAt: string;
  builtAt: string;
  forgeDictionary: string;
  members: PartyMember[];
}

export function makePartyPackage(id: string, campaign: PartyPackage["campaign"], fetchedAt: string, members: PartyMember[], now = new Date()): PartyPackage {
  return { schema: PARTY_SCHEMA, id, campaign, fetchedAt, builtAt: now.toISOString(), forgeDictionary: FORGE_DEFAULT_DICTIONARY_ID, members };
}

export function validateParty(input: any): string[] {
  const errors: string[] = [];
  if (input?.schema !== PARTY_SCHEMA) errors.push(`schema: expected "${PARTY_SCHEMA}"`);
  if (!Array.isArray(input?.members) || !input.members.length) errors.push("members: none");
  for (const [i, m] of (input?.members ?? []).entries()) {
    if (typeof m?.name !== "string") errors.push(`members[${i}].name missing`);
    if (typeof m?.hp?.max !== "number") errors.push(`members[${i}].hp.max missing`);
    if (typeof m?.forge !== "object") errors.push(`members[${i}].forge missing`);
  }
  return errors;
}

// ------------------------------------------------------------------ matching

export const normName = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

export interface PartyRecord { role: "party"; ddbId: number; partyId: string; syncedAt: string; initiative?: InitiativeRoll }

export interface MatchRow {
  member: PartyMember;
  item: SceneItemLite | null;
  by: "D&D Beyond id" | "full name" | "first name" | null;
  ambiguous: string[];
}

const labels = (i: SceneItemLite) => [i.label, i.name, i.metadata[FORGE_KEYS.UNIT_NAME] as string | undefined].filter((x): x is string => !!x);

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
  system: ForgeSystemStatus;
  rows: MatchRow[];
  forgeErrors: string[];
}

export function partyForgeMetadata(m: PartyMember, newId: () => string): Record<string, unknown> {
  const meta: Record<string, unknown> = {};
  for (const [bid, v] of Object.entries(m.forge)) {
    meta[forgeKey(bid)] = Array.isArray(v) ? (v as ListEntry[]).map((e) => ({ id: newId(), name: e.name, description: e.description })) : v;
  }
  meta[forgeKey("Z006")] = m.hp.max;
  meta[forgeKey("Z042")] = m.hp.temp;
  return meta;
}

export async function previewParty(pkg: unknown, gw: SceneGateway): Promise<PartyPreview> {
  const errors = validateParty(pkg);
  const [role, items, room] = await Promise.all([gw.getRole(), gw.getItems(), gw.getRoomMetadata()]);
  const p = pkg as PartyPackage;
  const rows = errors.length ? [] : matchParty(p.members, items);
  let n = 0;
  const forgeErrors = errors.length ? [] : p.members.flatMap((m) => validateForgeMetadata(partyForgeMetadata(m, () => `x${n++}`)).map((e) => `${m.name}: ${e}`));
  return { errors, isGM: role === "GM", system: detectForgeSystem(room), rows, forgeErrors };
}

export interface PartySyncOptions {
  /** "ddb": set current HP from D&D Beyond; "keep": keep the token's current HP (if it has one). */
  hp: "ddb" | "keep";
  createMissing: boolean;
  /** Avatar images (by ddbId) for tokens to create. */
  avatars?: Record<number, ResolvedImage>;
  acceptCustomSystem?: boolean;
  /**
   * "keep": never touch party initiative. "unset": roll only for members whose token has no initiative yet
   * (missing or 0, e.g. after Forge's "Reset Round & Initiative"). "all": re-roll everyone.
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
  /** Initiative rolled during this sync (dice, modifier, mode recorded like monster rolls). */
  rolled: { name: string; roll: InitiativeRoll }[];
  error?: string;
}

export async function syncParty(pkg: PartyPackage, opts: PartySyncOptions, gw: SceneGateway): Promise<PartySyncReport> {
  const newId = opts.newId ?? (() => globalThis.crypto.randomUUID());
  const now = opts.now ?? (() => new Date());
  const steps: StepResult[] = [];
  const report: PartySyncReport = { ok: false, steps, updated: [], created: [], skipped: [], createdItemIds: [], rolled: [] };
  const rng = opts.rng ?? cryptoRng;
  /** Rolls 1d20 (2d20 keep high/low with adv/dis) + the character's initiative modifier and records it. */
  const roll = (m: PartyMember, meta: Record<string, unknown>, record: PartyRecord) => {
    const r = rollInitiative(m.initiative.modifier, resolveRollMode(m.initiative.advantage, false), rng, "importer", now);
    meta[FORGE_KEYS.INITIATIVE] = r.total;
    record.initiative = r;
    report.rolled.push({ name: m.name, roll: r });
  };
  try {
    const errors = validateParty(pkg);
    if (errors.length) throw new Error(`Party file invalid: ${errors.join("; ")}`);
    if ((await gw.getRole()) !== "GM") throw new Error("Only the GM can sync the party.");
    const sys = detectForgeSystem(await gw.getRoomMetadata());
    if (sys.kind === "custom" && !opts.acceptCustomSystem) throw new Error(`Custom Forge system "${sys.name}" loaded; confirm BID compatibility first.`);

    const items = await gw.getItems();
    const rows = matchParty(pkg.members, items);
    const updates: { id: string; metadata: Record<string, unknown> }[] = [];
    const creates: ImageItemSpec[] = [];
    const grid = await gw.getGrid();
    const maps = items.filter((i) => i.layer === "MAP");
    const bounds = maps.length ? await gw.getItemBounds(maps.map((i) => i.id)) : { min: { x: 0, y: 0 }, max: { x: 0, y: 0 } };

    for (const r of rows) {
      const m = r.member;
      const meta = partyForgeMetadata(m, newId);
      const errs = validateForgeMetadata(meta);
      if (errs.length) throw new Error(`${m.name}: ${errs.join("; ")}`);
      const record: PartyRecord = { role: "party", ddbId: m.ddbId, partyId: pkg.id, syncedAt: now().toISOString() };
      if (r.item) {
        const existing = r.item.metadata;
        const hasHp = typeof existing[forgeKey("Z005")] === "number";
        meta[forgeKey("Z005")] = opts.hp === "keep" && hasHp ? Math.min(existing[forgeKey("Z005")] as number, m.hp.max) : m.hp.current;
        meta[FORGE_KEYS.UNIT_NAME] = (existing[FORGE_KEYS.UNIT_NAME] as string | undefined) ?? m.name;
        meta[FORGE_KEYS.FABRICATED] = true;
        meta[FORGE_KEYS.IN_PARTY] = true;
        meta[FORGE_KEYS.ON_LIST] = existing[FORGE_KEYS.ON_LIST] ?? true;
        const cur = existing[FORGE_KEYS.INITIATIVE];
        const unset = typeof cur !== "number" || cur === 0;
        if (opts.initiative === "all" || (opts.initiative === "unset" && unset)) roll(m, meta, record);
        meta[BUTLER_ITEM_KEY] = record;
        updates.push({ id: r.item.id, metadata: meta });
        report.updated.push(`${m.name} → token "${r.item.label ?? r.item.name}" (matched by ${r.by})`);
      } else if (opts.createMissing) {
        const img = opts.avatars?.[m.ddbId];
        if (!img) { report.skipped.push(`${m.name}: no token and no usable avatar image`); continue; }
        const problem = checkAssetUrl(img.url);
        if (problem) { report.skipped.push(`${m.name}: avatar ${problem}`); continue; }
        const size = SIZE_CELLS[m.size] ?? 1;
        const idx = creates.length;
        meta[forgeKey("Z005")] = m.hp.current;
        meta[FORGE_KEYS.UNIT_NAME] = m.name;
        meta[FORGE_KEYS.FABRICATED] = true;
        meta[FORGE_KEYS.IN_PARTY] = true;
        meta[FORGE_KEYS.ON_LIST] = true;
        if (opts.initiative === "all" || opts.initiative === "unset") roll(m, meta, record);
        meta[BUTLER_ITEM_KEY] = record;
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
      steps.push({ step: "Update tokens", ok: true, detail: `Forge stat blocks written to ${updates.length} existing token(s); position, image and ownership untouched` });
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
