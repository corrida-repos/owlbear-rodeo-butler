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
