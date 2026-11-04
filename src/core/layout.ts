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
