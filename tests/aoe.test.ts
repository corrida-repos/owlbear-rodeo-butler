import { describe, expect, it } from "vitest";
import { coveredCells, tokenCells, tokenInArea, type AoeMeta } from "../src/core/aoe";

const pl = (x: number, y: number, rotation = 0) => ({ origin: { x, y }, rotation, dpi: 100, feetPerCell: 5 });
const keys = (a: AoeMeta, p: ReturnType<typeof pl>) => coveredCells(a, p).map((c) => `${c.col},${c.row}`).sort();

describe("area templates: a square counts if the area covers at least half of it", () => {
  it("a 5-ft-radius sphere on an intersection covers the 4 squares around it", () => {
    // Each of the 4 squares is ~78.5% covered by the quarter circle.
    expect(keys({ shape: "sphere", size: 5 }, pl(500, 500))).toEqual(["4,4", "4,5", "5,4", "5,5"]);
  });
  it("a 20-ft-radius sphere on an intersection covers the DMG's 8×8 minus the corners", () => {
    const n = coveredCells({ shape: "sphere", size: 20 }, pl(1000, 1000)).length;
    // 64 squares in the bounding box; the 3 outermost squares in each corner are under half covered.
    expect(n).toBe(52);
  });
  it("a 10-ft cube from a corner covers exactly 2×2 squares", () => {
    expect(keys({ shape: "cube", size: 10 }, pl(300, 300))).toEqual(["3,3", "3,4", "4,3", "4,4"]);
  });
  it("a 30-ft line, 5 ft wide, along a row covers 6 squares; rotated 90° it runs down a column", () => {
    expect(keys({ shape: "line", size: 30, width: 5 }, pl(100, 350))).toEqual(["1,3", "2,3", "3,3", "4,3", "5,3", "6,3"]);
    expect(keys({ shape: "line", size: 30, width: 5 }, pl(350, 100, 90))).toEqual(["3,1", "3,2", "3,3", "3,4", "3,5", "3,6"]);
  });
  it("a 15-ft cone widens with distance", () => {
    const cells = coveredCells({ shape: "cone", size: 15 }, pl(100, 350));
    const cols = (c: number) => cells.filter((x) => x.col === c).length;
    expect(cols(1)).toBe(1);
    expect(cols(3)).toBeGreaterThanOrEqual(cols(2));
    expect(cells.every((c) => c.col >= 1 && c.col <= 3)).toBe(true);
  });
  it("an emanation counts from the edge of the creature's space", () => {
    // Medium creature on square (5,5): 5-ft emanation = the 3×3 block around it.
    expect(coveredCells({ shape: "emanation", size: 5, half: { w: 50, h: 50 } }, pl(550, 550)).length).toBe(9);
  });
  it("a token is in the area if any of its squares is", () => {
    const cells = coveredCells({ shape: "cube", size: 10 }, pl(300, 300));
    expect(tokenInArea(cells, tokenCells({ min: { x: 400, y: 400 }, max: { x: 500, y: 500 } }, 100))).toBe(true);
    expect(tokenInArea(cells, tokenCells({ min: { x: 500, y: 400 }, max: { x: 600, y: 500 } }, 100))).toBe(false);
    // Large token touching the area with one square.
    expect(tokenInArea(cells, tokenCells({ min: { x: 400, y: 200 }, max: { x: 600, y: 400 } }, 100))).toBe(true);
  });
});

describe("areas read from an entry", async () => {
  const { areaOf } = await import("../src/core/reach");
  it("Fireball: a sphere at a point; a breath: a cone from the creature; an aura: an emanation", () => {
    expect(areaOf("Each creature in a 20-foot-radius Sphere centered on a point within range makes a Dexterity save")).toEqual({ shape: "sphere", size: 20, selfCentred: false });
    expect(areaOf("The dragon exhales fire in a 60-foot Cone.")).toEqual({ shape: "cone", size: 60, selfCentred: true });
    expect(areaOf("Each creature in a 10-foot Emanation originating from it")).toMatchObject({ shape: "emanation", selfCentred: true });
    expect(areaOf("Melee Attack Roll: +5, reach 5 ft.")).toBeNull();
  });
});
