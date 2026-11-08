/**
 * Combat tab: encounter difficulty (2024 / "5.5e" DMG XP budgets, plus an invented Extreme tier for boss
 * fights) and initiative rolling for the Butler units already in the scene.
 */
import { BUTLER_ITEM_KEY, BUTLER_NS } from "./constants";
import { cryptoRng, resolveRollMode, rollInitiative, type Rng } from "./dice";
import { STATE_KEY, type UnitSheet, type UnitState } from "./sheet";
import { isUnitItem, readUnit } from "./unit";
import type { InitiativeSetup, SceneGateway, SceneItemLite } from "./importer";
import type { InitiativeRoll } from "./schema";

/** Per-token Combat settings, stored on the token so they persist and every GM tab sees them. */
export const COMBAT_KEY = `${BUTLER_NS}/combat`;
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
  /** In the initiative tracker. */
  onList: boolean;
  cr: number | null;
  /** Level used for the budget (setting, else sheet level, else guessed from CR); null if unknown. */
  level: number | null;
  levelSource: "set" | "sheet" | "cr" | null;
  exclude: boolean;
  initiative: number | null;
  setup: InitiativeSetup;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

export { isUnitItem };

/**
 * How to roll this token: recorded setup (import/party sync), else the stat block's initiative, else its last roll.
 * 2014 rules: creatures use their Dexterity modifier (2024 stat blocks add proficiency); advantage still applies.
 */
export function initiativeSetupFor(meta: Record<string, unknown>, sheet?: UnitSheet, state?: UnitState, rules: "2024" | "2014" = "2024"): InitiativeSetup {
  if (rules === "2014" && sheet?.kind === "creature") {
    return { modifier: Math.floor((sheet.abilities.dex - 10) / 2), advantage: sheet.initiative.advantage, disadvantage: sheet.initiative.disadvantage };
  }
  const rec = meta[BUTLER_ITEM_KEY] as { initiativeSetup?: InitiativeSetup } | undefined;
  if (rec?.initiativeSetup) return rec.initiativeSetup;
  if (sheet) return { modifier: sheet.initiative.modifier, advantage: sheet.initiative.advantage, disadvantage: sheet.initiative.disadvantage };
  const last = state?.initiativeRoll;
  if (last && typeof last.modifier === "number") return { modifier: last.modifier, advantage: last.mode === "advantage", disadvantage: last.mode === "disadvantage" };
  return { modifier: 0, advantage: false, disadvantage: false };
}

export function listCombatants(items: SceneItemLite[], rules: "2024" | "2014" = "2024"): Combatant[] {
  return items.filter(isUnitItem).flatMap((i) => {
    const m = i.metadata;
    const unit = readUnit(m);
    if (!unit) return [];
    const { sheet, state } = unit;
    const s = (m[COMBAT_KEY] as CombatSettings | undefined) ?? {};
    const party = state.party;
    const cr = num(sheet.cr);
    const sheetLevel = num(sheet.level);
    let level: number | null = null;
    let levelSource: Combatant["levelSource"] = null;
    if (party) {
      if (s.level) { level = s.level; levelSource = "set"; }
      else if (sheetLevel && sheetLevel > 0) { level = sheetLevel; levelSource = "sheet"; }
      else if (cr !== null) { level = clampLevel(Math.max(1, cr)); levelSource = "cr"; }
    }
    return [{
      id: i.id,
      name: i.label || i.name || sheet.name,
      party, onList: state.inEncounter, cr, level, levelSource,
      exclude: s.exclude === true,
      initiative: state.initiative,
      setup: initiativeSetupFor(m, sheet, state, rules),
    }];
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

/** Rolls initiative for every unit in the initiative tracker ("all") or only the non-party ones ("creatures"). */
export async function rollSceneInitiative(gw: SceneGateway, scope: "all" | "creatures", opts: { rng?: Rng; now?: () => Date; rules?: "2024" | "2014" } = {}): Promise<InitiativeReport> {
  if ((await gw.getRole()) !== "GM") throw new Error("Only the GM can roll initiative.");
  const rng = opts.rng ?? cryptoRng;
  const targets = listCombatants(await gw.getItems(), opts.rules).filter((c) => c.onList && (scope === "all" || !c.party));
  if (!targets.length) throw new Error(scope === "all" ? "No units in the initiative tracker." : "No creatures in the initiative tracker.");
  const rolled = targets.map((c) => ({
    id: c.id, name: c.name, party: c.party,
    roll: rollInitiative(c.setup.modifier, resolveRollMode(c.setup.advantage, c.setup.disadvantage), rng, "importer", opts.now),
  }));
  await gw.patchMetadata(rolled.map((r) => ({ id: r.id, key: STATE_KEY, patch: { initiative: r.roll.total, initiativeRoll: r.roll } satisfies Partial<UnitState> })));
  rolled.sort((a, b) => b.roll.total - a.roll.total || b.roll.modifier - a.roll.modifier);
  return { rolled };
}

// ------------------------------------------------------------------ 2014 rules (F9) + one shape for both systems

/** 2014 Dungeon Master's Guide, "XP Thresholds by Character Level" (Easy / Medium / Hard / Deadly), levels 1–20. */
export const XP_THRESHOLDS_2014: [number, number, number, number][] = [
  [25, 50, 75, 100], [50, 100, 150, 200], [75, 150, 225, 400], [125, 250, 375, 500], [250, 500, 750, 1100],
  [300, 600, 900, 1400], [350, 750, 1100, 1700], [450, 900, 1400, 2100], [550, 1100, 1600, 2400], [600, 1200, 1900, 2800],
  [800, 1600, 2400, 3600], [1000, 2000, 3000, 4500], [1100, 2200, 3400, 5100], [1250, 2500, 3800, 5700], [1400, 2800, 4300, 6400],
  [1600, 3200, 4800, 7200], [2000, 3900, 5900, 8800], [2100, 4200, 6300, 9500], [2400, 4900, 7300, 10900], [2800, 5700, 8500, 12700],
];

/**
 * 2014 DMG encounter multiplier: ×1 for one monster, ×1.5 for two, ×2 for 3–6, ×2.5 for 7–10, ×3 for 11–14, ×4 for 15+.
 * Fewer than 3 characters use the next higher multiplier (up to ×5), 6 or more the next lower (down to ×0.5).
 */
export function multiplier2014(monsters: number, characters: number): number {
  if (monsters <= 0) return 1;
  const steps = [0.5, 1, 1.5, 2, 2.5, 3, 4, 5];
  let i = monsters === 1 ? 1 : monsters === 2 ? 2 : monsters <= 6 ? 3 : monsters <= 10 ? 4 : monsters <= 14 ? 5 : 6;
  if (characters < 3) i++;
  else if (characters >= 6) i--;
  return steps[Math.max(0, Math.min(steps.length - 1, i))]!;
}

export interface ScaleStep { name: string; xp: number; cls: "low" | "moderate" | "high" | "extreme" }

/** Difficulty in one shape for both systems: the steps of the scale, the (adjusted) XP compared to them, the tier. */
export interface DifficultyView {
  rules: "2024" | "2014";
  /** XP compared to the scale (2014: adjusted by the multiplier). */
  xp: number;
  rawXp: number;
  multiplier: number;
  scale: ScaleStep[];
  tier: string | null;
  tierCls: ScaleStep["cls"] | null;
  belowFirst: boolean;
  warnings: string[];
}

export function difficulty2014(levels: number[], creatures: { name: string; cr: number }[]): DifficultyView {
  const t = levels.reduce((acc, l) => { const r = XP_THRESHOLDS_2014[clampLevel(l) - 1]!; return acc.map((v, i) => v + r[i]!); }, [0, 0, 0, 0]);
  const scale: ScaleStep[] = [
    { name: "Easy", xp: t[0]!, cls: "low" }, { name: "Medium", xp: t[1]!, cls: "moderate" },
    { name: "Hard", xp: t[2]!, cls: "high" }, { name: "Deadly", xp: t[3]!, cls: "extreme" },
  ];
  const rawXp = creatures.reduce((s, c) => s + xpForCr(c.cr), 0);
  const multiplier = multiplier2014(creatures.length, levels.length);
  const xp = Math.round(rawXp * multiplier);
  const base = encounterDifficulty(levels, creatures); // same warnings as 2024 (CR above the party, big groups)
  if (!levels.length || !creatures.length) return { rules: "2014", xp, rawXp, multiplier, scale, tier: null, tierCls: null, belowFirst: false, warnings: base.warnings };
  const reached = [...scale].reverse().find((s) => xp >= s.xp) ?? scale[0]!;
  return { rules: "2014", xp, rawXp, multiplier, scale, tier: reached.name, tierCls: reached.cls, belowFirst: xp < scale[0]!.xp, warnings: base.warnings };
}

export function difficulty2024(levels: number[], creatures: { name: string; cr: number }[]): DifficultyView {
  const d = encounterDifficulty(levels, creatures);
  const b = d.budgets;
  const scale: ScaleStep[] = [
    { name: "Low", xp: b.low, cls: "low" }, { name: "Moderate", xp: b.moderate, cls: "moderate" },
    { name: "High", xp: b.high, cls: "high" }, { name: "Extreme", xp: b.extreme, cls: "extreme" },
  ];
  return { rules: "2024", xp: d.xp, rawXp: d.xp, multiplier: 1, scale, tier: d.tier, tierCls: d.tier ? (d.tier.toLowerCase() as ScaleStep["cls"]) : null, belowFirst: d.belowLow, warnings: d.warnings };
}

/** The scene's difficulty under the room's rules (included party members vs non-excluded creatures). */
export function sceneDifficultyFor(cs: Combatant[], rules: "2024" | "2014"): DifficultyView & { missingLevels: string[]; missingCr: string[] } {
  const party = cs.filter((c) => c.party && !c.exclude);
  const foes = cs.filter((c) => !c.party && !c.exclude);
  const levels = party.flatMap((c) => (c.level ? [c.level] : []));
  const creatures = foes.flatMap((c) => (c.cr !== null ? [{ name: c.name, cr: c.cr }] : []));
  const d = rules === "2014" ? difficulty2014(levels, creatures) : difficulty2024(levels, creatures);
  return { ...d, missingLevels: party.filter((c) => !c.level).map((c) => c.name), missingCr: foes.filter((c) => c.cr === null).map((c) => c.name) };
}
