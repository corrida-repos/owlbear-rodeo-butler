import { describe, expect, it } from "vitest";
import data from "./fixtures/5etools-xmm-sample.json";
import { convertMonster, diceChip, findMonster, renderTags } from "../src/core/fivetools";
import { validateSheet } from "../src/core/sheet";

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
  it("only emits dice chips the roller can roll", () => {
    expect(diceChip("2d6 + 3")).toBe("[2d6+3]");
    expect(diceChip("1d3")).toBe("[1d3]"); // any die size works now (Forge only took standard dice)
    expect(diceChip("101d6")).toBe(""); // more than 100 dice
    expect(diceChip("1d1")).toBe("");
    expect(diceChip("7")).toBe("");
  });
});

describe("convertMonster", () => {
  it("Wolf (XMM p.373)", () => {
    const sb = convertMonster(findMonster(data, "Wolf", "XMM"), { catalogEntry: { source: "XMM", file: "bestiary-xmm.json", title: "Monster Manual (2025)", published: "2025-02-18", rules: "2024" } });
    expect(sb.size).toBe("M");
    expect(sb.hp).toEqual({ max: 11, formula: "2d8 + 2" });
    expect(sb.source).toMatchObject({ provenance: "official", book: "XMM", page: 373, bookTitle: "Monster Manual (2025)" });
    expect(sb.initiative.modifier).toBe(2);
    expect(sb.initiative.advantage).toBe(false);
    expect(validateSheet(sb)).toEqual([]);
    expect(sb).toMatchObject({
      schema: "butler-sheet@1", kind: "creature", alignment: "Unaligned", type: "Beast", ac: 12, speed: { walk: 40 }, cr: 0.25,
      proficiencyBonus: 2, abilities: { str: 14, dex: 15, con: 12, int: 3, wis: 12, cha: 6 },
      senses: "Darkvision 60 ft.", passivePerception: 15,
      skills: [{ name: "Perception", bonus: 5 }, { name: "Stealth", bonus: 4 }],
    });
    expect(sb.saves).toEqual({}); // none listed: the card uses ability modifiers
    expect(sb.traits).toEqual([expect.objectContaining({ name: "Pack Tactics" })]);
    const bite = sb.actions[0]!;
    expect(bite.name).toBe("Bite");
    expect(bite.text).toContain("[1d20+4]");
    expect(bite.text).toContain("[1d6+2]");
  });
  it("initiative proficiency multiplies PB (Aboleth, CR 10)", () => {
    const m = findMonster(data, "Aboleth", "XMM");
    const sb = convertMonster(m);
    // Dex 9 (-1) + 2 × PB 4 = +7, matching the printed "Initiative +7"
    expect(sb.initiative.modifier).toBe(-1 + 2 * 4);
  });
  it("spellcasting goes to the Spell List", () => {
    const sb = convertMonster(findMonster(data, "Priest", "XMM"));
    expect(sb.spells.map((s) => s.name)).toContain("At Will");
    expect(sb.spells.find((s) => s.name === "At Will")!.text).toBe("Light, Thaumaturgy");
  });
  it("throws a helpful error for unknown monsters", () => {
    expect(() => findMonster(data, "Wolfe", "XMM")).toThrow(/not found/);
  });
});
