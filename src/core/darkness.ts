/**
 * Darkness fog (part of the Vision HUD): in a dark (or dim) scene, the map is covered square by square with what the viewer's units
 * can't see. A square is clear, lightly obscured (a haze) or heavily obscured (black), judged at its centre from the
 * scene's light, every visible light source, and the best of the viewer's units' senses (vision.ts seenAs).
 * Pure geometry here; background/darkness.ts draws it.
 */
import { BUTLER_NS } from "./constants";
import { lightAt, seenAs, type Seen, type SceneLight, type Senses } from "./vision";

export const DARKNESS_ID = `${BUTLER_NS}/darkness`;

export interface Vec { x: number; y: number }
/** A unit looking: where it is (scene px), half its token's size (px; ranges count from the edge) and its senses. */
export interface Viewer { center: Vec; half: number; senses: Senses }
/** A unit shedding light (radii in feet). */
export interface Emitter { center: Vec; half: number; bright: number; dim: number }
export interface Area { minX: number; minY: number; maxX: number; maxY: number }

/** 0 = clear, 1 = lightly obscured, 2 = heavily obscured. */
export type FogLevel = 0 | 1 | 2;
export interface FogGrid { x0: number; y0: number; cell: number; cols: number; rows: number; levels: Uint8Array }

const RANK: Record<Seen, FogLevel> = { clear: 0, "lightly obscured": 1, "heavily obscured": 2 };
const NO_SENSES: Senses = { darkvision: 0, blindsight: 0, truesight: 0, tremorsense: 0, devilsSight: 0, blindBeyond: false };

/**
 * The fog over `area`, one value per grid square (squares at multiples of `cell`, as Owlbear's square grid).
 * With no viewers (a player with no units), squares are judged by the light alone.
 */
export function darknessGrid(o: { scene: SceneLight; area: Area; cell: number; feetPerCell: number; viewers: Viewer[]; lights: Emitter[]; maxCells?: number }): FogGrid {
  // A huge map is judged in bigger blocks (2×2 squares, then 4×4…) to stay quick.
  let cell = o.cell;
  const size = (c: number) => Math.ceil((o.area.maxX - o.area.minX) / c + 1) * Math.ceil((o.area.maxY - o.area.minY) / c + 1);
  while (size(cell) > (o.maxCells ?? 40_000)) cell *= 2;
  const x0 = Math.floor(o.area.minX / cell) * cell, y0 = Math.floor(o.area.minY / cell) * cell;
  const cols = Math.max(1, Math.ceil((o.area.maxX - x0) / cell)), rows = Math.max(1, Math.ceil((o.area.maxY - y0) / cell));
  const levels = new Uint8Array(cols * rows);
  const feet = (a: Vec, b: Vec, half: number) => Math.max(0, Math.hypot(a.x - b.x, a.y - b.y) - half) / o.cell * o.feetPerCell;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const p = { x: x0 + (c + 0.5) * cell, y: y0 + (r + 0.5) * cell };
      const light = lightAt(o.scene, o.lights.map((l) => ({ distance: feet(l.center, p, l.half), bright: l.bright, dim: l.dim })));
      let best: FogLevel = 2;
      if (!o.viewers.length) best = RANK[seenAs(light, NO_SENSES, Infinity).seen];
      for (const v of o.viewers) {
        const d = feet(v.center, p, v.half);
        // A creature always knows its own space, even when it can't see a thing.
        if (d === 0) { best = 0; break; }
        best = Math.min(best, RANK[seenAs(light, v.senses, d).seen]) as FogLevel;
        if (best === 0) break;
      }
      levels[r * cols + c] = best;
    }
  }
  return { x0, y0, cell, cols, rows, levels };
}

export interface Rect { x: number; y: number; w: number; h: number }

/** The squares at `level`, merged into few rectangles (runs along each row, stacked when rows repeat). */
export function fogRects(g: FogGrid, level: FogLevel): Rect[] {
  const done: Rect[] = [];
  let open = new Map<string, Rect>(); // "c0:c1" → rectangle still growing downwards
  for (let r = 0; r < g.rows; r++) {
    const next = new Map<string, Rect>();
    let c = 0;
    while (c < g.cols) {
      if (g.levels[r * g.cols + c] !== level) { c++; continue; }
      const start = c;
      while (c < g.cols && g.levels[r * g.cols + c] === level) c++;
      const key = `${start}:${c}`;
      const above = open.get(key);
      if (above) { above.h += g.cell; open.delete(key); next.set(key, above); }
      else next.set(key, { x: g.x0 + start * g.cell, y: g.y0 + r * g.cell, w: (c - start) * g.cell, h: g.cell });
    }
    done.push(...open.values());
    open = next;
  }
  done.push(...open.values());
  return done;
}

/** Owlbear path commands (MOVE 0, LINE 1, CLOSE 5) drawing these rectangles; they never overlap. */
export function rectCommands(rects: Rect[]): number[][] {
  return rects.flatMap((r) => [[0, r.x, r.y], [1, r.x + r.w, r.y], [1, r.x + r.w, r.y + r.h], [1, r.x, r.y + r.h], [5]]);
}
