import { beforeEach, describe, expect, it } from "vitest";
import { addCondition, badgeText, conditionText, d20Penalty, durationText, expiredOnTurnChange, exhaustionLevel, removeCondition, speedPenalty } from "../src/core/conditions";
import { applyHp } from "../src/core/hp";
import { addStep, movedFeet, rewind, rewindTarget, snapToCell, speedLimit, startMovement } from "../src/core/movement";
import { newState, SHEET_KEY, SHEET_SCHEMA, STATE_KEY, type UnitSheet, type UnitState } from "../src/core/sheet";
import { DND5E_2014, DND5E_2024 } from "../src/core/systems";
import { addConditionTo, changeHp, encounterAction, expireConditions, removeConditionFrom, resolveConcentration } from "../src/core/tracker";
import { readUnit } from "../src/core/unit";
import { FakeScene } from "./fakeGateway";

const sheet = (name: string, over: Partial<UnitSheet> = {}): UnitSheet => ({
  schema: SHEET_SCHEMA, name, kind: "creature", size: "M", ac: 12, hp: { max: 30 }, speed: { walk: 30 },
  abilities: { str: 10, dex: 14, con: 10, int: 10, wis: 10, cha: 10 }, saves: {}, skills: [], defenses: {}, proficiencyBonus: 2,
  initiative: { modifier: 2, advantage: false, disadvantage: false, reasons: [] },
  traits: [], actions: [], bonusActions: [], reactions: [], legendary: [], spells: [], inventory: [], source: { provenance: "homebrew" }, flags: [], ...over,
});
const st = (s: Partial<UnitState> = {}): UnitState => ({ ...newState(sheet("X")), ...s });

describe("conditions", () => {
  it("adds, replaces and removes; exhaustion has one instance with a level 1–6; custom effects by label", () => {
    let s = st();
    s = { ...s, ...addCondition(s, "prone") };
    s = { ...s, ...addCondition(s, "prone") };
    expect(s.conditions.map((c) => c.key)).toEqual(["prone"]);
    s = { ...s, ...addCondition(s, "exhaustion", { level: 2 }) };
    s = { ...s, ...addCondition(s, "exhaustion", { level: 9 }) };
    expect(exhaustionLevel(s)).toBe(6);
    s = { ...s, ...addCondition(s, "custom", { label: "Hexed", note: "by the warlock" }) };
    s = { ...s, ...addCondition(s, "custom", { label: "Blessed" }) };
    expect(s.conditions.filter((c) => c.key === "custom").map((c) => c.label)).toEqual(["Hexed", "Blessed"]);
    const id = s.conditions[0]!.id;
    expect(removeCondition(s, id).conditions!.map((c) => c.key)).toEqual(["exhaustion", "custom", "custom"]);
  });

  it("exhaustion penalties follow the system", () => {
    const s = st({ conditions: [{ id: "e", key: "exhaustion", level: 3 }] });
    expect(d20Penalty(DND5E_2024, s)).toBe(-6);
    expect(speedPenalty(DND5E_2024, s)).toBe(15);
    expect(d20Penalty(DND5E_2014, s)).toBe(0);
  });

  it("texts and badges", () => {
    expect(conditionText({ id: "1", key: "exhaustion", level: 2 }, DND5E_2024)).toBe("Exhaustion 2");
    expect(conditionText({ id: "1", key: "custom", label: "Hexed" }, DND5E_2024)).toBe("Hexed");
    expect(durationText({ id: "1", key: "prone", until: { turnOf: "u1", at: "end" } }, () => "Thorn")).toBe("until the end of Thorn's next turn");
    expect(badgeText(["Prone", "Poisoned", "Blinded", "Deafened", "Hexed"])).toBe("Prone · Poisoned · Blinded +2");
    expect(badgeText([])).toBe("");
  });
});

describe("condition durations", () => {
  const order = ["a", "b", "c"];
  const pos = (id: string) => order.indexOf(id);
  const withCond = (until: any, from = { round: 1, turnId: "b" }) => [{ id: "u", state: { conditions: [{ id: "k", key: "poisoned", until, from }] } }];

  it("N rounds: ends at the same point in the order N rounds later", () => {
    const u = withCond({ rounds: 1, turnOf: "b", at: "start" });
    expect(expiredOnTurnChange(u, { round: 1, turnId: "b" }, { round: 1, turnId: "c" }, pos)).toEqual([]);
    expect(expiredOnTurnChange(u, { round: 1, turnId: "c" }, { round: 2, turnId: "a" }, pos)).toEqual([]);
    expect(expiredOnTurnChange(u, { round: 2, turnId: "a" }, { round: 2, turnId: "b" }, pos)).toHaveLength(1);
  });

  it("until the start of X's turn: the first start after it was applied", () => {
    const u = withCond({ turnOf: "a", at: "start" });
    expect(expiredOnTurnChange(u, { round: 1, turnId: "b" }, { round: 1, turnId: "c" }, pos)).toEqual([]);
    expect(expiredOnTurnChange(u, { round: 1, turnId: "c" }, { round: 2, turnId: "a" }, pos)).toHaveLength(1);
  });

  it("until the end of X's turn: applied during X's own turn means its next turn", () => {
    const own = withCond({ turnOf: "b", at: "end" });
    expect(expiredOnTurnChange(own, { round: 1, turnId: "b" }, { round: 1, turnId: "c" }, pos)).toEqual([]);
    expect(expiredOnTurnChange(own, { round: 2, turnId: "b" }, { round: 2, turnId: "c" }, pos)).toHaveLength(1);
    const other = withCond({ turnOf: "c", at: "end" });
    expect(expiredOnTurnChange(other, { round: 1, turnId: "c" }, { round: 2, turnId: "a" }, pos)).toHaveLength(1);
  });

  it("conditions without a duration never expire", () => {
    expect(expiredOnTurnChange([{ id: "u", state: { conditions: [{ id: "k", key: "prone" }] } }], null, { round: 9, turnId: "a" }, pos)).toEqual([]);
  });
});

describe("concentration", () => {
  const conc = (s: Partial<UnitState> = {}) => st({ hp: 20, conditions: [{ id: "c", key: "concentration" }], ...s });
  it("damage asks for a Con save with the system's DC, temp HP damage counts", () => {
    const r = applyHp(sheet("X"), conc({ tempHp: 5 }), { kind: "damage", amount: 24 }, DND5E_2024);
    expect(r.patch.concentrationCheck).toEqual({ dc: 12, damage: 24 });
    expect(r.events).toContain("concentration-check");
    expect(applyHp(sheet("X"), conc(), { kind: "damage", amount: 3 }).patch.concentrationCheck).toEqual({ dc: 10, damage: 3 });
    expect(applyHp(sheet("X", { hp: { max: 200 } }), conc({ hp: 200 }), { kind: "damage", amount: 90 }, DND5E_2024).patch.concentrationCheck!.dc).toBe(30);
    expect(applyHp(sheet("X", { hp: { max: 200 } }), conc({ hp: 200 }), { kind: "damage", amount: 90 }, DND5E_2014).patch.concentrationCheck!.dc).toBe(45);
  });
  it("dropping to 0 HP ends it; no damage, no check", () => {
    const r = applyHp(sheet("X"), conc({ hp: 4 }), { kind: "damage", amount: 10 });
    expect(r.patch.conditions).toEqual([]);
    expect(r.events).toContain("concentration-lost");
    expect(applyHp(sheet("X"), conc(), { kind: "heal", amount: 3 }).events).toEqual([]);
  });
});

describe("conditions in a scene", () => {
  let scene: FakeScene;
  const add = (id: string, init: number, s: Partial<UnitState> = {}) => scene.items.push({
    id, type: "IMAGE", layer: "CHARACTER", name: id, label: id, metadata: { [SHEET_KEY]: sheet(id), [STATE_KEY]: newState(sheet(id), { initiative: init, inEncounter: true, ...s }) },
    position: { x: 0, y: 0 }, size: { w: 1, h: 1 },
  });
  const state = (id: string) => readUnit(scene.items.find((i) => i.id === id)!.metadata)!.state;
  beforeEach(() => { scene = new FakeScene(); add("a", 20); add("b", 15); add("c", 10); });

  it("applies to several units, expires with turns, and can't take a duration outside combat", async () => {
    await expect(addConditionTo(scene, ["a"], "prone", { duration: { kind: "rounds", rounds: 1 } })).rejects.toThrow(/combat/);
    await encounterAction(scene, "start"); // a
    await addConditionTo(scene, ["b", "c"], "poisoned", { duration: { kind: "turn", turnOf: "b", at: "end" } });
    expect(state("b").conditions[0]).toMatchObject({ key: "poisoned", from: { round: 1, turnId: "a" } });
    await encounterAction(scene, "next"); // b
    expect(await expireConditions(scene, { round: 1, turnId: "a" }, { round: 1, turnId: "b" }, DND5E_2024)).toEqual([]);
    await encounterAction(scene, "next"); // c: b's turn ended
    expect(await expireConditions(scene, { round: 1, turnId: "b" }, { round: 1, turnId: "c" }, DND5E_2024)).toEqual(["Poisoned ended on b.", "Poisoned ended on c."]);
    expect(state("b").conditions).toEqual([]);
  });

  it("concentration check from damage, resolved by the save", async () => {
    await addConditionTo(scene, ["a"], "concentration");
    await changeHp(scene, ["a"], { kind: "damage", amount: 22 }, { system: DND5E_2024 });
    expect(state("a").concentrationCheck).toEqual({ dc: 11, damage: 22 });
    expect(await resolveConcentration(scene, "a", 15)).toBe("kept");
    expect(state("a").concentrationCheck).toBeUndefined();
    await changeHp(scene, ["a"], { kind: "damage", amount: 2 });
    expect(await resolveConcentration(scene, "a", 7)).toBe("lost");
    expect(state("a").conditions).toEqual([]);
    expect(await resolveConcentration(scene, "a", 7)).toBe("dismissed");
  });

  it("removing Concentration clears a pending check", async () => {
    await addConditionTo(scene, ["a"], "concentration");
    await changeHp(scene, ["a"], { kind: "damage", amount: 5 });
    await removeConditionFrom(scene, "a", state("a").conditions[0]!.id);
    expect(state("a").concentrationCheck).toBeUndefined();
  });
});

describe("movement tracker", () => {
  it("sums the path, ignores non-moves, and rewinds to the last 5 ft point (13 → 10)", () => {
    let m = startMovement("u", 1, { x: 0, y: 0 });
    m = addStep(m, { x: 0, y: 0 }, 0);
    expect(m.path).toHaveLength(1);
    m = addStep(m, { x: 100, y: 0 }, 8);
    m = addStep(m, { x: 100, y: 50 }, 5);
    expect(movedFeet(m)).toBe(13);
    expect(rewindTarget(13)).toBe(10);
    const r = rewind(m);
    // 10 ft = all of the first segment (8) + 2 of the 5 ft second segment → 40% of the way from (100,0) to (100,50).
    expect(r.position).toEqual({ x: 100, y: 20 });
    expect(movedFeet(r.state)).toBe(10);
    // Again from a multiple of 5: back another 5 ft, landing inside the first segment.
    const r2 = rewind(r.state);
    expect(movedFeet(r2.state)).toBe(5);
    expect(r2.position.x).toBeCloseTo(62.5);
    // And down to the start.
    expect(rewind(rewind(r2.state).state).position).toEqual({ x: 0, y: 0 });
  });
  it("rewinds onto an existing point exactly", () => {
    let m = startMovement("u", 1, { x: 0, y: 0 });
    m = addStep(m, { x: 50, y: 0 }, 5);
    m = addStep(m, { x: 100, y: 0 }, 5);
    m = addStep(m, { x: 120, y: 0 }, 3);
    const r = rewind(m);
    expect(r.position).toEqual({ x: 100, y: 0 });
    expect(r.state.path).toHaveLength(3);
  });
  it("speed limit: fastest speed, Dash doubles, exhaustion slows", () => {
    expect(speedLimit({ speed: { walk: 30 } })).toBe(30);
    expect(speedLimit({ speed: { walk: 30, fly: 60 } })).toBe(60);
    expect(speedLimit({ speed: { walk: 30 } }, { dash: true })).toBe(60);
    expect(speedLimit({ speed: { walk: 30 } }, { penalty: 10, dash: true })).toBe(40);
  });
  it("snaps to the nearest cell centre", () => {
    expect(snapToCell({ x: 100, y: 20 }, 150)).toEqual({ x: 75, y: 75 });
    expect(snapToCell({ x: 230, y: 160 }, 150)).toEqual({ x: 225, y: 225 });
  });
});
