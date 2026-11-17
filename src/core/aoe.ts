/**
 * Area-of-effect templates on a square grid (2024 DMG "Areas of Effect"): an area covering at least half of a square
 * affects the whole square. A template is a shared map item (the outline, which anyone can drag and rotate) carrying
 * its shape and size in metadata; every client highlights the affected squares locally, and DM Tools lists the units
 * in them. Pure geometry here, in scene pixels.
 *
 * Shapes, in the template's own frame (origin = the item's position, x = the direction it's rotated to):
 *  - Sphere / Cylinder: radius around the origin (put it on a grid intersection, as the DMG suggests).
 *  - Cube: a square from the origin corner along +x and +y.
 *  - Cone: from the origin along +x; its width at any distance equals that distance (PHB 2024).
 *  - Line: from the origin along +x, `width` wide (5 ft by default).
 *  - Emanation: everything within the radius of the creature's space (the template sits on that creature).
 */
import { BUTLER_NS } from "./constants";

export const AOE_KEY = `${BUTLER_NS}/aoe`;

export type AoeShape = "sphere" | "cylinder" | "cube" | "cone" | "line" | "emanation";
export const AOE_SHAPES: { key: AoeShape; label: string }[] = [
  { key: "sphere", label: "Sphere (radius)" }, { key: "cylinder", label: "Cylinder (radius)" }, { key: "cube", label: "Cube (side)" },
  { key: "cone", label: "Cone (length)" }, { key: "line", label: "Line (length)" }, { key: "emanation", label: "Emanation (from a unit)" },
];

/** Stored on the template item. `half`: the creature's space for an Emanation (half width/height, px). */
export interface AoeMeta { shape: AoeShape; size: number; width?: number; label?: string; half?: { w: number; h: number }; unitId?: string }

export function readAoe(meta: Record<string, unknown>): AoeMeta | null {
  const a = meta[AOE_KEY] as AoeMeta | undefined;
  return a && typeof a.shape === "string" && typeof a.size === "number" && a.size > 0 ? a : null;
}

export interface Vec { x: number; y: number }
export interface Placement { origin: Vec; rotation: number; dpi: number; feetPerCell: number }

/** Whether a point (template frame, px) is inside the area. */
export function insideLocal(a: AoeMeta, x: number, y: number, ppf: number): boolean {
  const s = a.size * ppf;
  switch (a.shape) {
    case "sphere": case "cylinder": return x * x + y * y <= s * s + 1e-6;
    case "cube": return x >= -1e-6 && y >= -1e-6 && x <= s + 1e-6 && y <= s + 1e-6;
    case "cone": return x >= 0 && x <= s + 1e-6 && Math.abs(y) <= x / 2 + 1e-6;
    case "line": return x >= 0 && x <= s + 1e-6 && Math.abs(y) <= ((a.width ?? 5) * ppf) / 2 + 1e-6;
    case "emanation": {
      const hw = a.half?.w ?? 0, hh = a.half?.h ?? 0;
      const dx = Math.max(0, Math.abs(x) - hw), dy = Math.max(0, Math.abs(y) - hh);
      return dx * dx + dy * dy <= s * s + 1e-6;
    }
  }
}

/** Scene point → template frame. */
function toLocal(p: Vec, pl: Placement): Vec {
  const r = (-pl.rotation * Math.PI) / 180;
  const dx = p.x - pl.origin.x, dy = p.y - pl.origin.y;
  return { x: dx * Math.cos(r) - dy * Math.sin(r), y: dx * Math.sin(r) + dy * Math.cos(r) };
}

/** How far the area can reach from its origin, px (to bound the squares checked). */
function extent(a: AoeMeta, ppf: number): number {
  const s = a.size * ppf;
  if (a.shape === "cube") return s * Math.SQRT2;
  if (a.shape === "cone") return s * Math.hypot(1, 0.5);
  if (a.shape === "line") return Math.hypot(s, ((a.width ?? 5) * ppf) / 2);
  if (a.shape === "emanation") return s + Math.hypot(a.half?.w ?? 0, a.half?.h ?? 0);
  return s;
}

export interface Cell { col: number; row: number }
const SAMPLES = 8;

/** Squares (col,row, corners at multiples of `dpi`) the area covers by at least half. */
export function coveredCells(a: AoeMeta, pl: Placement): Cell[] {
  const ppf = pl.dpi / pl.feetPerCell;
  const e = extent(a, ppf);
  const c0 = Math.floor((pl.origin.x - e) / pl.dpi), c1 = Math.ceil((pl.origin.x + e) / pl.dpi);
  const r0 = Math.floor((pl.origin.y - e) / pl.dpi), r1 = Math.ceil((pl.origin.y + e) / pl.dpi);
  const out: Cell[] = [];
  const step = pl.dpi / SAMPLES;
  for (let row = r0; row < r1; row++) {
    for (let col = c0; col < c1; col++) {
      let hit = 0;
      for (let i = 0; i < SAMPLES; i++) for (let j = 0; j < SAMPLES; j++) {
        const l = toLocal({ x: col * pl.dpi + (i + 0.5) * step, y: row * pl.dpi + (j + 0.5) * step }, pl);
        if (insideLocal(a, l.x, l.y, ppf)) hit++;
      }
      if (hit * 2 >= SAMPLES * SAMPLES) out.push({ col, row });
    }
  }
  return out;
}

/** The squares a token covers, from its bounds (at least one; Tiny creatures count the square they're in). */
export function tokenCells(b: { min: Vec; max: Vec }, dpi: number): Cell[] {
  const w = Math.max(1, Math.round((b.max.x - b.min.x) / dpi)), h = Math.max(1, Math.round((b.max.y - b.min.y) / dpi));
  const c0 = Math.round((b.min.x + b.max.x) / 2 / dpi - w / 2), r0 = Math.round((b.min.y + b.max.y) / 2 / dpi - h / 2);
  const out: Cell[] = [];
  for (let r = r0; r < r0 + h; r++) for (let c = c0; c < c0 + w; c++) out.push({ col: c, row: r });
  return out;
}

/** Whether any of the token's squares is affected. */
export function tokenInArea(cells: Cell[], token: Cell[]): boolean {
  const set = new Set(cells.map((c) => `${c.col},${c.row}`));
  return token.some((c) => set.has(`${c.col},${c.row}`));
}

/** Outline points (template frame, px) for a Curve item: Cone and Line. */
export function outline(a: AoeMeta, ppf: number): Vec[] {
  const s = a.size * ppf;
  if (a.shape === "cone") return [{ x: 0, y: 0 }, { x: s, y: -s / 2 }, { x: s, y: s / 2 }];
  const w = ((a.width ?? 5) * ppf) / 2;
  return [{ x: 0, y: -w }, { x: s, y: -w }, { x: s, y: w }, { x: 0, y: w }];
}

export const aoeName = (a: AoeMeta) => a.label || (a.shape === "line" ? `${a.size}-ft Line (${a.width ?? 5} ft wide)` : a.shape === "sphere" || a.shape === "cylinder" ? `${a.size}-ft-radius ${a.shape[0]!.toUpperCase()}${a.shape.slice(1)}` : `${a.size}-ft ${a.shape[0]!.toUpperCase()}${a.shape.slice(1)}`);
