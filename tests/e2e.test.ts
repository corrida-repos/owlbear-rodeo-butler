import { beforeEach, describe, expect, it } from "vitest";
import data from "./fixtures/5etools-xmm-sample.json";
import source from "../encounters/wolves-test/encounter.source.json";
import { buildPackage, type EncounterSource } from "../src/core/builder";
import { BUTLER_ITEM_KEY, BUTLER_SCENE_KEY } from "../src/core/constants";
import { seededRng } from "../src/core/dice";
import { findMonster } from "../src/core/fivetools";
import { analyse, executeImport, rollbackImport, type ImportOptions } from "../src/core/importer";
import { validatePackage, type EncounterPackage } from "../src/core/schema";
import { FakeScene } from "./fakeGateway";

const F = (k: string) => `com.battle-system.forge/${k}`;

function wolvesPackage(): EncounterPackage {
  const src = {
    ...(source as any),
    map: { ...(source as any).map, image: { kind: "url", url: "https://example.org/enc/assets/forest-clearing.png" }, width: 1400, height: 980 },
  } as EncounterSource;
  return buildPackage(src, { fivetoolsMonster: (n, s) => findMonster(data, n, s), rng: seededRng(2026), now: () => new Date("2026-11-04T12:00:00Z") });
}

const resolvedAssets = (pkg: EncounterPackage): ImportOptions["resolvedAssets"] => ({
  map: { url: "https://example.org/enc/assets/forest-clearing.png", width: 1400, height: 980, mime: "image/png" },
  [pkg.creatures[0]!.token]: { url: (pkg.assets[pkg.creatures[0]!.token]!.image as any).url, width: 280, height: 280, mime: "image/webp" },
});

let ids = 0;
const opts = (pkg: EncounterPackage, extra: Partial<ImportOptions> = {}): ImportOptions => ({
  applyGrid: true, mapPlacement: "auto", duplicatePolicy: "abort", resolvedAssets: resolvedAssets(pkg), newId: () => `id-${++ids}`, ...extra,
});

describe("milestone: one map + five wolves", () => {
  let scene: FakeScene;
  let pkg: EncounterPackage;
  beforeEach(() => {
    scene = new FakeScene();
    // Pre-existing party token + Forge state that must survive.
    scene.items.push({ id: "pc-1", type: "IMAGE", layer: "CHARACTER", name: "Aria", position: { x: 0, y: 0 }, size: { w: 150, h: 150 },
      metadata: { [F("on-list")]: true, [F("in-party")]: true, [F("init")]: 18, [F("name")]: "Aria" } });
    scene.sceneMeta = { "com.battle-system.forge/currround": 3 };
    pkg = wolvesPackage();
  });

  it("builds a valid package with individually rolled initiatives", () => {
    expect(validatePackage(pkg)).toMatchObject({ ok: true, errors: [] });
    expect(pkg.creatures).toHaveLength(5);
    expect(pkg.creatures.map((c) => c.name)).toEqual(["Wolf 1", "Wolf 2", "Wolf 3", "Wolf 4", "Wolf 5"]);
    for (const c of pkg.creatures) {
      expect(c.hp).toMatchObject({ max: 11, current: 11, method: "average" });
      expect(c.initiative).toMatchObject({ modifier: 2, mode: "normal", rolledBy: "package-builder" });
      expect(c.initiative!.total).toBe(c.initiative!.dice[0]! + 2);
    }
    // separate rolls (seeded): not all identical
    expect(new Set(pkg.creatures.map((c) => c.initiative!.dice[0])).size).toBeGreaterThan(1);
  });

  it("previews then imports map, grid, tokens and Forge data without touching existing state", async () => {
    scene.grid.scale = "1.5m";
    const p = await analyse(pkg, scene);
    expect(p.validation.ok).toBe(true);
    expect(p.system.kind).toBe("default");
    expect(p.duplicates.itemIds).toEqual([]);
    expect(p.grid.differs).toBe(true);
    expect(p.forgeErrors).toEqual([]);
    expect(p.creatures[0]!.initiative).toMatch(/d20 \d+ \+2 = \d+/);

    const r = await executeImport(pkg, opts(pkg), scene);
    expect(r.error).toBeUndefined();
    expect(r.ok).toBe(true);
    expect(r.rolledAtImport).toEqual([]); // package rolls preserved, nothing re-rolled
    expect(scene.grid.scale).toBe("5ft");

    const map = scene.items.find((i) => i.layer === "MAP")!;
    expect(map.spec!.grid).toEqual({ dpi: 70, offset: { x: 0, y: 0 } });
    expect(map.spec!.locked).toBe(true);

    const wolves = scene.items.filter((i) => i.name.startsWith("Wolf"));
    expect(wolves).toHaveLength(5);
    expect(new Set(wolves.map((w) => w.id)).size).toBe(5);
    wolves.forEach((w, i) => {
      const c = pkg.creatures[i]!;
      expect(w.metadata[F("name")]).toBe(c.name);
      expect(w.metadata[F("fabd")]).toBe(true);
      expect(w.metadata[F("on-list")]).toBe(true);
      expect(w.metadata[F("in-party")]).toBe(false);
      expect(w.metadata[F("init")]).toBe(c.initiative!.total);
      expect(w.metadata[F("Z005")]).toBe(11);
      expect(w.metadata[F("Z006")]).toBe(11);
      expect(w.metadata[F("Z007")]).toBe(12);
      expect(w.metadata[F("Z042")]).toBe(0);
      expect((w.metadata[F("Z035")] as any[])[0].description).toContain("[1d6+2]");
      expect((w.metadata[BUTLER_ITEM_KEY] as any).initiative.dice).toEqual(c.initiative!.dice);
      // 1-cell Medium token centred on its cell (scene dpi 150)
      expect(w.spec!.position).toEqual({ x: (c.cell.x + 0.5) * 150, y: (c.cell.y + 0.5) * 150 });
      expect(w.spec!.grid.dpi).toBe(280);
      expect(w.spec!.label).toBe(c.name);
    });
    // each wolf has its own list-entry ids (no shared object identity)
    const actionIds = wolves.map((w) => (w.metadata[F("Z035")] as any[])[0].id);
    expect(new Set(actionIds).size).toBe(5);

    // party + Forge round state untouched
    const pc = scene.items.find((i) => i.id === "pc-1")!;
    expect(pc.metadata[F("init")]).toBe(18);
    expect(scene.sceneMeta["com.battle-system.forge/currround"]).toBe(3);
    expect((scene.sceneMeta[BUTLER_SCENE_KEY] as any[])[0]).toMatchObject({ packageId: "wolves-test", itemIds: r.createdItemIds });
  });

  it("detects a duplicate import and supports replace", async () => {
    await executeImport(pkg, opts(pkg), scene);
    const p = await analyse(pkg, scene);
    expect(p.duplicates.itemIds).toHaveLength(6);

    const blocked = await executeImport(pkg, opts(pkg), scene);
    expect(blocked.ok).toBe(false);
    expect(blocked.steps.at(-1)!.step).toMatch(/Aborted \(scene unchanged\)/);
    expect(scene.items).toHaveLength(7);

    const replaced = await executeImport(pkg, opts(pkg, { duplicatePolicy: "replace" }), scene);
    expect(replaced.ok).toBe(true);
    expect(scene.items).toHaveLength(7); // party token + new map + 5 wolves
    expect(scene.items.find((i) => i.id === "pc-1")).toBeTruthy();
  });

  it("places a second map beside existing maps", async () => {
    scene.items.push({ id: "old-map", type: "IMAGE", layer: "MAP", name: "Old", position: { x: 0, y: 0 }, size: { w: 3000, h: 3000 }, metadata: {} });
    await executeImport(pkg, opts(pkg), scene);
    const map = scene.items.find((i) => i.layer === "MAP" && i.id !== "old-map")!;
    expect(map.spec!.position).toEqual({ x: 3300, y: 0 });
  });

  it("aborts before changing anything for players, custom Forge systems or non-public assets", async () => {
    scene.role = "PLAYER";
    expect((await executeImport(pkg, opts(pkg), scene)).ok).toBe(false);
    scene.role = "GM";
    scene.roomMeta = { "com.battle-system.forge/SnapshotPublicId": "xyz", "com.battle-system.forge/SystemName": "My PF2" };
    expect((await executeImport(pkg, opts(pkg), scene)).error).toMatch(/Custom Forge system/);
    scene.roomMeta = {};
    const local = opts(pkg);
    local.resolvedAssets.map = { url: "http://localhost:5173/map.png", width: 1400, height: 980, mime: "image/png" };
    expect((await executeImport(pkg, local, scene)).error).toMatch(/https/);
    expect(scene.items).toHaveLength(1);
  });

  it("rolls and records initiative at import only when the package has none", async () => {
    pkg.creatures[0]!.initiative = null;
    const r = await executeImport(pkg, opts(pkg, { rng: seededRng(9) }), scene);
    expect(r.rolledAtImport).toHaveLength(1);
    expect(r.rolledAtImport[0]!.roll.rolledBy).toBe("importer");
    const w1 = scene.items.find((i) => i.name === "Wolf 1")!;
    expect(w1.metadata[F("init")]).toBe(r.rolledAtImport[0]!.roll.total);
  });

  it("reports partial success and can roll back", async () => {
    scene.failAddOnCall = 2; // map succeeds, tokens fail
    const r = await executeImport(pkg, opts(pkg), scene);
    expect(r.ok).toBe(false);
    expect(r.steps.filter((s) => s.ok).map((s) => s.step)).toEqual(["Preflight", "Grid", "Map"]);
    expect(r.steps.at(-1)).toMatchObject({ step: "FAILED", detail: "simulated network failure" });
    expect(r.createdItemIds).toHaveLength(1);
    expect(await rollbackImport(r.createdItemIds, scene)).toBe(1);
    expect(scene.items.map((i) => i.id)).toEqual(["pc-1"]);
  });
});
