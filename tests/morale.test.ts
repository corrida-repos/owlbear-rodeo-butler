import { describe, expect, it } from "vitest";
import { fleeReason, moraleOutcome } from "../src/core/morale";

type C = { key: string };
const u = (id: string, party: boolean, hp: number, conds: C[] = [], max = 20) =>
  ({ id, party, inEncounter: true, sheet: { hp: { max } }, state: { hp, conditions: conds.map((c, i) => ({ id: String(i), ...c })) } });

describe("fight or flight (2024 DMG)", () => {
  it("Bloodied and Frightened: likely to flee", () => {
    const orc = u("o", false, 9, [{ key: "frightened" }]);
    expect(fleeReason(orc, [orc, u("p", true, 30)])).toMatch(/Bloodied and Frightened/);
  });
  it("Bloodied with more than half its allies down while no foe is", () => {
    const boss = u("b", false, 10);
    const allies = [u("a1", false, 0), u("a2", false, 5, [{ key: "unconscious" }]), u("a3", false, 20)];
    const pcs = [u("p1", true, 30), u("p2", true, 12)];
    expect(fleeReason(boss, [boss, ...allies, ...pcs])).toMatch(/2 of its 3 allies/);
    // A PC down too: no.
    expect(fleeReason(boss, [boss, ...allies, u("p1", true, 0), pcs[1]!])).toBeNull();
    // Exactly half isn't more than half.
    expect(fleeReason(boss, [boss, u("a1", false, 0), u("a2", false, 20), ...pcs])).toBeNull();
  });
  it("not Bloodied, party members, or already down: no prompt", () => {
    expect(fleeReason(u("o", false, 11, [{ key: "frightened" }]), [])).toBeNull();
    expect(fleeReason(u("p", true, 5, [{ key: "frightened" }]), [])).toBeNull();
    expect(fleeReason(u("o", false, 0, [{ key: "frightened" }]), [])).toBeNull();
  });
  it("words the DC 10 Wisdom save", () => {
    expect(moraleOutcome(12)).toMatch(/keeps fighting/);
    expect(moraleOutcome(9)).toMatch(/flees or tries to parley/);
  });
});
