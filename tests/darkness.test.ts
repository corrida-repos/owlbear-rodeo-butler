import { describe, expect, it } from "vitest";
import { darknessGrid, fogRects, rectCommands, type FogGrid } from "../src/core/darkness";
import type { Senses } from "../src/core/vision";

const none: Senses = { darkvision: 0, blindsight: 0, truesight: 0, tremorsense: 0, devilsSight: 0, blindBeyond: false };
const cell = 100; // px per 5-ft square
const area = { minX: 0, minY: 0, maxX: 2000, maxY: 2000 }; // 20 × 20 squares
// A Medium token in square (10, 10): centre (1050, 1050), half a square wide.
const at = (c: number, r: number) => ({ center: { x: c * cell + 50, y: r * cell + 50 }, half: 50 });
const level = (g: FogGrid, c: number, r: number) => g.levels[r * g.cols + c];
const grid = (o: Partial<Parameters<typeof darknessGrid>[0]>) => darknessGrid({ scene: "dark", area, cell, feetPerCell: 5, viewers: [], lights: [], ...o });

describe("darkness fog", () => {
  it("in darkness a creature with no light or darkvision sees only its own space", () => {
    const g = grid({ viewers: [{ ...at(10, 10), senses: none }] });
    expect(level(g, 10, 10)).toBe(0);
    expect(level(g, 11, 10)).toBe(2);
    expect([...g.levels].filter((l) => l === 0)).toHaveLength(1);
  });
  it("darkvision: darkness within it is lightly obscured, beyond is heavily obscured", () => {
    const g = grid({ viewers: [{ ...at(10, 10), senses: { ...none, darkvision: 30 } }] });
    expect(level(g, 12, 10)).toBe(1); // centre 7.5 ft from the token's edge
    expect(level(g, 16, 10)).toBe(1); // 27.5 ft
    expect(level(g, 17, 10)).toBe(2); // 32.5 ft
  });
  it("a torch: bright 20 ft is clear, the next 20 ft is lightly obscured, and it lights things for everyone", () => {
    const torch = { ...at(10, 10), bright: 20, dim: 20 };
    const g = grid({ viewers: [{ ...at(3, 3), senses: none }], lights: [torch] });
    expect(level(g, 13, 10)).toBe(0); // 12.5 ft from the torch-bearer: bright
    expect(level(g, 15, 10)).toBe(1); // 22.5 ft: dim
    expect(level(g, 19, 10)).toBe(2); // 42.5 ft: dark
  });
  it("darkvision turns the torch's dim light clear; the best of the player's units counts", () => {
    const g = grid({ viewers: [{ ...at(10, 10), senses: { ...none, darkvision: 60 } }, { ...at(0, 0), senses: none }], lights: [{ ...at(10, 10), bright: 20, dim: 20 }] });
    expect(level(g, 15, 10)).toBe(0);
    expect(level(g, 0, 0)).toBe(0);
  });
  it("dim light is a haze except in bright light and darkvision; with no units only the light counts", () => {
    const g = grid({ scene: "dim", viewers: [{ ...at(10, 10), senses: { ...none, darkvision: 30 } }] });
    expect(level(g, 12, 10)).toBe(0);
    expect(level(g, 18, 10)).toBe(1);
    expect([...g.levels].includes(2)).toBe(false);
    const nobody = grid({ lights: [{ ...at(5, 5), bright: 10, dim: 10 }] });
    expect(level(nobody, 5, 6)).toBe(0);
    expect(level(nobody, 5, 8)).toBe(1);
    expect(level(nobody, 15, 15)).toBe(2);
  });
  it("merges squares into non-overlapping rectangles that cover exactly the fogged squares", () => {
    const g = grid({ viewers: [{ ...at(10, 10), senses: { ...none, darkvision: 30 } }] });
    for (const lv of [1, 2] as const) {
      const rects = fogRects(g, lv);
      const areaSum = rects.reduce((a, r) => a + r.w * r.h, 0);
      expect(areaSum).toBe([...g.levels].filter((l) => l === lv).length * cell * cell);
      for (const r of rects) {
        for (let y = r.y; y < r.y + r.h; y += cell) for (let x = r.x; x < r.x + r.w; x += cell) expect(level(g, (x - g.x0) / cell, (y - g.y0) / cell)).toBe(lv);
      }
    }
    expect(fogRects(g, 2).length).toBeLessThan(60); // far fewer than the ~370 dark squares
    expect(rectCommands([{ x: 0, y: 0, w: 10, h: 5 }])).toEqual([[0, 0, 0], [1, 10, 0], [1, 10, 5], [1, 0, 5], [5]]);
  });
  it("judges a huge map in bigger blocks", () => {
    const g = darknessGrid({ scene: "dark", area: { minX: 0, minY: 0, maxX: 100_000, maxY: 100_000 }, cell, feetPerCell: 5, viewers: [], lights: [] });
    expect(g.cols * g.rows).toBeLessThanOrEqual(40_000);
    expect(g.cell).toBeGreaterThan(cell);
  });
});
