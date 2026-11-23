import { describe, expect, it } from "vitest";
import {
  combineModes, complicationDie, complicationFor, escapes, exhaustionOnTest, failText, fallDice, freeDashes, dashTestKind, NEW_CHASE, nextParticipant,
  participants, quickSides, readChase, withLog, CHASE_KEY, URBAN, WILDERNESS, URBAN_2014, WILDERNESS_2014,
} from "../src/core/chase";

const units = [
  { id: "pc1", party: true, inEncounter: true, dead: false },
  { id: "pc2", party: true, inEncounter: true, dead: false },
  { id: "thug", party: false, inEncounter: true, dead: false },
  { id: "dead", party: false, inEncounter: true, dead: true },
  { id: "bystander", party: false, inEncounter: false, dead: false },
];

describe("chase mode (2024 DMG)", () => {
  it("one-click sides: party vs every hostile, or vs everyone else", () => {
    expect(quickSides(units, "party-pursuers-hostiles")).toEqual({ quarry: ["thug"], pursuers: ["pc1", "pc2"] });
    expect(quickSides(units, "party-quarry-everyone")).toEqual({ quarry: ["pc1", "pc2"], pursuers: ["thug", "bystander"] });
  });
  it("the next participant in initiative order skips escaped, dropped, downed and non-participants", () => {
    const c = { ...NEW_CHASE, quarry: ["thug"], pursuers: ["pc1", "pc2"], escaped: [], out: ["pc2"] };
    const order = ["pc1", "x", "pc2", "thug"];
    expect(nextParticipant(order, c, "pc1")).toBe("thug");
    expect(nextParticipant(order, c, "thug")).toBe("pc1");
    expect(participants(c)).toEqual(["thug", "pc1"]);
    // A participant at 0 HP isn't hit by complications.
    expect(nextParticipant(order, c, "pc1", (id) => id === "thug")).toBeNull();
  });
  it("complications: 1–6 on the 2024 tables (1d12), 7–12 nothing", () => {
    expect(complicationDie("2024")).toBe("1d12");
    expect(complicationFor("urban", 4)!.fail.prone).toBe(true);
    expect(complicationFor("urban", 5)!.test).toEqual({ kind: "save", dc: 15, options: [{ ability: "str" }, { ability: "dex" }, { ability: "cha" }] });
    expect(complicationFor("wilderness", 3)!.fail.blindedThisTurn).toBe(true);
    expect(complicationFor("wilderness", 4)!.fail.fall).toBe(10);
    expect(complicationFor("urban", 7)).toBeNull();
    expect(failText(complicationFor("urban", 5)!, { damage: 6 })).toBe("takes 6 damage; the obstacle counts as 10 feet of Difficult Terrain for it");
    expect(URBAN).toHaveLength(6);
    expect(WILDERNESS).toHaveLength(6);
  });
  it("Dash budget and the end-of-round escape check", () => {
    expect(freeDashes(2)).toBe(5);
    expect(freeDashes(-4)).toBe(1);
    expect(dashTestKind("2024")).toBe("save");
    expect(escapes(16, [12, 15], false)).toBe(true);
    expect(escapes(15, [12, 15], false)).toBe(false);
    expect(escapes(30, [12], true)).toBe(false);
  });
  it("reads what's stored (older chases too) and keeps a short log", () => {
    expect(readChase({}).active).toBe(false);
    const c = readChase({ [CHASE_KEY]: { v: 1, active: true, env: "wilderness", quarry: ["a"], pursuers: ["b"] } });
    expect(c).toMatchObject({ active: true, env: "wilderness", mode: "creatures", escaped: [], dashes: {}, vehicles: [], pending: [] });
    let l = c;
    for (let i = 0; i < 30; i++) l = withLog(l, `line ${i}`);
    expect(l.log).toHaveLength(16);
    expect(l.log.at(-1)).toBe("line 29");
  });
});

describe("chase mode in 5E rooms (2014 DMG)", () => {
  it("rolls a d20 with complications on 1–10, made with skill checks", () => {
    expect(complicationDie("2014")).toBe("1d20");
    expect(URBAN_2014).toHaveLength(10);
    expect(WILDERNESS_2014).toHaveLength(10);
    expect(complicationFor("urban", 11, "2014")).toBeNull();
    expect(complicationFor("urban", 1, "2014")!.test).toEqual({ kind: "check", dc: 15, options: [{ ability: "dex", skill: "Acrobatics" }] });
    expect(complicationFor("urban", 7, "2014")!.test!.options.map((o) => o.skill)).toEqual(["Athletics", "Acrobatics", "Intimidation"]);
  });
  it("the guard only strikes if the participant moves 20 feet; the swarm attacks", () => {
    const guard = complicationFor("urban", 9, "2014")!;
    expect(guard.ifMoves).toBe(20);
    expect(guard.attack).toEqual({ bonus: 3, damage: [{ dice: "1d6+1", type: "Piercing" }] });
    expect(complicationFor("wilderness", 3, "2014")!.attack!.damage[0]!.dice).toBe("4d4");
  });
  it("snares restrain, drops fall 1d4 × 5 feet, stampedes deal two damage types", () => {
    expect(complicationFor("wilderness", 7, "2014")!.fail.restrained).toBe(true);
    expect(complicationFor("wilderness", 6, "2014")!.fail.fall).toBe("1d4x5");
    expect(complicationFor("wilderness", 8, "2014")!.fail.damage!.map((d) => d.type)).toEqual(["Bludgeoning", "Piercing"]);
  });
  it("the extra Dash is a Constitution check", () => expect(dashTestKind("2014")).toBe("check"));
});

describe("falls, Exhaustion and roll modes", () => {
  it("falls: 1d6 per 10 feet, at most 20d6", () => {
    expect(fallDice(5)).toBe("");
    expect(fallDice(15)).toBe("1d6");
    expect(fallDice(500)).toBe("20d6");
  });
  it("Exhaustion: 2024 −2 per level; 2014 Disadvantage on checks from 1, saves from 3", () => {
    expect(exhaustionOnTest(2, "save", "2024")).toEqual({ penalty: -4, mode: "normal" });
    expect(exhaustionOnTest(1, "check", "2014")).toEqual({ penalty: 0, mode: "disadvantage" });
    expect(exhaustionOnTest(2, "save", "2014").mode).toBe("normal");
    expect(exhaustionOnTest(3, "save", "2014").mode).toBe("disadvantage");
  });
  it("Advantage and Disadvantage cancel out", () => {
    expect(combineModes("advantage", "disadvantage")).toBe("normal");
    expect(combineModes("advantage", undefined)).toBe("advantage");
    expect(combineModes("normal", "disadvantage")).toBe("disadvantage");
  });
});
