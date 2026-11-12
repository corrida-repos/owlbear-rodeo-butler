import { describe, expect, it } from "vitest";
import fighter from "./fixtures/ddb-synthetic-fighter.json";
import { actionBar, explain, inTab } from "../src/core/actions";
import { combatOptions } from "../src/core/combatOptions";
import { convertDdbCharacter } from "../src/core/ddb";
import { isEconomyChange, applyEconomy } from "../src/core/economy";
import { adjacent, canFlank, flankedUnits, opposite, type Footprint } from "../src/core/flanking";
import { convertMonster, lairEntries } from "../src/core/fivetools";
import { lairActionsOf } from "../src/core/fivetools-library";
import { hasLairActions, passesCount20 } from "../src/core/lair";
import { newState } from "../src/core/sheet";
import { displayConditions, DND5E_2024 } from "../src/core/systems";

const C = 100; // grid cell, scene units
/** A token whose space's top-left cell is (col, row), `size` cells wide. */
const at = (id: string, col: number, row: number, side: "party" | "foe", size = 1, able = true): Footprint =>
  ({ id, cx: (col + size / 2) * C, cy: (row + size / 2) * C, half: (size * C) / 2, side, able });

describe("flanking from token positions (DMG optional rule)", () => {
  it("opposite sides or opposite corners flank; adjacent sides don't", () => {
    const orc = at("orc", 5, 5, "foe");
    expect(flankedUnits([orc, at("a", 4, 5, "party"), at("b", 6, 5, "party")], C)).toEqual(new Set(["orc"])); // left / right
    expect(flankedUnits([orc, at("a", 5, 4, "party"), at("b", 5, 6, "party")], C)).toEqual(new Set(["orc"])); // above / below
    expect(flankedUnits([orc, at("a", 4, 4, "party"), at("b", 6, 6, "party")], C)).toEqual(new Set(["orc"])); // opposite corners
    expect(flankedUnits([orc, at("a", 4, 5, "party"), at("b", 5, 4, "party")], C).size).toBe(0); // left + above
    expect(flankedUnits([orc, at("a", 4, 4, "party"), at("b", 6, 4, "party")], C).size).toBe(0); // two top corners
  });
  it("needs two able enemies of the target, both touching it", () => {
    const orc = at("orc", 5, 5, "foe");
    expect(flankedUnits([orc, at("a", 4, 5, "party"), at("b", 7, 5, "party")], C).size).toBe(0); // b is 5 ft away
    expect(flankedUnits([orc, at("a", 4, 5, "party"), at("b", 6, 5, "foe")], C).size).toBe(0); // b is the orc's ally
    expect(flankedUnits([orc, at("a", 4, 5, "party"), at("b", 6, 5, "party", 1, false)], C).size).toBe(0); // b is down
    // Party members get flanked by foes too.
    expect(flankedUnits([at("pc", 5, 5, "party"), at("g1", 4, 5, "foe"), at("g2", 6, 5, "foe")], C)).toEqual(new Set(["pc"]));
  });
  it("works with bigger creatures", () => {
    const ogre = at("ogre", 5, 5, "foe", 2); // cells 5-6 × 5-6
    expect(flankedUnits([ogre, at("a", 4, 5, "party"), at("b", 7, 6, "party")], C)).toEqual(new Set(["ogre"]));
    expect(flankedUnits([ogre, at("a", 4, 5, "party"), at("b", 5, 4, "party")], C).size).toBe(0);
    expect(adjacent(at("a", 4, 5, "party"), ogre, C)).toBe(true);
    expect(opposite(at("a", 4, 5, "party"), at("b", 7, 6, "party"), ogre)).toBe(true);
  });
  it("who can flank, and how Flanked shows", () => {
    expect(canFlank({ hp: 5, conditions: [] })).toBe(true);
    expect(canFlank({ hp: 0, conditions: [] })).toBe(false);
    expect(canFlank({ hp: 5, conditions: [{ id: "c", key: "stunned" }] })).toBe(false);
    const sheet = convertDdbCharacter(fighter).sheet;
    const shown = displayConditions(DND5E_2024, sheet, newState(sheet, { conditions: [{ id: "f", key: "flanked" }] }));
    expect(shown.find((c) => c.key === "flanked")).toMatchObject({ label: "Flanked", automatic: true });
    expect(DND5E_2024.conditions.find((c) => c.key === "flanked")).toMatchObject({ automatic: true, stored: true });
  });
  it("the Flanking tile only shows when the GM switches it on", () => {
    const sheet = convertDdbCharacter(fighter).sheet;
    expect(combatOptions(sheet).some((o) => o.name === "Flanking")).toBe(false);
    expect(combatOptions(sheet, "2024", ["flanking"]).find((o) => o.name === "Flanking")!.text).toContain("Flanked condition automatically");
  });
});

describe("lair actions", () => {
  const raw = [
    "On initiative count 20 (losing initiative ties), the aboleth takes a lair action to cause one of the following effects:",
    { type: "list", items: ["Pools surge: each creature within 20 feet must succeed on a {@dc 14} Strength saving throw or be pulled into the water.", "Water becomes toxic: {@damage 2d6} poison damage."] },
  ];
  it("become a Lair Actions header plus one entry per effect", () => {
    const e = lairEntries(raw);
    expect(e.map((x) => x.name)).toEqual(["Lair Actions", "Lair Action 1", "Lair Action 2"]);
    expect(e[0]!.text).toContain("initiative count 20");
    expect(e[1]!.text).toContain("DC 14 Strength");
    expect(lairEntries([])).toEqual([]);
    expect(lairEntries(["just text"])).toEqual([]);
  });
  it("follow a legendary group's _copy with appended lair actions", () => {
    const groups = [
      { name: "Hag", source: "VGM", lairActions: ["Base intro", { type: "list", items: ["A"] }] },
      { name: "Annis Hag", source: "VGM", _copy: { name: "Hag", source: "VGM", _mod: { lairActions: { mode: "appendArr", items: ["Extra", { type: "list", items: ["B"] }] } } } },
      { name: "Red Dragon", source: "XMM", regionalEffects: [] },
    ];
    expect(lairActionsOf(groups, { name: "Annis Hag", source: "VGM" })).toEqual(["Base intro", { type: "list", items: ["A"] }, "Extra", { type: "list", items: ["B"] }]);
    expect(lairActionsOf(groups, { name: "red dragon", source: "xmm" })).toBeNull();
    expect(lairActionsOf(groups, { name: "Nope", source: "MM" })).toBeNull();
  });
  it("are on the action bar under Legendary, explained, and flagged on import", () => {
    const m = convertMonster({ name: "Test Aboleth", source: "MM", size: ["L"], type: "aberration", ac: [17], hp: { average: 135, formula: "18d10+36" },
      speed: { walk: 10, swim: 40 }, str: 21, dex: 9, con: 15, int: 18, wis: 15, cha: 18, cr: "10", legendaryGroup: { name: "Aboleth", source: "MM" }, _lairActions: raw });
    expect(hasLairActions(m)).toBe(true);
    expect(m.flags.join(" ")).toContain("Lair actions included");
    const bar = actionBar(m);
    const lair = bar.items.filter((i) => i.cost === "lair");
    expect(lair.map((i) => i.name)).toEqual(["Lair Action 1", "Lair Action 2"]);
    expect(lair.every((i) => inTab(i, "legendary"))).toBe(true);
    expect(explain(lair[0]!)[0]).toMatch(/initiative count 20/);
    expect(bar.items.some((i) => i.name === "Lair Actions")).toBe(false);
  });
  it("count 20 passes after units at 20+, before those below, or at the top of a round", () => {
    const order = [{ id: "fast", initiative: 22 }, { id: "tie", initiative: 20 }, { id: "slow", initiative: 12 }, { id: "slower", initiative: 5 }];
    expect(passesCount20({ round: 1, turnId: "fast" }, { round: 1, turnId: "tie" }, order)).toBe(false);
    expect(passesCount20({ round: 1, turnId: "tie" }, { round: 1, turnId: "slow" }, order)).toBe(true); // lair loses the tie
    expect(passesCount20({ round: 1, turnId: "slow" }, { round: 1, turnId: "slower" }, order)).toBe(false);
    expect(passesCount20({ round: 1, turnId: "slower" }, { round: 2, turnId: "fast" }, order)).toBe(false);
    const noFast = order.slice(2);
    expect(passesCount20({ round: 1, turnId: "slower" }, { round: 2, turnId: "slow" }, noFast)).toBe(true);
  });
});

describe("new options and readying movement", () => {
  const sheet = { ...convertDdbCharacter(fighter).sheet, skills: [{ name: "Athletics", bonus: 5 }] };
  it("Don or Doff a Shield, Escape Restraints, Wake a Creature", () => {
    const opts = combatOptions(sheet);
    expect(opts.find((o) => o.name === "Don or Doff a Shield")).toMatchObject({ cost: "action", costNote: "Utilize action" });
    expect(opts.find((o) => o.name === "Escape Restraints")).toMatchObject({ cost: "action", summary: "DC 10 · Athletics +5" });
    expect(opts.find((o) => o.name === "Wake a Creature")!.cost).toBe("action");
    expect(combatOptions(sheet, "2014").find((o) => o.name === "Don or Doff a Shield")!.costNote).toBeUndefined();
  });
  it("movement can be readied: the Action now, the Reaction when it triggers", () => {
    const ready = { name: "Move", cost: "move" as const, trigger: "if the bridge starts to fall" };
    expect(isEconomyChange({ ready })).toBe(true);
    expect(applyEconomy({}, { ready }, 1)).toEqual({ turn: { round: 1, action: true }, readied: { ...ready, round: 1 } });
    expect(isEconomyChange({ ready: { name: "Move", cost: "free" } })).toBe(false);
  });
});
