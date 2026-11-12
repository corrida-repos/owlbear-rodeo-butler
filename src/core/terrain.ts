/**
 * Difficult terrain zones. The GM marks drawings (rectangles, circles, triangles, hexagons, polygons, freehand
 * shapes) as difficult terrain from the context menu; they carry `dev.owlbear-butler/terrain` metadata. Every foot
 * moved inside a zone costs 1 extra foot, which the movement tracker adds to the segment's length.
 *
 * Pure geometry: zone outlines in scene pixels, and the extra cost of a straight move between two token positions.
 */
import { BUTLER_NS } from "./constants";
import type { Box, Vec2 } from "./grapple";

export const TERRAIN_KEY = `${BUTLER_NS}/terrain`;

/** Metadata stored on a zone. `style` is the drawing's look before it was marked, restored when it's unmarked. */
export interface TerrainMeta {
  difficult: true;
  style?: { strokeDash?: number[]; fillOpacity?: number };
}

export const isDifficultTerrain = (meta: Record<string, unknown>) => (meta[TERRAIN_KEY] as TerrainMeta | undefined)?.difficult === true;

/** The fields of an Owlbear Shape / Curve / Path item the outline needs. */
export interface ZoneItem {
  type: string;
  shapeType?: string;
  width?: number;
  height?: number;
  points?: Vec2[];
  position: Vec2;
  rotation: number;
  scale: Vec2;
}

/** The outline in the item's own coordinates, or null when it can only be approximated by its bounds (Path). */
export function localOutline(z: ZoneItem): Vec2[] | null {
  if (z.type === "CURVE") return z.points && z.points.length >= 3 ? z.points : null;
  if (z.type !== "SHAPE") return null;
  const w = z.width ?? 0, h = z.height ?? 0;
  switch (z.shapeType) {
    case "RECTANGLE": return [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
    case "TRIANGLE": return [{ x: 0, y: 0 }, { x: w / 2, y: h }, { x: -w / 2, y: h }];
    case "CIRCLE": return ring(32, w / 2, h / 2, 0);
    case "HEXAGON": return ring(6, w / 2, h / 2, Math.PI / 6);
    default: return null;
  }
}

const ring = (n: number, rx: number, ry: number, start: number): Vec2[] =>
  Array.from({ length: n }, (_, i) => { const a = start + (i / n) * Math.PI * 2; return { x: Math.cos(a) * rx, y: Math.sin(a) * ry }; });

function bbox(points: Vec2[]): Box {
  return {
    minX: Math.min(...points.map((p) => p.x)), minY: Math.min(...points.map((p) => p.y)),
    maxX: Math.max(...points.map((p) => p.x)), maxY: Math.max(...points.map((p) => p.y)),
  };
}

const boxPolygon = (b: Box): Vec2[] => [{ x: b.minX, y: b.minY }, { x: b.maxX, y: b.minY }, { x: b.maxX, y: b.maxY }, { x: b.minX, y: b.maxY }];

/**
 * The zone's outline in scene coordinates: scaled, rotated (degrees) and moved by the item's transform. When
 * Owlbear's own bounds are given, the outline is centred on them, so a shape whose origin isn't where we assume
 * still lands in the right place. Without an outline (Path), the bounds rectangle is used.
 */
export function zonePolygon(z: ZoneItem, bounds?: Box): Vec2[] | null {
  const local = localOutline(z);
  if (!local) return bounds ? boxPolygon(bounds) : null;
  const a = (z.rotation * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a);
  const sx = z.scale?.x ?? 1, sy = z.scale?.y ?? 1;
  let world = local.map((p) => {
    const x = p.x * sx, y = p.y * sy;
    return { x: z.position.x + x * cos - y * sin, y: z.position.y + x * sin + y * cos };
  });
  if (bounds) {
    const b = bbox(world);
    const dx = (bounds.minX + bounds.maxX) / 2 - (b.minX + b.maxX) / 2;
    const dy = (bounds.minY + bounds.maxY) / 2 - (b.minY + b.maxY) / 2;
    world = world.map((p) => ({ x: p.x + dx, y: p.y + dy }));
  }
  return world;
}

/** Even-odd ray casting. */
export function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!, b = poly[j]!;
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/**
 * Extra feet for moving a token from `a` to `b` (positions are token centres) that measured `feet` on the grid.
 * The move is split into one step per square; each step that ends with any part of the token's space (a `size` ×
 * `size` block of squares) in a zone costs its share of `feet` again. So crossing 2 difficult squares of a 6-square,
 * 30 ft move adds 10 ft.
 */
export function difficultExtra(a: Vec2, b: Vec2, feet: number, zones: Vec2[][], cell: number, size = 1): number {
  if (!zones.length || feet <= 0 || cell <= 0) return 0;
  const steps = Math.max(1, Math.round(Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) / cell));
  const n = Math.max(1, Math.round(size));
  const offsets = Array.from({ length: n }, (_, k) => (k - (n - 1) / 2) * cell);
  let hard = 0;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    const inZone = offsets.some((ox) => offsets.some((oy) => zones.some((z) => pointInPolygon({ x: p.x + ox, y: p.y + oy }, z))));
    if (inZone) hard++;
  }
  return Math.round(((feet * hard) / steps) * 10) / 10;
}
