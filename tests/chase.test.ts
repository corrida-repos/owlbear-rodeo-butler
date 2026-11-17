import { describe, expect, it } from "vitest";
import { complicationFor, escapes, failText, freeDashes, NEW_CHASE, nextParticipant, participants, quickSides, readChase, withLog, CHASE_KEY } from "../src/core/chase";

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
  it("the next participant in initiative order skips escaped, dropped and non-participants", () => {
    const c = { ...NEW_CHASE, quarry: ["thug"], pursuers: ["pc1", "pc2"], escaped: [], out: ["pc2"] };
    const order = ["pc1", "x", "pc2", "thug"];
    expect(nextParticipant(order, c, "pc1")).toBe("thug");
    expect(nextParticipant(order, c, "thug")).toBe("pc1");
    expect(participants(c)).toEqual(["thug", "pc1"]);
  });
  it("complications: 1–6 on the tables, 7–12 nothing", () => {
    expect(complicationFor("urban", 4)!.fail.prone).toBe(true);
    expect(complicationFor("urban", 5)!.save).toEqual({ dc: 15, abilities: ["str", "dex", "cha"] });
    expect(complicationFor("wilderness", 3)!.fail.blindedThisTurn).toBe(true);
    expect(complicationFor("urban", 7)).toBeNull();
    expect(failText(complicationFor("urban", 5)!, 6)).toBe("takes 6 Bludgeoning damage; the obstacle counts as 10 feet of Difficult Terrain for it");
  });
  it("Dash budget and the count-0 escape check", () => {
    expect(freeDashes(2)).toBe(5);
    expect(freeDashes(-4)).toBe(1);
    expect(escapes(16, [12, 15], false)).toBe(true);
    expect(escapes(15, [12, 15], false)).toBe(false);
    expect(escapes(30, [12], true)).toBe(false);
  });
  it("reads what's stored and keeps a short log", () => {
    expect(readChase({}).active).toBe(false);
    const c = readChase({ [CHASE_KEY]: { v: 1, active: true, env: "wilderness", quarry: ["a"], pursuers: ["b"] } });
    expect(c).toMatchObject({ active: true, env: "wilderness", escaped: [], dashes: {} });
    let l = c;
    for (let i = 0; i < 20; i++) l = withLog(l, `line ${i}`);
    expect(l.log).toHaveLength(12);
    expect(l.log.at(-1)).toBe("line 19");
  });
});
