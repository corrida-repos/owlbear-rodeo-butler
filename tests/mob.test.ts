import { describe, expect, it } from "vitest";
import { averageOf, mobResult, mobRow, targetsInArea } from "../src/core/mob";
import { attackProfile } from "../src/core/actions";

describe("mob rolls (2024 DMG Mob Results)", () => {
  it("matches the DMG's zombie examples", () => {
    // Eight zombies (+3) attack AC 18: roll needed 15, out of 8 → 2 hit.
    expect(mobResult(8, 18, 3)).toMatchObject({ rollNeeded: 15, fraction: "2/8", successes: 2, failures: 6 });
    // Shatter DC 16 vs Con +3: roll needed 13 → 3 of 8 succeed.
    expect(mobResult(8, 16, 3).successes).toBe(3);
    // Fireball DC 16 vs Dex −2 on twelve zombies: roll needed 18 → 1/6 → 2 succeed.
    expect(mobResult(12, 16, -2)).toMatchObject({ rollNeeded: 18, fraction: "1/6", successes: 2 });
  });
  it("reads the Advantage and Disadvantage columns", () => {
    expect(mobRow(10, "advantage")![0]).toBe(5);
    expect(mobRow(15, "disadvantage")![0]).toBe(19);
    expect(mobRow(21, "advantage")).toBeNull();
    expect(mobRow(18, "disadvantage")).toBeNull();
    expect(mobResult(4, 30, 0).successes).toBe(0);
    expect(mobResult(5, 5, 4).successes).toBe(5);
  });
  it("uses the out-of-10 proportion for groups no column divides", () => {
    // Roll needed 11 → 5/10; 7 monsters → 3.5 → 4.
    expect(mobResult(7, 14, 3).successes).toBe(4);
  });
  it("averages dice like a stat block", () => {
    expect(averageOf("1d8+3")).toBe(7);
    expect(averageOf("2d6 + 1d4 - 1")).toBe(8);
    expect(averageOf("1d6")).toBe(3);
  });
  it("reads an action's attack bonus and damage", () => {
    const p = attackProfile("Melee Attack Roll: +3 [1d20+3], reach 5 ft. Hit: 4 [1d6+1] Bludgeoning damage.");
    expect(p.bonus).toBe(3);
    expect(p.damage[0]!.formula).toBe("1d6+1");
  });
});

describe("Targets in Area of Effect", () => {
  it("reads the table, including sizes between rows", () => {
    expect(targetsInArea("sphere", 20)).toBe(10);
    expect(targetsInArea("sphere", 10)).toBe(3);
    expect(targetsInArea("cone", 15)).toBe(2);
    expect(targetsInArea("cone", 32)).toBe(5);
    expect(targetsInArea("cube", 10)).toBe(1);
    expect(targetsInArea("line", 100, { width: 5 })).toBe(4);
    expect(targetsInArea("line", 60, { width: 10 })).toBe(5);
  });
  it("spread out −1d3, bunched up +1d3, never more than are present", () => {
    expect(targetsInArea("sphere", 20, { spread: "bunched", d3: 2 })).toBe(12);
    expect(targetsInArea("sphere", 20, { spread: "spread", d3: 3 })).toBe(7);
    expect(targetsInArea("sphere", 20, { present: 6 })).toBe(6);
  });
});
