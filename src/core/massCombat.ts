/**
 * Mass combat, from Unearthed Arcana: Mass Combat (2017, playtest). Battles of hundreds of creatures run as units:
 *  - Each unit's Battle Rating (BR) comes from its creatures' CR; an attack is an opposed d20 + BR roll.
 *  - Morale (−10…+10, plus the commander's Charisma) sets a fixed initiative (10 + morale + Charisma: the text counts
 *    the commander's Charisma twice, and Butler follows it) and decides who flees.
 *  - A unit fills one 100 ft square; the battle scene's grid must be at least 100 ft per square.
 * House rule decided by the owner: a unit at BR 0 or below is removed at once (the UA never removes it).
 * The remaining gaps in the text and Butler's rulings are listed in docs/ROADMAP-MASS-COMBAT.md (A1–A13).
 * Pure; the DM Tools panel (extension/battlePanel.ts) and the background page (background/battle.ts) use it.
 */
import { BUTLER_NS } from "./constants";
import type { SheetEntry, SizeCode, UnitSheet } from "./sheet";

export const BATTLE_KEY = `${BUTLER_NS}/battle`;
export const BATTLE_UNIT_KEY = `${BUTLER_NS}/battle-unit`;

// ------------------------------------------------------------------ Battle Rating

/** Battle Rating by Challenge Rating: one creature of CR 2 or more. */
const BR_BY_CR: Record<number, number> = {
  2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 7: 6, 8: 8, 9: 10, 10: 12, 11: 16, 12: 18, 13: 22, 14: 26, 15: 30, 16: 34, 17: 38, 18: 42, 19: 46, 20: 50,
};
/** CR 1 or lower: +1 per this many creatures. */
const GROUP_SIZE: [number, number][] = [[1 / 8, 20], [1 / 4, 10], [1 / 2, 5], [1, 2]];

const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

/** The BR one creature of `cr` adds on its own (CR 2+). Above CR 20 the table stops; Butler goes on at +4 per CR (A12). */
export function creatureBr(cr: number): number {
  if (cr < 2) return 0;
  const whole = Math.floor(cr);
  return whole > 20 ? 50 + 4 * (whole - 20) : BR_BY_CR[whole] ?? 0;
}

/** How many creatures of `cr` give +1 together (CR 1/8 to 1), or null for CR 0 and CR 2+. */
export function groupSizeFor(cr: number): number | null {
  return GROUP_SIZE.find(([c]) => near(c, cr))?.[1] ?? null;
}

/** BR of `count` creatures of one CR. Small creatures give BR only in whole groups: 9 CR 1/2 creatures = +1. */
export function groupBr(cr: number, count: number): number {
  const n = Math.max(0, Math.floor(count));
  const per = groupSizeFor(cr);
  if (per) return Math.floor(n / per);
  return creatureBr(cr) * n;
}

export const crLabel = (cr: number) => near(cr, 1 / 8) ? "1/8" : near(cr, 1 / 4) ? "1/4" : near(cr, 1 / 2) ? "1/2" : String(cr);

// ------------------------------------------------------------------ units

/** soldier: fights on foot; rider: rides a mount (its own speed doesn't count); mount: carries riders (counts for speed, not for ranged). */
export type MemberRole = "soldier" | "rider" | "mount";
export interface Speeds { walk: number; fly?: number; swim?: number; climb?: number; burrow?: number }
export interface Member {
  name: string;
  cr: number;
  size: SizeCode;
  speed: Speeds;
  /** The longest maximum range of its at-will ranged attacks, in feet (0 = none). */
  rangeFt: number;
  count: number;
  role: MemberRole;
}
export interface Commander { name: string; cr: number; cha: number }

export const SPACE_MAX = 400;
export const SPACE_BY_SIZE: Record<string, number> = { T: 1, S: 1, M: 1, L: 4, H: 9, G: 16 };

/** Unit BR: every creature's BR, commander included, counted per CR group (the commander joins its CR's group). */
export function compositionBr(members: Member[], commander: Commander | null): number {
  const byCr = new Map<string, { cr: number; n: number }>();
  const add = (cr: number, n: number) => {
    const k = crLabel(cr);
    const g = byCr.get(k) ?? { cr, n: 0 };
    g.n += n;
    byCr.set(k, g);
  };
  for (const m of members) add(m.cr, m.count);
  if (commander) add(commander.cr, 1);
  return [...byCr.values()].reduce((s, g) => s + groupBr(g.cr, g.n), 0);
}

/** Space the unit takes toward its 400 limit. The commander doesn't count, and nor does a creature with no BR (CR 0). */
export function unitSpace(members: Member[]): number {
  return members.filter((m) => m.cr > 0).reduce((s, m) => s + (SPACE_BY_SIZE[m.size] ?? 1) * Math.max(0, m.count), 0);
}

const MODES = ["fly", "swim", "climb", "burrow"] as const;

/**
 * Unit speed: 10 × the lowest speed among its members, in feet per 1-minute round. Riders move on their mounts, so
 * their own speed is left out (A7); the commander moves with the unit (A11). A mode (fly, swim…) counts only if every
 * counted member has it.
 */
export function unitSpeed(members: Member[]): Speeds {
  const live = members.filter((m) => m.count > 0);
  const movers = live.filter((m) => m.role !== "rider");
  const counted = movers.length ? movers : live;
  if (!counted.length) return { walk: 0 };
  const out: Speeds = { walk: 10 * Math.min(...counted.map((m) => m.speed.walk)) };
  for (const k of MODES) if (counted.every((m) => (m.speed[k] ?? 0) > 0)) out[k] = 10 * Math.min(...counted.map((m) => m.speed[k]!));
  return out;
}

/**
 * The unit's maximum range in feet, or null if it can't attack at range: every member other than the commander needs an
 * at-will attack reaching 100 ft or more. Mounts carry riders and don't have to shoot (A11). The shortest wins.
 */
export function unitRange(members: Member[]): number | null {
  const shooters = members.filter((m) => m.count > 0 && m.role !== "mount");
  if (!shooters.length || shooters.some((m) => m.rangeFt < 100)) return null;
  return Math.min(...shooters.map((m) => m.rangeFt));
}

/** The members that stop the unit from attacking at range (for the builder's explanation). */
export const notRanged = (members: Member[]) => members.filter((m) => m.count > 0 && m.role !== "mount" && m.rangeFt < 100).map((m) => m.name);

// ------------------------------------------------------------------ morale

export const MORALE_ROWS = [-10, -8, -4, -2, 0, 2, 4, 8, 10] as const;
export const MORALE_LABELS: Record<number, string> = {
  [-10]: "Openly rebellious", [-8]: "Mutinous", [-4]: "Disgruntled", [-2]: "Shaky", 0: "The typical unit", 2: "Motivated", 4: "Stalwart", 8: "Fanatic", 10: "Unbreakable",
};
/** The UA's factors. Each is −1 (hurts morale: one row up the table), 0, or +1 (its reverse: one row down). */
export const MORALE_FACTORS = [
  { key: "treatment", worse: "poor treatment by a commander or allies", better: "good treatment" },
  { key: "animosity", worse: "animosity toward an allied unit", better: "trust in its allies" },
  { key: "pay", worse: "low or no pay", better: "good pay" },
  { key: "stake", worse: "no stake in the battle's outcome", better: "a real stake in the outcome" },
  { key: "commander", worse: "an incompetent or ill-prepared commander", better: "a capable commander" },
  { key: "foe", worse: "a daunting, overwhelming foe", better: "a foe it doesn't fear" },
  { key: "equipment", worse: "poor equipment", better: "fine equipment" },
] as const;
export type MoraleFactors = Partial<Record<(typeof MORALE_FACTORS)[number]["key"], -1 | 0 | 1>>;

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** Morale from the factors: start at 0 and shift one row per factor. */
export function moraleFromFactors(f: MoraleFactors): number {
  const shift = Object.values(f).reduce<number>((s, v) => s + (v ?? 0), 0);
  return MORALE_ROWS[clamp(4 + shift, 0, MORALE_ROWS.length - 1)]!;
}

/** The unit's morale rating: the base (factors or the GM's pick) plus the commander's Charisma, kept within −10…+10. */
export const unitMorale = (base: number, cha: number) => clamp(base + cha, -10, 10);

/** Fixed initiative: 10 + the unit's morale + the commander's Charisma modifier (counted twice, as written: A1). */
export const unitInitiative = (morale: number, cha: number) => 10 + morale + cha;

// ------------------------------------------------------------------ attacks and morale checks

export const HEAVY_MARGIN = 11;
export const LOSS_CASUALTIES = 2;
export const LOSS_HEAVY = 5;
export const DC_HEAVY = 10;
export const DC_CASUALTIES = 15;
export const DC_FRIENDLY = 10;
export const DC_DISENGAGE = 10;
export const FRIENDLY_RANGE_FT = 500;

export interface AttackOutcome { kind: "none" | "casualties" | "heavy"; margin: number; brLoss: number }

/** Opposed check: both roll d20 + BR. Tie or target higher: nothing; by 1–10: −2 BR; by 11+: −5 BR and a DC 10 morale check. */
export function attackOutcome(attackerTotal: number, targetTotal: number): AttackOutcome {
  const margin = attackerTotal - targetTotal;
  if (margin <= 0) return { kind: "none", margin, brLoss: 0 };
  if (margin < HEAVY_MARGIN) return { kind: "casualties", margin, brLoss: LOSS_CASUALTIES };
  return { kind: "heavy", margin, brLoss: LOSS_HEAVY };
}

export interface MoraleCheck { dc: number; why: string }

/**
 * What follows a loss of BR (from an attack, or creatures killed by characters and spells):
 *  - BR 0 or below: removed at once, no check (house rule, A3).
 *  - Heavy casualties: a DC 10 check (fail: flees).
 *  - First time at half its starting BR or less: a DC 15 check (fail: eliminated). Once per unit (A4), after the DC 10 one (A5).
 * Roll the checks in order and stop at the first failure.
 */
export function afterLoss(br: number, startBr: number, opts: { heavy: boolean; halfChecked: boolean }): { removed: boolean; checks: MoraleCheck[]; halfReached: boolean } {
  if (br <= 0) return { removed: true, checks: [], halfReached: true };
  const checks: MoraleCheck[] = [];
  if (opts.heavy) checks.push({ dc: DC_HEAVY, why: "heavy casualties" });
  const halfReached = br * 2 <= startBr;
  if (halfReached && !opts.halfChecked) checks.push({ dc: DC_CASUALTIES, why: "down to half its starting BR" });
  return { removed: false, checks, halfReached };
}

// ------------------------------------------------------------------ the map

export interface Cell { col: number; row: number }
/** Squares between two units (8 neighbours: diagonals count as adjacent, A8). */
export const cellDistance = (a: Cell, b: Cell) => Math.max(Math.abs(a.col - b.col), Math.abs(a.row - b.row));
export const adjacent = (a: Cell, b: Cell) => cellDistance(a, b) <= 1;
export const cellOf = (pos: { x: number; y: number }, dpi: number): Cell => ({ col: Math.floor(pos.x / dpi), row: Math.floor(pos.y / dpi) });

/** The battle scene's grid: square, in feet, at least 100 ft per square. Null when it's fine, otherwise why not. */
export function gridProblem(grid: { type: string; multiplier: number; unit: string }): string | null {
  if (grid.type !== "SQUARE") return "Mass combat needs a square grid.";
  if (!/^(ft|feet|foot|')$/i.test(grid.unit.trim())) return `The grid is measured in "${grid.unit}": set it to feet (100 ft per square).`;
  if (grid.multiplier < 100) return `The grid is ${grid.multiplier} ft per square: a unit fills 100 ft, so set the scene's grid to at least 100 ft.`;
  return null;
}

/** Squares a unit may move: it enters a square if it has at least half the square's movement left. */
export const squaresAllowed = (speedFt: number, scaleFt: number) => scaleFt > 0 ? Math.max(0, Math.floor(speedFt / scaleFt + 0.5)) : 0;

/** A unit on the map, as the rules need it. */
export interface FieldUnit { id: string; side: string; cell: Cell; removed: boolean; defending: boolean; range: number | null }

/** Whether `a` can attack `t`: adjacent (melee), or at range if the unit can shoot that far (centre to centre, A13). */
export function canAttack(a: FieldUnit, t: FieldUnit, scaleFt: number): { ok: boolean; how: "melee" | "ranged" | null; why: string } {
  if (a.side === t.side) return { ok: false, how: null, why: "same side" };
  const d = cellDistance(a.cell, t.cell);
  if (d <= 1) return { ok: true, how: "melee", why: "adjacent" };
  const ft = d * scaleFt;
  if (a.range === null) return { ok: false, how: null, why: `${ft} ft away and it can't attack at range` };
  if (ft > a.range) return { ok: false, how: null, why: `${ft} ft away, beyond its ${a.range} ft range` };
  return { ok: true, how: "ranged", why: `${ft} ft away (range ${a.range} ft)` };
}

export type RollMode = "normal" | "advantage" | "disadvantage";

/** Advantage and Disadvantage on the attacker's BR roll, with reasons. High ground and cover are the GM's call. */
export function attackFactors(a: FieldUnit, t: FieldUnit, all: FieldUnit[], gm: { highGround: boolean; cover: boolean }): { adv: string[]; dis: string[]; mode: RollMode } {
  const live = all.filter((u) => !u.removed && u.id !== t.id && adjacent(u.cell, t.cell));
  const adv: string[] = [], dis: string[] = [];
  if (gm.highGround) adv.push("higher ground");
  if (live.some((u) => u.side !== t.side && u.id !== a.id)) adv.push("the target is engaged by another enemy unit");
  if (gm.cover) dis.push("the target is behind cover");
  if (live.filter((u) => u.side === t.side).length >= 2) dis.push("the target is next to two or more of its own units");
  if (t.defending) dis.push("the target is defending");
  const mode: RollMode = adv.length && !dis.length ? "advantage" : dis.length && !adv.length ? "disadvantage" : "normal";
  return { adv, dis, mode };
}

/** Same-side units within 500 ft of a removed unit: each makes a DC 10 morale check (fail: can't move or act next turn). */
export function friendlyCheckIds(removed: FieldUnit, all: FieldUnit[], scaleFt: number): string[] {
  return all.filter((u) => !u.removed && u.id !== removed.id && u.side === removed.side && cellDistance(u.cell, removed.cell) * scaleFt <= FRIENDLY_RANGE_FT).map((u) => u.id);
}

// ------------------------------------------------------------------ records

export interface BattleUnit {
  v: 1;
  name: string;
  side: string;
  members: Member[];
  commander: Commander;
  /** Morale before the commander's Charisma: from the factors, or the GM's pick. */
  moraleBase: number;
  factors?: MoraleFactors;
  /** BR when the battle started (or when it joined a running battle). */
  startBr: number | null;
  /** BR lost to attacks (the −2 / −5 results). Creatures killed come out of `members` instead (A2). */
  brLost: number;
  /** The DC 15 half-strength check has been made. */
  halfChecked: boolean;
  removed: null | { round: number; why: string };
  /** Attacks against it have Disadvantage until the end of its turn in this round. */
  defendUntil?: number;
  /** It can't move or act on its turn in this round. */
  shakenRound?: number;
  /** Guarding since its turn in this round (until used or its next turn). */
  guardRound?: number;
  /** Characters (party token ids) fighting from inside the unit. */
  characters: string[];
  /** A player who commands this unit (house extension, off unless the GM sets it). */
  commandedBy?: string;
  /** Random tie-breaker, drawn once when the unit is made (the UA: ties ordered randomly, once). */
  tie: number;
}

export const unitBrNow = (u: Pick<BattleUnit, "members" | "commander" | "brLost">) => compositionBr(u.members, u.commander) - u.brLost;
export const unitMoraleOf = (u: Pick<BattleUnit, "moraleBase" | "commander">) => unitMorale(u.moraleBase, u.commander.cha);
export const unitInitiativeOf = (u: Pick<BattleUnit, "moraleBase" | "commander">) => unitInitiative(unitMoraleOf(u), u.commander.cha);

const num = (x: unknown, d = 0) => (typeof x === "number" && Number.isFinite(x) ? x : d);
const str = (x: unknown, d = "") => (typeof x === "string" ? x : d);

function readMember(x: any): Member | null {
  if (!x || typeof x !== "object") return null;
  const role: MemberRole = x.role === "rider" || x.role === "mount" ? x.role : "soldier";
  const sp = x.speed && typeof x.speed === "object" ? x.speed : {};
  const speed: Speeds = { walk: num(sp.walk) };
  for (const k of MODES) if (num(sp[k]) > 0) speed[k] = num(sp[k]);
  return { name: str(x.name, "Creature"), cr: num(x.cr), size: (str(x.size, "M") in SPACE_BY_SIZE ? x.size : "M") as SizeCode, speed, rangeFt: num(x.rangeFt), count: Math.max(0, Math.floor(num(x.count))), role };
}

export function readBattleUnit(meta: Record<string, unknown>): BattleUnit | null {
  const x = meta[BATTLE_UNIT_KEY] as any;
  if (!x || x.v !== 1) return null;
  const c = x.commander && typeof x.commander === "object" ? x.commander : {};
  return {
    v: 1, name: str(x.name, "Unit"), side: str(x.side, "Side A"),
    members: Array.isArray(x.members) ? x.members.map(readMember).filter((m: Member | null): m is Member => !!m) : [],
    commander: { name: str(c.name, "Commander"), cr: num(c.cr), cha: num(c.cha) },
    moraleBase: clamp(num(x.moraleBase), -10, 10), factors: x.factors && typeof x.factors === "object" ? x.factors : undefined,
    startBr: typeof x.startBr === "number" ? x.startBr : null, brLost: num(x.brLost), halfChecked: x.halfChecked === true,
    removed: x.removed && typeof x.removed === "object" ? { round: num(x.removed.round), why: str(x.removed.why) } : null,
    defendUntil: typeof x.defendUntil === "number" ? x.defendUntil : undefined,
    shakenRound: typeof x.shakenRound === "number" ? x.shakenRound : undefined,
    guardRound: typeof x.guardRound === "number" ? x.guardRound : undefined,
    characters: Array.isArray(x.characters) ? x.characters.filter((s: unknown): s is string => typeof s === "string") : [],
    commandedBy: typeof x.commandedBy === "string" ? x.commandedBy : undefined,
    tie: num(x.tie, 0.5),
  };
}

export interface BattleLine { /** What players may read: words, no numbers. */ pub: string; /** The GM's version, with the rolls. */ gm?: string }
export interface CriticalEvent { id: string; text: string; success: string; failure: string; status: "open" | "success" | "failure" }

export interface BattleState {
  v: 1;
  active: boolean;
  round: number;
  turnId: string | null;
  /** Players see the battle's dice (they'd reveal BR). Off by default: players read the results in words. */
  publicRolls: boolean;
  /** Players who command a unit see its BR and morale (house extension). */
  showCommandedBr: boolean;
  /** The current turn: where the unit started, and the action it took. */
  turn: { startCell?: Cell; action?: "attack" | "dash" | "defend" | "disengage" | "guard"; disengaged?: boolean };
  events: CriticalEvent[];
  log: BattleLine[];
}

export const NEW_BATTLE: BattleState = { v: 1, active: false, round: 0, turnId: null, publicRolls: false, showCommandedBr: false, turn: {}, events: [], log: [] };
export const BATTLE_LOG_MAX = 40;

export function readBattle(meta: Record<string, unknown>): BattleState {
  const b = meta[BATTLE_KEY] as any;
  if (!b || b.v !== 1) return { ...NEW_BATTLE, turn: {}, events: [], log: [] };
  return {
    v: 1, active: b.active === true, round: num(b.round), turnId: typeof b.turnId === "string" ? b.turnId : null,
    publicRolls: b.publicRolls === true, showCommandedBr: b.showCommandedBr === true,
    turn: b.turn && typeof b.turn === "object" ? b.turn : {},
    events: Array.isArray(b.events) ? b.events.filter((e: any) => e && typeof e.id === "string") : [],
    log: Array.isArray(b.log) ? b.log.filter((l: any) => l && typeof l.pub === "string") : [],
  };
}

export const withBattleLog = (b: BattleState, ...lines: BattleLine[]): BattleState => ({ ...b, log: [...b.log, ...lines].slice(-BATTLE_LOG_MAX) });

// ------------------------------------------------------------------ turns

export interface OrderedUnit { id: string; unit: BattleUnit }

/** Turn order: higher initiative first; ties by the random draw made once per unit. Removed units are left out. */
export function battleOrder<T extends OrderedUnit>(units: T[]): T[] {
  return units.filter((u) => !u.unit.removed)
    .sort((a, b) => unitInitiativeOf(b.unit) - unitInitiativeOf(a.unit) || b.unit.tie - a.unit.tie || a.id.localeCompare(b.id));
}

export function startBattle(b: BattleState, order: OrderedUnit[]): BattleState {
  return { ...b, active: true, round: 1, turnId: order[0]?.id ?? null, turn: {} };
}

/** The next unit in the order (wrapping into a new round). Null when nobody is left. */
export function nextBattleTurn(b: BattleState, order: OrderedUnit[], allIds: string[]): { round: number; turnId: string | null } {
  if (!order.length) return { round: b.round, turnId: null };
  const ids = order.map((u) => u.id);
  let i = b.turnId ? ids.indexOf(b.turnId) : -1;
  if (i < 0 && b.turnId) {
    // The active unit left the order (removed): continue from where it stood among every unit's initiative.
    const at = allIds.indexOf(b.turnId);
    const after = allIds.slice(at + 1).find((id) => ids.includes(id));
    if (after) return { round: b.round, turnId: after };
    return { round: b.round + 1, turnId: ids[0]! };
  }
  i += 1;
  return i >= ids.length ? { round: b.round + 1, turnId: ids[0]! } : { round: b.round, turnId: ids[i]! };
}

export function previousBattleTurn(b: BattleState, order: OrderedUnit[]): { round: number; turnId: string | null } {
  if (!order.length) return { round: b.round, turnId: null };
  const ids = order.map((u) => u.id);
  const i = b.turnId ? ids.indexOf(b.turnId) : 0;
  if (i > 0) return { round: b.round, turnId: ids[i - 1]! };
  return b.round > 1 ? { round: b.round - 1, turnId: ids.at(-1)! } : { round: b.round, turnId: ids[0]! };
}

/** Flags that end when `u`'s turn in `round` ends: Defend taken last turn, and being Shaken this turn. */
export function atTurnEnd(u: BattleUnit, round: number): Partial<BattleUnit> {
  const patch: Partial<BattleUnit> = {};
  if (u.defendUntil !== undefined && u.defendUntil <= round) patch.defendUntil = undefined;
  if (u.shakenRound !== undefined && u.shakenRound <= round) patch.shakenRound = undefined;
  return patch;
}

/** Guard ends at the start of the unit's next turn if it wasn't used. */
export function atTurnStart(u: BattleUnit, round: number): Partial<BattleUnit> {
  return u.guardRound !== undefined && u.guardRound < round ? { guardRound: undefined } : {};
}

/** The round in which `targetId` takes its next turn, seen from the active unit's turn in `round`. */
export function nextTurnRound(targetId: string, activeId: string | null, order: { id: string }[], round: number): number {
  const ids = order.map((u) => u.id);
  const t = ids.indexOf(targetId), a = activeId ? ids.indexOf(activeId) : -1;
  return t > a ? round : round + 1;
}

/** Each side's units still in the battle, and the BR they have left. */
export function sideStrength(units: OrderedUnit[]): { side: string; units: number; br: number; removed: number }[] {
  const sides = new Map<string, { side: string; units: number; br: number; removed: number }>();
  for (const { unit } of units) {
    const s = sides.get(unit.side) ?? { side: unit.side, units: 0, br: 0, removed: 0 };
    if (unit.removed) s.removed++;
    else { s.units++; s.br += unitBrNow(unit); }
    sides.set(unit.side, s);
  }
  return [...sides.values()];
}

// ------------------------------------------------------------------ from stat blocks

/** At-will (no Recharge, no uses per day) ranged attacks on a sheet: the longest maximum range, in feet. */
export function sheetRangeFt(sheet: Pick<UnitSheet, "actions">): number {
  let best = 0;
  for (const e of sheet.actions as SheetEntry[]) {
    if (/recharge|\/day|\bper day\b/i.test(`${e.name} ${e.text.slice(0, 60)}`)) continue;
    if (!/ranged/i.test(e.text)) continue;
    for (const m of e.text.matchAll(/range (\d+)(?:\s*\/\s*(\d+))?\s*(?:ft|feet)/gi)) best = Math.max(best, Number(m[2] ?? m[1]));
  }
  return best;
}

/** A unit member from a creature's sheet. */
export function memberFromSheet(sheet: UnitSheet, count = 1, role: MemberRole = "soldier"): Member {
  const speed: Speeds = { walk: sheet.speed.walk };
  for (const k of MODES) if ((sheet.speed[k] ?? 0) > 0) speed[k] = sheet.speed[k]!;
  return { name: sheet.name, cr: sheet.cr ?? 0, size: sheet.size, speed, rangeFt: sheetRangeFt(sheet), count, role };
}

/** Groups creature sheets (e.g. selected tokens) into members by name and CR. */
export function membersFromSheets(sheets: UnitSheet[]): Member[] {
  const out: Member[] = [];
  for (const s of sheets) {
    const m = out.find((x) => x.name === s.name && near(x.cr, s.cr ?? 0));
    if (m) m.count++;
    else out.push(memberFromSheet(s));
  }
  return out;
}

/** Removes `n` creatures named `name` (casualties from characters or spells). */
export function removeCreatures(members: Member[], name: string, n: number): Member[] {
  return members.map((m) => (m.name === name ? { ...m, count: Math.max(0, m.count - Math.max(0, Math.floor(n))) } : m));
}

/** A one-line summary for the GM. */
export function unitSummary(u: BattleUnit): string {
  const sp = unitSpeed(u.members);
  const modes = MODES.filter((k) => sp[k]).map((k) => `${k} ${sp[k]} ft`);
  const range = unitRange(u.members);
  return `BR ${unitBrNow(u)}${u.startBr !== null ? `/${u.startBr}` : ""} · ${unitSpace(u.members)}/${SPACE_MAX} · ${sp.walk} ft${modes.length ? `, ${modes.join(", ")}` : ""} · ${range ? `ranged ${range} ft` : "melee"} · morale ${fmt(unitMoraleOf(u))} · init ${unitInitiativeOf(u)}`;
}

/** What players read about a unit: its creatures, not its numbers. */
export function unitMakeup(u: Pick<BattleUnit, "members" | "commander">): string {
  const live = u.members.filter((m) => m.count > 0).map((m) => m.name);
  return `${live.join(", ") || "no creatures left"}; led by ${u.commander.name}`;
}

/** Strength in words for players, from the share of starting BR left. */
export function strengthWords(u: BattleUnit): string {
  if (u.removed) return u.removed.why;
  if (u.startBr === null || u.startBr <= 0) return "ready";
  const left = unitBrNow(u) / u.startBr;
  return left >= 0.99 ? "unhurt" : left > 0.5 ? "bloodied ranks" : "badly mauled";
}

const fmt = (n: number) => (n >= 0 ? `+${n}` : String(n));
export const fmtBonus = fmt;

/** Problems with a unit as built. */
export function unitWarnings(u: Pick<BattleUnit, "members" | "commander">): string[] {
  const w: string[] = [];
  const space = unitSpace(u.members);
  if (space > SPACE_MAX) w.push(`Takes ${space} space: a unit holds at most ${SPACE_MAX} (Large 4, Huge 9, Gargantuan 16). Split it.`);
  if (!u.members.some((m) => m.count > 0)) w.push("No creatures yet.");
  for (const m of u.members) if (m.count > 0 && m.cr <= 0) w.push(`${m.name}: CR 0 gives no BR and doesn't count toward the unit.`);
  for (const m of u.members) {
    const per = groupSizeFor(m.cr);
    if (per && m.count % per) w.push(`${m.name}: CR ${crLabel(m.cr)} gives +1 per ${per}; the last ${m.count % per} add nothing.`);
  }
  if (u.members.some((m) => m.role === "rider") && !u.members.some((m) => m.role === "mount")) w.push("Riders without mounts: mark their mounts as a member.");
  return w;
}

// ------------------------------------------------------------------ what players see

export interface PlayerBattleRow { id: string; name: string; side: string; makeup: string; status: string; active: boolean; numbers?: string; mine: boolean }

/**
 * The battle as a player sees it: visible units only, their creatures and how they're doing in words. BR and morale
 * only for a unit the player commands, and only if the GM allows it (house extension). The log's public half only.
 */
export function playerBattleView(units: { id: string; visible: boolean; unit: BattleUnit }[], b: BattleState, viewerId: string): { round: number; active: boolean; rows: PlayerBattleRow[]; log: string[] } {
  const rows = battleOrder(units.filter((u) => u.visible).map((u) => ({ ...u, unit: { ...u.unit, removed: null } })))
    .map(({ id }) => units.find((u) => u.id === id)!)
    .map(({ id, unit }): PlayerBattleRow => {
      const mine = unit.commandedBy === viewerId;
      const flags = [unit.defendUntil !== undefined ? "defending" : "", unit.guardRound !== undefined ? "guarding" : "", unit.shakenRound !== undefined ? "shaken" : ""].filter(Boolean);
      return {
        id, name: unit.name, side: unit.side, makeup: unitMakeup(unit), mine, active: b.active && b.turnId === id,
        status: [strengthWords(unit), ...flags].join(", "),
        numbers: mine && b.showCommandedBr && !unit.removed ? `BR ${unitBrNow(unit)}, morale ${fmt(unitMoraleOf(unit))}` : undefined,
      };
    });
  return { round: b.round, active: b.active, rows, log: b.log.map((l) => l.pub).filter(Boolean) };
}
