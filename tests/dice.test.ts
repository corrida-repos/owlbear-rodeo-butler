import { describe, expect, it } from "vitest";
import { describeInitiative, resolveRollMode, rollFormula, rollInitiative, seededRng, type Rng } from "../src/core/dice";

/** RNG returning a fixed sequence of d20 faces. */
const faces = (...f: number[]): Rng => { let i = 0; return () => (f[i++ % f.length]! - 1) / 20 + 0.001; };

describe("initiative", () => {
  it("advantage and disadvantage cancel", () => {
    expect(resolveRollMode(true, true)).toBe("normal");
    expect(resolveRollMode(true, false)).toBe("advantage");
    expect(resolveRollMode(false, true)).toBe("disadvantage");
    expect(resolveRollMode(false, false)).toBe("normal");
  });
  it("normal: 1d20 + modifier", () => {
    const r = rollInitiative(2, "normal", faces(13), "package-builder");
    expect(r).toMatchObject({ dice: [13], kept: 13, modifier: 2, total: 15, formula: "1d20+2", mode: "normal" });
  });
  it("advantage keeps the higher die, then adds the modifier", () => {
    const r = rollInitiative(-1, "advantage", faces(4, 17), "package-builder");
    expect(r).toMatchObject({ dice: [4, 17], kept: 17, total: 16, formula: "2d20kh1-1" });
    expect(describeInitiative(r)).toBe("adv d20 [4, 17] → 17 -1 = 16");
  });
  it("disadvantage keeps the lower die", () => {
    const r = rollInitiative(3, "disadvantage", faces(4, 17), "package-builder");
    expect(r).toMatchObject({ dice: [4, 17], kept: 4, total: 7, formula: "2d20kl1+3" });
  });
  it("d20 faces are uniform-ish and in range", () => {
    const rng = seededRng(1);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const r = rollInitiative(0, "normal", rng, "importer");
      expect(r.kept).toBeGreaterThanOrEqual(1);
      expect(r.kept).toBeLessThanOrEqual(20);
      seen.add(r.kept);
    }
    expect(seen.size).toBe(20);
  });
});

describe("rollFormula", () => {
  it("rolls 2d8 + 2 and records dice", () => {
    const r = rollFormula("2d8 + 2", seededRng(42));
    expect(r.dice).toHaveLength(2);
    expect(r.total).toBe(r.dice[0]! + r.dice[1]! + 2);
  });
  it("rejects unsupported formulas", () => {
    expect(() => rollFormula("2d8 + Con", seededRng(1))).toThrow();
  });
});
