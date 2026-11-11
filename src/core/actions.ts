/**
 * The action bar (BG3-style hotbar): what a unit can do, grouped by what it costs (Action, Bonus Action, Reaction,
 * Legendary), plus its spells, limited-use features, spell slots and this turn's action economy.
 * Built from the unit's sheet (for party members: the D&D Beyond sync), so a re-sync updates the bar. Pure, so the
 * parsing and the rules are unit-tested; the actions page renders it.
 *
 * What a player spends here (an Action, a slot, a use of Second Wind) lives in the token's state, never on D&D Beyond:
 * D&D Beyond has no public write API. A re-sync takes D&D Beyond's counts as the new starting point.
 */
import { parseChips, rollSegments } from "./chips";
import { STATE_KEY, type SheetEntry, type UnitSheet, type UnitState } from "./sheet";
import type { EncounterState, OrderUnit } from "./encounter";
import type { SceneGateway } from "./importer";
import { trackerView } from "./tracker";

export type Economy = "action" | "bonus" | "reaction";
export const ECONOMY: Economy[] = ["action", "bonus", "reaction"];
export const ECONOMY_LABEL: Record<Economy, string> = { action: "Action", bonus: "Bonus Action", reaction: "Reaction" };

/** What using an entry costs. "longer": a casting time of a minute or more; "none": passive or unknown. */
export type Cost = Economy | "legendary" | "free" | "longer" | "none";
export type Category = "common" | "action" | "bonus" | "reaction" | "legendary" | "spell" | "feature";
export type Reset = "short" | "long" | "turn" | "other";

export interface Uses { max: number; used: number; reset: Reset; label: string }

export interface ActionItem {
  /** Stable id for tracking uses: section + name without the uses note. */
  key: string;
  /** Name without the uses / recharge note. */
  name: string;
  text: string;
  section: "traits" | "actions" | "bonusActions" | "reactions" | "legendary" | "spells" | "common";
  category: Category;
  cost: Cost;
  /** Casting time or cost note shown on the tile ("1 minute", "Costs 2 Actions"). */
  costNote?: string;
  /** Legendary actions that cost more than one. */
  legendaryCost?: number;
  uses?: Uses;
  /** Recharge X–6: the minimum d6 roll that brings it back. */
  recharge?: number;
  /** 0 = cantrip. */
  spellLevel?: number;
  concentration?: boolean;
  ritual?: boolean;
  /** "+5 · 1d8+3 Slashing · DC 13" */
  summary: string;
  /** Has dice to roll. */
  rollable: boolean;
}

export interface SlotPool {
  /** "slots:Druid:1" */
  key: string;
  level: number;
  max: number;
  /** Used per the sheet (D&D Beyond at the last sync). */
  used: number;
  /** Which spellcasting it belongs to ("Druid", "Spellcasting"). */
  source: string;
  /** Warlock Pact Magic: back on a Short Rest. */
  pact: boolean;
}

/** Spent this turn. `round` is the round of the unit's own turn these belong to; older ones don't count any more. */
export interface TurnEconomy { round: number; action?: boolean; bonus?: boolean; reaction?: boolean; legendary?: number }

// ------------------------------------------------------------------ parsing

const USES_RE = /\s*\((\d+)\/(Short Rest|Long Rest|Dawn|Day|Turn|Round|Other|rest)\b([^)]*)\)/i;
const USES_ANY_RE = /\b(\d+)\/(Short Rest|Long Rest|Dawn|Day|Turn|Round)\b((?:,\s*\d+ used)?)/i;
const RECHARGE_RE = /\s*\(Recharge (\d)(?:\s*[–-]\s*6)?\)/i;
const RECHARGE_REST_RE = /\s*\(Recharges after a (Short|Long|Short or Long) Rest\)/i;
const COSTS_RE = /\s*\(Costs (\d) Actions\)/i;

function resetOf(word: string): Reset {
  const w = word.toLowerCase();
  if (w === "short rest") return "short";
  if (w === "long rest" || w === "dawn" || w === "day") return "long";
  if (w === "turn" || w === "round") return "turn";
  return "other";
}

/** Uses, recharge and legendary cost from an entry name; returns the name without those notes. */
export function parseEntryName(raw: string): { name: string; uses?: Uses; recharge?: number; legendaryCost?: number } {
  let name = raw;
  const out: { uses?: Uses; recharge?: number; legendaryCost?: number } = {};
  // "(2/Long Rest, 1 used)" at the start of a note, else anywhere ("Misty Step (Level 2, Fey Touched 1/Long Rest …)").
  const u = USES_RE.exec(name) ?? USES_ANY_RE.exec(name);
  // "1/Day Each" (a creature's spell list) is once per spell, not a shared pool: not tracked.
  if (u && !/\beach\b/i.test(name)) {
    const used = /(\d+) used/.exec(u[3] ?? "");
    out.uses = { max: Number(u[1]), used: used ? Number(used[1]) : 0, reset: resetOf(u[2]!), label: `${u[1]}/${u[2]}` };
    if (/^\s*\(\d+\/\w[\w ]*(?:,\s*\d+ used)?\)\s*$/i.test(u[0])) name = name.replace(u[0], "");
  }
  const r = RECHARGE_RE.exec(name);
  if (r) { out.recharge = Number(r[1]); name = name.replace(r[0], ""); }
  const rr = RECHARGE_REST_RE.exec(name);
  if (rr && !out.uses) { out.uses = { max: 1, used: 0, reset: /short/i.test(rr[1]!) ? "short" : "long", label: `1/${rr[1]} Rest` }; name = name.replace(rr[0], ""); }
  const c = COSTS_RE.exec(name);
  if (c) { out.legendaryCost = Number(c[1]); name = name.replace(c[0], ""); }
  return { name: name.trim() || raw, ...out };
}

/** A D&D Beyond spell's level from its name: "Fire Bolt (Cantrip)", "Shield (Level 1, …)". */
export function spellLevelOf(name: string): number | undefined {
  const m = /\((Cantrip|Level (\d))\b/.exec(name);
  if (!m) return undefined;
  return m[1] === "Cantrip" ? 0 : Number(m[2]);
}

/** The casting-time tag the D&D Beyond sync writes ("[Bonus Action, Concentration, 60 ft.]"). */
function tagOf(text: string): string[] {
  const m = /\[([^\]]*(?:Action|Reaction|Concentration|Ritual|ft\.|Self|Touch|minute|hour)[^\]]*)\]/i.exec(text);
  return m ? m[1]!.split(",").map((s) => s.trim()) : [];
}

function costFromText(tags: string[]): { cost?: Cost; note?: string } {
  for (const t of tags) {
    if (/^(1 )?Bonus Action$/i.test(t)) return { cost: "bonus" };
    if (/^(1 )?Reaction/i.test(t)) return { cost: "reaction", note: t.length > 12 ? t : undefined };
    if (/^(1 )?Action$/i.test(t)) return { cost: "action" };
    if (/^\d+ (minute|hour)s?$/i.test(t)) return { cost: "longer", note: t };
  }
  return {};
}

/** "+5 · 1d8+3 Slashing · DC 13 Dex" from the entry's dice chips. */
export function summaryOf(text: string): { summary: string; rollable: boolean } {
  const rolls = rollSegments(parseChips(text));
  const parts: string[] = [];
  const atk = rolls.find((r) => r.kind === "attack");
  if (atk) parts.push(atk.display);
  for (const d of rolls.filter((r) => r.kind === "damage").slice(0, 2)) parts.push(`${d.display}${d.damageType ? ` ${d.damageType}` : ""}`);
  const dc = /\b(?:DC (\d+)\s+(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma|STR|DEX|CON|INT|WIS|CHA)|(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma|STR|DEX|CON|INT|WIS|CHA) save DC (\d+)|(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) Saving Throw: DC (\d+))/i.exec(text);
  if (dc) {
    const n = dc[1] ?? dc[4] ?? dc[6];
    const ab = (dc[2] ?? dc[3] ?? dc[5] ?? "").slice(0, 3);
    parts.push(`DC ${n} ${ab[0]?.toUpperCase()}${ab.slice(1).toLowerCase()}`);
  }
  if (!parts.length) {
    const other = rolls.find((r) => r.kind === "dice" || r.kind === "check" || r.kind === "save");
    if (other) parts.push(other.display);
  }
  return { summary: parts.join(" · "), rollable: rolls.length > 0 };
}

const SECTION_COST: Record<string, Cost> = { actions: "action", bonusActions: "bonus", reactions: "reaction", legendary: "legendary" };
const SECTION_CATEGORY: Record<string, Category> = { actions: "action", bonusActions: "bonus", reactions: "reaction", legendary: "legendary", spells: "spell", traits: "feature" };

/** Header-like entries that describe a section rather than being something to use. */
const isHeader = (section: string, name: string) =>
  (section === "legendary" && /^(Legendary|Mythic) Actions$/i.test(name)) || /^Spellcasting\b/i.test(name) || (section === "spells" && /other known spells$/i.test(name));

type SheetSection = Exclude<ActionItem["section"], "common">;

function itemOf(entry: SheetEntry, section: SheetSection): ActionItem | null {
  if (isHeader(section, entry.name)) return null;
  const parsed = parseEntryName(entry.name);
  const tags = tagOf(entry.text);
  const fromText = costFromText(tags);
  let cost: Cost = entry.cost ?? SECTION_COST[section] ?? fromText.cost ?? "none";
  if (section === "spells" && !entry.cost && fromText.cost) cost = fromText.cost;
  const { summary, rollable } = summaryOf(entry.text);
  const spellLevel = section === "spells" ? spellLevelOf(entry.name) : undefined;
  const name = section === "spells" && spellLevel !== undefined ? parsed.name.replace(/\s*\((Cantrip|Level \d)[^)]*\)$/, "") : parsed.name;
  return {
    key: `${section}:${name}`,
    name,
    text: entry.text,
    section,
    category: SECTION_CATEGORY[section]!,
    cost,
    ...(entry.costNote || fromText.note ? { costNote: entry.costNote ?? fromText.note } : {}),
    ...(parsed.legendaryCost ? { legendaryCost: parsed.legendaryCost, costNote: `Costs ${parsed.legendaryCost} Actions` } : {}),
    ...(parsed.uses ? { uses: parsed.uses } : {}),
    ...(parsed.recharge ? { recharge: parsed.recharge } : {}),
    ...(spellLevel !== undefined ? { spellLevel } : {}),
    ...(tags.some((t) => /^Concentration$/i.test(t)) ? { concentration: true } : {}),
    ...(tags.some((t) => /^Ritual$/i.test(t)) ? { ritual: true } : {}),
    summary,
    rollable,
  };
}

/** Spell slots: from the D&D Beyond "Spellcasting — Druid" entry ("Slots: L1 4 (2 used), L2 3.") or a 5etools
 *  creature's "Level 1 (4 slots)" lists. */
export function slotPools(sheet: Pick<UnitSheet, "spells">): SlotPool[] {
  const out: SlotPool[] = [];
  let source = "Spellcasting";
  for (const e of sheet.spells) {
    const ddb = /^Spellcasting — (.+)$/.exec(e.name);
    if (ddb) {
      source = ddb[1]!.trim();
      const slots = /Slots: ([^.]*)/.exec(e.text)?.[1] ?? "";
      for (const m of slots.matchAll(/L(\d) (\d+)(?: \((\d+) used\))?/g)) {
        out.push({ key: `slots:${source}:${m[1]}`, level: Number(m[1]), max: Number(m[2]), used: Number(m[3] ?? 0), source, pact: /warlock/i.test(source) });
      }
      continue;
    }
    if (/^Spellcasting\b/i.test(e.name)) { source = e.name; continue; }
    const creature = /^Level (\d) \((\d+) slots?\)$/.exec(e.name);
    if (creature) out.push({ key: `slots:${source}:${creature[1]}`, level: Number(creature[1]), max: Number(creature[2]), used: 0, source, pact: false });
  }
  return out;
}

/** How many Legendary Actions a creature gets per round (0 if none). */
export function legendaryPerRound(sheet: Pick<UnitSheet, "legendary">): number {
  if (!sheet.legendary.length) return 0;
  const header = sheet.legendary.find((e) => /^Legendary Actions$/i.test(e.name))?.text ?? "";
  const m = /Legendary Action Uses:\s*(\d+)/i.exec(header) ?? /\b(\d+|one|two|three|four|five)\s+legendary actions/i.exec(header);
  const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };
  if (!m) return 3;
  return words[m[1]!.toLowerCase()] ?? Number(m[1]);
}

// ------------------------------------------------------------------ common actions

interface CommonDef { name: string; cost: Cost; text: string }
const COMMON_2024: CommonDef[] = [
  { name: "Attack", cost: "action", text: "Make an attack with a weapon or an Unarmed Strike (more attacks with Extra Attack)." },
  { name: "Dash", cost: "action", text: "Gain extra movement equal to your Speed for this turn." },
  { name: "Disengage", cost: "action", text: "Your movement doesn't provoke Opportunity Attacks for the rest of this turn." },
  { name: "Dodge", cost: "action", text: "Until your next turn, attack rolls against you have Disadvantage and you make Dexterity saves with Advantage (lost if Incapacitated or your Speed is 0)." },
  { name: "Help", cost: "action", text: "Help an ally's next ability check, or distract an enemy within 5 ft. so an ally's next attack against it has Advantage." },
  { name: "Hide", cost: "action", text: "DC 15 Dexterity (Stealth) check while Heavily Obscured or behind Three-Quarters or Total Cover: on a success you have the Invisible condition." },
  { name: "Influence", cost: "action", text: "Urge a monster to do something with a Charisma (Deception, Intimidation, Performance or Persuasion) or Wisdom (Animal Handling) check." },
  { name: "Magic", cost: "action", text: "Cast a spell with a casting time of an action, or use a magic item or magical feature." },
  { name: "Ready", cost: "action", text: "Choose a trigger and an action (or a spell, holding Concentration) to take with your Reaction when it happens." },
  { name: "Search", cost: "action", text: "Make a Wisdom (Insight, Medicine, Perception or Survival) check." },
  { name: "Study", cost: "action", text: "Make an Intelligence (Arcana, History, Investigation, Nature or Religion) check." },
  { name: "Utilize", cost: "action", text: "Use a nonmagical object." },
  { name: "Opportunity Attack", cost: "reaction", text: "When a creature you can see leaves your reach, make one melee attack against it." },
];
const COMMON_2014: CommonDef[] = [
  { name: "Attack", cost: "action", text: "Make one melee or ranged attack (more with Extra Attack)." },
  { name: "Cast a Spell", cost: "action", text: "Cast a spell with a casting time of 1 action." },
  { name: "Dash", cost: "action", text: "Gain extra movement equal to your speed for this turn." },
  { name: "Disengage", cost: "action", text: "Your movement doesn't provoke opportunity attacks for the rest of the turn." },
  { name: "Dodge", cost: "action", text: "Until your next turn, attack rolls against you have disadvantage (if you can see the attacker), and you make Dexterity saves with advantage." },
  { name: "Help", cost: "action", text: "Give an ally advantage on their next ability check, or on their next attack against a creature within 5 ft. of you." },
  { name: "Hide", cost: "action", text: "Make a Dexterity (Stealth) check to hide." },
  { name: "Ready", cost: "action", text: "Choose a trigger and an action to take with your reaction when it happens." },
  { name: "Search", cost: "action", text: "Make a Wisdom (Perception) or Intelligence (Investigation) check to find something." },
  { name: "Use an Object", cost: "action", text: "Interact with a second object, or use one that needs your action." },
  { name: "Opportunity Attack", cost: "reaction", text: "When a hostile creature you can see moves out of your reach, make one melee attack against it." },
];

export function commonActions(rules: "2024" | "2014"): ActionItem[] {
  return (rules === "2014" ? COMMON_2014 : COMMON_2024).map((c) => ({
    key: `common:${c.name}`, name: c.name, text: c.text, section: "common", category: "common", cost: c.cost, summary: "", rollable: false,
  }));
}

// ------------------------------------------------------------------ the bar

export interface ActionBar {
  items: ActionItem[];
  slots: SlotPool[];
  legendary: number;
}

export function actionBar(sheet: UnitSheet, rules: "2024" | "2014" = "2024"): ActionBar {
  const items: ActionItem[] = [];
  const seen = new Set<string>();
  for (const section of ["actions", "bonusActions", "reactions", "legendary", "spells", "traits"] as const) {
    for (const e of sheet[section]) {
      const it = itemOf(e, section);
      if (!it || seen.has(it.key)) continue;
      // Traits only belong on the bar when they're something to use: limited uses, a recharge, or a cost.
      if (section === "traits" && !it.uses && !it.recharge && it.cost === "none") continue;
      seen.add(it.key);
      items.push(it);
    }
  }
  return { items: [...items, ...commonActions(rules)], slots: slotPools(sheet), legendary: legendaryPerRound(sheet) };
}

/** Which tab an item shows under. Spells and features show under their cost too. */
export function inTab(it: ActionItem, tab: Category | "all"): boolean {
  if (tab === "all") return it.category !== "common";
  if (tab === it.category) return true;
  if (tab === "action" || tab === "bonus" || tab === "reaction" || tab === "legendary") return it.cost === tab && it.category !== "common";
  return false;
}

// ------------------------------------------------------------------ live state: turn economy, uses, slots

/**
 * The round of the unit's latest turn start: this round if its turn has come (or is now), else last round. Outside
 * combat (or out of the order) it's 0, so what was spent in combat is fresh again afterwards, and vice versa.
 */
export function ownTurnRound(enc: EncounterState, order: Pick<OrderUnit, "id">[], unitId: string): number {
  if (!enc.started) return 0;
  const me = order.findIndex((u) => u.id === unitId);
  if (me < 0) return 0;
  const cur = order.findIndex((u) => u.id === enc.turnId);
  const at = cur >= 0 ? cur : Math.min(enc.turnIndex, order.length);
  return me <= at ? enc.round : enc.round - 1;
}

/** This turn's economy: what was spent since the unit's turn began (a new turn resets it). */
export function currentEconomy(state: Pick<UnitState, "turn">, turnRound: number): TurnEconomy {
  const t = state.turn;
  return t && t.round === turnRound ? t : { round: turnRound };
}

export const usesLeft = (it: Pick<ActionItem, "key" | "uses">, state: Pick<UnitState, "used">) =>
  it.uses ? Math.max(0, it.uses.max - (state.used?.[it.key] ?? it.uses.used)) : Infinity;

export const slotsLeft = (p: SlotPool, state: Pick<UnitState, "used">) => Math.max(0, p.max - (state.used?.[p.key] ?? p.used));

/** Recharge abilities: expended until a d6 roll brings them back. */
export const recharging = (it: Pick<ActionItem, "key" | "recharge">, state: Pick<UnitState, "used">) => !!it.recharge && (state.used?.[it.key] ?? 0) > 0;

/** Slot pools that can cast a spell of `level` (that level or higher) and have a slot left. */
export function castableWith(level: number, slots: SlotPool[], state: Pick<UnitState, "used">): SlotPool[] {
  return slots.filter((p) => p.level >= level && slotsLeft(p, state) > 0).sort((a, b) => a.level - b.level);
}

/** Why an item can't be used right now, or null. */
export function unavailable(it: ActionItem, bar: Pick<ActionBar, "slots" | "legendary">, state: Pick<UnitState, "used" | "turn">, eco: TurnEconomy): string | null {
  if (it.cost === "action" && eco.action) return "Action used";
  if (it.cost === "bonus" && eco.bonus) return "Bonus Action used";
  if (it.cost === "reaction" && eco.reaction) return "Reaction used";
  if (it.cost === "legendary" && bar.legendary && (eco.legendary ?? 0) + (it.legendaryCost ?? 1) > bar.legendary) return "No Legendary Actions left";
  if (it.uses && usesLeft(it, state) <= 0) return "No uses left";
  if (recharging(it, state)) return `Recharging (${it.recharge}–6)`;
  if (it.spellLevel && it.spellLevel > 0 && bar.slots.length && !it.uses && !castableWith(it.spellLevel, bar.slots, state).length) return "No spell slots left";
  return null;
}

// ------------------------------------------------------------------ changes

/** A change to the action bar's live state. */
export interface UseChange {
  /** Mark economy spent (true) or regained (false). */
  economy?: Partial<Record<Economy, boolean>>;
  /** Legendary actions spent this round (absolute). */
  legendary?: number;
  /** Set how many of a pool / feature are used (absolute counts, keyed like ActionItem.key / SlotPool.key). */
  used?: Record<string, number>;
  /** Start a fresh turn by hand (outside combat, or the GM's call). */
  resetTurn?: boolean;
  /** A rest: clears uses that come back on it. */
  rest?: "short" | "long";
}

export function isUseChange(x: unknown): x is UseChange {
  if (!x || typeof x !== "object") return false;
  const c = x as UseChange;
  if (c.economy !== undefined && (typeof c.economy !== "object" || !Object.entries(c.economy).every(([k, v]) => (ECONOMY as string[]).includes(k) && typeof v === "boolean"))) return false;
  if (c.legendary !== undefined && !(Number.isInteger(c.legendary) && c.legendary >= 0 && c.legendary <= 10)) return false;
  if (c.used !== undefined) {
    if (typeof c.used !== "object" || c.used === null) return false;
    const e = Object.entries(c.used);
    if (e.length > 20 || !e.every(([k, v]) => k.length <= 120 && Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 99)) return false;
  }
  if (c.resetTurn !== undefined && typeof c.resetTurn !== "boolean") return false;
  if (c.rest !== undefined && c.rest !== "short" && c.rest !== "long") return false;
  return true;
}

/** The state patch for a change, given the unit's sheet and the round of its current turn. */
export function applyUse(sheet: UnitSheet, state: Pick<UnitState, "turn" | "used">, change: UseChange, turnRound: number, rules: "2024" | "2014" = "2024"): Partial<UnitState> {
  const patch: Partial<UnitState> = {};
  let eco: TurnEconomy = change.resetTurn ? { round: turnRound } : { ...currentEconomy(state, turnRound) };
  if (change.economy) for (const [k, v] of Object.entries(change.economy)) { if (v) eco[k as Economy] = true; else delete eco[k as Economy]; }
  if (change.legendary !== undefined) eco.legendary = change.legendary;
  if (change.economy || change.legendary !== undefined || change.resetTurn) patch.turn = eco;

  let used: Record<string, number> = { ...(state.used ?? {}) };
  if (change.rest) {
    const bar = actionBar(sheet, rules);
    const comes = (r: Reset | undefined) => r === "short" || r === "turn" || (change.rest === "long" && (r === "long" || r === "other"));
    for (const it of bar.items) {
      if (it.uses && comes(it.uses.reset)) used[it.key] = 0;
      if (it.recharge && change.rest) used[it.key] = 0;
    }
    for (const p of bar.slots) if (change.rest === "long" || p.pact) used[p.key] = 0;
    patch.turn = { round: turnRound };
  }
  if (change.used) used = { ...used, ...change.used };
  if (change.rest || change.used) patch.used = used;
  return patch;
}

// ------------------------------------------------------------------ on the scene

/** Applies a change to a unit on the scene (the GM's client, directly or for a player's request). */
export async function useOnUnit(gw: SceneGateway, unitId: string, change: UseChange, rules: "2024" | "2014" = "2024"): Promise<void> {
  const [items, meta] = await Promise.all([gw.getItems(), gw.getSceneMetadata()]);
  const v = trackerView(items, meta);
  const u = [...v.order, ...v.waiting, ...v.outside].find((x) => x.id === unitId);
  if (!u) throw new Error("That token is no longer in the scene.");
  const patch = applyUse(u.sheet, u.state, change, ownTurnRound(v.encounter, v.order, unitId), rules);
  if (Object.keys(patch).length) await gw.patchMetadata([{ id: unitId, key: STATE_KEY, patch }]);
}
