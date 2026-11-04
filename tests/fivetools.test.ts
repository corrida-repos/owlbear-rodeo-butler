import { describe, expect, it } from "vitest";
import data from "./fixtures/5etools-xmm-sample.json";
import { convertMonster, diceChip, findMonster, renderTags } from "../src/core/fivetools";

describe("5etools tag rendering", () => {
  it("renders 2024 attack text with Forge dice chips", () => {
    const s = renderTags("{@atkr m} {@hit 4}, reach 5 ft. {@h}5 ({@damage 1d6 + 2}) Piercing damage.");
    expect(s).toBe("Melee Attack Roll: +4 [1d20+4], reach 5 ft. Hit: 5 (1d6 + 2 [1d6+2]) Piercing damage.");
  });
  it("renders saves, conditions and nested tags", () => {
    expect(renderTags("{@actSave con} {@dc 13}")).toBe("Constitution Saving Throw: DC 13");
    expect(renderTags("the {@condition Prone|XPHB} condition")).toBe("the Prone condition");
    expect(renderTags("{@creature goblin|XMM|Goblins}")).toBe("Goblins");
  });
  it("only emits dice chips Forge can parse", () => {
    expect(diceChip("2d6 + 3")).toBe("[2d6+3]");
    expect(diceChip("1d3")).toBe(""); // d3 is not a Forge die size
    expect(diceChip("7")).toBe("");
  });
});

describe("convertMonster", () => {
  it("Wolf (XMM p.373)", () => {
    const sb = convertMonster(findMonster(data, "Wolf", "XMM"));
    expect(sb.size).toBe("M");
    expect(sb.hp).toEqual({ average: 11, formula: "2d8 + 2" });
    expect(sb.source).toMatchObject({ provenance: "official", book: "XMM", page: 373, bookTitle: "Monster Manual (2025)" });
    expect(sb.initiative.modifier).toBe(2);
    expect(sb.initiative.advantage).toBe(false);
    expect(sb.forge).toMatchObject({
      Z002: "Medium", Z003: "Unaligned", Z004: "Beast", Z007: 12, Z008: 40, Z016: 0.25,
      Z017: 14, Z018: 15, Z019: 12, Z020: 3, Z021: 12, Z022: 6,
      Z023: 2, Z024: 2, Z025: 1, Z026: -4, Z027: 1, Z028: -2,
      Z013: "Darkvision 60 ft., Passive Perception 15",
      Z014: "Perception +5, Stealth +4",
    });
    expect(sb.forge.Z034).toEqual([expect.objectContaining({ name: "Pack Tactics" })]);
    const bite = (sb.forge.Z035 as any[])[0];
    expect(bite.name).toBe("Bite");
    expect(bite.description).toContain("[1d20+4]");
    expect(bite.description).toContain("[1d6+2]");
  });
  it("initiative proficiency multiplies PB (Aboleth, CR 10)", () => {
    const m = findMonster(data, "Aboleth", "XMM");
    const sb = convertMonster(m);
    // Dex 9 (-1) + 2 × PB 4 = +7, matching the printed "Initiative +7"
    expect(sb.initiative.modifier).toBe(-1 + 2 * 4);
  });
  it("spellcasting goes to the Spell List", () => {
    const sb = convertMonster(findMonster(data, "Priest", "XMM"));
    const spells = sb.forge.Z039 as { name: string; description: string }[];
    expect(spells.map((s) => s.name)).toContain("At Will");
    expect(spells.find((s) => s.name === "At Will")!.description).toBe("Light, Thaumaturgy");
  });
  it("throws a helpful error for unknown monsters", () => {
    expect(() => findMonster(data, "Wolfe", "XMM")).toThrow(/not found/);
  });
});
