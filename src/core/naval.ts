/**
 * Naval and aerial combat (room setting, off by default). Pure rules; the DM Tools panel (extension/navalPanel.ts) and
 * the background page (background/naval.ts) run them. Sources, all from 5etools:
 *
 * Ships (Ghosts of Saltmarsh appendix A "Ship Stat Blocks", "Ships in Combat", "Officers and Crew", "Travel at Sea"):
 * - A ship is made of components (hull, controls, movement, weapons), each with AC and HP; the hull (and a naval ram)
 *   has a damage threshold. A component at 0 HP is destroyed; the ship is wrecked when its hull is. Ships are immune to
 *   Poison and Psychic damage. A movement component loses speed as it's damaged (e.g. −5 ft per 25 damage).
 * - A ship rolls initiative with its Dexterity plus its crew's quality score. On its turn its captain picks its actions
 *   (Move, Fire Ballistas…), each once per turn; how many depends on how many crew it has left.
 * - Officers (captain, first mate, bosun) can Take Aim (a weapon within 10 ft gets Advantage on its next attack before
 *   the end of the ship's next turn) and Full Speed Ahead (+d6 × 5 ft until the end of the ship's next turn, not stacking).
 * - Crew quality goes from −10 to +10 (starts at +4). The crew's passive Perception is 10 + quality. An area spell kills
 *   1d6 crew per spell level. Mutiny: when quality is below 0, a captain's Charisma check + quality of 0 or lower.
 * - Crashing (GoS): a ship that moves into a creature or object at least two sizes smaller doesn't crash. Otherwise it
 *   makes a DC 10 Constitution save or takes damage by the size of what it hit (a naval ram gives Advantage and takes the
 *   damage instead); it stops if that is no more than one size smaller. A creature struck makes a Dexterity save
 *   (DC 10 + the ship's Strength modifier), taking damage by the ship's size, half on a success.
 * - Fire aboard: a group check (captain, first mate, bosun, surgeon, the crew) every 5 minutes until it's out.
 * - Bosun's repair (end of the day): Strength check with carpenter's tools; 15+: each damaged component regains 1d6 +
 *   quality (at least 1), and destroyed components (not the hull) work again.
 *
 * Spelljammers and elemental airships (Astral Adventurer's Guide "Ship-to-Ship Combat", "Crashing", "Ship Repairs";
 * Eberron: Forge of the Artificer airships): crew operate stations on their own turns (load, aim and fire weapons take
 * the actions the stat block lists); the pilot moves the ship up to its speed on their turn. Crashing: the pilot makes an
 * attack (d20 + their Proficiency Bonus) against the target's AC; on a hit both take damage by the size of what was hit,
 * and the ship stops against something Gargantuan or immovable. Starting distance: 250, 500 or 1,000 feet.
 *
 * Elemental airships (Eberron: Forge of the Artificer, chapter 7 "Operating an Airship", "Airships in Combat"): crew
 * stations with their own AC and HP; the pilot needs the Mark of Storm; a suppressed core leaves Fly 5 ft (hovering) and
 * a broken core shard (AC 17, HP 10) stops the ship. Crashing: no attack roll; a creature in the path dodges with a DC 15
 * Dexterity save; both take damage by the size struck (Medium or smaller 2d10); the ship stops against something its size
 * or larger; everyone aboard makes a DC 10 Strength or Dexterity save (damage and Prone, or half). Tilt and Roll inverts
 * the ship (DC 15 Dexterity save or fall). Emergency repairs: DC 16, 2d4 + 2 HP, once per part until docked. Wind
 * doesn't affect airship speed. Sky hazards and travel conditions tables.
 *
 * Wind and weather (DMG 2014 / 2024): in a dead calm ships can't move under sail; a strong wind imposes Disadvantage on
 * ranged weapon attacks and a flying creature in it must land at the end of its turn or fall (nonmagical flight).
 *
 * Flying creatures (PHB 2014 "Flying Movement", PHB 2024 "Flying", XGE "Falling"): a flier falls if it's knocked Prone,
 * its speed drops to 0 (2024: or it's Incapacitated), unless it can hover or magic holds it aloft. A fall deals 1d6
 * Bludgeoning per 10 feet (at most 20d6) and leaves it Prone. Optional (XGE): falls of more than 500 feet take time
 * (500 feet at once, then 500 more at the end of each of its turns), and a conscious flier subtracts its fly speed from
 * the distance before damage; a Prone flier still falling at the start of its turn can halt the fall with half its fly speed.
 *
 * Underwater (PHB 2014 / 2024 "Underwater Combat") and the other references are shown as text.
 */
import { BUTLER_NS } from "./constants";
import type { Ability, SizeCode } from "./sheet";

export const NAVAL_KEY = `${BUTLER_NS}/naval`;
const LOG_MAX = 40;

// ------------------------------------------------------------------ stat blocks

export type ShipType = "ship" | "spelljammer" | "airship";
export type ShipEnv = "water" | "air" | "space";
export type CompKind = "hull" | "control" | "movement" | "weapon" | "station";
export interface DamagePart { dice: string; type: string }
export interface ShipAttack { name: string; bonus: number; reach?: number; normal?: number; long?: number; min?: number; damage: DamagePart[]; text: string }
export interface ShipSpeed { normal: number; into?: number; with?: number; minCrew?: number }

export interface ComponentData {
  kind: Exclude<CompKind, "hull">;
  name: string;
  ac?: number;
  hp?: number;
  dt?: number;
  count?: number;
  /** Crew needed to operate it (spelljammer and airship stations). */
  crew?: number;
  mode?: string;
  speed?: ShipSpeed;
  /** Speed lost per damage taken: −`ft` per `dmg`. */
  per?: { ft: number; dmg: number };
  isControl?: boolean;
  /** Actions it takes to load and to aim (spelljammer weapons). */
  load?: number;
  aim?: number;
  ram?: boolean;
  /** Damage types it's immune to besides Poison and Psychic (the elemental core shard). */
  immune?: string[];
  attacks?: ShipAttack[];
  text?: string;
}

export interface ShipPreset {
  key: string; name: string; source: string; page?: number; type: ShipType; env: string[]; size: string; dims?: string;
  crew: number; passengers?: number; abilities?: { str: number; dex: number; con: number };
  hull: { ac: number; hp: number; dt?: number }; hover?: boolean;
  /** Crew needed for 1, 2, 3… actions (GoS ships). None: crew act at stations on their own turns. */
  thresholds?: number[];
  actions?: string;
  components: ComponentData[];
  note?: string;
}

export interface Component extends ComponentData {
  id: string;
  ac: number;
  hp: number;
  /** 0: it has no hit points of its own (a spelljamming helm, a ram that's part of the hull) and can't be targeted. */
  maxHp: number;
  /** The stat block's name for a weapon with a count ("Ballistas" for "Ballista 2"). */
  group?: string;
  /** Actions spent loading and aiming so far (spelljammer weapons). */
  loaded?: number;
  aimed?: number;
  /** Take Aim: Advantage on its next attack until the end of this ship turn. */
  aimAdv?: number;
}

export type Officer = "captain" | "firstMate" | "bosun" | "quartermaster" | "surgeon" | "cook" | "pilot";
export const OFFICERS: Officer[] = ["captain", "firstMate", "bosun", "quartermaster", "surgeon", "cook", "pilot"];
export const OFFICER_LABEL: Record<Officer, string> = {
  captain: "Captain", firstMate: "First mate", bosun: "Bosun", quartermaster: "Quartermaster", surgeon: "Surgeon", cook: "Cook", pilot: "Pilot (helm)",
};
export type Heading = "across" | "with" | "into";
export const HEADING_LABEL: Record<Heading, string> = { across: "Across the wind", with: "With the wind", into: "Into the wind" };

export interface Ship {
  id: string;
  name: string;
  preset?: string;
  source?: string;
  type: ShipType;
  env: ShipEnv;
  size: SizeCode;
  /** Undefined when the stat block has none (spelljammers, elemental airships). */
  str?: number;
  dex?: number;
  con?: number;
  hull: { ac: number; hp: number; maxHp: number; dt: number };
  comps: Component[];
  crew: number;
  crewMax: number;
  /** Crew quality score, −10 to +10. */
  quality: number;
  thresholds?: number[];
  officers: Partial<Record<Officer, string>>;
  /** Units aboard (besides the crew, who aren't tokens). */
  aboard: string[];
  initiative?: number;
  /** Ship turns started so far. */
  turn: number;
  /** Actions taken this turn ("move", "fire:Ballistas"…). */
  used: string[];
  heading: Heading;
  fullSpeed?: { bonus: number; until: number };
  /** Height above the ground or water, in feet (airships). */
  altitude: number;
  hover?: boolean;
  /** Elemental airship with its core suppressed: stays aloft, can't move. */
  coreOff?: boolean;
  /** Feet moved since its last turn. */
  moved: number;
  /** EFA Tilt and Roll: upside down. */
  inverted?: boolean;
  /** EFA emergency repairs: parts that already regained HP this way (until the ship docks). */
  patched?: string[];
  basis?: string;
}

export type Wind = "calm" | "breeze" | "strong";
export const WIND_LABEL: Record<Wind, string> = { calm: "Dead calm", breeze: "Normal wind", strong: "Strong wind" };

/** A creature in the air (not standing on a ship's deck). */
export interface Aloft {
  ft: number;
  /** Held aloft by magic (the Fly spell, a broom of flying…): doesn't fall when Prone or stopped. */
  magic?: boolean;
  /** Falling: how far so far (the damage comes on landing). */
  falling?: { fallen: number };
}

export interface NavalState {
  ships: Ship[];
  wind: Wind;
  underwater: boolean;
  aloft: Record<string, Aloft>;
  /** XGE optional rules: falls take time (500 ft per round); fliers subtract their fly speed from the fall. */
  rateOfFalling: boolean;
  flierRule: boolean;
  publicRolls: boolean;
  log: string[];
}

export const EMPTY_NAVAL: NavalState = { ships: [], wind: "breeze", underwater: false, aloft: {}, rateOfFalling: false, flierRule: false, publicRolls: true, log: [] };

const num = (x: unknown, d: number) => (typeof x === "number" && Number.isFinite(x) ? x : d);
const SIZE_CODES: SizeCode[] = ["T", "S", "M", "L", "H", "G"] as SizeCode[];
const clampQ = (q: number) => Math.max(-10, Math.min(10, Math.round(q)));

function readComp(x: unknown): Component | null {
  const c = x as Partial<Component> | null;
  if (!c || typeof c !== "object" || typeof c.id !== "string" || typeof c.name !== "string") return null;
  const maxHp = Math.max(0, num(c.maxHp, 0));
  return { ...c, id: c.id, name: c.name, kind: (["control", "movement", "weapon", "station"].includes(c.kind as string) ? c.kind : "weapon") as Component["kind"], ac: num(c.ac, 15), maxHp, hp: Math.max(0, Math.min(maxHp, num(c.hp, maxHp))) };
}

export function readShip(x: unknown): Ship | null {
  const s = x as Partial<Ship> | null;
  if (!s || typeof s !== "object" || typeof s.id !== "string") return null;
  const h = (s.hull ?? {}) as Partial<Ship["hull"]>;
  const maxHp = Math.max(1, num(h.maxHp, 100));
  const off = (s.officers ?? {}) as Record<string, unknown>;
  return {
    id: s.id, name: typeof s.name === "string" && s.name ? s.name : "Ship", preset: typeof s.preset === "string" ? s.preset : undefined, source: typeof s.source === "string" ? s.source : undefined,
    type: s.type === "spelljammer" || s.type === "airship" ? s.type : "ship", env: s.env === "air" || s.env === "space" ? s.env : "water",
    size: SIZE_CODES.includes(s.size as SizeCode) ? (s.size as SizeCode) : ("G" as SizeCode),
    str: typeof s.str === "number" ? s.str : undefined, dex: typeof s.dex === "number" ? s.dex : undefined, con: typeof s.con === "number" ? s.con : undefined,
    hull: { ac: num(h.ac, 15), maxHp, hp: Math.max(0, Math.min(maxHp, num(h.hp, maxHp))), dt: Math.max(0, num(h.dt, 0)) },
    comps: Array.isArray(s.comps) ? s.comps.map(readComp).filter((c): c is Component => !!c) : [],
    crew: Math.max(0, num(s.crew, 0)), crewMax: Math.max(0, num(s.crewMax, num(s.crew, 0))), quality: clampQ(num(s.quality, 4)),
    thresholds: Array.isArray(s.thresholds) ? s.thresholds.filter((n): n is number => typeof n === "number") : undefined,
    officers: Object.fromEntries(OFFICERS.filter((o) => typeof off[o] === "string" && off[o]).map((o) => [o, off[o] as string])),
    aboard: Array.isArray(s.aboard) ? s.aboard.filter((a): a is string => typeof a === "string") : [],
    initiative: typeof s.initiative === "number" ? s.initiative : undefined, turn: Math.max(0, num(s.turn, 0)),
    used: Array.isArray(s.used) ? s.used.filter((a): a is string => typeof a === "string") : [],
    heading: s.heading === "with" || s.heading === "into" ? s.heading : "across",
    fullSpeed: s.fullSpeed && typeof s.fullSpeed.bonus === "number" && typeof s.fullSpeed.until === "number" ? s.fullSpeed : undefined,
    altitude: Math.max(0, num(s.altitude, 0)), hover: s.hover === true || undefined, coreOff: s.coreOff === true || undefined,
    moved: Math.max(0, num(s.moved, 0)), inverted: s.inverted === true || undefined, patched: Array.isArray(s.patched) ? s.patched.filter((a): a is string => typeof a === "string") : undefined, basis: typeof s.basis === "string" ? s.basis : undefined,
  };
}

export function readNaval(meta: Record<string, unknown>): NavalState {
  const raw = meta[NAVAL_KEY] as Partial<NavalState> | undefined;
  if (!raw || typeof raw !== "object") return { ...EMPTY_NAVAL, aloft: {} };
  const aloft: Record<string, Aloft> = {};
  for (const [id, a] of Object.entries((raw.aloft ?? {}) as Record<string, Partial<Aloft>>)) {
    if (!a || typeof a !== "object") continue;
    aloft[id] = { ft: Math.max(0, num(a.ft, 0)), ...(a.magic ? { magic: true } : {}), ...(a.falling && typeof a.falling.fallen === "number" ? { falling: { fallen: Math.max(0, a.falling.fallen) } } : {}) };
  }
  return {
    ships: Array.isArray(raw.ships) ? raw.ships.map(readShip).filter((s): s is Ship => !!s) : [],
    wind: raw.wind === "calm" || raw.wind === "strong" ? raw.wind : "breeze", underwater: raw.underwater === true, aloft,
    rateOfFalling: raw.rateOfFalling === true, flierRule: raw.flierRule === true, publicRolls: raw.publicRolls !== false,
    log: Array.isArray(raw.log) ? raw.log.filter((l): l is string => typeof l === "string").slice(-LOG_MAX) : [],
  };
}

export const withNavalLog = (n: NavalState, ...lines: string[]): NavalState => ({ ...n, log: [...n.log, ...lines].slice(-LOG_MAX) });

/** A ship ready for battle from a stat block: weapons with a count become one component each (each has its own HP). */
export function shipFromPreset(p: ShipPreset, id: string, name?: string): Ship {
  const comps: Component[] = [];
  const seen: Record<string, number> = {};
  for (const c of p.components) {
    const n = Math.max(1, c.count ?? 1);
    for (let i = 1; i <= n; i++) {
      const base = c.kind.slice(0, 1) + (seen[c.kind] = (seen[c.kind] ?? 0) + 1);
      const label = n > 1 ? `${c.name.replace(/(ae|s)$/, (m) => (m === "ae" ? "a" : ""))} ${i}` : c.name;
      const { count: _c, ...rest } = c;
      comps.push({ ...rest, id: base, name: label, ...(n > 1 ? { group: c.name } : {}), ac: c.ac ?? p.hull.ac, maxHp: c.hp ?? 0, hp: c.hp ?? 0 });
    }
  }
  const env: ShipEnv = p.env.includes("water") && p.type === "ship" ? "water" : p.env.includes("air") ? "air" : p.env.includes("space") ? "space" : "water";
  return {
    id, name: name?.trim() || p.name, preset: p.key, source: p.source, type: p.type, env, size: p.size as SizeCode,
    ...(p.abilities ? { str: p.abilities.str, dex: p.abilities.dex, con: p.abilities.con } : {}),
    hull: { ac: p.hull.ac, hp: p.hull.hp, maxHp: p.hull.hp, dt: p.hull.dt ?? 0 }, comps,
    crew: p.crew, crewMax: p.crew, quality: 4, ...(p.thresholds ? { thresholds: p.thresholds } : {}), officers: {}, aboard: [],
    turn: 0, used: [], heading: "across", altitude: 0, ...(p.hover ? { hover: true } : {}), moved: 0,
    basis: `${p.name} (${p.source}${p.page ? ` p. ${p.page}` : ""})${p.dims ? `, ${p.dims}` : ""}${p.note ? `. ${p.note}` : ""}`,
  };
}

/** The weapon group a component belongs to ("Ballistas" for "Ballista 2"). */
export const groupOf = (c: Component) => c.group ?? c.name;

// ------------------------------------------------------------------ state of the ship

export const isWrecked = (s: Pick<Ship, "hull">) => s.hull.hp <= 0;
/** Destroyed: a component with hit points at 0 (it's unusable). */
export const isDestroyed = (c: Pick<Component, "hp" | "maxHp">) => c.maxHp > 0 && c.hp <= 0;
export const crewPassive = (s: Pick<Ship, "quality">) => 10 + s.quality;
export const abilityMod = (score: number) => Math.floor((score - 10) / 2);

/** How many actions a crewed ship (GoS) can take this turn from its crew; null for ships whose crew act at stations. */
export function actionCount(s: Pick<Ship, "thresholds" | "crew" | "hull">): number | null {
  if (!s.thresholds?.length) return null;
  if (isWrecked(s)) return 0;
  return s.thresholds.filter((t) => s.crew >= t).length;
}

/** The actions a crewed ship can choose from (each once per turn): Move, and Fire for each weapon group with a working weapon. */
export function shipActions(s: Ship): { key: string; label: string; comps: Component[] }[] {
  const out: { key: string; label: string; comps: Component[] }[] = [{ key: "move", label: "Move", comps: [] }];
  const groups = new Map<string, Component[]>();
  for (const c of s.comps) if (c.kind === "weapon" && !c.ram && c.attacks?.length) groups.set(groupOf(c), [...(groups.get(groupOf(c)) ?? []), c]);
  for (const [g, comps] of groups) {
    const working = comps.filter((c) => !isDestroyed(c));
    if (working.length) out.push({ key: `fire:${g}`, label: `Fire ${g}`, comps: working });
  }
  return out;
}

/** Initiative bonus (GoS): Dexterity modifier + crew quality. Null when the stat block has no Dexterity (the crew act on their own turns). */
export const shipInitiativeBonus = (s: Pick<Ship, "dex" | "quality">): number | null => (typeof s.dex === "number" ? abilityMod(s.dex) + s.quality : null);

const WIND_DRIVEN = /\bsails?\b/i;

/** One movement component's speed now: wind and heading, damage, crew it needs, Full Speed Ahead. */
export function componentSpeed(s: Ship, c: Component, wind: Wind): { speed: number; notes: string[] } {
  const notes: string[] = [];
  if (!c.speed) return { speed: 0, notes };
  if (isDestroyed(c)) return { speed: 0, notes: ["destroyed"] };
  if (c.speed.minCrew && s.crew < c.speed.minCrew) return { speed: 0, notes: [`needs ${c.speed.minCrew} crew`] };
  if (/elemental core/i.test(c.name)) {
    // EFA: a broken core shard stops the ship (it still hovers); a suppressed core leaves it Fly 5 ft.
    if (s.comps.some((o) => /core shard/i.test(o.name) && isDestroyed(o))) return { speed: 0, notes: ["elemental core broken: it hovers in place"] };
    if (s.coreOff) return { speed: 5, notes: ["core suppressed: Fly 5 ft, hovers"] };
  }
  if (wind === "calm" && WIND_DRIVEN.test(c.name)) return { speed: 0, notes: ["dead calm: no wind in the sails"] };
  let speed = c.speed.normal;
  if (s.heading === "into" && c.speed.into !== undefined) { speed = c.speed.into; notes.push("into the wind"); }
  else if (s.heading === "with" && c.speed.with !== undefined) { speed = c.speed.with; notes.push("with the wind"); }
  if (c.per && c.maxHp > c.hp) {
    const lost = Math.floor((c.maxHp - c.hp) / c.per.dmg) * c.per.ft;
    if (lost) { speed -= lost; notes.push(`−${lost} ft from damage`); }
  }
  const fs = fullSpeedBonus(s);
  if (fs) { speed += fs; notes.push(`Full Speed Ahead +${fs}`); }
  return { speed: Math.max(0, speed), notes };
}

export const fullSpeedBonus = (s: Pick<Ship, "fullSpeed" | "turn">) => (s.fullSpeed && s.fullSpeed.until >= s.turn ? s.fullSpeed.bonus : 0);

/** The ship's speed: the best of its movement components (a helm that "can't move" when destroyed stops it). */
export function shipSpeed(s: Ship, wind: Wind): { speed: number; via?: string; notes: string[] } {
  if (isWrecked(s)) return { speed: 0, notes: ["wrecked"] };
  if (actionCount(s) === 0) return { speed: 0, notes: ["too few crew to act"] };
  if (s.comps.some((c) => c.kind === "control" && isDestroyed(c) && /can't move/i.test(c.text ?? ""))) return { speed: 0, notes: ["helm destroyed: it can't move"] };
  let best: { speed: number; via?: string; notes: string[] } = { speed: 0, notes: [] };
  for (const c of s.comps.filter((x) => x.kind === "movement")) {
    const r = componentSpeed(s, c, wind);
    if (r.speed > best.speed || !best.via) best = { speed: r.speed, via: c.name, notes: r.notes };
  }
  return best;
}

/** False once every helm is destroyed (GoS: it can't turn). */
export const canTurn = (s: Ship) => { const helms = s.comps.filter((c) => (c.kind === "control" || c.kind === "station") && /helm/i.test(c.name)); return !helms.length || helms.some((c) => !isDestroyed(c)); };
/** False when something that keeps it in the air is destroyed (the battle balloon's balloon). */
export const staysAloft = (s: Ship) => !s.comps.some((c) => c.kind === "control" && isDestroyed(c) && /maintain altitude/i.test(c.text ?? ""));

export interface ShipHit { ship: Ship; applied: number; why: string; destroyed: boolean; wrecked: boolean; target: string }

/** Damage to the hull or a component: Immunity to Poison and Psychic, damage thresholds. */
export function damageShip(s: Ship, compId: string, amount: number, type?: string): ShipHit {
  const n = Math.max(0, Math.floor(amount));
  const comp = compId === "hull" ? null : s.comps.find((c) => c.id === compId);
  const target = comp ? comp.name : "hull";
  if (type && comp?.immune?.some((t) => t.toLowerCase() === type.toLowerCase())) return { ship: s, applied: 0, why: `${comp.name} is immune to ${type}`, destroyed: false, wrecked: false, target };
  if (type && /^(poison|psychic)$/i.test(type)) return { ship: s, applied: 0, why: `Immunity to ${type}`, destroyed: false, wrecked: false, target };
  const dt = comp ? comp.dt ?? 0 : s.hull.dt;
  if (dt && n < dt) return { ship: s, applied: 0, why: `below the damage threshold of ${dt}`, destroyed: false, wrecked: false, target };
  if (comp) {
    if (!comp.maxHp) return { ship: s, applied: 0, why: `${comp.name} has no hit points of its own: hit the hull`, destroyed: false, wrecked: false, target };
    const hp = Math.max(0, comp.hp - n);
    return { ship: { ...s, comps: s.comps.map((c) => (c.id === comp.id ? { ...c, hp } : c)) }, applied: n, why: "", destroyed: hp <= 0 && comp.hp > 0, wrecked: false, target };
  }
  const hp = Math.max(0, s.hull.hp - n);
  return { ship: { ...s, hull: { ...s.hull, hp } }, applied: n, why: "", destroyed: false, wrecked: hp <= 0 && s.hull.hp > 0, target };
}

export function repairShip(s: Ship, compId: string, amount: number): Ship {
  const n = Math.max(0, Math.floor(amount));
  if (compId === "hull") return { ...s, hull: { ...s.hull, hp: Math.min(s.hull.maxHp, s.hull.hp + n) } };
  return { ...s, comps: s.comps.map((c) => (c.id === compId ? { ...c, hp: Math.min(c.maxHp, c.hp + n) } : c)) };
}

/** Components (and the hull) that have taken damage. */
export const damagedParts = (s: Ship): string[] => [...(s.hull.hp < s.hull.maxHp ? ["hull"] : []), ...s.comps.filter((c) => c.maxHp && c.hp < c.maxHp).map((c) => c.id)];

/** Bosun's repair (GoS "Travel at Sea"): a 15+ heals each damaged part by its roll (1d6 + quality, at least 1); destroyed components work again (min 1 HP). The hull isn't revived. */
export function bosunRepair(s: Ship, rolls: Record<string, number>): Ship {
  let out = s;
  for (const [id, r] of Object.entries(rolls)) {
    if (id === "hull" && isWrecked(out)) continue;
    out = repairShip(out, id, Math.max(1, r + s.quality));
  }
  return out;
}
export const BOSUN_DC = 15;
/** Repairs while berthed (DMG / PHB 2024 / AAG): 1 day and 20 gp per hit point (shipboard weapons: 10 gp). */
export const BERTHED_REPAIR = { gpPerHp: 20, weaponGpPerHp: 10, hpPerDay: 1 };

// ------------------------------------------------------------------ turns and officers

/** A new ship turn: actions reset, the feet-moved count restarts, Take Aim and Full Speed Ahead that ran out end. */
export function startShipTurn(s: Ship): Ship {
  const turn = s.turn + 1;
  return {
    ...s, turn, used: [], moved: 0,
    fullSpeed: s.fullSpeed && s.fullSpeed.until >= turn ? s.fullSpeed : undefined,
    comps: s.comps.map((c) => (c.aimAdv !== undefined && c.aimAdv < turn ? { ...c, aimAdv: undefined } : c)),
  };
}

/**
 * The crewed ships whose initiative falls between the turn that ended (initiative `prev`) and the one starting
 * (`next`), highest first: a ship acts after units with the same initiative. `wrapped`: a new round began in between.
 */
export function shipsUpBetween(ships: Ship[], prev: number | null, next: number | null, wrapped: boolean): Ship[] {
  const up = ships.filter((s) => typeof s.initiative === "number" && !isWrecked(s) && actionCount(s) !== null).filter((s) => {
    const i = s.initiative!;
    const afterPrev = prev === null ? true : i <= prev;
    const beforeNext = next === null ? true : i > next;
    return wrapped ? afterPrev || beforeNext : afterPrev && beforeNext;
  });
  // In a wrap, the end of the old round comes first (low initiatives), then the top of the new one.
  const oldRound = (s: Ship) => (!wrapped || prev === null || s.initiative! <= prev ? 0 : 1);
  return up.sort((a, b) => oldRound(a) - oldRound(b) || b.initiative! - a.initiative!);
}

/** Full Speed Ahead (captain, first mate or bosun, as an action on deck): +d6 × 5 ft until the end of the ship's next turn; the higher bonus applies. */
export function fullSpeedAhead(s: Ship, d6: number): { ship: Ship; bonus: number; kept: boolean } {
  const bonus = d6 * 5;
  const cur = fullSpeedBonus(s);
  if (cur >= bonus) return { ship: s, bonus, kept: true };
  return { ship: { ...s, fullSpeed: { bonus, until: s.turn + 1 } }, bonus, kept: false };
}

/** Take Aim (captain, first mate or bosun, as an action): one weapon within 10 ft has Advantage on its next attack before the end of the ship's next turn. */
export const takeAim = (s: Ship, compId: string): Ship => ({ ...s, comps: s.comps.map((c) => (c.id === compId ? { ...c, aimAdv: s.turn + 1 } : c)) });

/** Officers who can Take Aim and call Full Speed Ahead. */
export const COMMANDERS: Officer[] = ["captain", "firstMate", "bosun"];

/** A weapon that needs loading and aiming (spelljammers): ready to fire? */
export const weaponReady = (c: Component) => (c.loaded ?? 0) >= (c.load ?? 0) && (c.aimed ?? 0) >= (c.aim ?? 0);
/** One action spent loading (then aiming) a weapon. */
export function weaponStep(c: Component): { comp: Component; did: "load" | "aim" | null } {
  if ((c.loaded ?? 0) < (c.load ?? 0)) return { comp: { ...c, loaded: (c.loaded ?? 0) + 1 }, did: "load" };
  if ((c.aimed ?? 0) < (c.aim ?? 0)) return { comp: { ...c, aimed: (c.aimed ?? 0) + 1 }, did: "aim" };
  return { comp: c, did: null };
}
/** After firing: unloaded, unaimed, Take Aim used up. */
export const afterFiring = (c: Component): Component => ({ ...c, loaded: c.load ? 0 : undefined, aimed: c.aim ? 0 : undefined, aimAdv: undefined });

export type Mode = "normal" | "advantage" | "disadvantage";
const combine = (modes: Mode[]): Mode => { const a = modes.includes("advantage"), d = modes.includes("disadvantage"); return a && !d ? "advantage" : d && !a ? "disadvantage" : "normal"; };

/** Can this attack reach, and with what? Range (long range: Disadvantage; inside the minimum: can't), strong wind (ranged: Disadvantage), Take Aim (Advantage). */
export function attackMode(a: ShipAttack, opts: { distance?: number; wind: Wind; aimed?: boolean }): { ok: boolean; mode: Mode; notes: string[] } {
  const notes: string[] = [];
  const modes: Mode[] = [];
  const d = opts.distance;
  if (d !== undefined && Number.isFinite(d)) {
    if (a.reach !== undefined && d > a.reach) return { ok: false, mode: "normal", notes: [`out of reach (${a.reach} ft)`] };
    if (a.min !== undefined && d < a.min) return { ok: false, mode: "normal", notes: [`can't hit targets within ${a.min} ft`] };
    if (a.normal !== undefined) {
      const long = a.long ?? a.normal;
      if (d > long) return { ok: false, mode: "normal", notes: [`out of range (${long} ft)`] };
      if (d > a.normal) { modes.push("disadvantage"); notes.push("long range"); }
    }
  }
  if (opts.wind === "strong" && a.normal !== undefined) { modes.push("disadvantage"); notes.push("strong wind"); }
  if (opts.aimed) { modes.push("advantage"); notes.push("Take Aim"); }
  return { ok: true, mode: combine(modes), notes };
}

// ------------------------------------------------------------------ crew

/** Crew lost to an area spell (GoS "Crew Casualties"): 1d6 per spell level. */
export const casualtyDice = (spellLevel: number) => `${Math.max(1, Math.floor(spellLevel))}d6`;
export const loseCrew = (s: Ship, n: number): Ship => ({ ...s, crew: Math.max(0, s.crew - Math.max(0, Math.floor(n))) });
export const setQuality = (s: Ship, q: number): Ship => ({ ...s, quality: clampQ(q) });

/** Mutiny (GoS): once a day while quality is below 0, the captain's Charisma (Intimidation or Persuasion) check + quality. */
export function mutinyResult(total: number): { mutiny: boolean; qualityChange: number; text: string } {
  if (total <= 0) return { mutiny: true, qualityChange: 0, text: "The crew mutinies: they turn hostile to the officers. When the mutiny ends, quality rises by 1d4." };
  if (total <= 9) return { mutiny: false, qualityChange: -1, text: "Grumbling: the crew's quality drops by 1." };
  return { mutiny: false, qualityChange: 0, text: "The crew stays in line." };
}

/** Fire aboard (GoS "Travel at Sea"): who rolls what. The crew rolls d20 + quality. Anyone missing counts as a failure. */
export const FIRE_CHECKS: { officer: Officer; ability: Ability; skill?: string; tool?: string; label: string }[] = [
  { officer: "captain", ability: "int", tool: "Vehicles (Water)", label: "Intelligence (water vehicles)" },
  { officer: "firstMate", ability: "cha", skill: "Intimidation", label: "Charisma (Intimidation)" },
  { officer: "bosun", ability: "str", tool: "Carpenter's Tools", label: "Strength (carpenter's tools)" },
  { officer: "surgeon", ability: "int", skill: "Medicine", label: "Intelligence (Medicine)" },
];
export const FIRE_DCS: { dc: number; text: string }[] = [
  { dc: 10, text: "Small, contained fire (an oil lantern)" }, { dc: 15, text: "Dangerous flame (a large campfire, or several small fires)" },
  { dc: 20, text: "Intense fire likely to spread (a bonfire)" }, { dc: 25, text: "Sudden, pervasive flames (a hold of flammable cargo)" },
];
export type GroupResult = "total success" | "success" | "failure" | "total failure";
/** A group check (PHB): it succeeds if at least half succeed; total success / failure when every roll does. */
export function groupResult(passed: number, total: number): GroupResult {
  if (total > 0 && passed === total) return "total success";
  if (passed === 0) return "total failure";
  return passed * 2 >= total ? "success" : "failure";
}
export const FIRE_RESULT: Record<GroupResult, { text: string; damage: boolean; continues: boolean; quality: number }> = {
  "total success": { text: "The fire is out, with nothing beyond cosmetic damage.", damage: false, continues: false, quality: 0 },
  success: { text: "The fire is out, but the hull and 1d3 other components take 6d6 Fire damage.", damage: true, continues: false, quality: 0 },
  failure: { text: "The hull and 1d3 other components take 6d6 Fire damage, and the fire burns on: another check in 5 minutes.", damage: true, continues: true, quality: 0 },
  "total failure": { text: "Injuries cost the crew 1 quality; the hull and 1d3 other components take 6d6 Fire damage, and the fire burns on.", damage: true, continues: true, quality: -1 },
};
export const FIRE_DAMAGE: DamagePart = { dice: "6d6", type: "Fire" };

// ------------------------------------------------------------------ crashing

export const sizeIndex = (s: SizeCode) => Math.max(0, SIZE_CODES.indexOf(s));
/** Crash Damage (GoS; AAG gives Large and up, the same dice; EFA: Medium or smaller 2d10). */
export const CRASH_DAMAGE_EFA: Record<string, string> = { T: "2d10", S: "2d10", M: "2d10", L: "4d10", H: "8d10", G: "16d10" };
export const CRASH_DAMAGE: Record<string, string> = { T: "", S: "1d6", M: "1d10", L: "4d10", H: "8d10", G: "16d10" };
export const SIZE_LABEL: Record<string, string> = { T: "Tiny", S: "Small", M: "Medium", L: "Large", H: "Huge", G: "Gargantuan" };

/** Which crash rules: GoS for ships under sail and oar, AAG's attack roll for spelljammers, EFA's for elemental airships. */
export const crashRules = (s: Pick<Ship, "type">): "gos" | "aag" | "efa" => (s.type === "ship" ? "gos" : s.type === "airship" ? "efa" : "aag");

export interface CrashPlan {
  rules: "gos" | "aag" | "efa";
  /** EFA: a creature in the path gets out of the way with this Dexterity save (no damage). */
  dodgeDc?: number;
  /** EFA: everyone aboard makes a Strength or Dexterity save: damage (targetDice) and Prone on a failure, half on a success. */
  aboardDc?: number;
  /** GoS: the target is at least two sizes smaller: no crash, the ship just pushes on. */
  noCrash?: boolean;
  /** Damage the ship takes (GoS: on a failed DC 10 Constitution save; AAG: on a hit). */
  shipDice: string;
  /** GoS: what a creature (or a rammed ship, Butler's ruling) takes on a failed Dexterity save, half on a success. AAG: what the target takes on a hit. */
  targetDice: string;
  /** GoS: the Dexterity save DC for a creature struck (10 + the ship's Strength modifier). */
  dexDc?: number;
  /** GoS: Advantage on the Constitution save and the damage goes to the ram. */
  ram?: Component;
  stops: boolean;
}

export function crashPlan(s: Ship, targetSize: SizeCode, opts: { immovable?: boolean } = {}): CrashPlan {
  const rules = crashRules(s);
  const ram = s.comps.find((c) => c.ram && !isDestroyed(c) && !c.attacks?.length);
  if (rules === "gos") {
    const gap = sizeIndex(s.size) - sizeIndex(targetSize);
    return {
      rules, noCrash: gap >= 2 && !opts.immovable, shipDice: CRASH_DAMAGE[targetSize] ?? "", targetDice: CRASH_DAMAGE[s.size] ?? "",
      dexDc: 10 + abilityMod(s.str ?? 10), ram, stops: gap <= 1 || !!opts.immovable,
    };
  }
  if (rules === "efa") {
    const dice = CRASH_DAMAGE_EFA[targetSize] ?? "2d10";
    return { rules, shipDice: dice, targetDice: dice, dodgeDc: 15, aboardDc: 10, stops: sizeIndex(targetSize) >= sizeIndex(s.size) || !!opts.immovable };
  }
  const dice = CRASH_DAMAGE[targetSize] ?? "";
  return { rules, shipDice: dice, targetDice: dice, stops: targetSize === "G" || !!opts.immovable };
}
export const CRASH_CON_DC = 10;

/** AAG rams (Piercing Ram, Blunt Ram): the spelljammer's special attack against an object or a Gargantuan creature. */
export const ramAttack = (s: Ship) => s.comps.find((c) => c.ram && c.attacks?.length && !isDestroyed(c))?.attacks?.[0];

/** A ship save or check with one of its scores: a 0 or missing score fails automatically. */
export function shipTest(s: Ship, ability: "str" | "dex" | "con"): { auto: string | null; bonus: number } {
  const score = s[ability];
  if (typeof score !== "number") return { auto: `${s.name} has no ${ability === "dex" ? "Dexterity" : ability === "con" ? "Constitution" : "Strength"} score: it fails`, bonus: 0 };
  if (score <= 0) return { auto: `${s.name} has a 0 in it: it fails`, bonus: 0 };
  return { auto: null, bonus: abilityMod(score) };
}

/** Starting Encounter Distance (AAG). */
export const STARTING_DISTANCE: { ft: number; text: string }[] = [
  { ft: 250, text: "Long range for ballistae, mangonels, bows and crossbows" },
  { ft: 500, text: "Long range for longbows and mangonels; beyond ballistae and crossbows" },
  { ft: 1000, text: "Beyond the range of most ranged weapons" },
];

// ------------------------------------------------------------------ creatures in the air

const STOPPED_2014 = ["grappled", "restrained", "paralyzed", "petrified", "stunned", "unconscious"];
const STOPPED_2024 = ["grappled", "restrained"];
const INCAPACITATING = ["incapacitated", "paralyzed", "petrified", "stunned", "unconscious"];

/**
 * Why a creature in the air falls now (null if it doesn't): Prone, speed 0 (Grappled, Restrained, Paralyzed…; 2014
 * Exhaustion 5; 2024 Exhaustion that eats its whole fly speed) or, in 2024, Incapacitated. Hovering or magic keeps it up.
 */
export function fallReason(u: { conditions: { key: string; level?: number }[]; fly?: number; hover?: boolean }, a: Aloft, rules: "2024" | "2014"): string | null {
  if (a.ft <= 0 || a.falling || a.magic || u.hover) return null;
  const has = (k: string) => u.conditions.some((c) => c.key === k);
  if (has("prone")) return "it's Prone";
  if (rules === "2024" && INCAPACITATING.some(has)) return `it's ${cap(INCAPACITATING.find(has)!)}`;
  const stop = (rules === "2024" ? STOPPED_2024 : STOPPED_2014).find(has);
  if (stop) return `it's ${cap(stop)} (speed 0)`;
  const ex = u.conditions.find((c) => c.key === "exhaustion")?.level ?? 0;
  if (rules === "2014" && ex >= 5) return "Exhaustion 5 (speed 0)";
  if (rules === "2024" && u.fly !== undefined && u.fly > 0 && u.fly - 5 * ex <= 0) return `Exhaustion ${ex} (speed 0)`;
  return null;
}
const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);

/** How far a fall goes right now: all of it, or 500 feet with the rate-of-falling rule. */
export const fallStep = (ft: number, rateOfFalling: boolean) => (rateOfFalling ? Math.min(ft, 500) : ft);
/** The distance damage is counted on: minus the flier's current fly speed under XGE's optional rule (conscious, fly speed above 0). */
export const fallDamageFeet = (fallen: number, opts: { flierRule: boolean; fly?: number; conscious: boolean }) =>
  Math.max(0, fallen - (opts.flierRule && opts.conscious && opts.fly ? opts.fly : 0));
export const fallDice = (feet: number) => { const n = Math.min(20, Math.floor(feet / 10)); return n > 0 ? `${n}d6` : ""; };

/** Strong wind: a creature flying by nonmagical means must land at the end of its turn or fall. */
export const windGrounds = (wind: Wind, a: Aloft | undefined, hover?: boolean) => wind === "strong" && !!a && a.ft > 0 && !a.magic && !a.falling && !hover;

// ------------------------------------------------------------------ reference

export function underwaterRules(rules: "2024" | "2014"): string[] {
  return rules === "2024"
    ? [
      "Melee attack rolls with a weapon have Disadvantage unless the attacker has a Swim Speed or the weapon deals Piercing damage.",
      "Ranged attack rolls with a weapon automatically miss beyond normal range, and have Disadvantage within it.",
      "Anything underwater has Resistance to Fire damage.",
      "Encounter distance: clear water 60 ft in Bright Light, 30 ft in Dim Light; murky water or Darkness 10 ft (DMG).",
      "Deep water (100+ ft): each hour of swimming without a Swim Speed, DC 10 Constitution save or 1 Exhaustion level (DMG).",
    ]
    : [
      "Melee weapon attacks have Disadvantage for a creature without a swimming speed, unless the weapon is a dagger, javelin, shortsword, spear or trident.",
      "Ranged weapon attacks automatically miss beyond normal range, and have Disadvantage within it unless the weapon is a crossbow, a net or a thrown weapon like a javelin (spear, trident, dart).",
      "Creatures and objects fully immersed in water have resistance to fire damage.",
      "Encounter distance: clear water 60 ft in bright light, 30 ft in dim light; murky water or no light 10 ft (DMG).",
      "Swimming more than 100 ft deep counts as 2 hours per hour for exhaustion (200 ft: 4 hours) for creatures without a swimming speed (DMG).",
    ];
}

export function windRules(wind: Wind, rules: "2024" | "2014"): string[] {
  if (wind === "calm") return ["Dead calm: ships can't move under sail and must be rowed (DMG)."];
  if (wind === "breeze") return ["Ships use their speeds into, across or with the wind (GoS stat blocks)."];
  return [
    rules === "2024" ? "Strong wind: Disadvantage on ranged attack rolls with weapons; open flames go out and fog disperses (DMG)." : "Strong wind: disadvantage on ranged weapon attack rolls and on Wisdom (Perception) checks that rely on hearing; open flames go out and fog disperses (DMG).",
    "A creature flying by nonmagical means must land at the end of its turn or fall: Butler drops it at the end of its turn.",
    "With heavy rain too, it's a storm with high waves: navigation checks have Disadvantage and landmarks are lost (DMG).",
  ];
}

export const SKY_RULES = [
  "High altitude (10,000+ ft): each hour of travel counts as 2 for creatures that breathe; acclimation takes 30 days, impossible above 20,000 ft (DMG).",
  "A flying mount must rest 1 hour for every 3 hours it flies, and can't fly more than 9 hours a day (DMG 2014 \"The Sky\").",
  "Falling off a mount: when an effect moves the mount against its will, or the rider or mount is knocked Prone, DC 10 Dexterity save or fall off Prone within 5 ft (PHB).",
];

// ------------------------------------------------------------------ elemental airships (Eberron: Forge of the Artificer)

/** Tilt and Roll: half the Fly Speed inverts or rights the ship; unanchored creatures fall unless they make this Dexterity save to grab hold. */
export const TILT_DC = 15;
/** Emergency repairs (1 hour, 100+ gp of spare parts): DC 16 Dexterity (Sleight of Hand) or Intelligence (Arcana) with carpenter's, smith's or tinker's tools; 2d4 + 2 HP, once per part until docked; the part needs at least 1 HP. */
export const EMERGENCY_REPAIR = { dc: 16, dice: "2d4+2" };
export function canPatch(s: Ship, part: string): string | null {
  if (s.patched?.includes(part)) return "already patched since the ship last docked";
  const hp = part === "hull" ? s.hull.hp : s.comps.find((c) => c.id === part)?.hp ?? 0;
  const max = part === "hull" ? s.hull.maxHp : s.comps.find((c) => c.id === part)?.maxHp ?? 0;
  if (hp <= 0) return "it's at 0 HP: emergency repairs need at least 1";
  if (hp >= max) return "it isn't damaged";
  return null;
}

/** Airship Travel Conditions (EFA): encounter distance and the helm's Wisdom (Survival) navigation DC. */
export const AIRSHIP_CONDITIONS: { text: string; distance: string; dc: number }[] = [
  { text: "Day, clear skies", distance: "1,000 ft", dc: 10 }, { text: "Day, light precipitation", distance: "500 ft", dc: 13 },
  { text: "Day, heavy precipitation", distance: "250 ft", dc: 15 }, { text: "Night, clear skies", distance: "500 ft", dc: 10 },
  { text: "Night, light precipitation", distance: "250 ft", dc: 15 }, { text: "Night, heavy precipitation", distance: "6d6 × 10 ft", dc: 20 },
];

/** Environmental Hazards for airship journeys (EFA, d4). */
export const AIRSHIP_HAZARDS: { roll: number; text: string }[] = [
  { roll: 1, text: "Rough turbulence: each creature aboard makes a DC 10 Constitution save or is Poisoned for 1d4 hours (motion sickness)." },
  { roll: 2, text: "Extreme altitude for 1d4 hours: extreme cold, and reduced gravity (weights halved, jump distances doubled)." },
  { roll: 3, text: "A lightning storm for 1d4 hours: the area is Heavily Obscured, and a creature that starts its turn on deck makes a DC 10 Dexterity save or takes 4 (1d8) Lightning damage." },
  { roll: 4, text: "Strong wind for 1d4 hours: when the ship enters it, the pilot makes a DC 15 Constitution save or the ship inverts." },
];

export const AIRSHIP_RULES = [
  "Helm (EFA): the pilot needs the Mark of Storm (or, at the DM's discretion, a DC 20 Intelligence (Arcana) or Charisma (Intimidation or Persuasion) check per Drive or Shift Engine action). An Incapacitated pilot, or one who takes no helm action, lets the ship fly its full speed straight on at the start of their turn; with nobody at the helm it doesn't move.",
  "Airship speed isn't affected by wind or currents. A suppressed core leaves Fly 5 ft (it still hovers); Dispel Magic on the core suppresses it for 1 minute, and on a crew station makes it inoperable for 1 minute; an antimagic area suppresses the core.",
  "Wind wards: while the core runs, creatures aboard breathe normally, the deck is free of wind, and they have Advantage on saves to avoid being pushed off the deck. With the core suppressed or broken, high altitude and strong wind apply aboard.",
  "Monsters: one that can't beat the damage threshold knows it, and may turn on crew stations or crew instead.",
];
