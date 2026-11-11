/**
 * Limited uses on a stat block: Recharge abilities, X/Day traits and spells, abilities that come back on a rest, and
 * the legendary action pool. Read from the sheet's entry names (as 5etools, homebrew and D&D Beyond write them), so
 * no sheet change is needed; what has been spent lives in the unit's state (`uses`: key → number spent).
 *
 *  - "Fire Breath (Recharge 5–6)": one use; at the start of the creature's turn a d6 of 5 or more brings it back.
 *  - "Legendary Resistance (3/Day, or 4/Day in Lair)": 3 uses (4 while the unit is in its lair).
 *  - Spells "1/Day Each: Dominate Monster, Teleport": one use of each spell; "3/Day: …" three uses shared by the list.
 *  - "(Recharges after a Short or Long Rest)", "2/Long Rest": back when the GM resets the unit's uses.
 *  - Legendary actions: the header's count ("can take 3 legendary actions", "Legendary Action Uses: 3 (4 in Lair)"),
 *    3 if it doesn't say; "(Costs 2 Actions)" spends two. All back at the start of the creature's turn.
 * Pure; the scene operations (spend, reset, start of turn) are at the end.
 */
import { makeRoll, type RollMessage } from "./rolls";
import type { Rng } from "./dice";
import { isDdbSheet, STATE_KEY, type SheetEntry, type UnitSheet, type UnitState } from "./sheet";
import type { SceneGateway } from "./importer";
import { readUnit } from "./unit";

export type UseKind = "recharge" | "perDay" | "rest" | "legendary";

export interface UseResource {
  /** Stable id within the unit: section and entry name (and spell), lower case. */
  key: string;
  label: string;
  kind: UseKind;
  max: number;
  /** Lowest d6 that recharges it ("Recharge 5–6" → 5). */
  recharge?: number;
  /** Section and entry the resource belongs to (the card shows its control there). */
  section: Section;
  entry: string;
  /** One spell of an "each" list. */
  spell?: string;
}

type Section = "traits" | "actions" | "bonusActions" | "reactions" | "legendary" | "spells" | "inventory" | "lair";
const SECTIONS: Section[] = ["traits", "actions", "bonusActions", "reactions", "legendary", "spells", "inventory"];

const RECHARGE = /\(\s*recharge\s+(\d)(?:\s*[–—-]\s*6)?\s*\)/i;
const AFTER_REST = /\(\s*recharges?\s+after\s+(?:a\s+)?(?:short\s+or\s+long|long|short)\s+rest\s*\)/i;
/** "3/Day", "1/day each", "2/Long Rest", "1/Short Rest", with an optional "or 4/Day in Lair". */
const PER = /(?:^|[\s(])(\d+)\s*\/\s*(day|long rest|short rest|rest)\b(\s+each)?(?:[^)]*?\bor\s+(\d+)\s*\/\s*day\s+in\s+(?:its\s+)?lair)?/i;
const COSTS = /\(\s*costs\s+(\d+)\s+actions?\s*\)/i;

const keyOf = (section: Section, entry: string, spell?: string) =>
  `${section}:${entry.trim().toLowerCase()}${spell ? `:${spell.trim().toLowerCase()}` : ""}`;

/** Entry names Butler writes as headers of the legendary list (not actions themselves). */
const isLegendaryHeader = (e: SheetEntry) => /^(legendary actions|mythic actions)$/i.test(e.name.trim());

/** "Legendary Action Uses: 3 (4 in Lair)" / "can take 3 legendary actions". */
export function legendaryCount(sheet: Pick<UnitSheet, "legendary">, inLair = false): number {
  const header = sheet.legendary.filter(isLegendaryHeader).map((e) => e.text).join(" ");
  const uses = /legendary action uses:?\s*(\d+)(?:\s*\(\s*(\d+)\s+in\s+(?:its\s+)?lair\s*\))?/i.exec(header);
  if (uses) return inLair && uses[2] ? Number(uses[2]) : Number(uses[1]);
  const take = /can take (\d+) legendary actions?/i.exec(header);
  return take ? Number(take[1]) : 3;
}

/** Legendary action cost from its name ("Wing Attack (Costs 2 Actions)"); 1 otherwise. */
export const legendaryCost = (entryName: string) => Number(COSTS.exec(entryName)?.[1] ?? 1);

/** Spell names of a spell-list entry ("Detect Magic, Fly (self only), Invisibility" → three names). */
export function spellNames(text: string): string[] {
  return text.split(/,(?![^()]*\))/).map((s) => s.replace(/\*+$/, "").trim()).filter((s) => s && s.length < 80);
}

/** Every limited-use resource of a sheet, in card order. */
export function sheetUses(sheet: UnitSheet, opts: { inLair?: boolean } = {}): UseResource[] {
  // D&D Beyond characters: the player tracks uses there; the card keeps the synced "(2/Short Rest, 1 used)" text.
  if (isDdbSheet(sheet)) return [];
  const out: UseResource[] = [];
  const lists: [Section, SheetEntry[]][] = [...SECTIONS.map((s) => [s, sheet[s]] as [Section, SheetEntry[]]), ["lair", sheet.lair ?? []]];
  for (const [section, entries] of lists) {
    for (const e of entries) {
      const name = e.name.trim();
      if (!name || (section === "legendary" && isLegendaryHeader(e))) continue;
      const label = name.replace(RECHARGE, "").replace(AFTER_REST, "").replace(/\s*\([^)]*\/[^)]*\)\s*$/, "").trim() || name;
      const r = RECHARGE.exec(name);
      if (r) { out.push({ key: keyOf(section, name), label, kind: "recharge", max: 1, recharge: Number(r[1]), section, entry: e.name }); continue; }
      if (AFTER_REST.test(name)) { out.push({ key: keyOf(section, name), label, kind: "rest", max: 1, section, entry: e.name }); continue; }
      const p = PER.exec(name);
      if (!p) continue;
      const n = Number(p[1]);
      const lairN = p[4] ? Number(p[4]) : undefined;
      const max = opts.inLair && lairN ? lairN : n;
      const kind: UseKind = p[2]!.toLowerCase() === "day" ? "perDay" : "rest";
      if (!(max > 0 && max <= 20)) continue;
      // "1/Day Each: a, b, c": a counter per spell. Spell lists without "each" share one counter.
      if (p[3] && section === "spells") {
        for (const spell of spellNames(e.text)) out.push({ key: keyOf(section, name, spell), label: spell, kind, max, section, entry: e.name, spell });
        continue;
      }
      out.push({ key: keyOf(section, name), label: section === "spells" && /^\d+\s*\/\s*day/i.test(name) ? `Spells ${name}` : label, kind, max, section, entry: e.name });
    }
  }
  const actions = sheet.legendary.filter((e) => !isLegendaryHeader(e));
  if (actions.length) {
    out.push({ key: "legendary", label: "Legendary actions", kind: "legendary", max: legendaryCount(sheet, opts.inLair), section: "legendary", entry: "" });
  }
  return out;
}

/** Whether the unit's sheet has anything that changes in its lair (lair actions or "in Lair" counts). */
export function hasLairFeatures(sheet: UnitSheet): boolean {
  if (sheet.lair?.length) return true;
  const named = [...sheet.traits, ...sheet.actions, ...sheet.legendary.filter((e) => !isLegendaryHeader(e))].some((e) => /\bin\s+(?:its\s+)?lair\b/i.test(e.name));
  return named || legendaryCount(sheet, true) !== legendaryCount(sheet, false);
}

export const spentOf = (state: Pick<UnitState, "uses">, key: string) => Math.max(0, Math.floor(state.uses?.[key] ?? 0));
export const leftOf = (r: UseResource, state: Pick<UnitState, "uses">) => Math.max(0, r.max - spentOf(state, r.key));

/** The `uses` map with one resource set to `spent` (0 removes the key; undefined when nothing is spent). */
export function withSpent(state: Pick<UnitState, "uses">, key: string, spent: number): UnitState["uses"] {
  const next = { ...(state.uses ?? {}) };
  if (spent > 0) next[key] = Math.floor(spent); else delete next[key];
  return Object.keys(next).length ? next : undefined;
}

/** "Fire Breath ✗ · Legendary Resistance 2/3 · Legendary actions 1/3" for the tracker (spells left out). */
export function usesSummary(sheet: UnitSheet, state: Pick<UnitState, "uses" | "inLair">): string {
  return sheetUses(sheet, { inLair: state.inLair }).filter((r) => r.section !== "spells").map((r) => {
    const left = leftOf(r, state);
    return r.max === 1 ? `${r.label} ${left ? "✓" : "✗"}` : `${r.label} ${left}/${r.max}`;
  }).join(" · ");
}

export interface TurnStartResult {
  /** New `uses` map (undefined key = nothing spent), or null if nothing changed. */
  uses: UnitState["uses"] | null;
  regainedLegendary: boolean;
  recharges: { resource: UseResource; roll: number; recharged: boolean }[];
}

/**
 * Start of the unit's turn: legendary actions come back and each expended Recharge ability rolls a d6.
 * `rollD6` returns the die (the background broadcasts it as a roll message; tests pass a fixed die).
 */
export function startOfTurnUses(sheet: UnitSheet, state: Pick<UnitState, "uses" | "inLair">, rollD6: (r: UseResource) => number): TurnStartResult {
  let uses: UnitState["uses"] = state.uses;
  let changed = false;
  let regainedLegendary = false;
  const recharges: TurnStartResult["recharges"] = [];
  for (const r of sheetUses(sheet, { inLair: state.inLair })) {
    if (!spentOf({ uses }, r.key)) continue;
    if (r.kind === "legendary") { uses = withSpent({ uses }, r.key, 0); changed = true; regainedLegendary = true; }
    else if (r.kind === "recharge") {
      const roll = rollD6(r);
      const recharged = roll >= (r.recharge ?? 6);
      recharges.push({ resource: r, roll, recharged });
      if (recharged) { uses = withSpent({ uses }, r.key, 0); changed = true; }
    }
  }
  return { uses: changed ? uses ?? {} : null, regainedLegendary, recharges };
}

// ------------------------------------------------------------------ scene operations

async function unit(gw: SceneGateway, id: string) {
  const item = (await gw.getItems()).find((i) => i.id === id);
  const u = item && readUnit(item.metadata);
  if (!item || !u) throw new Error("That token is no longer in the scene.");
  return { item, ...u };
}

/** `uses: {}` in a patch would keep stale keys under mergePatch's shallow merge, so empty maps are removed. */
const usesPatch = (uses: UnitState["uses"] | null | undefined) => ({ uses: uses && Object.keys(uses).length ? uses : undefined });

/** Sets how many uses of a resource are spent (clamped to 0…max). Returns the uses left. */
export async function setUsesSpent(gw: SceneGateway, id: string, key: string, spent: number): Promise<number> {
  const { sheet, state } = await unit(gw, id);
  const r = sheetUses(sheet, { inLair: state.inLair }).find((x) => x.key === key);
  if (!r) throw new Error("That ability has no limited uses on this stat block.");
  const n = Math.min(r.max, Math.max(0, Math.floor(spent)));
  await gw.patchMetadata([{ id, key: STATE_KEY, patch: usesPatch(withSpent(state, key, n)) }]);
  return r.max - n;
}

/** Spends `n` uses (a legendary action's cost). Refuses if not enough are left. */
export async function spendUses(gw: SceneGateway, id: string, key: string, n = 1): Promise<number> {
  const { sheet, state } = await unit(gw, id);
  const r = sheetUses(sheet, { inLair: state.inLair }).find((x) => x.key === key);
  if (!r) throw new Error("That ability has no limited uses on this stat block.");
  const left = leftOf(r, state);
  if (left < n) throw new Error(`${r.label}: ${left ? `only ${left} left` : "none left"}.`);
  return setUsesSpent(gw, id, key, spentOf(state, key) + n);
}

/** Every use back (a new day, or a rest): clears the unit's spent uses. */
export async function resetUses(gw: SceneGateway, ids: string[]) {
  await gw.patchMetadata(ids.map((id) => ({ id, key: STATE_KEY, patch: { uses: undefined } })));
}

/** Whether the unit is in its lair: lair actions on initiative 20 and the "in Lair" counts. */
export async function setInLair(gw: SceneGateway, id: string, on: boolean) {
  await gw.patchMetadata([{ id, key: STATE_KEY, patch: { inLair: on ? true : undefined } }]);
}

/**
 * Start of `id`'s turn (primary GM client, forward turn changes only): legendary actions back, recharge rolls.
 * Each recharge roll is a GM-private roll message for the log. Returns the messages and notice lines.
 */
export async function applyTurnStartUses(gw: SceneGateway, id: string, opts: { rng: Rng; by: RollMessage["by"]; unitName: string }): Promise<{ rolls: RollMessage[]; lines: string[] }> {
  const item = (await gw.getItems()).find((i) => i.id === id);
  const u = item && readUnit(item.metadata);
  if (!item || !u) return { rolls: [], lines: [] };
  const rolls: RollMessage[] = [];
  const res = startOfTurnUses(u.sheet, u.state, (r) => {
    const msg = makeRoll("1d6", `${r.label} · recharge (${r.recharge}–6)`, opts.by, "private", { rng: opts.rng, unit: { id, name: opts.unitName }, kind: "dice" });
    rolls.push(msg);
    return msg.total;
  });
  if (res.uses) await gw.patchMetadata([{ id, key: STATE_KEY, patch: usesPatch(res.uses) }]);
  res.recharges.forEach((x, i) => { rolls[i]!.label += x.recharged ? " · recharged" : " · not recharged"; });
  const lines = res.recharges.map((x) => `${opts.unitName}: ${x.resource.label} ${x.recharged ? "recharged" : "not recharged"} (rolled ${x.roll}, needs ${x.resource.recharge}+).`);
  return { rolls, lines };
}
