import { describe, expect, it } from "vitest";
import { chooseMapOrigin, mapGeometry, resizeFor, sizeForCells, tokenCells, tokenCenter, tokenImageGrid, TOKEN_SIZES } from "../src/core/layout";
import { checkAssetUrl } from "../src/core/importer";

describe("layout", () => {
  it("token centers and image grid", () => {
    expect(tokenCenter({ x: 2, y: 3 }, 1, { x: 0, y: 0 }, 150)).toEqual({ x: 375, y: 525 });
    expect(tokenCenter({ x: 2, y: 3 }, 2, { x: 300, y: 0 }, 150)).toEqual({ x: 300 + 450, y: 600 });
    expect(tokenImageGrid(280, 280, 2)).toEqual({ dpi: 140, offset: { x: 140, y: 140 } });
  });
  it("rescales map grid if the served image size differs", () => {
    const map = { name: "m", asset: "map", width: 1400, height: 980, grid: { cellPx: 70, offsetPx: { x: 10, y: 20 }, cols: 20, rows: 14, scale: "5ft", type: "SQUARE" as const } };
    expect(mapGeometry(map, { width: 700, height: 490 }, { x: 0, y: 0 })).toMatchObject({ dpi: 35, offset: { x: 5, y: 10 } });
  });
  it("places new maps beside existing ones", () => {
    expect(chooseMapOrigin(null, 150)).toEqual({ x: 0, y: 0 });
    expect(chooseMapOrigin({ min: { x: 0, y: 0 }, max: { x: 3000, y: 2000 } }, 150)).toEqual({ x: 3300, y: 0 });
  });
});

describe("asset URL policy", () => {
  it("allows public https only", () => {
    expect(checkAssetUrl("https://raw.githubusercontent.com/x.webp")).toBeNull();
    expect(checkAssetUrl("http://example.com/x.png")).toMatch(/https/);
    expect(checkAssetUrl("https://localhost:5173/x.png")).toMatch(/not reachable/);
    expect(checkAssetUrl("blob:https://www.owlbear.rodeo/123")).toMatch(/only work/);
    expect(checkAssetUrl("https://192.168.1.4/x.png")).toMatch(/not reachable/);
  });
});

describe("token size (right-click → Set size)", () => {
  const img = { width: 300, height: 280 };
  it("reads a token's size from its image grid and scale", () => {
    expect(sizeForCells(tokenCells(img, { dpi: 300 }))).toBe("M");
    expect(sizeForCells(tokenCells(img, { dpi: 150 }))).toBe("L");
    expect(sizeForCells(tokenCells(img, { dpi: 300 }, { x: 3, y: 3 }))).toBe("H"); // stretched by hand
    expect(sizeForCells(tokenCells(img, { dpi: 600 }))).toBe("T");
    expect(sizeForCells(tokenCells(img, { dpi: 200 }))).toBeNull(); // 1.5 cells: no category
  });

  it("each size: footprint, scale reset, and corner snapping only for even footprints", () => {
    expect(TOKEN_SIZES.map((s) => [s, tokenCells(img, resizeFor(img, s).grid), resizeFor(img, s).snap])).toEqual([
      ["T", 0.5, "center"], ["S", 1, "center"], ["M", 1, "center"], ["L", 2, "corners"], ["H", 3, "center"], ["G", 4, "corners"],
    ]);
    expect(resizeFor(img, "G").scale).toEqual({ x: 1, y: 1 });
    expect(resizeFor(img, "L").grid.offset).toEqual({ x: 150, y: 140 }); // centred
  });
});
