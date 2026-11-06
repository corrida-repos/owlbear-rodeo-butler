/**
 * Combat tab: encounter difficulty (2024 / "5.5e" DMG XP budgets, plus an invented Extreme tier for boss
 * fights) and initiative rolling for the Forge units already in the scene.
 */
import { BUTLER_ITEM_KEY, BUTLER_NS, FORGE_KEYS } from "./constants";
import { cryptoRng, resolveRollMode, rollInitiative, type Rng } from "./dice";
import { forgeKey } from "./forge";
import type { InitiativeSetup, SceneGateway, SceneItemLite } from "./importer";
import type { InitiativeRoll } from "./schema";

/** Per-token Combat settings, stored on the token so they persist and every GM tab sees them. */
export const COMBAT_KEY = `${BUTLER_NS}/combat`;
/** Last initiative rolled from the Combat tab. */
export const INIT_KEY = `${BUTLER_NS}/initiative`;
export interface CombatSettings { exclude?: boolean; level?: number }

// ------------------------------------------------------------------ XP tables

/** XP by challenge rating (same in the 2014 and 2024 rules; CR 0 counted as 10 XP). */
export const XP_BY_CR: Record<string, number> = {
  "0": 10, "0.125": 25, "0.25": 50, "0.5": 100, "1": 200, "2": 450, "3": 700, "4": 1100, "5": 1800, "6": 2300, "7": 2900,
  "8": 3900, "9": 5000, "10": 5900, "11": 7200, "12": 8400, "13": 10000, "14": 11500, "15": 13000, "16": 15000,
  "17": 18000, "18": 20000, "19": 22000, "20": 25000, "21": 33000, "22": 41000, "23": 50000, "24": 62000,
  "25": 75000, "26": 90000, "27": 105000, "28": 120000, "29": 135000, "30": 155000,
};
export const xpForCr = (cr: number): number => XP_BY_CR[String(cr)] ?? 0;
export const crLabel = (cr: number) => (cr === 0.125 ? "1/8" : cr === 0.25 ? "1/4" : cr === 0.5 ? "1/2" : String(cr));

/** 2024 Dungeon Master's Guide, "XP Budget per Character" (Low / Moderate / High), levels 1–20. */
export const XP_BUDGET_2024: [number, number, number][] = [
  [50, 75, 100], [100, 150, 200], [150, 225, 400], [250, 375, 500], [500, 750, 1100],
  [600, 1000, 1400], [750, 1300, 1700], [1000, 1700, 2100], [1300, 2000, 2600], [1600, 2300, 3100],
  [1900, 2900, 4100], [2200, 3700, 4700], [2600, 4200, 5400], [2900, 4900, 6200], [3300, 5400, 7800],
  [3800, 6100, 9800], [4500, 7200, 11700], [5000, 8700, 14200], [5500, 10700, 17200], [6400, 13200, 22000],
];
/** Invented tier (not in the DMG): a boss-level fight, at 1.5× the High budget. */
export const EXTREME_FACTOR = 1.5;

export type Tier = "Low" | "Moderate" | "High" | "Extreme";
export interface Budgets { low: number; moderate: number; high: number; extreme: number }
export interface Difficulty {
  xp: number;
  budgets: Budgets;
  /** Highest tier whose budget the encounter reaches; null when there is nothing to compare. */
  tier: Tier | null;
  /** The encounter spends less than even the Low budget. */
  belowLow: boolean;
  warnings: string[];
}

const clampLevel = (l: number) => Math.min(20, Math.max(1, Math.round(l)));

export function partyBudgets(levels: number[]): Budgets {
  const b = { low: 0, moderate: 0, high: 0, extreme: 0 };
  for (const l of levels) {
    const [low, mod, high] = XP_BUDGET_2024[clampLevel(l) - 1]!;
    b.low += low; b.moderate += mod; b.high += high; b.extreme += Math.round(high * EXTREME_FACTOR);
  }
  return b;
}

export function encounterDifficulty(levels: number[], creatures: { name: string; cr: number }[]): Difficulty {
  const budgets = partyBudgets(levels);
  const xp = creatures.reduce((s, c) => s + xpForCr(c.cr), 0);
  const warnings: string[] = [];
  if (!levels.length || !creatures.length) return { xp, budgets, tier: null, belowLow: false, warnings };
  const tier: Tier = xp >= budgets.extreme ? "Extreme" : xp >= budgets.high ? "High" : xp >= budgets.moderate ? "Moderate" : "Low";
  const avg = levels.reduce((s, l) => s + clampLevel(l), 0) / levels.length;
  for (const c of creatures) if (c.cr > avg) warnings.push(`${c.name} (CR ${crLabel(c.cr)}) is above the party's average level (${Math.round(avg * 10) / 10}). One big hit from it can drop a character.`);
  if (creatures.length > levels.length * 2) warnings.push(`${creatures.length} hostile creatures against ${levels.length} characters: large groups get many more attacks than the XP suggests.`);
  return { xp, budgets, tier, belowLow: xp < budgets.low, warnings };
}

// ------------------------------------------------------------------ combatants in the scene

export interface Combatant {
  id: string;
  name: string;
  party: boolean;
  /** In Forge's tracker. */
  onList: boolean;
  cr: number | null;
  /** Level used for the budget (setting, else Forge level, else guessed from CR); null if unknown. */
  level: number | null;
  levelSource: "set" | "sheet" | "cr" | null;
  exclude: boolean;
  initiative: number | null;
  setup: InitiativeSetup;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

export const isForgeUnit = (i: SceneItemLite) =>
  i.layer === "CHARACTER" && i.type === "IMAGE" && (FORGE_KEYS.UNIT_NAME in i.metadata || FORGE_KEYS.FABRICATED in i.metadata || forgeKey("Z005") in i.metadata);

/** How to roll this token: recorded setup, else its last recorded roll, else its Forge Dexterity. */
export function initiativeSetupFor(meta: Record<string, unknown>): InitiativeSetup {
  const rec = meta[BUTLER_ITEM_KEY] as { initiativeSetup?: InitiativeSetup; initiative?: InitiativeRoll } | undefined;
  if (rec?.initiativeSetup) return rec.initiativeSetup;
  const last = (meta[INIT_KEY] as InitiativeRoll | undefined) ?? rec?.initiative;
  if (last && typeof last.modifier === "number") return { modifier: last.modifier, advantage: last.mode === "advantage", disadvantage: last.mode === "disadvantage" };
  const dex = num(meta[forgeKey("Z018")]);
  return { modifier: dex === null ? 0 : Math.floor((dex - 10) / 2), advantage: false, disadvantage: false };
}

export function listCombatants(items: SceneItemLite[]): Combatant[] {
  return items.filter(isForgeUnit).map((i) => {
    const m = i.metadata;
    const s = (m[COMBAT_KEY] as CombatSettings | undefined) ?? {};
    const party = m[FORGE_KEYS.IN_PARTY] === true;
    const cr = num(m[forgeKey("Z016")]);
    const sheetLevel = num(m[forgeKey("Z001")]);
    let level: number | null = null;
    let levelSource: Combatant["levelSource"] = null;
    if (party) {
      if (s.level) { level = s.level; levelSource = "set"; }
      else if (sheetLevel && sheetLevel > 0) { level = sheetLevel; levelSource = "sheet"; }
      else if (cr !== null) { level = clampLevel(Math.max(1, cr)); levelSource = "cr"; }
    }
    return {
      id: i.id,
      name: i.label || (m[FORGE_KEYS.UNIT_NAME] as string | undefined) || i.name,
      party, onList: m[FORGE_KEYS.ON_LIST] !== false, cr, level, levelSource,
      exclude: s.exclude === true,
      initiative: num(m[FORGE_KEYS.INITIATIVE]),
      setup: initiativeSetupFor(m),
    };
  }).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

/** Difficulty of the scene as the Combat tab shows it: included party members vs non-excluded creatures. */
export function sceneDifficulty(cs: Combatant[]): Difficulty & { missingLevels: string[]; missingCr: string[] } {
  const party = cs.filter((c) => c.party && !c.exclude);
  const foes = cs.filter((c) => !c.party && !c.exclude);
  const d = encounterDifficulty(party.flatMap((c) => (c.level ? [c.level] : [])), foes.flatMap((c) => (c.cr !== null ? [{ name: c.name, cr: c.cr }] : [])));
  return { ...d, missingLevels: party.filter((c) => !c.level).map((c) => c.name), missingCr: foes.filter((c) => c.cr === null).map((c) => c.name) };
}

// ------------------------------------------------------------------ settings + initiative

export async function setCombatSettings(gw: SceneGateway, id: string, patch: CombatSettings) {
  const item = (await gw.getItems()).find((i) => i.id === id);
  if (!item) throw new Error("That token is no longer in the scene.");
  const cur = (item.metadata[COMBAT_KEY] as CombatSettings | undefined) ?? {};
  await gw.updateMetadata([{ id, metadata: { [COMBAT_KEY]: { ...cur, ...patch } } }]);
}

export interface InitiativeReport { rolled: { id: string; name: string; party: boolean; roll: InitiativeRoll }[] }

/** Rolls initiative for every unit in Forge's tracker ("all") or only the non-party ones ("creatures"). */
export async function rollSceneInitiative(gw: SceneGateway, scope: "all" | "creatures", opts: { rng?: Rng; now?: () => Date } = {}): Promise<InitiativeReport> {
  if ((await gw.getRole()) !== "GM") throw new Error("Only the GM can roll initiative.");
  const rng = opts.rng ?? cryptoRng;
  const targets = listCombatants(await gw.getItems()).filter((c) => c.onList && (scope === "all" || !c.party));
  if (!targets.length) throw new Error(scope === "all" ? "No units in the Forge tracker." : "No creatures in the Forge tracker.");
  const rolled = targets.map((c) => ({
    id: c.id, name: c.name, party: c.party,
    roll: rollInitiative(c.setup.modifier, resolveRollMode(c.setup.advantage, c.setup.disadvantage), rng, "importer", opts.now),
  }));
  await gw.updateMetadata(rolled.map((r) => ({ id: r.id, metadata: { [FORGE_KEYS.INITIATIVE]: r.roll.total, [INIT_KEY]: r.roll } })));
  rolled.sort((a, b) => b.roll.total - a.roll.total || b.roll.modifier - a.roll.modifier);
  return { rolled };
}
