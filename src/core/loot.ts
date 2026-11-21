/**
 * Suggested loot for a dead monster or NPC (never a party member or a D&D Beyond character).
 *  - Gear: what the 2024 Monster Manual stat block lists as Gear. Always found on the body.
 *  - Coins: the DMG Individual Treasure table for the creature's CR, for every creature with a Treasure line, and for
 *    those without one unless they're a kind of creature that carries nothing (Beast, Ooze, Plant…). 5E rooms roll on
 *    the 2014 table, 5.5E rooms on the 2024 one.
 *  - Magic items: themed Treasure lines (Arcana, Armaments, Implements, Relics) offer a roll on that 2024 DMG table; the
 *    GM decides whether to roll. "Any" lets the GM pick the theme. The rarity uses the DMG Magic Item
 *    Rarities table, reading the creature's CR band (0–4, 5–10, 11–16, 17+) as the table's level band.
 * Rolled once when the unit dies and kept on the unit (state.loot), so the card shows the same loot every time.
 */
import { rollFormula, type Rng } from "./dice";
import { INDIVIDUAL_2014, INDIVIDUAL_2024, THEME_TABLES, type CoinKey, type IndividualBand } from "./lootTables";
import type { UnitSheet, UnitState } from "./sheet";

export const THEMES = ["Arcana", "Armaments", "Implements", "Relics"] as const;
export type Theme = (typeof THEMES)[number];
export const RARITIES = ["Common", "Uncommon", "Rare", "Very Rare", "Legendary"] as const;
export type Rarity = (typeof RARITIES)[number];
export type LootRules = "2024" | "2014";

export interface LootLine {
  id: string;
  kind: "gear" | "coins" | "item";
  /** "Scimitar", "11 gp", "Cloak of Billowing (Common)". */
  text: string;
  /** How it was rolled, for the GM: "Individual Treasure, CR 0–4: 3d6 → 4 + 3 + 4". */
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

export function planLoot(sheet: LootSource, rules: LootRules, rng: Rng): UnitLoot {
  const ids = idMaker(rng);
  const gear = sheet.gear ?? inferGear(sheet);
  const lines: LootLine[] = gear.map((g) => ({ id: ids(), kind: "gear", text: g, detail: sheet.gear ? "Gear (stat block)" : "Carried (from its armor and attacks)" }));
  const tags = sheet.treasure?.map((t) => t.toLowerCase());
  const out: UnitLoot = { lines, themes: [] };
  // Without a Treasure line (or with an empty one), only creatures that could carry money have some.
  if (!tags?.length) {
    const t = sheet.type?.trim() ?? "";
    if (NO_TREASURE.test(t)) out.note = `${t.replace(/\s*\(.*\)$/, "")} creatures usually carry no treasure.`;
    else lines.push(rollCoins(sheet.cr, rules, rng, ids()));
    return out;
  }
  lines.push(rollCoins(sheet.cr, rules, rng, ids()));
  out.themes = THEMES.filter((th) => tags.includes(th.toLowerCase()));
  if (tags.includes("any")) { out.any = true; out.themes = [...THEMES]; }
  return out;
}

const COIN_ORDER: CoinKey[] = ["pp", "gp", "ep", "sp", "cp"];
/** Copper pieces per coin. */
const CP: Record<CoinKey, number> = { pp: 1000, gp: 100, ep: 50, sp: 10, cp: 1 };

/** "4d6*100" → rolled, multiplied. */
function rollCoinFormula(f: string, rng: Rng): { total: number; text: string } {
  const [dice, mult] = f.split("*");
  const r = rollFormula(dice!, rng);
  const m = mult ? Number(mult) : 1;
  return { total: r.total * m, text: `${dice} → ${r.dice.join(" + ")}${m !== 1 ? ` × ${m}` : ""}` };
}

/** Average of "4d6*100". */
function formulaAverage(f: string): number {
  const [dice, mult] = f.split("*");
  const m = /^(\d+)d(\d+)$/.exec(dice!.trim());
  return (m ? Number(m[1]) * (Number(m[2]) + 1) / 2 : Number(dice)) * (mult ? Number(mult) : 1);
}

/** A band's average value in gp (d100 rows weighted by their chance). */
function bandAverageGp(b: IndividualBand): number {
  return b.rows.reduce((sum, r) => sum + (r.max - r.min + 1) / 100
    * Object.entries(r.coins).reduce((v, [k, f]) => v + formulaAverage(f!) * CP[k as CoinKey] / 100, 0), 0);
}

function pickBand(table: IndividualBand[], cr: number | undefined): IndividualBand {
  const c = Math.max(0, cr ?? 0);
  return table.find((b) => c >= b.crMin && c <= b.crMax) ?? (c > 30 ? table[table.length - 1]! : table[0]!);
}

/** CRs above this get the same money (the curve would otherwise run past a whole DMG hoard). */
const MAX_SCALED_CR = 24;

/**
 * The DMG gives every CR in a band the same dice, so a CR 4 and a CR 0 carry the same and CR 5 jumps ninefold.
 * Butler keeps each band's average at the band's middle CR (2, 7.5, 13.5, 20) and follows a smooth curve between them
 * (log-linear, continued past both ends), so money grows steadily with CR. Returns the factor for this CR's roll.
 */
export function coinScale(cr: number | undefined, rules: LootRules): number {
  const table = rules === "2014" ? INDIVIDUAL_2014 : INDIVIDUAL_2024;
  const anchors = table.map((b) => ({ cr: b.crMax >= 30 ? 20 : (b.crMin + b.crMax) / 2, ln: Math.log(bandAverageGp(b)) }));
  const c = Math.min(MAX_SCALED_CR, Math.max(0, cr ?? 0));
  let i = anchors.findIndex((a) => c <= a.cr);
  i = i <= 0 ? 1 : i;
  if (c > anchors[anchors.length - 1]!.cr) i = anchors.length - 1;
  const a = anchors[i - 1]!, z = anchors[i]!;
  const target = Math.exp(a.ln + (z.ln - a.ln) * (c - a.cr) / (z.cr - a.cr));
  return target / bandAverageGp(pickBand(table, cr));
}

/** Scales an amount of one coin; too little for that coin is counted in smaller coins ("0.4 gp" → "4 sp"). */
function scaleCoin(amount: number, coin: CoinKey, factor: number): { k: CoinKey; n: number } | null {
  const cp = amount * CP[coin] * factor;
  for (const k of COIN_ORDER.slice(COIN_ORDER.indexOf(coin)).filter((x) => x !== "ep")) {
    if (cp >= CP[k]) return { k, n: Math.round(cp / CP[k]) };
  }
  return cp >= 0.5 ? { k: "cp", n: 1 } : null;
}

const crText = (cr: number) => (cr === 0.125 ? "1/8" : cr === 0.25 ? "1/4" : cr === 0.5 ? "1/2" : String(cr));

/** A roll on the DMG Individual Treasure table for this CR, scaled so money follows the CR (see coinScale). */
export function rollCoins(cr: number | undefined, rules: LootRules, rng: Rng, id = idMaker(rng)()): LootLine {
  const b = pickBand(rules === "2014" ? INDIVIDUAL_2014 : INDIVIDUAL_2024, cr);
  const d100 = b.rows.length > 1 ? rollFormula("1d100", rng).total : undefined;
  const row = d100 === undefined ? b.rows[0]! : b.rows.find((r) => d100 >= r.min && d100 <= r.max)!;
  const parts = COIN_ORDER.filter((k) => row.coins[k]).map((k) => ({ k, ...rollCoinFormula(row.coins[k]!, rng) }));
  const factor = coinScale(cr, rules);
  const found = new Map<CoinKey, number>();
  for (const p of parts) {
    const s = scaleCoin(p.total, p.k, factor);
    if (s) found.set(s.k, (found.get(s.k) ?? 0) + s.n);
  }
  if (!found.size) found.set("cp", 1);
  const label = `${rules === "2014" ? "2014" : "2024"} DMG Individual Treasure, CR ${b.crMax >= 30 ? `${b.crMin}+` : `${b.crMin}–${b.crMax}`}`;
  const rolled = parts.map((p) => `${p.text} = ${p.total.toLocaleString("en-US")} ${p.k}`).join("; ");
  return {
    id, kind: "coins",
    text: COIN_ORDER.filter((k) => found.has(k)).map((k) => `${found.get(k)!.toLocaleString("en-US")} ${k}`).join(", "),
    detail: `${label}${d100 !== undefined ? ` (d100 ${d100})` : ""}: ${rolled}; × ${factor < 10 ? factor.toFixed(2) : Math.round(factor)} for CR ${crText(cr ?? 0)}`,
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
