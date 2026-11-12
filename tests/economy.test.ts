import { beforeEach, describe, expect, it } from "vitest";
import fighter from "./fixtures/ddb-synthetic-fighter.json";
import { convertDdbCharacter } from "../src/core/ddb";
import { applyEconomy, currentEconomy, isEconomyChange, ownTurnRound, setEconomy } from "../src/core/economy";
import { EMPTY_ENCOUNTER, ENCOUNTER_KEY, type EncounterState } from "../src/core/encounter";
import { newState, SHEET_KEY, STATE_KEY } from "../src/core/sheet";
import { EDIT_REQUESTS, isPlayerRequest } from "../src/core/turns";
import { readUnit } from "../src/core/unit";
import { FakeScene } from "./fakeGateway";

const order = [{ id: "a" }, { id: "b" }, { id: "c" }];
const enc = (round: number, turnId: string): EncounterState => ({ ...EMPTY_ENCOUNTER, started: true, round, turnId, turnIndex: order.findIndex((u) => u.id === turnId) });

describe("combat HUD: Action / Bonus Action / Reaction markers", () => {
  it("a unit's turn round: this round once its turn has come, else last round; 0 outside combat", () => {
    expect(ownTurnRound(EMPTY_ENCOUNTER, order, "b")).toBe(0);
    expect(ownTurnRound(enc(3, "a"), order, "b")).toBe(2);
    expect(ownTurnRound(enc(3, "b"), order, "b")).toBe(3);
    expect(ownTurnRound(enc(3, "c"), order, "b")).toBe(3);
    expect(ownTurnRound(enc(3, "c"), order, "nobody")).toBe(0);
  });
  it("everything comes back when the unit's next turn starts, the Reaction included", () => {
    // b used its Reaction on a's turn in round 3 (still b's round-2 turn), then b's round-3 turn starts.
    const afterReaction = applyEconomy({}, { reaction: true }, ownTurnRound(enc(3, "a"), order, "b"));
    expect(afterReaction.turn).toEqual({ round: 2, reaction: true });
    expect(currentEconomy(afterReaction, ownTurnRound(enc(3, "a"), order, "b"))).toEqual({ round: 2, reaction: true });
    expect(currentEconomy(afterReaction, ownTurnRound(enc(3, "b"), order, "b"))).toEqual({ round: 3 });
  });
  it("marks spent and available again", () => {
    const s1 = applyEconomy({}, { action: true }, 1);
    const s2 = applyEconomy(s1, { bonus: true }, 1);
    expect(s2.turn).toEqual({ round: 1, action: true, bonus: true });
    expect(applyEconomy(s2, { action: false }, 1).turn).toEqual({ round: 1, bonus: true });
    // A stale record from an earlier turn doesn't carry over.
    expect(applyEconomy(s2, { reaction: true }, 2).turn).toEqual({ round: 2, reaction: true });
  });
  it("players send it as a request that works even with player edits off", () => {
    const base = { v: 1, unitId: "u", playerId: "p", playerName: "Ana" };
    expect(isPlayerRequest({ ...base, type: "economy", change: { reaction: true } })).toBe(true);
    expect(isPlayerRequest({ ...base, type: "economy", change: {} })).toBe(false);
    expect(isPlayerRequest({ ...base, type: "economy", change: { legendary: true } })).toBe(false);
    expect(isEconomyChange({ action: "yes" })).toBe(false);
    expect(EDIT_REQUESTS).not.toContain("economy");
  });
});

describe("combat HUD on the scene", () => {
  let scene: FakeScene;
  const sheet = convertDdbCharacter(fighter).sheet;
  const state = (id: string) => readUnit(scene.items.find((i) => i.id === id)!.metadata)!.state;
  beforeEach(() => {
    scene = new FakeScene();
    for (const [id, init] of [["pc", 18], ["orc", 12]] as const) {
      scene.items.push({ id, type: "IMAGE", layer: "CHARACTER", name: id, label: id,
        metadata: { [SHEET_KEY]: sheet, [STATE_KEY]: newState(sheet, { initiative: init, inEncounter: true }) }, position: { x: 0, y: 0 }, size: { w: 1, h: 1 } });
    }
  });
  it("records against the unit's current turn", async () => {
    scene.sceneMeta = { [ENCOUNTER_KEY]: { ...EMPTY_ENCOUNTER, started: true, round: 2, turnId: "pc", turnIndex: 0 } };
    await setEconomy(scene, "pc", { action: true });
    await setEconomy(scene, "pc", { bonus: true });
    expect(state("pc").turn).toEqual({ round: 2, action: true, bonus: true });
    // The orc hasn't had its round-2 turn: its Reaction counts against round 1.
    await setEconomy(scene, "orc", { reaction: true });
    expect(state("orc").turn).toEqual({ round: 1, reaction: true });
    await expect(setEconomy(scene, "gone", { action: true })).rejects.toThrow();
  });
});
