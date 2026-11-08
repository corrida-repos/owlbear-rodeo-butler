import { describe, expect, it } from "vitest";
import { editionText, initiativeRoll } from "../src/core/card";
import { difficulty2014, difficulty2024, initiativeSetupFor, multiplier2014 } from "../src/core/combat";
import { d20Penalty, EXHAUSTION_2014, speedPenalty } from "../src/core/conditions";
import { SHEET_SCHEMA, type UnitSheet } from "../src/core/sheet";
import { DND5E_2014, DND5E_2024 } from "../src/core/systems";

const aboleth = {
  schema: SHEET_SCHEMA, name: "Aboleth", kind: "creature", size: "L", ac: 17, hp: { max: 150 }, speed: { walk: 10, swim: 40 },
  abilities: { str: 21, dex: 9, con: 15, int: 18, wis: 15, cha: 18 }, saves: {}, skills: [], defenses: {}, proficiencyBonus: 4,
  initiative: { modifier: 7, advantage: false, disadvantage: false, reasons: ["Dex −1 + proficiency ×2"] },
  traits: [], actions: [], bonusActions: [], reactions: [], legendary: [], spells: [], inventory: [], source: { provenance: "official" }, flags: [],
} as UnitSheet;

describe("2014 encounter difficulty (DMG 2014, chapter 3)", () => {
  it("the DMG's example: four 3rd-level characters vs a bugbear and three hobgoblins is Hard", () => {
    // Thresholds 300 / 600 / 900 / 1600; 200 + 3×100 = 500 XP × 2 (four monsters) = 1000 adjusted XP.
    const d = difficulty2014([3, 3, 3, 3], [{ name: "Bugbear", cr: 1 }, ...[1, 2, 3].map((i) => ({ name: `Hobgoblin ${i}`, cr: 0.5 }))]);
    expect(d.scale.map((s) => [s.name, s.xp])).toEqual([["Easy", 300], ["Medium", 600], ["Hard", 900], ["Deadly", 1600]]);
    expect(d).toMatchObject({ rawXp: 500, multiplier: 2, xp: 1000, tier: "Hard", tierCls: "high" });
  });
  it("multipliers by group size, adjusted for small and large parties", () => {
    expect([1, 2, 3, 6, 7, 10, 11, 14, 15].map((n) => multiplier2014(n, 4))).toEqual([1, 1.5, 2, 2, 2.5, 2.5, 3, 3, 4]);
    expect(multiplier2014(1, 2)).toBe(1.5);   // fewer than 3 characters: next higher
    expect(multiplier2014(15, 2)).toBe(5);
    expect(multiplier2014(1, 6)).toBe(0.5);   // 6+ characters: next lower
    expect(multiplier2014(3, 7)).toBe(1.5);
  });
  it("below Easy, Deadly at the top, nothing to compare without both sides", () => {
    expect(difficulty2014([5, 5, 5, 5], [{ name: "Wolf", cr: 0.25 }])).toMatchObject({ tier: "Easy", belowFirst: true });
    expect(difficulty2014([1, 1], [{ name: "Ogre", cr: 2 }]).tier).toBe("Deadly"); // 450 × 1.5 = 675 ≥ 200
    expect(difficulty2014([], [{ name: "Wolf", cr: 0.25 }]).tier).toBeNull();
  });
  it("the 2024 view keeps its budgets and Extreme tier", () => {
    const d = difficulty2024([3, 3, 3, 3], [{ name: "Troll", cr: 5 }]);
    expect(d.scale.map((s) => s.name)).toEqual(["Low", "Moderate", "High", "Extreme"]);
    expect(d).toMatchObject({ tier: "High", multiplier: 1 });
  });
});

describe("other 2014 / 2024 differences", () => {
  it("creatures roll initiative with Dexterity only under 2014 rules", () => {
    expect(initiativeSetupFor({}, aboleth, undefined, "2024").modifier).toBe(7);
    expect(initiativeSetupFor({}, aboleth, undefined, "2014").modifier).toBe(-1);
    expect(initiativeRoll(aboleth, "2014")).toMatchObject({ formula: "1d20-1", bonus: -1 });
    expect(initiativeRoll({ ...aboleth, kind: "character" }, "2014").bonus).toBe(7); // PCs keep their sheet's initiative
  });
  it("exhaustion: 2024 flat penalties, 2014 effects table", () => {
    const st = { conditions: [{ id: "e", key: "exhaustion", level: 2 }] };
    expect([d20Penalty(DND5E_2024, st), speedPenalty(DND5E_2024, st)]).toEqual([-4, 10]);
    expect([d20Penalty(DND5E_2014, st), speedPenalty(DND5E_2014, st)]).toEqual([0, 0]);
    expect(EXHAUSTION_2014).toHaveLength(6);
    expect(EXHAUSTION_2014[5]).toBe("Death");
  });
  it("attack wording follows the edition", () => {
    expect(editionText("Melee Attack Roll: +4 [1d20+4]", "2014")).toBe("Melee Weapon Attack: +4 [1d20+4]");
    expect(editionText("Ranged Spell Attack: +7 [1d20+7]", "2024")).toBe("Ranged Attack Roll: +7 [1d20+7]");
    expect(editionText("Melee Weapon Attack: +5", "2014")).toBe("Melee Weapon Attack: +5");
  });
});
