/**
 * Reach and range: how far an action on the action bar reaches, read from its text (a weapon's "reach 10 ft." or
 * "range 80/320 ft.", a spell's "[Action, 60 ft.]" or "Touch", "each creature within 10 feet of it", "a 15-foot
 * Cone"…), and which creatures on the map that puts in range. The background page draws it on the map for the browser
 * that picked the action (background/reach.ts). Pure, so the parsing and the grid distances are unit-tested.
 *
 * Distances follow the rules: from the edge of the creature's space to the edge of the target's, counted in squares
 * the way the scene's grid measures them (Owlbear's grid settings), so a creature next to you is 5 ft away.
 */
import { BUTLER_NS } from "./constants";

/**
 * A band around the unit, `feet` out from the edge of its space:
 *  - reach: melee reach (or Touch); range: normal range; long: long range (attacks at Disadvantage);
 *  - area: an area of effect that starts at the unit (an Emanation, a radius on itself): everyone inside is caught;
 *  - aim: a Cone or Line from the unit, as far as it reaches: who could be caught depends on where it's aimed.
 */
export type BandKind = "reach" | "range" | "long" | "area" | "aim";
export interface Band { kind: BandKind; feet: number; label: string }

export interface Reach {
  /** Nearest first. */
  bands: Band[];
  /** Shown with the bands: an area placed at a point in range ("20-ft-radius Sphere at a point in range"). */
  note?: string;
}

/** What the reach of an action is read from. */
export interface ReachSource { key: string; name: string; text: string }

const NUM = "(\\d+)";
const FT = "\\s*(?:-|\\s)?\\s*(?:ft\\.?|feet|foot)";
const SHAPES = "Cone|Line|Cube|Sphere|Cylinder|Emanation|radius";

const cap = (s: string) => `${s[0]!.toUpperCase()}${s.slice(1).toLowerCase()}`;

/** "a 15-foot Cone", "20-foot-radius Sphere", "30-foot Emanation", "Self (15-ft. Cone)" → the shape and its size. */
function areaIn(text: string): { shape: string; feet: number; centred: boolean } | null {
  // "60-foot-long, 5-foot-wide Line" counts by its length.
  const m = new RegExp(`${NUM}${FT}(?:-radius|\\s+radius|-(?:long|wide|tall|high)\\b[^.]{0,25}?)?[\\s-]*(${SHAPES})\\b`, "i").exec(text)
    ?? new RegExp(`${NUM}${FT}-(radius)\\b`, "i").exec(text);
  // 2014 wording: "a line that is 30 feet long".
  const old = m ? null : new RegExp(`\\b(line|cone|cube)\\s+(?:that is\\s+)?${NUM}${FT}\\s+long\\b`, "i").exec(text);
  if (old) return { shape: cap(old[1]!), feet: Number(old[2]), centred: false };
  if (!m) return null;
  const shape = m[2]!.toLowerCase() === "radius" ? "radius" : cap(m[2]!);
  const after = text.slice(m.index, m.index + 160);
  // "centered on itself", "originating from you", "around it": the area moves with the creature.
  const centred = shape === "Emanation" || /\b(centered on (it|him|her|them|you)(self|selves)?|originating from (it|you|him|her)|around (it|you|him|her)(self)?)\b/i.test(after);
  return { shape, feet: Number(m[1]), centred };
}

/** The tag the D&D Beyond sync writes on a spell: "[Action, Concentration, 60 ft.]" → "60 ft." / "Self" / "Touch". */
function spellRangeTag(text: string): string | null {
  const tag = /\[([^\]]*(?:Action|Reaction|minute|hour)[^\]]*)\]/i.exec(text)?.[1];
  if (!tag) return null;
  const parts = tag.split(",").map((s) => s.trim());
  return parts.find((p) => /^(Self|Touch|Sight|Unlimited)\b/i.test(p) || new RegExp(`^${NUM}${FT}`, "i").test(p)) ?? null;
}

const ftLabel = (n: number) => `${n} ft`;

/** The rules' options that reach as far as the unit's melee reach, and those that need the target within 5 ft. */
const COMMON_REACH = new Set(["Unarmed Strike", "Grapple", "Shove", "Shove Aside", "Disarm", "Opportunity Attack", "Mark"]);
const COMMON_5FT = new Set(["Help", "Help#assist", "Stabilize", "Mount", "Climb onto a Bigger Creature"]);

/**
 * How far an action reaches, or null when its text says nothing about it (Dash, Second Wind, Shield…).
 * `meleeReach` is the unit's own reach for the rules' options that say "within reach" (Grapple, Shove…).
 */
export function reachOf(it: ReachSource, meleeReach = 5): Reach | null {
  // The rules' options (combatOptions.ts) say how far they reach in words; their reach is known.
  if (it.key.startsWith("common:")) {
    const name = it.key.slice("common:".length);
    if (name === "Improvised Weapon") return finish([{ kind: "reach", feet: 5, label: "Reach 5 ft" }, { kind: "range", feet: 20, label: "Thrown: range 20 ft" }, { kind: "long", feet: 60, label: "Long range 60 ft: Disadvantage" }]);
    if (COMMON_REACH.has(name)) return finish([{ kind: "reach", feet: meleeReach, label: `Reach ${ftLabel(meleeReach)}` }]);
    if (COMMON_5FT.has(name)) return finish([{ kind: "reach", feet: 5, label: "Within 5 ft" }]);
    return null;
  }
  const text = it.text ?? "";
  const bands: Band[] = [];
  const add = (b: Band) => { if (b.feet > 0 && !bands.some((x) => x.kind === b.kind && x.feet === b.feet)) bands.push(b); };

  // Weapon attacks: "reach 10 ft.", "range 80/320 ft.", "reach 5 ft. or range 20/60 ft." (thrown).
  const reach = new RegExp(`\\breach\\s+${NUM}${FT}`, "i").exec(text);
  const range = new RegExp(`\\brange\\s+${NUM}(?:\\s*/\\s*${NUM})?${FT}`, "i").exec(text);
  if (reach) add({ kind: "reach", feet: Number(reach[1]), label: `Reach ${ftLabel(Number(reach[1]))}` });
  if (range) {
    const normal = Number(range[1]);
    add({ kind: "range", feet: normal, label: `Range ${ftLabel(normal)}` });
    if (range[2] && Number(range[2]) > normal) add({ kind: "long", feet: Number(range[2]), label: `Long range ${ftLabel(Number(range[2]))}: Disadvantage` });
  }
  if (bands.length) return finish(bands);

  // Spells from the D&D Beyond sync: the range is in the casting tag.
  const tag = spellRangeTag(text);
  const area = areaIn(text);
  if (tag) {
    if (/^Touch\b/i.test(tag)) return finish([{ kind: "reach", feet: 5, label: "Touch: 5 ft" }]);
    if (/^Self\b/i.test(tag)) return area ? selfArea(area) : null;
    const n = new RegExp(`^${NUM}${FT}`, "i").exec(tag);
    if (n) {
      add({ kind: "range", feet: Number(n[1]), label: `Range ${ftLabel(Number(n[1]))}` });
      return finish(bands, area ? `${areaName(area)} at a point in range` : undefined);
    }
    return null;
  }

  // A cone or line breathed or swung from the creature, or an area on itself.
  if (area && (area.shape === "Cone" || area.shape === "Line" || area.centred)) return selfArea(area);
  // "each creature within 10 feet of it", "Each creature within 10 ft. makes…": an area around the creature.
  const around = new RegExp(`\\b(?:each|every|all|any)\\s+(?:other\\s+)?(?:creatures?|targets?|enem(?:y|ies)|allies|ally|ones?)\\b[^.]{0,40}?\\bwithin\\s+${NUM}${FT}(?!\\s+of\\s+(?:a|the|that|an)\\s+point)`, "i").exec(text);
  if (around) return finish([{ kind: "area", feet: Number(around[1]), label: `Within ${ftLabel(Number(around[1]))}: everyone here` }]);
  // "one creature it can see within 120 feet of it", "a point within 150 feet".
  // Only when it picks someone or somewhere (not "if an ally is within 5 feet of it", which is a condition).
  const within = /\b(targets?|can see|of (its|your) choice|choose|a point|teleport|hurls?|throws?)\b/i.test(text) ? new RegExp(`\\bwithin\\s+${NUM}${FT}`, "i").exec(text) : null;
  if (within) return finish([{ kind: "range", feet: Number(within[1]), label: `Range ${ftLabel(Number(within[1]))}` }], area ? `${areaName(area)} at a point in range` : undefined);
  // The rules' options: "within reach", "within your reach", "leaves your reach", "within 5 feet" (handled above).
  if (/\b(within (your )?reach|leaves your reach|to another space within your reach)\b/i.test(text)) {
    return finish([{ kind: "reach", feet: meleeReach, label: `Reach ${ftLabel(meleeReach)}` }]);
  }
  return null;
}

function areaName(a: { shape: string; feet: number }): string {
  return a.shape === "radius" ? `${a.feet}-ft radius` : a.shape === "Sphere" || a.shape === "Cylinder" ? `${a.feet}-ft-radius ${a.shape}` : `${a.feet}-ft ${a.shape}`;
}

function selfArea(a: { shape: string; feet: number }): Reach {
  if (a.shape === "Cone" || a.shape === "Line") {
    return finish([{ kind: "aim", feet: a.feet, label: `${areaName(a)}: aim it` }], `${areaName(a)} from the creature: who it catches depends on where it's aimed`);
  }
  if (a.shape === "Cube") return finish([{ kind: "aim", feet: a.feet, label: `${areaName(a)}: place it next to you` }]);
  return finish([{ kind: "area", feet: a.feet, label: `${areaName(a)}: everyone here` }]);
}

function finish(bands: Band[], note?: string): Reach {
  return { bands: [...bands].sort((a, b) => a.feet - b.feet), ...(note ? { note } : {}) };
}

/** A melee reach from the sheet's weapon attacks: the longest "reach N ft." (5 ft if none). */
export function meleeReachOf(texts: string[]): number {
  let best = 5;
  for (const t of texts) {
    const m = new RegExp(`\\breach\\s+${NUM}${FT}`, "i").exec(t);
    if (m) best = Math.max(best, Number(m[1]));
  }
  return best;
}

/** The longest band of the reaches given: the Attack tile shows how far any of its attacks reach. */
export function widest(reaches: (Reach | null)[]): Reach | null {
  const bands = reaches.flatMap((r) => r?.bands ?? []);
  if (!bands.length) return null;
  const best = new Map<BandKind, Band>();
  for (const b of bands) if (!best.has(b.kind) || best.get(b.kind)!.feet < b.feet) best.set(b.kind, b);
  return finish([...best.values()]);
}

// ------------------------------------------------------------------ distances on the grid

export type Measurement = "CHEBYSHEV" | "ALTERNATING" | "EUCLIDEAN" | "MANHATTAN";
export interface Box { min: { x: number; y: number }; max: { x: number; y: number } }

/** The cells a token covers: its size in whole cells (at least one), around its centre. */
function cells(b: Box, cell: number) {
  const w = Math.max(1, Math.round((b.max.x - b.min.x) / cell));
  const h = Math.max(1, Math.round((b.max.y - b.min.y) / cell));
  const x0 = Math.round((b.min.x + b.max.x) / 2 / cell - w / 2);
  const y0 = Math.round((b.min.y + b.max.y) / 2 / cell - h / 2);
  return { x0, x1: x0 + w, y0, y1: y0 + h };
}

/** Squares between two tokens on one axis: 0 when they overlap on it, 1 when they touch, and so on. */
function steps(a0: number, a1: number, b0: number, b1: number): number {
  const gap = Math.max(a0, b0) - Math.min(a1, b1);
  return gap >= 0 ? gap + 1 : 0;
}

/** Feet from one token to another, edge to edge, the way the grid counts: next to each other is one square. */
export function gridFeet(a: Box, b: Box, cell: number, feetPerCell: number, measurement: Measurement = "CHEBYSHEV"): number {
  const A = cells(a, cell), B = cells(b, cell);
  const dx = steps(A.x0, A.x1, B.x0, B.x1), dy = steps(A.y0, A.y1, B.y0, B.y1);
  let n: number;
  if (measurement === "MANHATTAN") n = dx + dy;
  else if (measurement === "EUCLIDEAN") n = Math.round(Math.hypot(dx, dy) * 10) / 10;
  else if (measurement === "ALTERNATING") n = Math.max(dx, dy) + Math.floor(Math.min(dx, dy) / 2);
  else n = Math.max(dx, dy);
  return n * feetPerCell;
}

/** The band a target `feet` away falls in (the nearest that reaches it), or null when it's out of reach. */
export function bandFor(reach: Reach, feet: number): Band | null {
  return reach.bands.find((b) => feet <= b.feet) ?? null;
}

// ------------------------------------------------------------------ the action bar → the map

/** Local broadcast (this browser only) from the action bar: the action being looked at, or null to clear. */
export const AIM_CHANNEL = `${BUTLER_NS}/aim`;
/** Per browser: show reach and range on the map (on unless turned off). */
export const SHOW_REACH_KEY = "butler.showReach";
export const showReach = (v: string | null) => v !== "0";

export interface Aim { unitId: string; name: string; reach: Reach }

export function isAim(x: unknown): x is Aim {
  const a = x as Aim;
  return !!a && typeof a === "object" && typeof a.unitId === "string" && typeof a.name === "string" && !!a.reach && Array.isArray(a.reach.bands)
    && a.reach.bands.every((b) => b && typeof b.feet === "number" && Number.isFinite(b.feet) && typeof b.label === "string" && ["reach", "range", "long", "area", "aim"].includes(b.kind));
}

export const BAND_STYLE: Record<BandKind, { color: string; target: string }> = {
  reach: { color: "#43a047", target: "in reach" },
  range: { color: "#1e88e5", target: "in range" },
  long: { color: "#fb8c00", target: "long range: Disadvantage" },
  area: { color: "#e53935", target: "caught in it" },
  aim: { color: "#8e24aa", target: "could be caught" },
};
