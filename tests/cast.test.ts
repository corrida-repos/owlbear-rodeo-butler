import { describe, expect, it } from "vitest";
import { attackOutcome, castPlan, damageFor, resolveSave, targetLine, upsertCast, type CastRecord } from "../src/core/cast";

describe("casting at targets", () => {
  it("reads an attack spell, a save spell and a damage-only spell", () => {
    expect(castPlan("Ranged Attack Roll: +7 [1d20+7], range 120 ft. Hit: 11 [2d10] Fire damage.")).toMatchObject({ kind: "attack", bonus: 7, damage: [{ formula: "2d10", type: "Fire" }] });
    const fb = castPlan("Each creature in a 20-foot-radius Sphere makes a DC 15 Dexterity saving throw, taking 8d6 [8d6] Fire damage on a failed save or half as much damage on a successful one.");
    expect(fb).toMatchObject({ kind: "save", dc: 15, ability: "dex", half: true });
    expect(castPlan("Each target makes a DC 13 Wisdom saving throw or has the Frightened condition.")).toMatchObject({ kind: "save", ability: "wis", half: false, damage: [] });
    expect(castPlan("Three darts each deal 1d4+1 [1d4+1] Force damage.")).toMatchObject({ kind: "damage" });
    expect(castPlan("You gain 10 feet of Speed.")).toBeNull();
  });
  it("attack rolls: natural 20 crits, natural 1 misses, else against AC", () => {
    expect(attackOutcome(25, 20, 30)).toBe("crit");
    expect(attackOutcome(30, 1, 10)).toBe("miss");
    expect(attackOutcome(15, 10, 15)).toBe("hit");
    expect(attackOutcome(14, 9, 15)).toBe("miss");
  });
  const fireball: CastRecord = { id: "c", at: "", caster: { id: "w", name: "Wiz" }, spell: "Fireball", kind: "save", dc: 15, ability: "dex", half: true, rolled: [{ amount: 28, type: "Fire" }],
    targets: [{ id: "g", name: "Goblin", party: false, outcome: "awaiting-save", damage: 0 }, { id: "a", name: "Ana", party: true, outcome: "awaiting-save", damage: 0 }] };
  it("saves: full on a failure, half on a success, then the target's defenses", () => {
    expect(resolveSave(fireball, "g", 9).targets[0]).toMatchObject({ outcome: "failed", roll: 9, damage: 28 });
    expect(resolveSave(fireball, "g", 15).targets[0]).toMatchObject({ outcome: "saved", damage: 14 });
    expect(resolveSave(fireball, "g", 15, { resist: "Fire" }).targets[0]).toMatchObject({ outcome: "saved", damage: 7, notes: ["Resistance to Fire"] });
    expect(damageFor({ half: false, rolled: [{ amount: 10 }] }, { outcome: "saved" }).amount).toBe(0);
    expect(resolveSave(fireball, "g", 3).targets[1]!.outcome).toBe("awaiting-save");
  });
  it("attack damage per target, misses take none", () => {
    expect(damageFor({ half: false }, { outcome: "crit", rolled: [{ amount: 18, type: "Fire" }] }, { vulnerable: "Fire" }).amount).toBe(36);
    expect(damageFor({ half: false }, { outcome: "miss", rolled: [{ amount: 9 }] }).amount).toBe(0);
  });
  it("words results and keeps a few records", () => {
    const r = resolveSave(fireball, "g", 9);
    expect(targetLine(r, r.targets[0]!)).toBe("Goblin: fails (9 vs DC 15) · 28 damage");
    expect(targetLine(r, r.targets[1]!)).toBe("Ana: rolling its save…");
    let list: CastRecord[] = [];
    for (let i = 0; i < 12; i++) list = upsertCast(list, { ...fireball, id: String(i) });
    expect(list).toHaveLength(8);
    expect(upsertCast(list, { ...fireball, id: "11", spell: "X" }).at(-1)!.spell).toBe("X");
  });
});

describe("cast requests", async () => {
  const { isPlayerRequest } = await import("../src/core/turns");
  it("accepts a cast and a save, rejects malformed ones", () => {
    const base = { v: 1, unitId: "u", playerId: "p", playerName: "P" };
    expect(isPlayerRequest({ ...base, type: "cast", record: { id: "c", kind: "save", targets: [{ id: "g" }] } })).toBe(true);
    expect(isPlayerRequest({ ...base, type: "cast", record: { id: "c", kind: "nope", targets: [] } })).toBe(false);
    expect(isPlayerRequest({ ...base, type: "cast-save", castId: "c", total: 14 })).toBe(true);
    expect(isPlayerRequest({ ...base, type: "cast-save", castId: "c", total: "x" })).toBe(false);
  });
});

describe("upcasting, spell slots and conditions", async () => {
  const { upcastDamage, slotTable, slotsLeft, lowestSlot, conditionsIn } = await import("../src/core/cast");
  it("adds the spell's per-level dice for a higher slot (2024 and 2014 wording)", () => {
    const fb2024 = "Using a Higher-Level Spell Slot. The damage increases by 1d6 for each spell slot level above 3.";
    expect(upcastDamage(fb2024, [{ formula: "8d6", type: "Fire" }], 5)).toEqual({ damage: [{ formula: "10d6", type: "Fire" }], extra: "+2d6" });
    expect(upcastDamage(fb2024, [{ formula: "8d6", type: "Fire" }], 3).damage[0]!.formula).toBe("8d6");
    const ice = "At Higher Levels. When you cast this spell using a spell slot of 2nd level or higher, the damage increases by 1d10 for each slot level above 1st.";
    expect(upcastDamage(ice, [{ formula: "1d10", type: "Piercing" }, { formula: "2d6", type: "Cold" }], 3).damage).toEqual([{ formula: "3d10", type: "Piercing" }, { formula: "2d6", type: "Cold" }]);
    expect(upcastDamage("No scaling.", [{ formula: "1d8" }], 9).extra).toBeUndefined();
  });
  it("reads slots from a D&D Beyond sheet and a stat block, with what's been used", () => {
    const pc = { traits: [], actions: [], spells: [{ name: "Spellcasting — Wizard", text: "Intelligence; spell save DC 15. Slots: L1 4 (1 used), L2 3, L3 2." }] };
    expect(slotTable(pc)).toEqual({ 1: { max: 4, used: 1 }, 2: { max: 3, used: 0 }, 3: { max: 2, used: 0 } });
    const t = slotTable(pc, { slotsUsed: { 3: 2 } });
    expect(slotsLeft(t, 3)).toBe(0);
    expect(lowestSlot(t, 3)).toBeNull();
    expect(lowestSlot(t, 1)).toBe(1);
    const mage = { traits: [], actions: [], spells: [{ name: "Level 3 (3 slots)", text: "Fireball, Counterspell" }] };
    expect(slotTable(mage)).toEqual({ 3: { max: 3, used: 0 } });
  });
  it("finds the conditions a spell gives and their durations", () => {
    expect(conditionsIn("On a failed save, the target has the Frightened condition until the end of your next turn.")).toEqual([{ key: "frightened", until: "caster-end" }]);
    expect(conditionsIn("must succeed on a Wisdom saving throw or be frightened for 1 minute.")).toEqual([{ key: "frightened", rounds: 10 }]);
    expect(conditionsIn("A creature that fails is pushed 10 feet and is knocked Prone.")).toEqual([{ key: "prone" }]);
    expect(conditionsIn("You have Immunity to the Charmed condition.")).toEqual([]);
    expect(conditionsIn("Each creature takes 8d6 Fire damage.")).toEqual([]);
  });
});
