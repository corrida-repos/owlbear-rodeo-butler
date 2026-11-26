import { describe, expect, it } from "vitest";
import { addCondition } from "../src/core/conditions";
import { applyDeathSave, applyHp } from "../src/core/hp";
import { canAdvance, chokeTurn, grappleConditionId, holdConditionId, martialActionWarning, SUFFOCATING_2014, type Grapple } from "../src/core/martial";
import { speedLimit } from "../src/core/movement";
import type { UnitState } from "../src/core/sheet";

const grapple: Grapple = { id: "one", actor: "fighter", round: 1, dc: 14, reach: 5 };
const turn = (turnId: string, round: number) => ({ turnId, round });

describe("martial house rules", () => {
  it("requires an intervening turn before advancing an established grapple", () => {
    expect(canAdvance(grapple, 1)).toBe(false);
    expect(canAdvance(grapple, 2)).toBe(true);
  });

  it("keeps linked grapple and restraint sources distinct from independently applied conditions", () => {
    const conditions = [{ key: "grappled", id: grappleConditionId(grapple) }, { key: "restrained", id: holdConditionId(grapple) }];
    const pin = addCondition({ conditions }, "restrained", { note: "Web" }).conditions!;
    expect(pin).toHaveLength(3);
    expect(pin.filter((c) => c.id !== holdConditionId(grapple) && c.id !== grappleConditionId(grapple))).toEqual([
      expect.objectContaining({ key: "restrained", note: "Web" }),
    ]);
    expect(speedLimit({ speed: { walk: 30, fly: 60 } }, { dash: true, state: { conditions: pin } })).toBe(0);
  });

  it("does not suffocate a target whose turn occurs before the grappler's next turn", () => {
    const choke = { ...grapple, hold: "choke" as const, chokeRound: 3 };
    expect(chokeTurn(choke, "mage", turn("mage", 3), turn("troll", 3), "2024", 0)).toBeUndefined();
    expect(chokeTurn(choke, "mage", turn("troll", 3), turn("fighter", 3), "2024", 0)).toBe("start");
    expect(chokeTurn({ ...choke, suffocating: true }, "mage", turn("mage", 4), turn("fighter", 4), "2024", 0)).toBe("tick");
    expect(chokeTurn({ ...choke, suffocating: true, lastTick: 4 }, "mage", turn("mage", 4), turn("fighter", 4), "2024", 0)).toBeUndefined();
    expect(chokeTurn({ ...choke, breathless: true }, "mage", turn("troll", 3), turn("fighter", 3), "2024", 0)).toBeUndefined();
  });

  it("gives 2014 targets at least three rounds and prevents recovery at 0 HP while suffocating", () => {
    const choke = { ...grapple, hold: "choke" as const, chokeRound: 3, suffocating: true, rounds: 2 };
    expect(chokeTurn(choke, "mage", turn("fighter", 5), turn("mage", 5), "2014", -1)).toBeUndefined();
    expect(chokeTurn({ ...choke, rounds: 3 }, "mage", turn("fighter", 6), turn("mage", 6), "2014", 0)).toBe("drop");
    expect(chokeTurn({ ...choke, rounds: 3 }, "mage", turn("fighter", 6), turn("mage", 6), "2014", 4)).toBeUndefined();
    const state: UnitState = { hp: 0, tempHp: 0, initiative: 10, inEncounter: true, party: true,
      deathSaves: { successes: 2, failures: 0 }, conditions: [{ key: "custom", id: SUFFOCATING_2014 }] };
    expect(() => applyHp({ hp: { max: 12 } }, state, { kind: "heal", amount: 4 })).toThrow(/breathe/);
    expect(applyDeathSave(state, 20)).toMatchObject({ outcome: "success", patch: { deathSaves: { successes: 2, failures: 0 } } });
  });

  it("warns about forbidden reactions and known spell components", () => {
    expect(martialActionWarning({ cost: "reaction", category: "action", text: "" }, [{ key: "custom", id: "martial:short:neck:neck" }])).toMatch(/reactions/);
    const arms = [{ key: "custom", id: "pin", label: "Arms Bound" }];
    expect(martialActionWarning({ cost: "action", category: "spell", text: "Components: V, S." }, arms)).toMatch(/somatic/);
    expect(martialActionWarning({ cost: "action", category: "spell", text: "Components: V." }, arms)).toBeUndefined();
  });
});
