/**
 * Movement (spent speed) tracker, F14. The active unit's path since its turn started is a list of token positions;
 * each segment's length comes from the scene's grid measurement (Owlbear's getDistance × the grid scale), so the
 * math here takes segment lengths in feet and stays pure.
 */
import { speedPenalty } from "./conditions";
import { BUTLER_NS } from "./constants";
import { isGrappling } from "./grapple";
import type { UnitSheet, UnitState } from "./sheet";
import type { GameSystem } from "./systems";

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
  dash: boolean;
}

export function readMovement(sceneMeta: Record<string, unknown>): MovementState | null {
  const m = sceneMeta[MOVEMENT_KEY] as MovementState | undefined;
  return m && m.v === 1 && typeof m.unitId === "string" && Array.isArray(m.path) && Array.isArray(m.segments) ? m : null;
}

export const startMovement = (unitId: string, round: number, at: Vec2): MovementState => ({ v: 1, unitId, round, path: [at], segments: [], dash: false });

export const movedFeet = (m: Pick<MovementState, "segments">) => round1(m.segments.reduce((s, d) => s + d, 0));
const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * The movement limit: the unit's fastest speed (walk, fly, swim, climb, burrow) minus penalties, halved while
 * grappling (dragging a creature), then doubled by Dash.
 */
export function speedLimit(sheet: Pick<UnitSheet, "speed">, opts: { dash?: boolean; penalty?: number; halve?: boolean } = {}): number {
  const s = sheet.speed;
  const base = Math.max(s.walk ?? 0, s.fly ?? 0, s.swim ?? 0, s.climb ?? 0, s.burrow ?? 0);
  let v = Math.max(0, base - (opts.penalty ?? 0));
  if (opts.halve) v = Math.floor(v / 2);
  return opts.dash ? v * 2 : v;
}

/** A unit's limit this turn, from its conditions: exhaustion (5.5E) and Grappling. */
export const unitSpeedLimit = (system: Pick<GameSystem, "rules">, sheet: Pick<UnitSheet, "speed">, state: Pick<UnitState, "conditions">, dash: boolean) =>
  speedLimit(sheet, { dash, penalty: speedPenalty(system, state), halve: isGrappling(state) });

/** Records a move to `to` that measured `feet`; ignores non-moves. */
export function addStep(m: MovementState, to: Vec2, feet: number): MovementState {
  const last = m.path[m.path.length - 1]!;
  if (Math.abs(last.x - to.x) < 1e-6 && Math.abs(last.y - to.y) < 1e-6) return m;
  return { ...m, path: [...m.path, to], segments: [...m.segments, Math.max(0, feet)] };
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
    return { state: { ...m, path: [start], segments: [] }, position: start };
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
      return { state: { ...m, path, segments }, position: exact ? b : p };
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
