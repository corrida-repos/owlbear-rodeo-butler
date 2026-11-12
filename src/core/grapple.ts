/**
 * Grappling: a linked pair of conditions. The grappler gets "Grappling" (with = the grappled unit) and the target
 * gets "Grappled" (with = the grappler). While grappling:
 *  - the grappler moves at half speed (see movement.ts `unitSpeedLimit`);
 *  - the grappled token is kept adjacent to the grappler (the primary GM client moves it, see background/grapple.ts);
 *  - the grappler has +2 AC against attacks whose line passes through the grappled creature (it's in the way).
 * Pure geometry here; positions and boxes are scene pixels.
 */
import type { ConditionInstance, UnitState } from "./sheet";

export interface Vec2 { x: number; y: number }
export interface Box { minX: number; minY: number; maxX: number; maxY: number }

export const GRAPPLE_AC_BONUS = 2;

export const isGrappleKey = (key: string) => key === "grappling" || key === "grappled";
/** The key the partner unit carries: Grappling ↔ Grappled. */
export const partnerKey = (key: string): string | null => key === "grappling" ? "grappled" : key === "grappled" ? "grappling" : null;

/** Whether `c` is the other half of `of`, a linked condition carried by unit `ofOwner`. */
export const isPartnerOf = (c: ConditionInstance, of: ConditionInstance, ofOwner: string) =>
  c.key === partnerKey(of.key) && c.with === ofOwner;

export const isGrappling = (state: Pick<UnitState, "conditions">) => state.conditions.some((c) => c.key === "grappling");
/** Ids of the units this one is grappling. */
export const grappledBy = (state: Pick<UnitState, "conditions">): string[] =>
  state.conditions.filter((c) => c.key === "grappling" && c.with).map((c) => c.with!);

const width = (b: Box) => b.maxX - b.minX;
const height = (b: Box) => b.maxY - b.minY;
export const centre = (b: Box): Vec2 => ({ x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 });

/** Gap between two boxes on each axis (negative = overlap). */
function gaps(a: Box, b: Box) {
  return { x: Math.max(a.minX - b.maxX, b.minX - a.maxX), y: Math.max(a.minY - b.maxY, b.minY - a.maxY) };
}

/** Boxes overlap by more than the tolerance on both axes. */
export function overlaps(a: Box, b: Box, tol: number): boolean {
  const g = gaps(a, b);
  return g.x < -tol && g.y < -tol;
}

/** Touching (side or corner, within a quarter cell) without overlapping: the 5 ft "adjacent" of a grid. */
export function areAdjacent(a: Box, b: Box, cell: number): boolean {
  const tol = cell * 0.25;
  const g = gaps(a, b);
  return g.x <= tol && g.y <= tol && !overlaps(a, b, tol);
}

/**
 * Where to put the grappled token so it's adjacent to the grappler: the free spot next to the grappler nearest to
 * where it is now (so it trails behind as the grappler moves). Returns the token's new centre, or null if it's already
 * adjacent. Spots overlapping `occupied` boxes (other tokens) are used only if nothing else is free.
 */
export function adjacentSpot(grappler: Box, target: Box, cell: number, occupied: Box[] = []): Vec2 | null {
  if (areAdjacent(grappler, target, cell)) return null;
  const tol = cell * 0.25;
  // Footprint on the grid: whole cells, at least one (a Tiny creature still takes a square's spot here).
  const tw = Math.max(1, Math.round(width(target) / cell)) * cell;
  const th = Math.max(1, Math.round(height(target) / cell)) * cell;
  const nx = Math.round((width(grappler) + tw) / cell);
  const ny = Math.round((height(grappler) + th) / cell);
  const now = centre(target);
  let best: { c: Vec2; score: number } | null = null;
  for (let i = 0; i <= nx; i++) {
    for (let j = 0; j <= ny; j++) {
      const x = grappler.minX - tw + i * cell;
      const y = grappler.minY - th + j * cell;
      const ring = i === 0 || i === nx || j === 0 || j === ny;
      if (!ring) continue;
      const box = { minX: x, minY: y, maxX: x + tw, maxY: y + th };
      const c = centre(box);
      const blocked = occupied.some((o) => overlaps(o, box, tol));
      const score = Math.hypot(c.x - now.x, c.y - now.y) + (blocked ? 1e9 : 0);
      if (!best || score < best.score - 1e-6) best = { c, score };
    }
  }
  return best?.c ?? null;
}

/**
 * Whether the line from `from` to `to` passes through `box` (shrunk by `inset` on each side, so grazing a corner
 * doesn't count). Used for "the attack goes through the grappled creature".
 */
export function intercepts(from: Vec2, to: Vec2, box: Box, inset = 0): boolean {
  const b = { minX: box.minX + inset, minY: box.minY + inset, maxX: box.maxX - inset, maxY: box.maxY - inset };
  if (b.minX >= b.maxX || b.minY >= b.maxY) return false;
  // Liang–Barsky clipping of the segment against the box.
  const dx = to.x - from.x, dy = to.y - from.y;
  let t0 = 0, t1 = 1;
  const edges: [number, number][] = [[-dx, from.x - b.minX], [dx, b.maxX - from.x], [-dy, from.y - b.minY], [dy, b.maxY - from.y]];
  for (const [p, q] of edges) {
    if (p === 0) { if (q < 0) return false; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
    else { if (r < t0) return false; if (r < t1) t1 = r; }
  }
  return t0 <= t1;
}
