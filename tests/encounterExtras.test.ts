/** Lair actions on initiative 20, HP undo, surprise and revealing hidden units on their turn. */
import { beforeEach, describe, expect, it } from "vitest";
import { seededRng } from "../src/core/dice";
import { ENCOUNTER_KEY } from "../src/core/encounter";
import { convertMonster } from "../src/core/fivetools";
import { expiredOnTurnChange, durationText } from "../src/core/conditions";
import { hpLogEntry, HP_LOG_MAX, undoHpPatch, withHpLog } from "../src/core/hp";
import { initiativeRoll } from "../src/core/card";
import { initiativeSetupFor } from "../src/core/combat";
import { newState, SHEET_KEY, SHEET_SCHEMA, STATE_KEY, validateSheet, type UnitSheet, type UnitState } from "../src/core/sheet";
import { DND5E_2014, DND5E_2024 } from "../src/core/systems";
import {
  addConditionTo, addWorldTurn, changeHp, encounterAction, readWorldTurns, removeWorldTurn, updateWorldTurn, WORLD_KEY, expireConditions, LAIR_TURN_ID, markUnitsDead, revealOnTurnStart, revealUnits, rollInitiativeFor,
  setRevealOnTurn, setSurprised, trackerView, undoHp,
} from "../src/core/tracker";
import { isPlayerRequest } from "../src/core/turns";
import { readUnit } from "../src/core/unit";
import { setInLair } from "../src/core/uses";
import { FakeScene } from "./fakeGateway";

const sheet = (name: string, over: Partial<UnitSheet> = {}): UnitSheet => ({
  schema: SHEET_SCHEMA, name, kind: "creature", size: "M", ac: 12, hp: { max: 20 }, speed: { walk: 30 },
  abilities: { str: 10, dex: 14, con: 10, int: 10, wis: 10, cha: 10 }, saves: {}, skills: [], defenses: {}, proficiencyBonus: 2,
  initiative: { modifier: 2, advantage: false, disadvantage: false, reasons: [] },
  traits: [], actions: [], bonusActions: [], reactions: [], legendary: [], spells: [], inventory: [], source: { provenance: "homebrew" }, flags: [], ...over,
});
const lairDragon = sheet("Adult Red Dragon", { hp: { max: 256 }, lair: [{ name: "Lair Actions", text: "On initiative count 20 (losing initiative ties)…" }] });

let scene: FakeScene;
const add = (id: string, s: UnitSheet, st: Partial<UnitState>, extra: { visible?: boolean } = {}) => scene.items.push({
  id, type: "IMAGE", layer: "CHARACTER", name: s.name, label: s.name, metadata: { [SHEET_KEY]: s, [STATE_KEY]: newState(s, st) },
  position: { x: 0, y: 0 }, size: { w: 1, h: 1 }, ...extra,
});
const state = (id: string) => readUnit(scene.items.find((i) => i.id === id)!.metadata)!.state;
const view = async () => trackerView(await scene.getItems(), await scene.getSceneMetadata());
const enc = () => scene.sceneMeta[ENCOUNTER_KEY] as { round: number; turnId: string };

beforeEach(() => { scene = new FakeScene(); });

describe("lair actions", () => {
  beforeEach(() => {
    add("pc", sheet("Thorn", { kind: "character" }), { party: true, initiative: 20, inEncounter: true });
    add("drg", lairDragon, { initiative: 12, inEncounter: true });
    add("kob", sheet("Kobold"), { initiative: 22, inEncounter: true });
  });

  it("converts 5etools lair actions into the sheet's lair list", () => {
    const raw = { name: "Red Dragon Test", source: "MM", size: ["H"], type: "dragon", ac: [18], hp: { average: 256, formula: "19d12+133" },
      speed: { walk: 40 }, str: 27, dex: 10, con: 25, int: 16, wis: 13, cha: 21, cr: "17", legendaryGroup: { name: "Red Dragon", source: "MM" },
      legendary: [{ name: "Detect", entries: ["The dragon makes a Wisdom (Perception) check."] }] };
    const group = { name: "Red Dragon", source: "MM", lairActions: ["On initiative count 20 (losing initiative ties), the dragon takes a lair action:", { type: "list", items: ["Magma erupts… {@dc 15} Dexterity saving throw, taking 21 ({@damage 6d6}) fire damage."] }], regionalEffects: ["…"] };
    const sb = convertMonster(raw, { legendaryGroup: group, catalogEntry: { rules: "2014" } as any });
    expect(validateSheet(sb)).toEqual([]);
    expect(sb.lair).toHaveLength(1);
    expect(sb.lair![0]!.text).toMatch(/initiative count 20/);
    expect(sb.lair![0]!.text).toMatch(/\[6d6\]/); // the damage is a dice chip
    expect(sb.flags.join(" ")).toMatch(/Regional effects/);
    expect(sb.legendary[0]!.text).toMatch(/can take 3 legendary actions/);
    // Without the group (couldn't load), it says so instead of silently dropping it.
    expect(convertMonster(raw).flags.join(" ")).toMatch(/couldn't be loaded/);
    expect(convertMonster(raw).lair).toBeUndefined();
  });

  it("no lair turn until the creature is in its lair; then initiative 20, after units on 20", async () => {
    expect((await view()).turns.map((t) => t.id)).toEqual(["kob", "pc", "drg"]);
    await setInLair(scene, "drg", true);
    expect((await view()).turns.map((t) => t.id)).toEqual(["kob", "pc", LAIR_TURN_ID, "drg"]);
    // A creature in its lair but without lair actions (2024 stat block) adds no turn.
    add("ab", sheet("Aboleth"), { initiative: 5, inEncounter: true, inLair: true });
    expect((await view()).turns.filter((t) => t.id === LAIR_TURN_ID)).toHaveLength(1);
  });

  it("the encounter steps through the lair turn; it goes away when the creature dies", async () => {
    await setInLair(scene, "drg", true);
    await encounterAction(scene, "start");
    await encounterAction(scene, "next");
    await encounterAction(scene, "next");
    expect(enc()).toMatchObject({ round: 1, turnId: LAIR_TURN_ID });
    expect((await view()).active).toBe(LAIR_TURN_ID);
    await encounterAction(scene, "next");
    expect(enc().turnId).toBe("drg");
    await encounterAction(scene, "previous");
    expect(enc().turnId).toBe(LAIR_TURN_ID);
    // Dead dragon: no more lair turn, and the active lair turn passes on.
    await markUnitsDead(scene, ["drg"]);
    expect((await view()).turns.map((t) => t.id)).toEqual(["kob", "pc"]);
    await encounterAction(scene, "next");
    expect(enc()).toMatchObject({ round: 2, turnId: "kob" });
  });

  it("a duration counted from the lair turn ends on the lair turn a round later", async () => {
    await setInLair(scene, "drg", true);
    await encounterAction(scene, "start");
    await encounterAction(scene, "next");
    await encounterAction(scene, "next"); // lair turn
    await addConditionTo(scene, ["pc"], "restrained", { duration: { kind: "rounds", rounds: 1 } });
    const v = await view();
    const pos = (id: string) => v.turns.findIndex((t) => t.id === id);
    const units = [...v.order];
    expect(expiredOnTurnChange(units, { round: 2, turnId: "pc" }, { round: 2, turnId: LAIR_TURN_ID }, pos)).toHaveLength(1);
    expect(expiredOnTurnChange(units, { round: 2, turnId: "kob" }, { round: 2, turnId: "pc" }, pos)).toHaveLength(0);
    expect(await expireConditions(scene, { round: 2, turnId: "pc" }, { round: 2, turnId: LAIR_TURN_ID }, DND5E_2024)).toEqual(["Restrained ended on Thorn."]);
  });
});

describe("HP undo", () => {
  it("undoes a mistyped hit: HP, death saves and the conditions it changed", async () => {
    add("pc", sheet("Thorn", { kind: "character" }), { party: true, hp: 15, inEncounter: true, initiative: 10 });
    await addConditionTo(scene, ["pc"], "concentration");
    await changeHp(scene, ["pc"], { kind: "damage", amount: 70 }, { system: DND5E_2024 });
    expect(state("pc")).toMatchObject({ hp: 0, deathSaves: { successes: 0, failures: 0 } });
    expect(state("pc").conditions.map((c) => c.key)).toEqual([]); // 0 HP ended Concentration
    expect(state("pc").hpLog!.map((e) => e.text)).toEqual(["-70"]);
    expect(await undoHp(scene, "pc")).toEqual({ text: "-70", hp: 15 });
    expect(state("pc").hp).toBe(15);
    expect(state("pc").deathSaves).toBeUndefined();
    expect(state("pc").conditions.map((c) => c.key)).toEqual(["concentration"]);
    expect(state("pc").hpLog).toBeUndefined();
    await expect(undoHp(scene, "pc")).rejects.toThrow(/No HP change/);
  });

  it("undoes an automatic Mark as dead: back in initiative, Dead removed", async () => {
    add("w", sheet("Wolf"), { hp: 5, inEncounter: true, initiative: 12 });
    await changeHp(scene, ["w"], { kind: "damage", amount: 9 }, { autoDeadAtZero: true, system: DND5E_2024 });
    expect(state("w")).toMatchObject({ hp: 0, inEncounter: false });
    expect(state("w").conditions.map((c) => c.key)).toEqual(["dead"]);
    await undoHp(scene, "w");
    expect(state("w")).toMatchObject({ hp: 5, inEncounter: true });
    expect(state("w").conditions).toEqual([]);
  });

  it("steps back through several changes, temp HP included; refuses after an unlogged HP change", async () => {
    add("w", sheet("Wolf"), { hp: 20 });
    await changeHp(scene, ["w"], { kind: "temp", amount: 5 });
    await changeHp(scene, ["w"], { kind: "damage", amount: 8 });
    await changeHp(scene, ["w"], { kind: "heal", amount: 2 });
    expect(state("w").hpLog!.map((e) => e.text)).toEqual(["t5", "-8", "+2"]);
    await undoHp(scene, "w");
    expect(state("w")).toMatchObject({ hp: 17, tempHp: 0 });
    await undoHp(scene, "w");
    expect(state("w")).toMatchObject({ hp: 20, tempHp: 5 });
    // Someone set HP outside the log (a death save of 20, an import): undoing would overwrite it.
    await scene.patchMetadata([{ id: "w", key: STATE_KEY, patch: { hp: 3 } }]);
    await expect(undoHp(scene, "w")).rejects.toThrow(/HP changed since t5/);
  });

  it("keeps the last few changes and records nothing for a change that changes nothing", () => {
    const st: UnitState = newState(sheet("Wolf"));
    expect(hpLogEntry(st, {}, { kind: "damage", amount: 0 }, 1)).toBeNull();
    let log: UnitState["hpLog"] = [];
    for (let i = 0; i < HP_LOG_MAX + 3; i++) log = withHpLog({ hpLog: log }, hpLogEntry(st, { hp: 19 - i }, { kind: "damage", amount: 1 }, i)!);
    expect(log).toHaveLength(HP_LOG_MAX);
    expect(log.at(-1)!.at).toBe(HP_LOG_MAX + 2);
    expect(() => undoHpPatch({ ...st, hpLog: [] })).toThrow();
  });

  it("player undo requests are validated", () => {
    expect(isPlayerRequest({ v: 1, unitId: "u", playerId: "p", playerName: "Ana", type: "hp-undo" })).toBe(true);
  });
});

describe("surprise", () => {
  beforeEach(() => {
    add("pc", sheet("Thorn", { kind: "character" }), { party: true, initiative: 15, inEncounter: true });
    add("gob", sheet("Goblin"), { inEncounter: true });
  });

  it("5.5E: a surprised unit rolls initiative with disadvantage; the mark clears when combat starts", async () => {
    await setSurprised(scene, ["gob"], true);
    const st = state("gob");
    expect(initiativeSetupFor({}, sheet("Goblin"), st, "2024").disadvantage).toBe(true);
    expect(initiativeSetupFor({}, sheet("Goblin"), st, "2014").disadvantage).toBe(false);
    expect(initiativeRoll(sheet("Goblin"), "2024", st).mode).toBe("disadvantage");
    expect(initiativeRoll(sheet("Goblin", { initiative: { modifier: 2, advantage: true, disadvantage: false, reasons: [] } }), "2024", st).mode).toBeUndefined();
    await rollInitiativeFor(scene, ["gob"], { rng: seededRng(1), rules: "2024" });
    expect(state("gob").initiativeRoll!.mode).toBe("disadvantage");
    await encounterAction(scene, "start", { rules: "2024" });
    expect(state("gob").surprised).toBeUndefined();
    expect(state("gob").conditions).toEqual([]);
  });

  it("5E: Surprised until the end of the unit's first turn", async () => {
    await scene.patchMetadata([{ id: "gob", key: STATE_KEY, patch: { initiative: 10 } }]);
    await setSurprised(scene, ["gob"], true);
    await encounterAction(scene, "start", { rules: "2014" });
    const c = state("gob").conditions.find((x) => x.key === "surprised")!;
    expect(c).toBeDefined();
    expect(durationText(c, (id) => (id === "gob" ? "Goblin" : id))).toBe("until the end of Goblin's first turn");
    expect(DND5E_2014.conditions.some((d) => d.key === "surprised")).toBe(true);
    // Thorn's turn ends: still surprised. The goblin's first turn ends: no longer.
    expect(await expireConditions(scene, { round: 1, turnId: "pc" }, { round: 1, turnId: "gob" }, DND5E_2014)).toEqual([]);
    expect(await expireConditions(scene, { round: 1, turnId: "gob" }, { round: 2, turnId: "pc" }, DND5E_2014)).toEqual(["Surprised ended on Goblin."]);
  });

  it("End combat and Reset clear surprise marks", async () => {
    await setSurprised(scene, ["gob", "pc"], true);
    await encounterAction(scene, "reset");
    expect([state("gob").surprised, state("pc").surprised]).toEqual([undefined, undefined]);
  });
});

describe("hidden units revealed on their turn", () => {
  beforeEach(() => {
    add("pc", sheet("Thorn", { kind: "character" }), { party: true, initiative: 15, inEncounter: true });
    add("ass", sheet("Assassin"), { initiative: 12, inEncounter: true }, { visible: false });
  });

  it("reveals only units marked for it, when their turn starts", async () => {
    expect(await revealOnTurnStart(scene, "ass")).toBeNull(); // not marked: stays hidden
    expect(scene.items[1]!.visible).toBe(false);
    await setRevealOnTurn(scene, ["ass"], true);
    expect(await revealOnTurnStart(scene, "pc")).toBeNull();
    expect(await revealOnTurnStart(scene, "ass")).toBe("Assassin");
    expect(scene.items[1]!.visible).toBe(true);
    expect(state("ass").revealOnTurn).toBeUndefined();
    expect((await view()).order.find((u) => u.id === "ass")!.hidden).toBe(false);
  });

  it("Reveal now (GM only)", async () => {
    scene.role = "PLAYER";
    await expect(revealUnits(scene, ["ass"])).rejects.toThrow(/GM/);
    scene.role = "GM";
    await revealUnits(scene, ["ass"]);
    expect(scene.items[1]!.visible).toBe(true);
  });
});

describe("world turns (added by hand, no stat block needed)", () => {
  beforeEach(() => {
    add("pc", sheet("Thorn", { kind: "character" }), { party: true, initiative: 20, inEncounter: true });
    add("gob", sheet("Goblin"), { initiative: 8, inEncounter: true });
  });

  it("defaults to 'Lair / world actions' on 20, losing ties; several can be added at any count", async () => {
    const id = await addWorldTurn(scene);
    expect(readWorldTurns(scene.sceneMeta)).toEqual([{ id, name: "Lair / world actions", initiative: 20 }]);
    const ceiling = await addWorldTurn(scene, { name: "  Collapsing ceiling ", initiative: 10, note: "DC 13 Dex save under the cracks" });
    expect((await view()).turns.map((t) => t.id)).toEqual(["pc", id, ceiling, "gob"]);
    expect(readWorldTurns(scene.sceneMeta)[1]).toMatchObject({ name: "Collapsing ceiling", note: "DC 13 Dex save under the cracks" });
    // A unit with lair actions in its lair still gets its own lair turn alongside.
    add("drg", lairDragon, { initiative: 5, inEncounter: true, inLair: true });
    const ids = (await view()).turns.map((t) => t.id);
    expect(ids[0]).toBe("pc"); // the unit on 20 wins the tie against both tokenless turns
    expect(new Set(ids.slice(1, 3))).toEqual(new Set([LAIR_TURN_ID, id]));
    expect(ids.slice(3)).toEqual([ceiling, "gob", "drg"]);
  });

  it("combat steps through it; editing moves it; removing the current one passes the turn", async () => {
    const id = await addWorldTurn(scene, { name: "Storm", initiative: 15 });
    await encounterAction(scene, "start");
    await encounterAction(scene, "next");
    expect(enc()).toMatchObject({ round: 1, turnId: id });
    expect((await view()).active).toBe(id);
    await updateWorldTurn(scene, id, { initiative: 5, shown: true, name: "Storm surge" });
    expect(readWorldTurns(scene.sceneMeta)[0]).toMatchObject({ initiative: 5, shown: true, name: "Storm surge" });
    expect((await view()).turns.map((t) => t.id)).toEqual(["pc", "gob", id]);
    await removeWorldTurn(scene, id);
    expect(readWorldTurns(scene.sceneMeta)).toEqual([]);
    expect(enc().turnId).not.toBe(id);
    expect((await view()).turns.map((t) => t.id)).toEqual(["pc", "gob"]);
  });

  it("quick edits to different fields don't overwrite each other", async () => {
    const id = await addWorldTurn(scene);
    await Promise.all([updateWorldTurn(scene, id, { name: "Ceiling" }), updateWorldTurn(scene, id, { note: "Dex save" }), updateWorldTurn(scene, id, { initiative: 4 })]);
    expect(readWorldTurns(scene.sceneMeta)[0]).toMatchObject({ name: "Ceiling", note: "Dex save", initiative: 4 });
  });

  it("stays when combat ends or initiative is reset (part of the scene, not the fight)", async () => {
    const id = await addWorldTurn(scene);
    await encounterAction(scene, "start");
    await encounterAction(scene, "end");
    await encounterAction(scene, "reset");
    expect(readWorldTurns(scene.sceneMeta).map((t) => t.id)).toEqual([id]);
  });

  it("GM only, needs a name and a number; ignores malformed stored entries", async () => {
    await expect(addWorldTurn(scene, { name: "   " })).rejects.toThrow(/name/);
    await expect(addWorldTurn(scene, { initiative: Number.NaN })).rejects.toThrow(/number/);
    scene.role = "PLAYER";
    await expect(addWorldTurn(scene)).rejects.toThrow(/GM/);
    scene.sceneMeta[WORLD_KEY] = [{ id: "ok", name: "Ok", initiative: 3 }, { id: "bad" }, "junk"];
    expect(readWorldTurns(scene.sceneMeta).map((t) => t.id)).toEqual(["ok"]);
  });
});
