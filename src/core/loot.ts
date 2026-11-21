/**
 * Suggested loot for a dead monster or NPC (never a party member or a D&D Beyond character).
 *  - Gear: what the 2024 Monster Manual stat block lists as Gear, or (no Gear line) the armor its AC names and the
 *    weapons it attacks with.
 *  - Money: a purse in a mix of coins, sized from the party's economy (see expectedPurse): the coin a party of its level
 *    finds (2024 DMG: a hoard per session, quest rewards worth a hoard at the party's level), of which monster purses
 *    are a share, divided among monsters by XP. Every creature with a Treasure line has one, and those without one
 *    unless they're a kind of creature that carries nothing (Beast, Ooze, Plant…).
 *  - Magic items: themed Treasure lines (Arcana, Armaments, Implements, Relics) offer a roll on that 2024 DMG table; the
 *    GM decides whether to roll. "Any" lets the GM pick the theme. The rarity uses the DMG Magic Item
 *    Rarities table, reading the creature's CR band (0–4, 5–10, 11–16, 17+) as the table's level band.
 * Rolled once when the unit dies and kept on the unit (state.loot), so the card shows the same loot every time.
 */
import { rollFormula, type Rng } from "./dice";
import { xpForCr } from "./combat";
import { THEME_TABLES } from "./lootTables";
import type { UnitSheet, UnitState } from "./sheet";

export const THEMES = ["Arcana", "Armaments", "Implements", "Relics"] as const;
export type Theme = (typeof THEMES)[number];
export const RARITIES = ["Common", "Uncommon", "Rare", "Very Rare", "Legendary"] as const;
export type Rarity = (typeof RARITIES)[number];

export interface LootLine {
  id: string;
  kind: "gear" | "coins" | "item";
  /** "Scimitar", "11 gp", "Cloak of Billowing (Common)". */
  text: string;
  /** How it was worked out, for the GM. */
  detail?: string;
  /** Posted to the roll log. */
  posted?: true;
}

export interface UnitLoot {
  lines: LootLine[];
  /** Magic item tables the GM can roll on. */
  themes: Theme[];
  /** The Treasure line says Any: the GM picks a theme. */
  any?: true;
  /** Why there's little or nothing: "Beasts carry no treasure." */
  note?: string;
}

/** The DMG's CR bands. */
export const BANDS = ["0–4", "5–10", "11–16", "17+"] as const;
export type Band = (typeof BANDS)[number];
export function band(cr: number | undefined): Band {
  const c = cr ?? 0;
  return c >= 17 ? "17+" : c >= 11 ? "11–16" : c >= 5 ? "5–10" : "0–4";
}

/** Dead monsters and NPCs get loot; the party and D&D Beyond characters don't. */
export function lootEligible(sheet: Pick<UnitSheet, "kind">, state: Pick<UnitState, "party">): boolean {
  return sheet.kind === "creature" && !state.party;
}

/** Creature types that carry no treasure when the stat block doesn't say otherwise. */
const NO_TREASURE = /^(swarm of \w+ )?(beast|ooze|plant|construct|elemental)s?\b/i;

/** The facts loot depends on; `treasure`/`gear` may come from the book when the token predates them (see card). */
export type LootSource = Pick<UnitSheet, "cr" | "type" | "treasure" | "gear"> & Partial<Pick<UnitSheet, "actions" | "acNote" | "flags">>;

export function planLoot(sheet: LootSource, economy: Economy, rng: Rng): UnitLoot {
  const ids = idMaker(rng);
  const gear = sheet.gear ?? inferGear(sheet);
  const lines: LootLine[] = gear.map((g) => ({ id: ids(), kind: "gear", text: g, detail: sheet.gear ? "Gear (stat block)" : "Carried (from its armor and attacks)" }));
  const tags = sheet.treasure?.map((t) => t.toLowerCase());
  const out: UnitLoot = { lines, themes: [] };
  // Without a Treasure line (or with an empty one), only creatures that could carry money have some.
  if (!tags?.length) {
    const t = sheet.type?.trim() ?? "";
    if (NO_TREASURE.test(t)) out.note = `${t.replace(/\s*\(.*\)$/, "")} creatures usually carry no treasure.`;
    else lines.push(rollPurse(sheet.cr, economy, rng, ids()));
    return out;
  }
  lines.push(rollPurse(sheet.cr, economy, rng, ids()));
  out.themes = THEMES.filter((th) => tags.includes(th.toLowerCase()));
  if (tags.includes("any")) { out.any = true; out.themes = [...THEMES]; }
  return out;
}

export type CoinKey = "cp" | "sp" | "ep" | "gp" | "pp";
const COIN_ORDER: CoinKey[] = ["pp", "gp", "ep", "sp", "cp"];
/** Copper pieces per coin. */
const CP: Record<CoinKey, number> = { pp: 1000, gp: 100, ep: 50, sp: 10, cp: 1 };

/** The party the loot is for: its average level and size (from the scene's party members; see the card). */
export interface Economy { partyLevel?: number; partySize?: number }

/** PHB experience points needed for each level (index 0 = level 1). */
const LEVEL_XP = [0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000, 85000, 100000, 120000, 140000, 165000, 195000, 225000, 265000, 305000, 355000];
/** XP a character earns while at `level` (level 20 keeps earning at the 19→20 pace). */
const xpDuringLevel = (level: number) => (level >= 20 ? 50000 : LEVEL_XP[level]! - LEVEL_XP[level - 1]!);

/** 2024 DMG Random Treasure Hoard averages (GP), placed at the middle level of each tier. */
const HOARD_ANCHORS: [number, number][] = [[2.5, 500], [7.5, 4400], [13.5, 36000], [18.5, 330000]];

/** Average hoard (GP) for a party of this level: the DMG's tier averages, joined by a smooth (log-linear) curve. */
export function hoardValue(level: number): number {
  const l = Math.min(20, Math.max(1, level));
  let i = HOARD_ANCHORS.findIndex(([at]) => l <= at);
  i = i <= 0 ? 1 : i;
  if (l > HOARD_ANCHORS[HOARD_ANCHORS.length - 1]![0]) i = HOARD_ANCHORS.length - 1;
  const [a, av] = HOARD_ANCHORS[i - 1]!, [z, zv] = HOARD_ANCHORS[i]!;
  return Math.exp(Math.log(av) + (Math.log(zv) - Math.log(av)) * (l - a) / (z - a));
}

/** Sessions to gain a level: one each for levels 1 and 2 (they go fast), two after that. */
export const sessionsAtLevel = (level: number) => (level <= 2 ? 1 : 2);
/** Quest rewards per level (the DMG's Quest Rewards: one hoard roll at the characters' level). */
export const QUESTS_PER_LEVEL = 1;
/** Share of all the coin a party finds that comes from what monsters carry; the rest is hoards and quest rewards. */
export const PURSE_SHARE = 0.2;

/** Coin a party finds while at this level: a hoard per session plus quest rewards, and monster purses on top. */
export function partyIncome(level: number): { hoardsAndQuests: number; purses: number } {
  const hoardsAndQuests = hoardValue(level) * (sessionsAtLevel(level) + QUESTS_PER_LEVEL);
  return { hoardsAndQuests, purses: hoardsAndQuests * PURSE_SHARE / (1 - PURSE_SHARE) };
}

/** The level loot is pitched at: the party's average level, else (no party in the scene) the monster's CR. */
export function economyLevel(cr: number | undefined, e: Economy = {}): number {
  const l = e.partyLevel ?? Math.round(cr ?? 1);
  return Math.min(20, Math.max(1, Math.round(l)));
}

/**
 * What a monster carries on average (GP): its share of the purses the party finds over a level, in proportion to its
 * XP. Purse = monster XP × purse income ÷ (XP the whole party earns over the level). Never more than one hoard.
 */
export function expectedPurse(cr: number | undefined, e: Economy = {}): number {
  const level = economyLevel(cr, e);
  const size = Math.max(1, Math.round(e.partySize ?? 4));
  const xp = xpForCr(cr ?? 0) || 10;
  const perXp = partyIncome(level).purses / (xpDuringLevel(level) * size);
  return Math.min(hoardValue(level), xp * perXp);
}

/**
 * Splits a value into a purse its owner would want to carry: coins weigh a pound per fifty (PHB), so the bulk is in the
 * most valuable coin there are at least three of, and the rest is exact change, largest coins first (never more than
 * nine of any smaller coin). Electrum turns up now and then as change in place of five silver. The value is exact,
 * rounded to the silver above 10 gp and to the gold above 100 gp.
 */
export function coinMix(valueGp: number, rng: Rng): Partial<Record<CoinKey, number>> {
  // Nobody carries exact copper in a fat purse: round to the silver above 10 gp, to the gold above 100 gp.
  const unit = valueGp >= 100 ? 100 : valueGp >= 10 ? 10 : 1;
  let cp = Math.max(1, Math.round(valueGp * 100 / unit) * unit);
  const plain: CoinKey[] = ["pp", "gp", "sp", "cp"];
  const main = plain.find((k) => cp / CP[k] >= 3) ?? "cp";
  const change: CoinKey[] = plain.slice(plain.indexOf(main) + 1);
  if (change.includes("sp") && rng() < 0.15) change.splice(change.indexOf("sp"), 0, "ep");
  const out: Partial<Record<CoinKey, number>> = {};
  for (const k of [main, ...change]) {
    const n = Math.floor(cp / CP[k]);
    if (n > 0) { out[k] = n; cp -= n * CP[k]; }
  }
  return out;
}

/** Coins weigh a pound per fifty (PHB). */
export const coinWeightLb = (c: Partial<Record<CoinKey, number>>) => COIN_ORDER.reduce((n, k) => n + (c[k] ?? 0), 0) / 50;

export const coinText = (c: Partial<Record<CoinKey, number>>) => COIN_ORDER.filter((k) => c[k]).map((k) => `${c[k]!.toLocaleString("en-US")} ${k}`).join(", ");
export const coinValueGp = (c: Partial<Record<CoinKey, number>>) => COIN_ORDER.reduce((v, k) => v + (c[k] ?? 0) * CP[k] / 100, 0);

const crText = (cr: number) => (cr === 0.125 ? "1/8" : cr === 0.25 ? "1/4" : cr === 0.5 ? "1/2" : String(cr));
const gpText = (v: number) => (v >= 100 ? Math.round(v).toLocaleString("en-US") : v >= 10 ? v.toFixed(0) : v.toFixed(1));

/** The monster's purse: its expected share (expectedPurse), varied by 4d6 ÷ 14 (×0.3–×1.7), in a mix of coins. */
export function rollPurse(cr: number | undefined, e: Economy, rng: Rng, id = idMaker(rng)()): LootLine {
  const expected = expectedPurse(cr, e);
  const r = rollFormula("4d6", rng);
  const coins = coinMix(expected * r.total / 14, rng);
  const level = economyLevel(cr, e);
  const who = e.partyLevel !== undefined ? `a level ${level} party of ${Math.max(1, Math.round(e.partySize ?? 4))}` : `a level ${level} party of 4 (CR used as the level: no party in the scene)`;
  return {
    id, kind: "coins", text: coinText(coins),
    detail: `Worth ${gpText(coinValueGp(coins))} gp (${coinWeightLb(coins) < 1 ? "under 1 lb" : `${Math.round(coinWeightLb(coins) * 10) / 10} lb`}). Expected ${gpText(expected)} gp for CR ${crText(cr ?? 0)} against ${who}, `
      + `whose coin at this level is ~${gpText(partyIncome(level).hoardsAndQuests)} gp from hoards and quests plus ${Math.round(PURSE_SHARE * 100)}% from monsters, `
      + `shared by XP; varied by 4d6 (${r.dice.join(" + ")} = ${r.total}) ÷ 14`,
  };
}

/** DMG Magic Item Rarities: the highest d100 roll for each rarity, per band (0 = never). */
const RARITY_MAX: Record<Band, number[]> = {
  "0–4": [54, 91, 100, 0, 0],
  "5–10": [30, 81, 98, 100, 0],
  "11–16": [11, 34, 70, 93, 100],
  "17+": [0, 0, 20, 64, 100],
};

export function rarityFor(b: Band, d100: number): Rarity {
  const maxes = RARITY_MAX[b];
  const i = maxes.findIndex((m) => m > 0 && d100 <= m);
  return RARITIES[i < 0 ? RARITIES.length - 1 : i]!;
}

/** A magic item from a theme's table: d100 for rarity (by CR band), d100 on the table, and a variant when it lists several. */
export function rollMagicItem(theme: Theme, cr: number | undefined, rng: Rng, id = idMaker(rng)()): LootLine {
  const b = band(cr);
  const rRoll = rollFormula("1d100", rng).total;
  const rarity = rarityFor(b, rRoll);
  const iRoll = rollFormula("1d100", rng).total;
  const row = THEME_TABLES[theme][rarity].find((r) => iRoll >= r.min && iRoll <= r.max)!;
  const name = row.options ? row.options[Math.floor(rng() * row.options.length)]! : row.name;
  return { id, kind: "item", text: `${name} (${rarity})`, detail: `2024 DMG ${theme} – ${rarity}: rarity d100 ${rRoll} (CR ${b}), item d100 ${iRoll}` };
}

/** Adds a rolled magic item; picking a theme uses up that offer (one roll per monster). */
export function addRolled(loot: UnitLoot, line: LootLine, used: Theme): UnitLoot {
  const lines = [...loot.lines, line];
  // "Any" offers every theme but stands for one roll: picking one ends the choice.
  const { any: _, ...rest } = loot;
  return { ...rest, lines, themes: loot.any ? [] : loot.themes.filter((t) => t !== used) };
}

export function removeLine(loot: UnitLoot, id: string): UnitLoot {
  return { ...loot, lines: loot.lines.filter((l) => l.id !== id) };
}

export function markPosted(loot: UnitLoot, ids: string[]): UnitLoot {
  return { ...loot, lines: loot.lines.map((l) => (ids.includes(l.id) ? { ...l, posted: true } : l)) };
}

/** The roll log line: "Loot from Goblin Warrior: Scimitar, 11 gp" (with who took it, when the GM says). */
export function lootPostText(unitName: string, lines: LootLine[], takenBy?: string): string {
  const what = lines.map((l) => l.text).join(", ");
  return takenBy ? `${takenBy} takes ${what} from ${unitName}` : `Loot from ${unitName}: ${what}`;
}

/** "scimitar|xphb" or { item: "arrow|xphb", quantity: 20 } (5etools Gear) → "Scimitar", "Arrow ×20". */
export function gearName(g: unknown): string | null {
  const ref = typeof g === "string" ? g : typeof (g as any)?.item === "string" ? (g as any).item : null;
  if (!ref) return null;
  const name = ref.split("|")[0]!.trim().replace(/\b([a-z])/g, (c: string) => c.toUpperCase()).replace(/\b(Of|The|And)\b/g, (w: string) => w.toLowerCase());
  const q = Number((g as any)?.quantity);
  return q > 1 ? `${name} ×${q}` : name;
}

/** PHB weapons (2014 and 2024, firearms included) and armor, for creatures whose stat block has no Gear line. */
const WEAPONS = [
  "Club", "Dagger", "Greatclub", "Handaxe", "Javelin", "Light Hammer", "Mace", "Quarterstaff", "Sickle", "Spear", "Dart", "Light Crossbow",
  "Shortbow", "Sling", "Battleaxe", "Flail", "Glaive", "Greataxe", "Greatsword", "Halberd", "Lance", "Longsword", "Maul", "Morningstar",
  "Pike", "Rapier", "Scimitar", "Shortsword", "Trident", "War Pick", "Warhammer", "Whip", "Blowgun", "Hand Crossbow", "Heavy Crossbow",
  "Longbow", "Musket", "Pistol", "Net",
];
/** Longest names first, so "Studded Leather" wins over "Leather" and "Half Plate" over "Plate". */
const ARMOR: [RegExp, string][] = ([
  ["studded leather( armor)?", "Studded Leather Armor"], ["half plate( armor)?", "Half Plate Armor"], ["chain shirt", "Chain Shirt"],
  ["chain mail", "Chain Mail"], ["scale mail", "Scale Mail"], ["ring mail", "Ring Mail"], ["splint( armor)?", "Splint Armor"],
  ["breastplate", "Breastplate"], ["padded( armor)?", "Padded Armor"], ["leather( armor)?", "Leather Armor"], ["hide( armor)?", "Hide Armor"],
  ["plate( armor)?", "Plate Armor"], ["shields?", "Shield"],
] as [string, string][]).map(([re, name]) => [new RegExp(`\\b${re}\\b`, "i"), name]);

/** Armor named in a text ("leather armor, shield"), each piece once. */
function armorIn(text: string): string[] {
  let rest = text;
  const out: string[] = [];
  for (const [re, name] of ARMOR) if (re.test(rest)) { out.push(name); rest = rest.replace(re, " "); }
  return out;
}

/** "Scimitar", "Longsword (Two-Handed)", "Spear (Melee)" → the weapon; "Bite", "Bone Bow", "Multiattack" → none. */
function weaponOf(action: string): string | undefined {
  const base = action.replace(/\s*\(.*?\)\s*/g, " ").replace(/\s*\+\d+$/, "").trim().toLowerCase();
  return WEAPONS.find((w) => w.toLowerCase() === base);
}

/** What a creature without a Gear line visibly carries: the armor its AC names and the weapons it attacks with. */
export function inferGear(sheet: Partial<Pick<UnitSheet, "actions" | "acNote" | "flags">>): string[] {
  const acText = [sheet.acNote ?? "", ...(sheet.flags ?? []).filter((f) => f.startsWith("AC source:"))].join(", ");
  const weapons = (sheet.actions ?? []).map((a) => weaponOf(a.name)).filter((w): w is string => !!w);
  return [...new Set([...armorIn(acText), ...weapons])];
}

/** The 5etools fields loot reads, from a raw monster: `treasure` and `gear`. 2024 Monster Manual creatures without a
 *  Treasure line carry none (the book lists it for every creature that has some). */
export function lootFields(m: any): Pick<UnitSheet, "treasure" | "gear"> {
  const out: Pick<UnitSheet, "treasure" | "gear"> = {};
  if (Array.isArray(m?.treasure)) out.treasure = m.treasure.map(String);
  else if (String(m?.source).toUpperCase() === "XMM") out.treasure = [];
  const gear = Array.isArray(m?.gear) ? m.gear.map(gearName).filter((g: string | null): g is string => !!g) : [];
  if (gear.length) out.gear = gear;
  return out;
}

function idMaker(rng: Rng) {
  let n = 0;
  const salt = Math.floor(rng() * 36 ** 4).toString(36);
  return () => `loot-${salt}-${n++}`;
}
