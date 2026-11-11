import { beforeEach, describe, expect, it } from "vitest";
import xmm from "./fixtures/5etools-xmm-sample.json";
import { seededRng } from "../src/core/dice";
import { convertMonster, findMonster } from "../src/core/fivetools";
import { newState, SHEET_KEY, SHEET_SCHEMA, STATE_KEY, type UnitSheet, type UnitState } from "../src/core/sheet";
import { isPlayerRequest } from "../src/core/turns";
import { readUnit } from "../src/core/unit";
import {
  applyTurnStartUses, hasLairFeatures, legendaryCost, legendaryCount, resetUses, setUsesSpent, sheetUses, spellNames, spendUses,
  startOfTurnUses, usesSummary,
} from "../src/core/uses";
import { FakeScene } from "./fakeGateway";

const sheet = (name: string, over: Partial<UnitSheet> = {}): UnitSheet => ({
  schema: SHEET_SCHEMA, name, kind: "creature", size: "L", ac: 18, hp: { max: 200 }, speed: { walk: 40 },
  abilities: { str: 10, dex: 14, con: 10, int: 10, wis: 10, cha: 10 }, saves: {}, skills: [], defenses: {}, proficiencyBonus: 4,
  initiative: { modifier: 2, advantage: false, disadvantage: false, reasons: [] },
  traits: [], actions: [], bonusActions: [], reactions: [], legendary: [], spells: [], inventory: [], source: { provenance: "homebrew" }, flags: [], ...over,
});

const dragon = sheet("Young Dragon", {
  traits: [{ name: "Legendary Resistance (3/Day)", text: "If it fails a saving throw, it can choose to succeed instead." }],
  actions: [
    { name: "Bite", text: "Melee Attack Roll: +10 [1d20+10]" },
    { name: "Fire Breath (Recharge 5–6)", text: "Dexterity Saving Throw: DC 17. Failure: 56 [16d6] Fire damage." },
    { name: "Frightful Presence (Recharges after a Short or Long Rest)", text: "…" },
  ],
  legendary: [
    { name: "Legendary Actions", text: "The dragon can take 3 legendary actions, choosing from the options below." },
    { name: "Detect", text: "The dragon makes a Wisdom (Perception) check." },
    { name: "Wing Attack (Costs 2 Actions)", text: "…" },
  ],
  spells: [
    { name: "Innate Spellcasting", text: "The dragon casts…" },
    { name: "At Will", text: "Detect Magic" },
    { name: "1/Day Each", text: "Fly (self only), Invisibility*, Plane Shift" },
    { name: "3/Day", text: "Command, Fear" },
  ],
});

describe("limited uses on a stat block", () => {
  it("finds Recharge, per-rest, X/Day, per-spell and legendary resources", () => {
    const uses = sheetUses(dragon);
    expect(uses.map((r) => [r.label, r.kind, r.max, r.recharge])).toEqual([
      ["Legendary Resistance", "perDay", 3, undefined],
      ["Fire Breath", "recharge", 1, 5],
      ["Frightful Presence", "rest", 1, undefined],
      ["Fly (self only)", "perDay", 1, undefined],
      ["Invisibility", "perDay", 1, undefined],
      ["Plane Shift", "perDay", 1, undefined],
      ["Spells 3/Day", "perDay", 3, undefined],
      ["Legendary actions", "legendary", 3, undefined],
    ]);
    expect(new Set(uses.map((r) => r.key)).size).toBe(uses.length);
    expect(legendaryCost("Wing Attack (Costs 2 Actions)")).toBe(2);
    expect(legendaryCost("Detect")).toBe(1);
    expect(spellNames("Fly (self only, 1 hour), Invisibility")).toEqual(["Fly (self only, 1 hour)", "Invisibility"]);
  });

  it("reads the 2024 Monster Manual aboleth: lair counts for Legendary Resistance and legendary actions", () => {
    const raw = findMonster(xmm as any, "Aboleth", "XMM");
    const ab = convertMonster(raw, { catalogEntry: { rules: "2024" } as any });
    expect(ab.legendary[0]).toMatchObject({ name: "Legendary Actions" });
    expect(ab.legendary[0]!.text).toMatch(/^Legendary Action Uses: 3 \(4 in Lair\)/);
    const lr = (inLair: boolean) => sheetUses(ab, { inLair }).find((r) => r.label === "Legendary Resistance")!.max;
    expect([lr(false), lr(true)]).toEqual([3, 4]);
    expect([legendaryCount(ab), legendaryCount(ab, true)]).toEqual([3, 4]);
    expect(sheetUses(ab).find((r) => r.label === "Dominate Mind")).toMatchObject({ kind: "perDay", max: 2, section: "actions" });
    expect(hasLairFeatures(ab)).toBe(true);
    expect(hasLairFeatures(dragon)).toBe(false);
  });

  it("reads the priest's spell lists (1/Day, and a named 3/Day spellcasting block)", () => {
    const pr = convertMonster(findMonster(xmm as any, "Priest", "XMM"));
    const uses = sheetUses(pr);
    expect(uses.map((r) => [r.label, r.max])).toEqual(expect.arrayContaining([["Spells 1/Day", 1], ["Divine Aid", 3]]));
  });

  it("a stat block without legendary actions or limits has no resources", () => {
    expect(sheetUses(sheet("Wolf", { actions: [{ name: "Bite", text: "…" }] }))).toEqual([]);
    expect(usesSummary(sheet("Wolf"), {})).toBe("");
  });

  it("summary for the tracker leaves spells out", () => {
    const fire = sheetUses(dragon).find((r) => r.label === "Fire Breath")!.key;
    expect(usesSummary(dragon, { uses: { [fire]: 1, legendary: 2 } })).toBe("Legendary Resistance 3/3 · Fire Breath ✗ · Frightful Presence ✓ · Legendary actions 1/3");
  });

  it("start of turn: legendary actions back, an expended Recharge ability rolls (5–6 recharges)", () => {
    const fire = sheetUses(dragon).find((r) => r.label === "Fire Breath")!.key;
    const lr = sheetUses(dragon).find((r) => r.label === "Legendary Resistance")!.key;
    const st = { uses: { [fire]: 1, legendary: 3, [lr]: 1 } };
    const miss = startOfTurnUses(dragon, st, () => 4);
    expect(miss.regainedLegendary).toBe(true);
    expect(miss.recharges.map((x) => [x.roll, x.recharged])).toEqual([[4, false]]);
    expect(miss.uses).toEqual({ [fire]: 1, [lr]: 1 });
    const hit = startOfTurnUses(dragon, st, () => 5);
    expect(hit.uses).toEqual({ [lr]: 1 }); // per-day uses don't come back on a turn
    // Nothing spent: nothing rolled, nothing changed.
    expect(startOfTurnUses(dragon, {}, () => { throw new Error("no roll expected"); })).toEqual({ uses: null, regainedLegendary: false, recharges: [] });
  });
});

describe("limited uses in a scene", () => {
  let scene: FakeScene;
  const state = () => readUnit(scene.items[0]!.metadata)!.state;
  const key = (label: string) => sheetUses(dragon).find((r) => r.label === label)!.key;
  beforeEach(() => {
    scene = new FakeScene();
    scene.items.push({ id: "d", type: "IMAGE", layer: "CHARACTER", name: "Dragon", metadata: { [SHEET_KEY]: dragon, [STATE_KEY]: newState(dragon) }, position: { x: 0, y: 0 }, size: { w: 1, h: 1 } });
  });

  it("spends, refuses past the limit, clamps, and resets", async () => {
    expect(await spendUses(scene, "d", "legendary", 2)).toBe(1);
    await expect(spendUses(scene, "d", "legendary", 2)).rejects.toThrow(/only 1 left/);
    expect(await setUsesSpent(scene, "d", key("Legendary Resistance"), 9)).toBe(0); // clamped to max
    expect(state().uses).toEqual({ legendary: 2, [key("Legendary Resistance")]: 3 });
    await setUsesSpent(scene, "d", "legendary", 0);
    expect(state().uses).toEqual({ [key("Legendary Resistance")]: 3 });
    await expect(setUsesSpent(scene, "d", "actions:bite", 1)).rejects.toThrow(/no limited uses/);
    await resetUses(scene, ["d"]);
    expect(state().uses).toBeUndefined();
  });

  it("start of the dragon's turn: recharge roll message (GM-private) and legendary actions back", async () => {
    await setUsesSpent(scene, "d", key("Fire Breath"), 1);
    await setUsesSpent(scene, "d", "legendary", 3);
    const r = await applyTurnStartUses(scene, "d", { rng: seededRng(3), by: { id: "gm", name: "GM", role: "GM" }, unitName: "Dragon" });
    expect(r.rolls).toHaveLength(1);
    const roll = r.rolls[0]!;
    expect(roll).toMatchObject({ visibility: "private", formula: "1d6", unit: { id: "d", name: "Dragon" } });
    expect(roll.label).toMatch(roll.total >= 5 ? /recharged$/ : /not recharged$/);
    const left: UnitState["uses"] = roll.total >= 5 ? undefined : { [key("Fire Breath")]: 1 };
    expect(state().uses).toEqual(left);
  });

  it("player requests for uses are validated", () => {
    const base = { v: 1, unitId: "d", playerId: "p", playerName: "Ana" };
    expect(isPlayerRequest({ ...base, type: "uses", key: "legendary", spent: 2 })).toBe(true);
    expect(isPlayerRequest({ ...base, type: "uses", key: "legendary", spent: -1 })).toBe(false);
    expect(isPlayerRequest({ ...base, type: "uses", key: 3, spent: 1 })).toBe(false);
  });
});
