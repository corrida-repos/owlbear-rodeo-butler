import { beforeEach, describe, expect, it } from "vitest";
import { seededRng } from "../src/core/dice";
import {
  activeAndNext, EMPTY_ENCOUNTER, ENCOUNTER_KEY, moveInTie, nextTurn, passTurnFrom, previousTurn, readEncounter, startCombat, turnOrder,
  waitingForInitiative, type OrderUnit,
} from "../src/core/encounter";
import { applyDeathSave, applyHp, markDead, parseHpInput, revive, setStable } from "../src/core/hp";
import { newState, SHEET_KEY, SHEET_SCHEMA, STATE_KEY, type UnitSheet, type UnitState } from "../src/core/sheet";
import {
  changeHp, encounterAction, endTurnFor, markUnitsDead, moveTie, recordDeathSave, reviveUnits, rollInitiativeFor, setInEncounter,
  setInitiative, setMaxHp, trackerView,
} from "../src/core/tracker";
import { readUnit } from "../src/core/unit";
import { FakeScene } from "./fakeGateway";

const sheet = (name: string, over: Partial<UnitSheet> = {}): UnitSheet => ({
  schema: SHEET_SCHEMA, name, kind: "creature", size: "M", ac: 12, hp: { max: 20 }, speed: { walk: 30 },
  abilities: { str: 10, dex: 14, con: 10, int: 10, wis: 10, cha: 10 }, saves: {}, skills: [], defenses: {}, proficiencyBonus: 2,
  initiative: { modifier: 2, advantage: false, disadvantage: false, reasons: [] },
  traits: [], actions: [], bonusActions: [], reactions: [], legendary: [], spells: [], inventory: [], source: { provenance: "homebrew" }, flags: [], ...over,
});
const ou = (id: string, initiative: number | null, over: Partial<OrderUnit> = {}): OrderUnit =>
  ({ id, name: id, initiative, initMod: 0, dex: 10, inEncounter: true, ...over });

describe("turn order", () => {
  it("sorts by initiative, then GM tie order, modifier, Dex and name; unrolled units wait", () => {
    const units = [ou("a", 12), ou("b", 15), ou("c", 12, { initMod: 3 }), ou("d", 12, { initMod: 3, dex: 16 }), ou("e", null), ou("f", 20, { inEncounter: false })];
    expect(turnOrder(units).map((u) => u.id)).toEqual(["b", "d", "c", "a"]);
    expect(waitingForInitiative(units).map((u) => u.id)).toEqual(["e"]);
    expect(turnOrder([ou("a", 12, { tiebreak: 1 }), ou("z", 12, { initMod: 5 }), ou("m", 12, { tiebreak: 2 })]).map((u) => u.id)).toEqual(["m", "a", "z"]);
  });

  it("start, next (round wraps), previous, active and next", () => {
    const order = turnOrder([ou("a", 20), ou("b", 15), ou("c", 10)]);
    let e = startCombat(EMPTY_ENCOUNTER, order);
    expect(e).toMatchObject({ started: true, round: 1, turnId: "a" });
    expect(activeAndNext(e, order)).toEqual({ active: "a", next: "b" });
    e = nextTurn(nextTurn(e, order), order);
    expect(e).toMatchObject({ round: 1, turnId: "c" });
    expect(activeAndNext(e, order)).toEqual({ active: "c", next: "a" });
    e = nextTurn(e, order);
    expect(e).toMatchObject({ round: 2, turnId: "a" });
    e = previousTurn(e, order);
    expect(e).toMatchObject({ round: 1, turnId: "c" });
    expect(() => startCombat(EMPTY_ENCOUNTER, [])).toThrow(/initiative/);
    expect(() => previousTurn(startCombat(EMPTY_ENCOUNTER, order), order)).toThrow(/earlier/);
  });

  it("keeps a stable order with 10 units over 5 rounds, including one added mid-combat", () => {
    const units = Array.from({ length: 10 }, (_, i) => ou(`u${i}`, 20 - i * 2));
    let order = turnOrder(units);
    let e = startCombat(EMPTY_ENCOUNTER, order);
    const seen: string[] = [e.turnId!];
    for (let t = 1; t < 50; t++) {
      if (t === 23) { units.push(ou("late", 13)); order = turnOrder(units); } // joins between u3 (14) and u4 (12)
      e = nextTurn(e, order);
      seen.push(e.turnId!);
    }
    expect(seen.slice(0, 10)).toEqual(units.slice(0, 10).map((u) => u.id));
    expect(e.round).toBe(5);
    // Round 3 onwards includes the late unit right after u3.
    const r3 = seen.slice(30, 41);
    expect(r3.indexOf("late")).toBe(r3.indexOf("u3") + 1);
  });

  it("passes the turn when the active unit leaves, without disturbing the others", () => {
    const order = turnOrder([ou("a", 20), ou("b", 15), ou("c", 10)]);
    let e = nextTurn(startCombat(EMPTY_ENCOUNTER, order), order); // b's turn
    const after = passTurnFrom(e, order, ["b"]);
    expect(after).toMatchObject({ round: 1, turnId: "c" });
    expect(passTurnFrom(e, order, ["a"])).toBe(e); // not active: unchanged
    e = nextTurn(e, order); // c, last in round
    expect(passTurnFrom(e, order, ["c"])).toMatchObject({ round: 2, turnId: "a" });
    expect(passTurnFrom(e, order, ["a", "b", "c"]).started).toBe(false);
    // If the active unit vanished without passTurnFrom, Next goes to the one that took its place.
    const without = turnOrder([ou("a", 20), ou("c", 10)]);
    expect(nextTurn({ ...e, turnId: "b", turnIndex: 1 }, without)).toMatchObject({ turnId: "c" });
  });

  it("reorders ties with up/down", () => {
    const order = turnOrder([ou("a", 12), ou("b", 12), ou("c", 12), ou("d", 9)]);
    expect(order.map((u) => u.id)).toEqual(["a", "b", "c", "d"]);
    expect(moveInTie(order, "c", "up")).toEqual([{ id: "a", tiebreak: 3 }, { id: "c", tiebreak: 2 }, { id: "b", tiebreak: 1 }]);
    expect(moveInTie(order, "a", "up")).toEqual([]);
    expect(moveInTie(order, "d", "up")).toEqual([]);
  });

  it("reads a missing or broken record as no encounter", () => {
    expect(readEncounter({})).toEqual(EMPTY_ENCOUNTER);
    expect(readEncounter({ [ENCOUNTER_KEY]: { v: 2 } })).toEqual(EMPTY_ENCOUNTER);
  });
});

describe("HP rules", () => {
  const pc = (s: Partial<UnitState> = {}): UnitState => ({ ...newState(sheet("PC")), party: true, ...s });
  const wolf = sheet("Wolf");

  it("parses the HP box", () => {
    expect(parseHpInput("-7")).toEqual({ kind: "damage", amount: 7 });
    expect(parseHpInput("+5")).toEqual({ kind: "heal", amount: 5 });
    expect(parseHpInput(" 12 ")).toEqual({ kind: "set", amount: 12 });
    expect(parseHpInput("=3")).toEqual({ kind: "set", amount: 3 });
    expect(parseHpInput("t5")).toEqual({ kind: "temp", amount: 5 });
    expect(parseHpInput("temp 8")).toEqual({ kind: "temp", amount: 8 });
    expect(parseHpInput("lots")).toBeNull();
  });

  it("temp HP absorbs damage first and doesn't stack; healing stops at max", () => {
    expect(applyHp(wolf, { ...pc(), hp: 10, tempHp: 5 }, { kind: "damage", amount: 7 }).patch).toEqual({ tempHp: 0, hp: 8 });
    expect(applyHp(wolf, { ...pc(), tempHp: 5 }, { kind: "temp", amount: 3 }).patch).toEqual({ tempHp: 5 });
    expect(applyHp(wolf, { ...pc(), tempHp: 5 }, { kind: "temp", amount: 8 }).patch).toEqual({ tempHp: 8 });
    expect(applyHp(wolf, { ...pc(), hp: 15 }, { kind: "heal", amount: 10 }).patch).toEqual({ hp: 20 });
    expect(applyHp(wolf, { ...pc(), hp: 15 }, { kind: "set", amount: 99 }).patch).toEqual({ hp: 20 });
    expect(applyHp(wolf, { ...pc(), hp: 15, maxHpOverride: 30 }, { kind: "heal", amount: 99 }).patch).toEqual({ hp: 30 });
  });

  it("party member: 0 HP starts death saves; damage at 0 is a failure; massive damage is reported", () => {
    const r = applyHp(wolf, pc({ hp: 5 }), { kind: "damage", amount: 9 });
    expect(r.patch).toEqual({ hp: 0, deathSaves: { successes: 0, failures: 0 } });
    expect(r.events).toEqual(["dropped-to-zero"]);
    const f = applyHp(wolf, pc({ hp: 0, deathSaves: { successes: 1, failures: 1 } }), { kind: "damage", amount: 3, critical: true });
    expect(f.patch.deathSaves).toEqual({ successes: 1, failures: 3 });
    expect(f.events).toEqual(["death-save-failure", "three-failures"]);
    expect(applyHp(wolf, pc({ hp: 5 }), { kind: "damage", amount: 25 }).events).toEqual(["dropped-to-zero", "massive-damage"]);
  });

  it("Stable is lost on damage; healing above 0 clears death saves and Stable", () => {
    const stable = pc({ hp: 0, conditions: [{ id: "s", key: "stable" }], deathSaves: { successes: 0, failures: 0 } });
    const d = applyHp(wolf, stable, { kind: "damage", amount: 1 });
    expect(d.patch.conditions).toEqual([]);
    expect(d.patch.deathSaves).toEqual({ successes: 0, failures: 1 });
    expect(d.events).toContain("stable-lost");
    const h = applyHp(wolf, pc({ hp: 0, deathSaves: { successes: 2, failures: 1 } }), { kind: "heal", amount: 4 });
    expect(h.patch).toEqual({ hp: 4, deathSaves: undefined });
    expect(h.events).toEqual(["revived-from-zero"]);
    expect("deathSaves" in h.patch).toBe(true); // undefined = remove the key
  });

  it("a unit that is already Dead reports nothing at 0 HP", () => {
    const r = applyHp(wolf, pc({ hp: 5, conditions: [{ id: "d", key: "dead" }] }), { kind: "damage", amount: 9 });
    expect(r).toEqual({ patch: { hp: 0 }, events: [] });
  });
  it("creatures at 0 HP are reported (Mark as dead offered), no death saves", () => {
    const r = applyHp(wolf, newState(wolf, { hp: 4 }), { kind: "damage", amount: 10 });
    expect(r.patch).toEqual({ hp: 0 });
    expect(r.events).toEqual(["creature-at-zero"]);
  });

  it("death saves: success, failures, nat 1, nat 20, three successes → Stable", () => {
    const s = pc({ hp: 0, deathSaves: { successes: 2, failures: 0 } });
    expect(applyDeathSave(s, 12).outcome).toBe("stable");
    expect(applyDeathSave(s, 12).patch.conditions!.map((c) => c.key)).toEqual(["stable"]);
    expect(applyDeathSave(pc({ hp: 0 }), 10)).toEqual({ patch: { deathSaves: { successes: 1, failures: 0 } }, outcome: "success" });
    expect(applyDeathSave(pc({ hp: 0 }), 9).outcome).toBe("failure");
    expect(applyDeathSave(pc({ hp: 0 }), 1).patch.deathSaves).toEqual({ successes: 0, failures: 2 });
    expect(applyDeathSave(pc({ hp: 0, deathSaves: { successes: 0, failures: 2 } }), 5).outcome).toBe("dead");
    expect(applyDeathSave(pc({ hp: 0 }), 20).patch).toMatchObject({ hp: 1, deathSaves: undefined });
  });

  it("Mark as dead supersedes Death Saves and Stable; Revive removes Dead; Stable only at 0 HP", () => {
    const p = markDead({ conditions: [{ id: "s", key: "stable" }, { id: "p", key: "poisoned" }] });
    expect(p.conditions!.map((c) => c.key)).toEqual(["poisoned", "dead"]);
    expect(p).toMatchObject({ inEncounter: false, deathSaves: undefined });
    expect(revive({ conditions: p.conditions! }).conditions!.map((c) => c.key)).toEqual(["poisoned"]);
    expect(() => setStable({ conditions: [], hp: 3, party: true })).toThrow();
    expect(setStable({ conditions: [], hp: 0, party: true }).conditions!.map((c) => c.key)).toEqual(["stable"]);
  });
});

describe("tracker operations in a scene", () => {
  let scene: FakeScene;
  const add = (id: string, s: UnitSheet, st: Partial<UnitState>, extra: { visible?: boolean } = {}) => scene.items.push({
    id, type: "IMAGE", layer: "CHARACTER", name: s.name, label: s.name, metadata: { [SHEET_KEY]: s, [STATE_KEY]: newState(s, st) },
    position: { x: 0, y: 0 }, size: { w: 1, h: 1 }, ...extra,
  });
  const state = (id: string) => readUnit(scene.items.find((i) => i.id === id)!.metadata)!.state;
  const view = async () => trackerView(await scene.getItems(), await scene.getSceneMetadata());

  beforeEach(() => {
    scene = new FakeScene();
    add("pc", sheet("Thorn", { kind: "character" }), { party: true, initiative: 18, inEncounter: true, controlledBy: "ana" });
    add("w1", sheet("Wolf 1"), { initiative: 14, inEncounter: true });
    add("w2", sheet("Wolf 2"), { initiative: 9, inEncounter: true, hp: 3 });
    add("bandit", sheet("Bandit"), { initiative: null, inEncounter: true }, { visible: false });
    add("npc", sheet("Merchant"), { inEncounter: false });
  });

  it("builds the view: order, waiting, outside, hidden", async () => {
    const v = await view();
    expect(v.order.map((u) => u.id)).toEqual(["pc", "w1", "w2"]);
    expect(v.waiting.map((u) => [u.id, u.hidden])).toEqual([["bandit", true]]);
    expect(v.outside.map((u) => u.id)).toEqual(["npc"]);
  });

  it("runs turns; Mark as dead on the active unit passes the turn and keeps the round", async () => {
    await encounterAction(scene, "start");
    await encounterAction(scene, "next");
    expect((await view()).active).toBe("w1");
    await markUnitsDead(scene, ["w1"]);
    const v = await view();
    expect(v.active).toBe("w2");
    expect(v.encounter.round).toBe(1);
    expect(state("w1")).toMatchObject({ inEncounter: false });
    expect(state("w1").conditions.map((c) => c.key)).toEqual(["dead"]);
    await reviveUnits(scene, ["w1"]);
    expect(state("w1").conditions).toEqual([]);
  });

  it("removing the active unit from initiative passes the turn too", async () => {
    await encounterAction(scene, "start");
    await setInEncounter(scene, ["pc"], false);
    expect((await view()).active).toBe("w1");
  });

  it("reset clears initiative and the round, units stay in the encounter", async () => {
    await encounterAction(scene, "start");
    await encounterAction(scene, "reset");
    const v = await view();
    expect(v.encounter.started).toBe(false);
    expect(v.order).toEqual([]);
    expect(v.waiting.map((u) => u.id).sort()).toEqual(["bandit", "pc", "w1", "w2"]);
    expect(state("pc").initiativeRoll).toBeUndefined();
  });

  it("damages several units at once; auto-dead creatures leave initiative", async () => {
    await encounterAction(scene, "start");
    const r = await changeHp(scene, ["w1", "w2", "pc"], { kind: "damage", amount: 5 }, { autoDeadAtZero: true });
    expect(r.find((x) => x.id === "w2")).toMatchObject({ events: ["creature-at-zero"], markedDead: true });
    expect(state("w1").hp).toBe(15);
    expect(state("w2")).toMatchObject({ hp: 0, inEncounter: false });
    expect(state("pc").hp).toBe(15);
    const r2 = await changeHp(scene, ["w1"], { kind: "damage", amount: 99 });
    expect(r2[0]).toMatchObject({ events: ["creature-at-zero"], markedDead: false });
  });

  it("death saves from the card, PC down then marked dead", async () => {
    await changeHp(scene, ["pc"], { kind: "damage", amount: 20 });
    expect(state("pc").deathSaves).toEqual({ successes: 0, failures: 0 });
    expect(await recordDeathSave(scene, "pc", 4)).toBe("failure");
    expect(await recordDeathSave(scene, "pc", 1)).toBe("dead");
    await markUnitsDead(scene, ["pc"]);
    expect(state("pc").deathSaves).toBeUndefined();
    expect(state("pc").conditions.map((c) => c.key)).toEqual(["dead"]);
  });

  it("typed initiative, rolled initiative, ties, max HP and player end-turn requests", async () => {
    await setInitiative(scene, "bandit", 14);
    expect((await view()).order.map((u) => u.id)).toEqual(["pc", "bandit", "w1", "w2"]); // tie with w1: name order
    await moveTie(scene, "w1", "up");
    expect((await view()).order.map((u) => u.id)).toEqual(["pc", "w1", "bandit", "w2"]);
    expect(await rollInitiativeFor(scene, ["npc"], { rng: seededRng(3) })).toBe(1);
    expect(state("npc").inEncounter).toBe(true);
    expect(typeof state("npc").initiative).toBe("number");
    await setMaxHp(scene, "w1", 10);
    expect(state("w1")).toMatchObject({ maxHpOverride: 10, hp: 10 });
    await setMaxHp(scene, "w1", null);
    expect(state("w1").maxHpOverride).toBeUndefined();

    await encounterAction(scene, "start");
    expect(await endTurnFor(scene, "w1", 1)).toBe(false); // not w1's turn
    expect(await endTurnFor(scene, "pc", 1)).toBe(true);
    expect(await endTurnFor(scene, "pc", 1)).toBe(false); // already moved on (second GM tab)
    const v = await view();
    expect(v.active).toBe(v.order[1]!.id);
  });

  it("only the GM changes the encounter", async () => {
    scene.role = "PLAYER";
    await expect(encounterAction(scene, "start")).rejects.toThrow(/GM/);
  });
});
