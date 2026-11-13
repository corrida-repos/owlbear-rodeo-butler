import { describe, expect, it } from "vitest";
import fighter from "./fixtures/ddb-synthetic-fighter.json";
import { convertDdbCharacter } from "../src/core/ddb";
import { playerStats, spellSaveDc } from "../src/core/partyStats";
import { newState, type UnitSheet } from "../src/core/sheet";

const base = convertDdbCharacter(fighter).sheet;
const sheet: UnitSheet = {
  ...base, abilities: { ...base.abilities, wis: 14, int: 8 }, passivePerception: 15,
  skills: [{ name: "Insight", bonus: 4 }], saves: { str: 6, con: 5 }, senses: "Darkvision 60 ft., Passive Perception 15",
  speed: { walk: 30, climb: 30 }, defenses: { resist: "Fire" },
  spells: [{ name: "Spellcasting (Wizard)", text: "Intelligence; spell save DC 13, spell attack +5." }, { name: "Spellcasting (Cleric)", text: "spell save DC 15" }],
};
const hp = { hp: 20, maxHp: 40, tempHp: 5, ac: 18 };

describe("Players tab stats (GM)", () => {
  const s = playerStats(sheet, newState(sheet, { conditions: [{ id: "c", key: "concentration" }, { id: "e", key: "exhaustion", level: 2 }] }), hp);
  it("works out passives from the sheet, falling back to 10 + modifier", () => {
    expect(s.passives).toEqual({ perception: 15, insight: 14, investigation: 9 });
  });
  it("takes the highest spell save DC on the sheet, none for a non-caster", () => {
    expect(s.spellDc).toBe(15);
    expect(spellSaveDc({ spells: [], traits: [], actions: [] })).toBeUndefined();
  });
  it("lists saves with proficiency, senses, speed, defences and live state", () => {
    expect(s.saves.find((x) => x.ability === "str")).toMatchObject({ bonus: 6, proficient: true });
    expect(s.saves.find((x) => x.ability === "wis")).toMatchObject({ bonus: 2, proficient: false });
    expect(s.senses).toEqual(["Darkvision 60 ft."]);
    expect(s.speed).toBe("30 ft., climb 30");
    expect(s.defenses).toEqual([{ label: "Resist", text: "Fire" }]);
    expect(s).toMatchObject({ ac: 18, hp: 20, maxHp: 40, tempHp: 5, concentrating: true, exhaustion: 2 });
  });
});
