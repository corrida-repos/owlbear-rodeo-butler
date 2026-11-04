import { describe, expect, it } from "vitest";
import { FORGE_DEFAULT_DND5E } from "../src/core/constants";
import { detectForgeSystem, validateForgeMetadata } from "../src/core/forge";
import { chooseMapOrigin, mapGeometry, tokenCenter, tokenImageGrid } from "../src/core/layout";
import { checkAssetUrl } from "../src/core/importer";

describe("Forge dictionary", () => {
  it("covers Z001..Z042 exactly once", () => {
    const bids = FORGE_DEFAULT_DND5E.map((a) => a.bid).sort();
    expect(bids).toEqual(Array.from({ length: 42 }, (_, i) => `Z${String(i + 1).padStart(3, "0")}`));
  });
  it("rejects unknown BIDs and wrong types", () => {
    const errs = validateForgeMetadata({
      "com.battle-system.forge/Z999": 1,
      "com.battle-system.forge/Z005": "11",
      "com.battle-system.forge/Z035": [{ name: "Bite" }],
      "com.battle-system.forge/name": "Wolf 1",
      "other.ext/x": 1,
    });
    expect(errs).toHaveLength(3);
  });
  it("detects custom systems from room metadata", () => {
    expect(detectForgeSystem({}).kind).toBe("default");
    expect(detectForgeSystem({ "com.battle-system.forge/SnapshotPublicId": "abc", "com.battle-system.forge/SystemName": "PF2" }))
      .toEqual({ kind: "custom", name: "PF2", snapshotId: "abc" });
  });
});

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
