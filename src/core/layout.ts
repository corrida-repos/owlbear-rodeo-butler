import { SIZE_CELLS } from "./constants";
import type { EncounterPackage, MapSpec } from "./schema";

export interface Vec2 { x: number; y: number }
export interface Bounds { min: Vec2; max: Vec2 }

/**
 * Coordinate model
 * - Scene units: one grid cell = sceneDpi units (OBR default 150).
 * - The map image is placed so that its grid origin (offsetPx) lands on `origin`,
 *   which is itself snapped to a scene grid intersection; so map cells == scene cells.
 * - Map image item: grid.dpi = image px per cell, grid.offset = offsetPx, position = origin.
 */
export interface MapGeometry {
  position: Vec2;
  dpi: number;
  offset: Vec2;
  width: number;
  height: number;
}

/** Scales the package grid numbers if the served image has a different pixel size (e.g. re-encoded on upload). */
export function mapGeometry(map: MapSpec, actual: { width: number; height: number }, origin: Vec2): MapGeometry {
  const k = actual.width / map.width;
  return {
    position: origin,
    dpi: map.grid.cellPx * k,
    offset: { x: map.grid.offsetPx.x * k, y: map.grid.offsetPx.y * k },
    width: actual.width,
    height: actual.height,
  };
}

/** Center of a token whose top-left cell is `cell` and which spans `sizeCells` cells. */
export function tokenCenter(cell: Vec2, sizeCells: number, origin: Vec2, sceneDpi: number): Vec2 {
  return {
    x: origin.x + (cell.x + sizeCells / 2) * sceneDpi,
    y: origin.y + (cell.y + sizeCells / 2) * sceneDpi,
  };
}

/** Token image grid: image dpi such that the image spans `sizeCells` cells at scale 1; offset = image center. */
export function tokenImageGrid(width: number, height: number, sizeCells: number) {
  return { dpi: Math.max(width, height) / sizeCells, offset: { x: width / 2, y: height / 2 } };
}

/** The size categories a token can be set to from the right-click menu, smallest first. */
export const TOKEN_SIZES = ["T", "S", "M", "L", "H", "G"] as const;
export type TokenSize = (typeof TOKEN_SIZES)[number];

/**
 * A token's footprint in map cells from its image and image grid (and any manual scale), and the size category that
 * matches it. Small and Medium both fill one cell, so a one-cell token reads as Medium.
 */
export function tokenCells(image: { width: number; height: number }, grid: { dpi: number }, scale: { x: number; y: number } = { x: 1, y: 1 }): number {
  return (Math.max(image.width, image.height) / grid.dpi) * Math.max(Math.abs(scale.x), Math.abs(scale.y));
}
export function sizeForCells(cells: number): TokenSize | null {
  const match = (["T", "M", "L", "H", "G"] as const).find((s) => Math.abs(SIZE_CELLS[s]! - cells) < 0.05);
  return match ?? null;
}

/**
 * What resizing a token to `size` writes: the image grid for that footprint, scale back to 1 (a manual stretch would
 * throw the size off), and how to snap it: an even footprint (Large, Gargantuan) sits on grid corners, an odd one
 * (Tiny inside a cell, Small, Medium, Huge) on a cell centre.
 */
export function resizeFor(image: { width: number; height: number }, size: TokenSize) {
  const cells = SIZE_CELLS[size]!;
  return { grid: tokenImageGrid(image.width, image.height, cells), scale: { x: 1, y: 1 }, snap: cells % 2 === 0 ? "corners" as const : "center" as const };
}

const snap = (v: number, dpi: number) => Math.ceil(v / dpi) * dpi;

/** Place the new map at (0,0) on an empty scene, otherwise to the right of existing maps with a 2-cell gap. */
export function chooseMapOrigin(existingMapBounds: Bounds | null, sceneDpi: number, mode: "auto" | "origin" = "auto"): Vec2 {
  if (mode === "origin" || !existingMapBounds) return { x: 0, y: 0 };
  return { x: snap(existingMapBounds.max.x, sceneDpi) + 2 * sceneDpi, y: snap(existingMapBounds.min.y, sceneDpi) };
}

/** Sanity checks on placements: off-map and overlapping footprints. */
export function checkPlacements(pkg: EncounterPackage): string[] {
  const warnings: string[] = [];
  const { cols, rows } = pkg.map.grid;
  const occupied = new Map<string, string>();
  for (const c of pkg.creatures) {
    const sb = pkg.statblocks[c.statblock];
    const size = sb ? SIZE_CELLS[sb.size] ?? 1 : 1;
    if (c.cell.x < 0 || c.cell.y < 0 || c.cell.x + size > cols || c.cell.y + size > rows)
      warnings.push(`${c.name} at (${c.cell.x},${c.cell.y}) is partly outside the ${cols}×${rows} map grid`);
    for (let dx = 0; dx < Math.max(1, size); dx++)
      for (let dy = 0; dy < Math.max(1, size); dy++) {
        const k = `${Math.floor(c.cell.x + dx)},${Math.floor(c.cell.y + dy)}`;
        const other = occupied.get(k);
        if (other && other !== c.name) warnings.push(`${c.name} overlaps ${other} at cell (${k})`);
        else occupied.set(k, c.name);
      }
  }
  return [...new Set(warnings)];
}
