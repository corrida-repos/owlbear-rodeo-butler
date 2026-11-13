import { describe, expect, it } from "vitest";
import { newState, SHEET_KEY, SHEET_SCHEMA, STATE_KEY, type UnitSheet } from "../src/core/sheet";
import { EDIT_REQUESTS, isPlayerRequest } from "../src/core/turns";
import { readUnit } from "../src/core/unit";
import {
  isUnitLight, lightAt, readDarknessFog, lightingUpdate, lightRings, lightsOnSheet, LIGHTING_KEY, readSceneLight, resolveLight, seenAs, senseRings, sensesOf,
  setUnitLight, visionSummary,
} from "../src/core/vision";
import { FakeScene } from "./fakeGateway";

const sheet = (over: Partial<UnitSheet> = {}): UnitSheet => ({
  schema: SHEET_SCHEMA, name: "X", kind: "creature", size: "M", ac: 12, hp: { max: 30 }, speed: { walk: 30 },
  abilities: { str: 10, dex: 14, con: 10, int: 10, wis: 10, cha: 10 }, saves: {}, skills: [], defenses: {}, proficiencyBonus: 2,
  initiative: { modifier: 2, advantage: false, disadvantage: false, reasons: [] },
  traits: [], actions: [], bonusActions: [], reactions: [], legendary: [], spells: [], inventory: [], source: { provenance: "homebrew" }, flags: [], ...over,
});

describe("scene light", () => {
  it("defaults to bright; dim and dark are stored, bright removes the key", () => {
    expect(readSceneLight({})).toBe("bright");
    expect(readSceneLight(lightingUpdate({}, { level: "dark" }))).toBe("dark");
    expect(readSceneLight(lightingUpdate({}, { level: "dim" }))).toBe("dim");
    expect(lightingUpdate({}, { level: "bright" })).toEqual({ [LIGHTING_KEY]: undefined });
    // The darkness fog is on by default; turning it off survives a change of light level.
    const off = lightingUpdate(lightingUpdate({}, { level: "dark" }), { fog: false });
    expect(readDarknessFog(off)).toBe(false);
    expect(readDarknessFog(lightingUpdate(off, { level: "dim" }))).toBe(false);
    expect(readDarknessFog(lightingUpdate({}, { level: "dark" }))).toBe(true);
    expect(readSceneLight({ [LIGHTING_KEY]: { level: "pitch" } })).toBe("bright");
  });
});

describe("senses", () => {
  it("reads 5etools, D&D Beyond and blind-beyond senses, and Devil's Sight", () => {
    expect(sensesOf(sheet({ senses: "darkvision 60 ft., tremorsense 30 ft." }))).toMatchObject({ darkvision: 60, tremorsense: 30, blindsight: 0 });
    expect(sensesOf(sheet({ senses: "Darkvision 120 ft., Passive Insight 12" })).darkvision).toBe(120);
    const ooze = sensesOf(sheet({ senses: "blindsight 60 ft. (blind beyond this radius)" }));
    expect(ooze).toMatchObject({ blindsight: 60, blindBeyond: true });
    expect(senseRings(ooze, "dark").map((r) => r.kind)).toEqual(["blindsight"]);
    const warlock = sensesOf(sheet({ senses: "Darkvision 60 ft.", traits: [{ name: "Devil's Sight", text: "You can see normally in Dim Light and Darkness within 120 feet." }] }));
    expect(warlock.devilsSight).toBe(120);
    expect(senseRings(warlock, "dark").map((r) => `${r.kind} ${r.feet}`)).toEqual(["devilsSight 120", "darkvision 60"]);
  });
  it("draws nothing in bright light", () => {
    expect(senseRings(sensesOf(sheet({ senses: "darkvision 60 ft." })), "bright")).toEqual([]);
  });
});

describe("light sources", () => {
  it("finds lights on the sheet: items, spells and a monster's spell list", () => {
    expect(lightsOnSheet(sheet({ inventory: [{ name: "Torch (10)", text: "" }, { name: "Lantern, Hooded", text: "" }, { name: "Rope", text: "" }] }))).toEqual(["torch", "lantern-hooded"]);
    expect(lightsOnSheet(sheet({ spells: [{ name: "Light", text: "Cantrip" }, { name: "Produce Flame", text: "" }] }))).toEqual(["light", "produce-flame"]);
    expect(lightsOnSheet(sheet({ spells: [{ name: "Spellcasting", text: "At will: dancing lights, light, mage hand\n1/day: daylight" }] })))
      .toEqual(["light", "dancing-lights", "daylight"]);
    // "bright light" in a description isn't the Light cantrip.
    expect(lightsOnSheet(sheet({ spells: [{ name: "Spellcasting", text: "It sheds bright light in a 10-foot radius." }] }))).toEqual([]);
  });
  it("resolves radii by edition and validates custom lights", () => {
    expect(resolveLight({ key: "torch" })).toMatchObject({ bright: 20, dim: 20 });
    expect(resolveLight({ key: "produce-flame" }, "2014")).toMatchObject({ bright: 10, dim: 10 });
    expect(resolveLight({ key: "produce-flame" }, "2024")).toMatchObject({ bright: 20, dim: 20 });
    expect(resolveLight({ key: "custom", bright: 10, dim: 5 })).toMatchObject({ bright: 10, dim: 5 });
    expect(isUnitLight({ key: "custom", bright: 0, dim: 0 })).toBe(false);
    expect(isUnitLight({ key: "sunbeam-9000" })).toBe(false);
  });
  it("a torch is bright + dim in darkness, only bright in dim light, nothing in bright light", () => {
    const torch = resolveLight({ key: "torch" });
    expect(lightRings(torch, "dark").map((r) => `${r.kind} ${r.feet}`)).toEqual(["dim 40", "bright 20"]);
    expect(lightRings(torch, "dim").map((r) => `${r.kind} ${r.feet}`)).toEqual(["bright 20"]);
    expect(lightRings(torch, "bright")).toEqual([]);
    expect(lightRings(resolveLight({ key: "candle" }), "dim").map((r) => r.feet)).toEqual([5]);
  });
  it("the GM or a player's request sets and puts out a unit's light", async () => {
    const scene = new FakeScene();
    scene.items.push({ id: "u", type: "IMAGE", layer: "CHARACTER", name: "u", metadata: { [SHEET_KEY]: sheet(), [STATE_KEY]: newState(sheet()) }, position: { x: 0, y: 0 }, size: { w: 1, h: 1 } });
    await setUnitLight(scene, "u", { key: "torch" });
    expect(readUnit(scene.items[0]!.metadata)!.state.light).toEqual({ key: "torch" });
    await setUnitLight(scene, "u", { key: "custom", bright: 12.4, dim: 3 });
    expect(readUnit(scene.items[0]!.metadata)!.state.light).toEqual({ key: "custom", bright: 12, dim: 3 });
    await setUnitLight(scene, "u", null);
    expect(readUnit(scene.items[0]!.metadata)!.state.light).toBeUndefined();
    await expect(setUnitLight(scene, "u", { key: "nope" })).rejects.toThrow();

    const base = { v: 1, unitId: "u", playerId: "p", playerName: "Ana" };
    expect(isPlayerRequest({ ...base, type: "light", light: { key: "torch" } })).toBe(true);
    expect(isPlayerRequest({ ...base, type: "light", light: null })).toBe(true);
    expect(isPlayerRequest({ ...base, type: "light", light: { key: "nope" } })).toBe(false);
    expect(EDIT_REQUESTS).toContain("light");
  });
});

describe("what a creature sees", () => {
  const human = sensesOf(sheet());
  const elf = sensesOf(sheet({ senses: "Darkvision 60 ft." }));
  it("combines the scene's light with light sources", () => {
    expect(lightAt("dark", [])).toBe("dark");
    expect(lightAt("dark", [{ distance: 30, bright: 20, dim: 20 }])).toBe("dim");
    expect(lightAt("dark", [{ distance: 50, bright: 20, dim: 20 }, { distance: 10, bright: 15, dim: 30 }])).toBe("bright");
    expect(lightAt("dim", [{ distance: 30, bright: 20, dim: 20 }])).toBe("dim");
  });
  it("applies darkvision, blindsight, truesight and Devil's Sight", () => {
    expect(seenAs("dark", human, 10).seen).toBe("heavily obscured");
    expect(seenAs("dim", human, 10).seen).toBe("lightly obscured");
    expect(seenAs("dark", elf, 60)).toEqual({ seen: "lightly obscured", by: "darkvision" });
    expect(seenAs("dark", elf, 65).seen).toBe("heavily obscured");
    expect(seenAs("dim", elf, 30)).toEqual({ seen: "clear", by: "darkvision" });
    expect(seenAs("dark", elf, 30, { magicalDarkness: true }).seen).toBe("heavily obscured");
    const bat = sensesOf(sheet({ senses: "blindsight 60 ft." }));
    expect(seenAs("dark", bat, 40)).toEqual({ seen: "clear", by: "blindsight" });
    const ooze = sensesOf(sheet({ senses: "blindsight 30 ft. (blind beyond this radius)" }));
    expect(seenAs("bright", ooze, 40).seen).toBe("heavily obscured");
    const devil = sensesOf(sheet({ traits: [{ name: "Devil's Sight", text: "120 feet" }] }));
    expect(seenAs("dark", devil, 100, { magicalDarkness: true }).seen).toBe("clear");
  });
  it("explains it on the card", () => {
    const lines = visionSummary(sheet({ senses: "Darkvision 60 ft." }), { light: { key: "torch" } }, "dark");
    expect(lines[0]).toMatch(/Carrying Torch: bright 20 ft, dim 20 ft more/);
    expect(lines[1]).toMatch(/Darkvision 60 ft/);
    expect(visionSummary(sheet(), {}, "bright")).toEqual([]);
    expect(visionSummary(sheet(), {}, "dark")[0]).toMatch(/No darkvision/);
  });
});
