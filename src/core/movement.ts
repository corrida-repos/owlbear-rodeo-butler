/**
 * Movement (spent speed) tracker, F14. The active unit's path since its turn started is a list of token positions;
 * each segment's length comes from the scene's grid measurement (Owlbear's getDistance × the grid scale), so the
 * math here takes segment lengths in feet and stays pure.
 */
import { BUTLER_NS } from "./constants";
import type { UnitSheet } from "./sheet";

export const MOVEMENT_KEY = `${BUTLER_NS}/movement`;

export interface Vec2 { x: number; y: number }

/** Scene metadata record, written by the GM's client. */
export interface MovementState {
  v: 1;
  unitId: string;
  round: number;
  /** Token positions: the turn's start, then each place it stopped. */
  path: Vec2[];
  /** Feet of each segment (path[i] → path[i+1]), from the grid's measurement rules. */
  segments: number[];
  /** Alternating-diagonal grids only: diagonal squares in each segment, so the 5/10 ft pattern carries on across stops. */
  diagonals?: number[];
  dash: boolean;
}

export function readMovement(sceneMeta: Record<string, unknown>): MovementState | null {
  const m = sceneMeta[MOVEMENT_KEY] as MovementState | undefined;
  return m && m.v === 1 && typeof m.unitId === "string" && Array.isArray(m.path) && Array.isArray(m.segments) ? m : null;
}

export const startMovement = (unitId: string, round: number, at: Vec2): MovementState => ({ v: 1, unitId, round, path: [at], segments: [], dash: false });

export const movedFeet = (m: Pick<MovementState, "segments">) => round1(m.segments.reduce((s, d) => s + d, 0));
const round1 = (n: number) => Math.round(n * 10) / 10;

/** The movement limit: the unit's fastest speed (walk, fly, swim, climb, burrow), doubled by Dash, minus penalties. */
export function speedLimit(sheet: Pick<UnitSheet, "speed">, opts: { dash?: boolean; penalty?: number } = {}): number {
  const s = sheet.speed;
  const base = Math.max(s.walk ?? 0, s.fly ?? 0, s.swim ?? 0, s.climb ?? 0, s.burrow ?? 0);
  const v = Math.max(0, base - (opts.penalty ?? 0));
  return opts.dash ? v * 2 : v;
}

/** Records a move to `to` that measured `feet`; ignores non-moves. `diagonals`: diagonal squares in it (alternating grids). */
export function addStep(m: MovementState, to: Vec2, feet: number, diagonals?: number): MovementState {
  const last = m.path[m.path.length - 1]!;
  if (Math.abs(last.x - to.x) < 1e-6 && Math.abs(last.y - to.y) < 1e-6) return m;
  const next: MovementState = { ...m, path: [...m.path, to], segments: [...m.segments, Math.max(0, feet)] };
  if (diagonals !== undefined || m.diagonals) next.diagonals = [...(m.diagonals ?? m.segments.map(() => 0)), diagonals ?? 0];
  return next;
}

/** Diagonal squares moved so far this turn (alternating grids). */
export const diagonalsSoFar = (m: Pick<MovementState, "diagonals">) => (m.diagonals ?? []).reduce((s, d) => s + d, 0);

/**
 * DMG "Diagonal Movement" (the 5/10 rule): the first diagonal square counts 5 ft, the second 10 ft, and so on for the
 * whole move, even with straight moves or stops in between. `dx`, `dy`: whole squares moved on each axis; `prior`:
 * diagonal squares already moved this turn. Returns the feet and the diagonal squares in this move.
 */
export function alternatingStep(dx: number, dy: number, prior: number, feetPerCell = 5): { feet: number; diagonals: number } {
  const ax = Math.abs(Math.round(dx)), ay = Math.abs(Math.round(dy));
  const diag = Math.min(ax, ay), straight = Math.max(ax, ay) - diag;
  let feet = straight * feetPerCell;
  for (let k = 1; k <= diag; k++) feet += (prior + k) % 2 === 0 ? feetPerCell * 2 : feetPerCell;
  return { feet, diagonals: diag };
}

/** Where Rewind goes: the last multiple of 5 ft below the distance moved (13 → 10; 10 → 5), not below 0. */
export function rewindTarget(moved: number): number {
  const eps = 1e-6;
  const down = Math.floor((moved - eps) / 5) * 5;
  return Math.max(0, down);
}

/**
 * Rewinds the path to `target` feet along it: keeps the points before that distance and adds the interpolated point
 * inside the segment where it falls. Returns the new state and the token's new position.
 */
export function rewind(m: MovementState, target = rewindTarget(movedFeet(m))): { state: MovementState; position: Vec2 } {
  if (!m.segments.length || target <= 0) {
    const start = m.path[0]!;
    return { state: { ...m, path: [start], segments: [], ...(m.diagonals ? { diagonals: [] } : {}) }, position: start };
  }
  let acc = 0;
  for (let i = 0; i < m.segments.length; i++) {
    const seg = m.segments[i]!;
    if (acc + seg >= target - 1e-6) {
      const a = m.path[i]!, b = m.path[i + 1]!;
      const t = seg > 0 ? (target - acc) / seg : 0;
      const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      const exact = t >= 1 - 1e-6;
      const path = [...m.path.slice(0, i + 1), exact ? b : p];
      const segments = [...m.segments.slice(0, i), exact ? seg : round1(target - acc)];
      const state: MovementState = { ...m, path, segments };
      if (m.diagonals) state.diagonals = [...m.diagonals.slice(0, i), exact ? m.diagonals[i] ?? 0 : Math.round((m.diagonals[i] ?? 0) * t)];
      return { state, position: exact ? b : p };
    }
    acc += seg;
  }
  return { state: m, position: m.path[m.path.length - 1]! };
}

/** Snaps an interpolated point to the grid: the nearest cell centre (Owlbear positions are token centres). */
export function snapToCell(p: Vec2, cell: number, offset: Vec2 = { x: 0, y: 0 }): Vec2 {
  const sx = Math.round((p.x - offset.x - cell / 2) / cell) * cell + cell / 2 + offset.x;
  const sy = Math.round((p.y - offset.y - cell / 2) / cell) * cell + cell / 2 + offset.y;
  return { x: sx, y: sy };
}
