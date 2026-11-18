import { describe, expect, it } from "vitest";
import { costlyMaterial, materialWarning, spellKey } from "../src/core/components";

describe("material components a focus or pouch can't replace", () => {
  it("from the books, by edition", () => {
    expect(costlyMaterial("Revivify (Level 3)", "")).toBe("a diamond worth 300+ GP, which the spell consumes");
    expect(costlyMaterial("Revivify", "", "2014")).toBe("diamonds worth 300 gp, which the spell consumes");
    expect(costlyMaterial("Chromatic Orb (Level 1)", "")).toBe("a diamond worth 50+ GP");
    expect(costlyMaterial("Fireball (Level 3)", "")).toBeNull();
  });
  it("from the spell's own text (D&D Beyond sync) first", () => {
    expect(costlyMaterial("Homebrew Ward", "Components: V, S, M. Material: a silver mirror worth 100 gp. You ward…")).toBe("a silver mirror worth 100 gp");
    // A cheap component in the text means a focus works, even if a same-named spell elsewhere costs something.
    expect(costlyMaterial("Revivify", "Components: V, S, M. Material: a pinch of dust. …")).toBeNull();
  });
  it("words the warning, saying when it's used up", () => {
    expect(materialWarning("Revivify", "")).toMatch(/can't replace it, and the spell uses it up/);
    expect(materialWarning("Chromatic Orb", "")).toMatch(/can't replace it: you need the actual item/);
    expect(materialWarning("Magic Missile", "")).toBeNull();
    expect(spellKey("Find Familiar (Level 1, Ritual)")).toBe("find familiar");
  });
});
