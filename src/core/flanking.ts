/**
 * Flanking (DMG optional rule), worked out from token positions on a square grid: a creature is Flanked when two
 * enemies of it, both able to act and both adjacent to it, are on opposite sides or corners of its space. The DMG's
 * test: a line between the two flankers' centres passes through opposite sides or opposite corners of its space.
 * Pure; the background page feeds it token footprints and stores the automatic Flanked condition.
 */
import type { UnitState } from "./sheet";

export interface Footprint {
  id: string;
  /** Centre of the token's space, scene units. */
  cx: number;
  cy: number;
  /** Half the side of its (square) space, scene units. */
  half: number;
  /** Party members flank enemies of the party and vice versa. */
  side: "party" | "foe";
  /** Can flank: not at 0 HP, dead or incapacitated. */
  able: boolean;
}

export const FLANKED = "flanked";
const OUT_OF_IT = new Set(["dead", "incapacitated", "paralyzed", "petrified", "stunned", "unconscious"]);

/** A unit can help flank while it's up and able to act. */
export const canFlank = (state: Pick<UnitState, "hp" | "conditions">) => state.hp > 0 && !state.conditions.some((c) => OUT_OF_IT.has(c.key));

/** Touching: the two spaces share an edge or a corner (within a tenth of a cell). */
export function adjacent(a: Footprint, b: Footprint, cell: number): boolean {
  const gx = Math.abs(a.cx - b.cx) - (a.half + b.half);
  const gy = Math.abs(a.cy - b.cy) - (a.half + b.half);
  const tol = cell * 0.1;
  return gx <= tol && gy <= tol && !(gx < -tol && gy < -tol); // touching, not overlapping
}

type Edge = "left" | "right" | "top" | "bottom";

/** The edges of the target's square that the segment p→q crosses on the way in and out (corners count for both). */
function crossings(p: { x: number; y: number }, q: { x: number; y: number }, t: Footprint): Set<Edge>[] | null {
  const [x0, x1, y0, y1] = [t.cx - t.half, t.cx + t.half, t.cy - t.half, t.cy + t.half];
  const dx = q.x - p.x, dy = q.y - p.y;
  let lo = 0, hi = 1;
  for (const [pk, qk] of [[-dx, p.x - x0], [dx, x1 - p.x], [-dy, p.y - y0], [dy, y1 - p.y]] as const) {
    if (pk === 0) { if (qk < 0) return null; continue; }
    const r = qk / pk;
    if (pk < 0) lo = Math.max(lo, r); else hi = Math.min(hi, r);
    if (lo > hi) return null;
  }
  const eps = t.half * 0.02;
  const edgesAt = (u: number) => {
    const x = p.x + u * dx, y = p.y + u * dy;
    const s = new Set<Edge>();
    if (Math.abs(x - x0) <= eps) s.add("left");
    if (Math.abs(x - x1) <= eps) s.add("right");
    if (Math.abs(y - y0) <= eps) s.add("top");
    if (Math.abs(y - y1) <= eps) s.add("bottom");
    return s;
  };
  return [edgesAt(lo), edgesAt(hi)];
}

/** Whether a line between two flankers' centres passes through opposite sides or corners of the target's space. */
export function opposite(a: Footprint, b: Footprint, target: Footprint): boolean {
  const c = crossings({ x: a.cx, y: a.cy }, { x: b.cx, y: b.cy }, target);
  if (!c) return false;
  const [i, o] = c as [Set<Edge>, Set<Edge>];
  return (i.has("left") && o.has("right")) || (i.has("right") && o.has("left")) || (i.has("top") && o.has("bottom")) || (i.has("bottom") && o.has("top"));
}

/** The ids of every flanked unit. */
export function flankedUnits(units: Footprint[], cell: number): Set<string> {
  const out = new Set<string>();
  for (const t of units) {
    const near = units.filter((u) => u.id !== t.id && u.able && u.side !== t.side && adjacent(u, t, cell));
    outer: for (let i = 0; i < near.length; i++) {
      for (let j = i + 1; j < near.length; j++) {
        if (opposite(near[i]!, near[j]!, t)) { out.add(t.id); break outer; }
      }
    }
  }
  return out;
}
