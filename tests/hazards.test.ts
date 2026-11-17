import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { entered, hazardDef, HAZARDS, readHazard, resolveHazard, HAZARD_KEY } from "../src/core/hazards";

describe("hazards and traps (2024 DMG)", () => {
  it("covers the book's 12 hazards and 8 traps, each with a picture", () => {
    expect(HAZARDS.filter((h) => h.kind === "hazard")).toHaveLength(12);
    expect(HAZARDS.filter((h) => h.kind === "trap")).toHaveLength(8);
    for (const h of HAZARDS) expect(existsSync(`public/hazards/${h.image}`), h.image).toBe(true);
  });
  it("save for half: Brown Mold DC 12 Con, 4d10 Cold", () => {
    const d = hazardDef("brown-mold")!;
    expect(resolveHazard(d, "Wolf", 8, [22])).toMatchObject({ damage: 22, failed: true });
    expect(resolveHazard(d, "Wolf", 14, [22])).toMatchObject({ damage: 11, failed: false });
  });
  it("save or condition: Webs restrain on a failure only", () => {
    const d = hazardDef("webs")!;
    expect(resolveHazard(d, "Ana", 5, []).conditions.map((c) => c.key)).toEqual(["restrained"]);
    expect(resolveHazard(d, "Ana", 12, []).conditions).toEqual([]);
    expect(resolveHazard(d, "Ana", 12, []).text).toBe("Webs → Ana: 12 vs DC 12: succeeds.");
  });
  it("no save: a Spiked Pit always hurts and knocks Prone; Razorvine does nothing on a success", () => {
    const pit = resolveHazard(hazardDef("spiked-pit")!, "Bo", null, [3, 9]);
    expect(pit).toMatchObject({ damage: 12, failed: true });
    expect(pit.conditions.map((c) => c.key)).toEqual(["prone"]);
    expect(resolveHazard(hazardDef("razorvine")!, "Bo", 11, [6]).damage).toBe(0);
  });
  it("reads placed hazards and finds newly entered ones", () => {
    expect(readHazard({ [HAZARD_KEY]: { key: "webs" } })).toEqual({ key: "webs", armed: true });
    expect(readHazard({ [HAZARD_KEY]: { key: "nope" } })).toBeNull();
    expect(entered(new Set(["a"]), new Set(["a", "b"]))).toEqual(["b"]);
  });
});

describe("hazard damage and the creature's defenses", async () => {
  const { damageAgainst, immuneToCondition, parseDefenses } = await import("../src/core/defenses");
  it("reads defense lines, keeping qualified B/P/S conditional", () => {
    const d = parseDefenses("Cold, Fire; Bludgeoning, Piercing, and Slashing from Nonmagical Attacks");
    expect([...d.always]).toEqual(["Cold", "Fire"]);
    expect([...d.conditional].sort()).toEqual(["Bludgeoning", "Piercing", "Slashing"]);
    // 5etools flattens the group into one comma list: still only B/P/S are conditional.
    expect([...parseDefenses("Acid, Bludgeoning, Piercing, Slashing from nonmagical attacks").always]).toEqual(["Acid"]);
  });
  it("Immunity, Resistance (round down), Vulnerability (×2), conditional reported", () => {
    expect(damageAgainst({ immune: "Poison" }, 12, "Poison")).toEqual({ amount: 0, note: "Immunity to Poison" });
    expect(damageAgainst({ resist: "Cold" }, 11, "cold").amount).toBe(5);
    expect(damageAgainst({ vulnerable: "Fire" }, 7, "Fire").amount).toBe(14);
    expect(damageAgainst({ resist: "Bludgeoning from nonmagical attacks" }, 10, "Bludgeoning")).toEqual({ amount: 10, note: "a conditional Bludgeoning defense on its sheet wasn't applied" });
    expect(damageAgainst(undefined, 9, "Acid").amount).toBe(9);
    expect(immuneToCondition({ conditionImmune: "Charmed, Poisoned" }, "poisoned")).toBe(true);
    expect(immuneToCondition({ conditionImmune: "Charmed" }, "restrained")).toBe(false);
  });
  it("Brown Mold vs a creature resistant to Cold: half on a save, then halved again", () => {
    const d = hazardDef("brown-mold")!;
    const r = resolveHazard(d, "Yeti", 14, [22], { resist: "Cold" });
    expect(r.damage).toBe(5);
    expect(r.text).toBe("Brown Mold → Yeti: 14 vs DC 12: succeeds. 5 Cold damage (half; Resistance to Cold).");
    expect(resolveHazard(d, "Fire elemental", 3, [22], { immune: "Cold" }).text).toBe("Brown Mold → Fire elemental: 3 vs DC 12: fails. No damage (Immunity to Cold).");
  });
  it("mixed damage types are handled one by one; immune conditions are skipped", () => {
    // Spiked Pit: 1d6 Bludgeoning + 2d8 Piercing, Prone.
    const r = resolveHazard(hazardDef("spiked-pit")!, "Golem", null, [4, 10], { immune: "Piercing" });
    expect(r.damage).toBe(4);
    const ooze = resolveHazard(hazardDef("yellow-mold")!, "Ooze", 2, [11], { immune: "Poison", conditionImmune: "Poisoned" });
    expect(ooze).toMatchObject({ damage: 0, conditions: [] });
    expect(ooze.text).toMatch(/Immune to Poisoned\.$/);
  });
});
