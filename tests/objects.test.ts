import { describe, expect, it } from "vitest";
import { coverHit, hitObject, improvisedObject, makeObjects, OBJECT_PRESETS, objectDamage, readObjects, OBJECTS_KEY } from "../src/core/objects";

let n = 0;
const id = () => `o${++n}`;

describe("objects (PHB 2024 Breaking Objects, DMG doors and siege)", () => {
  it("AC by substance, HP by size and resilience", () => {
    expect(improvisedObject("stone", "M", true)).toMatchObject({ ac: 17, maxHp: 18, immune: ["Poison", "Psychic"], sections: 1 });
    expect(improvisedObject("glass", "T", false)).toMatchObject({ ac: 13, maxHp: 2 });
    expect(improvisedObject("cloth", "S", false).vulnerable).toEqual(["Fire"]);
    // Huge: tracked as Large sections.
    const wall = improvisedObject("stone", "H", true, { name: "Castle wall", threshold: 10 });
    expect(wall).toMatchObject({ ac: 17, maxHp: 27, sections: 3, threshold: 10 });
    expect(makeObjects(wall, id).map((o) => o.name)).toEqual(["Castle wall 1", "Castle wall 2", "Castle wall 3"]);
  });
  it("presets carry the book numbers", () => {
    const p = (k: string) => OBJECT_PRESETS.find((x) => x.key === k)!.stats;
    expect(p("door-wood")).toMatchObject({ ac: 15, maxHp: 18 });
    expect(p("wall-stone")).toMatchObject({ ac: 15, maxHp: 180 });
    expect(p("wall-ice")).toMatchObject({ ac: 12, maxHp: 30, vulnerable: ["Fire"] });
    expect(p("siege-trebuchet")).toMatchObject({ ac: 15, maxHp: 150 });
  });
  it("damage: immunities, vulnerability, resistance, threshold; repair; destroyed at 0", () => {
    const [ice] = makeObjects(OBJECT_PRESETS.find((x) => x.key === "wall-ice")!.stats, id);
    expect(objectDamage(ice!, 20, "Cold").applied).toBe(0);
    expect(hitObject(ice!, 16, "Fire").object.hp).toBe(0);
    expect(objectDamage({ immune: [], resist: ["Slashing"], vulnerable: [], threshold: 10 }, 18, "Slashing")).toEqual({ applied: 0, why: "below its damage threshold of 10" });
    expect(objectDamage({ immune: [], resist: [], vulnerable: [], threshold: 10 }, 12).applied).toBe(12);
    expect(objectDamage({ immune: ["all"], resist: [], vulnerable: [] }, 99).applied).toBe(0);
    const hurt = hitObject(ice!, 10, "Bludgeoning").object;
    expect(hitObject(hurt, -50).object.hp).toBe(30);
  });
  it("hitting cover: a miss only because of the cover's bonus hits the cover", () => {
    expect(coverHit(16, 15, "half")).toBe("cover");
    expect(coverHit(17, 15, "half")).toBe("target");
    expect(coverHit(14, 15, "three-quarters")).toBe("miss");
    expect(coverHit(16, 15, "three-quarters", 17)).toBe("miss");
  });
  it("reads only valid records from scene metadata", () => {
    expect(readObjects({ [OBJECTS_KEY]: [{ id: "a", hp: 3 }, { nope: 1 }] })).toHaveLength(1);
    expect(readObjects({})).toEqual([]);
  });
});
