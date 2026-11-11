import { beforeEach, describe, expect, it } from "vitest";
import xmm from "./fixtures/5etools-xmm-sample.json";
import { blankSheet } from "../src/core/collection";
import { convertMonster, findMonster } from "../src/core/fivetools";
import { newState, SHEET_KEY, STATE_KEY, validateSheet, type UnitSheet } from "../src/core/sheet";
import { addConditionTo, changeHp, markUnitsDead } from "../src/core/tracker";
import { isPlayerRequest } from "../src/core/turns";
import { readUnit } from "../src/core/unit";
import { DND5E_2014, DND5E_2024 } from "../src/core/systems";
import {
  addKnownShape, detectWildShape, formSheet, knownShapeFrom, readWildShape, revertWildShape, setupWildShape, shapeProblem, transformUnit,
  wildShapeHp, wildShapeLimits, WILD_KEY, type KnownShape,
} from "../src/core/wildshape";
import { FakeScene } from "./fakeGateway";

const wolf = convertMonster(findMonster(xmm, "Wolf", "XMM"));
const wolfShape = knownShapeFrom(wolf, "XMM", "Monster Manual (2025)");
const druidImage = { url: "https://example.com/druid.png", width: 300, height: 300, mime: "image/png" };
const wolfImage = { url: "https://example.com/wolf.webp", width: 280, height: 280, mime: "image/webp" };

function druid(level = 5, sub = "Circle of the Moon"): UnitSheet {
  return {
    ...blankSheet("Ysolde"), kind: "character", level, type: `Wood Elf · Druid ${level} (${sub})`,
    hp: { max: 38 }, ac: 14, abilities: { str: 8, dex: 14, con: 14, int: 12, wis: 18, cha: 10 },
    saves: { int: 4, wis: 7 }, skills: [{ name: "Perception", bonus: 7 }, { name: "Stealth", bonus: 2 }, { name: "Nature", bonus: 4 }],
    proficiencyBonus: 3, languages: "Common, Druidic, Elvish",
    traits: [{ name: "Wild Shape", text: "…" }, { name: "Druidic", text: "…" }],
    spells: [{ name: "Level 1", text: "Healing Word" }],
  };
}

function addDruid(scene: FakeScene, sheet: UnitSheet, hp = sheet.hp.max) {
  scene.items.push({
    id: "d1", type: "IMAGE", layer: "CHARACTER", name: "Ysolde", label: "Ysolde", image: { ...druidImage }, grid: { dpi: 300, offset: { x: 150, y: 150 } },
    metadata: { [SHEET_KEY]: sheet, [STATE_KEY]: { ...newState(sheet), hp, party: true, portraitUrl: "https://example.com/face.png", conditions: [] } },
    position: { x: 0, y: 0 }, size: { w: 150, h: 150 },
  });
}

describe("Wild Shape rules", () => {
  it("reads the druid level and circle from a D&D Beyond class line", () => {
    expect(detectWildShape(druid(5))).toEqual({ druidLevel: 5, moon: true });
    expect(detectWildShape({ ...druid(3), type: "Human · Fighter 2 / Druid 3 (Circle of the Land)" })).toEqual({ druidLevel: 3, moon: false });
    expect(detectWildShape({ ...druid(1), type: "Human · Druid 1" })).toBeNull();
    expect(detectWildShape(blankSheet())).toBeNull();
  });

  it("2024: Known Forms, CR and fly limits by level; Circle Forms for the Moon", () => {
    const l2 = wildShapeLimits("2024", 2, false);
    expect([l2.maxKnown, l2.maxCr, l2.fly, l2.tempHp]).toEqual([4, 0.25, false, 2]);
    const l4 = wildShapeLimits("2024", 4, false);
    expect([l4.maxKnown, l4.maxCr]).toEqual([6, 0.5]);
    const l8 = wildShapeLimits("2024", 8, false);
    expect([l8.maxKnown, l8.maxCr, l8.fly]).toEqual([8, 1, true]);
    const moon9 = wildShapeLimits("2024", 9, true);
    expect([moon9.maxCr, moon9.tempHp]).toEqual([3, 27]);
    expect(wildShapeLimits("2024", 2, true).maxCr).toBe(0.25); // the subclass starts at 3
  });

  it("2014: no cap on shapes, swim from 4, fly from 8; Moon CR 1 at 2 and level ÷ 3 from 6", () => {
    const l2 = wildShapeLimits("2014", 2, false);
    expect([l2.maxKnown, l2.maxCr, l2.swim, l2.fly]).toEqual([null, 0.25, false, false]);
    expect(wildShapeLimits("2014", 2, true).maxCr).toBe(1);
    expect(wildShapeLimits("2014", 12, true).maxCr).toBe(4);
    expect(shapeProblem({ cr: "1/2", swim: true }, wildShapeLimits("2014", 4, false))).toBeNull();
    expect(shapeProblem({ cr: "1/4", swim: true }, l2)).toMatch(/swimming/);
    expect(shapeProblem({ cr: "1", fly: true }, wildShapeLimits("2024", 6, true))).toMatch(/flying/);
    expect(shapeProblem({ cr: "1" }, wildShapeLimits("2024", 4, false))).toMatch(/max CR 1\/2/);
  });

  it("the form keeps the druid's mind and proficiencies on the beast's body", () => {
    const f = formSheet(druid(5), wolf, "2024", { druidLevel: 5, moon: true });
    expect(validateSheet(f)).toEqual([]);
    expect(f.abilities).toMatchObject({ str: wolf.abilities.str, dex: wolf.abilities.dex, con: wolf.abilities.con, int: 12, wis: 18, cha: 10 });
    expect(f.hp.max).toBe(38); // 2024: own hit points
    expect(f.ac).toBe(Math.max(wolf.ac, 17)); // Circle Forms: 13 + Wis
    expect(f.saves.wis).toBe(7);
    expect(f.skills.find((s) => s.name === "Perception")!.bonus).toBeGreaterThanOrEqual(7);
    // Stealth: the druid has no proficiency (bonus = Dex mod), the wolf's own bonus wins if it has one.
    expect(f.spells).toEqual([]);
    expect(f.size).toBe(wolf.size);
    expect(f.actions).toEqual(wolf.actions);
    expect(f.type).toContain("Druid 5"); // keeps the druid's creature type
    const wolfCon = wolf.saves.con ?? Math.floor((wolf.abilities.con - 10) / 2);
    expect(f.saves.con ?? wolfCon).toBe(wolfCon); // level 5: no Improved Circle Forms yet
    expect(formSheet(druid(6), wolf, "2024", { druidLevel: 6, moon: true }).saves.con).toBe(wolfCon + 4); // level 6: + Wis
    expect(formSheet(druid(5), wolf, "2014", { druidLevel: 5, moon: true }).hp.max).toBe(wolf.hp.max);
  });
});

describe("Wild Shape on the scene", () => {
  let scene: FakeScene;
  beforeEach(async () => {
    scene = new FakeScene();
    addDruid(scene, druid(5));
    await setupWildShape(scene, "d1", { druidLevel: 5, moon: true });
  });

  const unit = () => readUnit(scene.items[0]!.metadata)!;
  const ws = () => readWildShape(scene.items[0]!.metadata)!;

  it("Known Shapes respect the limits", async () => {
    await addKnownShape(scene, "d1", wolfShape, "2024");
    await addKnownShape(scene, "d1", wolfShape, "2024"); // no duplicates
    expect(ws().known).toHaveLength(1);
    const eagle: KnownShape = { name: "Giant Eagle", source: "XMM", cr: "1", size: "L", fly: true };
    await expect(addKnownShape(scene, "d1", eagle, "2024")).rejects.toThrow(/flying/);
    await setupWildShape(scene, "d1", { druidLevel: 2, moon: false });
    for (const n of ["A", "B", "C"]) await addKnownShape(scene, "d1", { ...wolfShape, name: n }, "2024");
    await expect(addKnownShape(scene, "d1", { ...wolfShape, name: "E" }, "2024")).rejects.toThrow(/already know 4/);
  });

  it("2024: transform changes the token and sheet, adds temp HP, and reverts at 0 HP", async () => {
    await addKnownShape(scene, "d1", wolfShape, "2024");
    await expect(transformUnit(scene, "d1", wolf, wolfImage, { rules: "2024", form: { name: "Bat", source: "XMM" } })).rejects.toThrow(/Known Shapes/);
    const r = await transformUnit(scene, "d1", wolf, wolfImage, { rules: "2024", form: { name: "Wolf", source: "XMM" } });
    expect(r.form).toBe("Wolf");
    expect(scene.items[0]!.image!.url).toBe(wolfImage.url);
    expect(unit().sheet.name).toBe("Ysolde (Wolf)");
    expect(unit().state).toMatchObject({ hp: 38, tempHp: 15 }); // Moon: 3 × druid level
    expect(unit().state.portraitUrl).toBeUndefined();
    expect(ws()).not.toHaveProperty("usesSpent"); // uses aren't counted

    const [rep] = await changeHp(scene, ["d1"], { kind: "damage", amount: 20 }, { system: DND5E_2024 });
    expect(rep!.events).not.toContain("wild-shape-ended");
    expect(unit().state).toMatchObject({ hp: 33, tempHp: 0 });

    const [rep2] = await changeHp(scene, ["d1"], { kind: "damage", amount: 40 }, { system: DND5E_2024 });
    expect(rep2!.events).toEqual(expect.arrayContaining(["wild-shape-ended", "dropped-to-zero"]));
    expect(ws().active).toBeUndefined();
    expect(unit().sheet.name).toBe("Ysolde");
    expect(unit().state.hp).toBe(0);
    expect(unit().state.deathSaves).toEqual({ successes: 0, failures: 0 });
    expect(unit().state.portraitUrl).toBe("https://example.com/face.png");
    expect(scene.items[0]!.image!.url).toBe(druidImage.url);
    expect(scene.items[0]!.grid).toEqual({ dpi: 300, offset: { x: 150, y: 150 } });
  });

  it("5.5E: Incapacitated, Stunned and the like end the form; so does Mark as dead", async () => {
    await addKnownShape(scene, "d1", wolfShape, "2024");
    await transformUnit(scene, "d1", wolf, wolfImage, { rules: "2024", form: { name: "Wolf", source: "XMM" } });
    expect(await addConditionTo(scene, ["d1"], "prone")).toEqual([]);
    expect(ws().active).toBeDefined();
    expect(await addConditionTo(scene, ["d1"], "stunned")).toEqual(["Ysolde"]);
    expect(ws().active).toBeUndefined();
    expect(unit().sheet.name).toBe("Ysolde");
    expect(unit().state.hp).toBe(38);

    await transformUnit(scene, "d1", wolf, wolfImage, { rules: "2024", form: { name: "Wolf", source: "XMM" } });
    await markUnitsDead(scene, ["d1"]);
    expect(ws().active).toBeUndefined();
  });

  it("5.5E: changing form gives fresh temp HP; uses aren't counted (no warning, old counters dropped)", async () => {
    await addKnownShape(scene, "d1", wolfShape, "2024");
    await transformUnit(scene, "d1", wolf, wolfImage, { rules: "2024", form: { name: "Wolf", source: "XMM" } });
    await changeHp(scene, ["d1"], { kind: "damage", amount: 10 }, { system: DND5E_2024 });
    expect(unit().state.tempHp).toBe(5);
    await transformUnit(scene, "d1", wolf, wolfImage, { rules: "2024", form: { name: "Wolf", source: "XMM" } });
    expect(unit().state.tempHp).toBe(15);
    for (let i = 0; i < 4; i++) {
      const r = await transformUnit(scene, "d1", wolf, wolfImage, { rules: "2024", form: { name: "Wolf", source: "XMM" } });
      expect(r.warnings.join(" ")).not.toMatch(/uses/);
    }
    // A token from an earlier version still carries a counter: it's ignored and not written back.
    scene.items[0]!.metadata[WILD_KEY] = { ...(scene.items[0]!.metadata[WILD_KEY] as object), usesSpent: 3 };
    expect(ws()).not.toHaveProperty("usesSpent");
    await transformUnit(scene, "d1", wolf, wolfImage, { rules: "2024", form: { name: "Wolf", source: "XMM" } });
    expect(scene.items[0]!.metadata[WILD_KEY]).not.toHaveProperty("usesSpent");
  });

  it("2014: the beast's HP take the damage, then the rest carries over to the druid", async () => {
    scene.items[0]!.metadata[STATE_KEY] = { ...(scene.items[0]!.metadata[STATE_KEY] as object), hp: 30 };
    await addKnownShape(scene, "d1", wolfShape, "2014");
    await transformUnit(scene, "d1", wolf, wolfImage, { rules: "2014", form: { name: "Wolf", source: "XMM" } });
    expect(unit().state.hp).toBe(wolf.hp.max);
    expect(unit().sheet.hp.max).toBe(wolf.hp.max);

    await changeHp(scene, ["d1"], { kind: "damage", amount: 3 }, { system: DND5E_2014 });
    expect(unit().state.hp).toBe(wolf.hp.max - 3);
    expect(ws().active).toBeDefined();

    const [rep] = await changeHp(scene, ["d1"], { kind: "damage", amount: wolf.hp.max - 3 + 5 }, { system: DND5E_2014 });
    expect(rep!.events).toContain("wild-shape-ended");
    expect(rep!.events).not.toContain("dropped-to-zero");
    expect(ws().active).toBeUndefined();
    expect(unit().sheet.name).toBe("Ysolde");
    expect(unit().state.hp).toBe(25); // 30 − 5 carried over
  });

  it("revert by choice: 2014 back to the HP before the shape", async () => {
    await addKnownShape(scene, "d1", wolfShape, "2014");
    await transformUnit(scene, "d1", wolf, wolfImage, { rules: "2014", form: { name: "Wolf", source: "XMM" } });
    await changeHp(scene, ["d1"], { kind: "damage", amount: 2 }, { system: DND5E_2014 });
    expect(await revertWildShape(scene, "d1")).toBe("Ysolde");
    expect(unit().state.hp).toBe(38);
    expect(unit().sheet.name).toBe("Ysolde");
    expect(await revertWildShape(scene, "d1")).toBeNull();
  });

  it("keeps a re-synced sheet instead of restoring the old one", async () => {
    await addKnownShape(scene, "d1", wolfShape, "2024");
    await transformUnit(scene, "d1", wolf, wolfImage, { rules: "2024", form: { name: "Wolf", source: "XMM" } });
    scene.items[0]!.metadata[SHEET_KEY] = { ...druid(6), name: "Ysolde v2" };
    await revertWildShape(scene, "d1");
    expect(unit().sheet.name).toBe("Ysolde v2");
    expect(scene.items[0]!.metadata[WILD_KEY]).not.toHaveProperty("active");
  });

  it("wildShapeHp: a 2014 concentration save uses the whole hit", () => {
    const sheet = formSheet(druid(5), wolf, "2014", { druidLevel: 5, moon: true });
    const state = { ...newState(sheet), hp: 4, party: true, conditions: [{ id: "c", key: "concentration" }] };
    const active = { form: { name: "Wolf", source: "XMM" }, rules: "2014" as const, since: "", sheetName: sheet.name, original: { sheet: druid(5), hp: 30 } };
    const r = wildShapeHp(sheet, state, active, { kind: "damage", amount: 24 }, DND5E_2014);
    expect(r.revert).toBe(true);
    expect(r.patch.hp).toBe(10);
    expect(r.patch.concentrationCheck).toEqual({ dc: 12, damage: 24 });
  });
});

describe("Wild Shape requests", () => {
  const base = { v: 1, unitId: "u", playerId: "p", playerName: "Ana", type: "wild-shape" };
  it("validates each operation", () => {
    expect(isPlayerRequest({ ...base, op: "known-add", shape: wolfShape })).toBe(true);
    expect(isPlayerRequest({ ...base, op: "known-add", shape: { name: "Wolf" } })).toBe(false);
    expect(isPlayerRequest({ ...base, op: "known-remove", shape: { name: "Wolf", source: "XMM" } })).toBe(true);
    expect(isPlayerRequest({ ...base, op: "transform", form: { name: "Wolf", source: "XMM" }, sheet: wolf, image: wolfImage })).toBe(true);
    expect(isPlayerRequest({ ...base, op: "transform", form: { name: "Wolf", source: "XMM" }, sheet: wolf, image: { url: 3 } })).toBe(false);
    expect(isPlayerRequest({ ...base, op: "revert" })).toBe(true);
    expect(isPlayerRequest({ ...base, op: "rest" })).toBe(false); // rests were removed
    expect(isPlayerRequest({ ...base, op: "fly" })).toBe(false);
  });
});
