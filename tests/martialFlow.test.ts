import { beforeEach, describe, expect, it, vi } from "vitest";
import { martialRequest, martialWatch } from "../src/background/martial";
import { ENCOUNTER_KEY } from "../src/core/encounter";
import { readMartial, readMartialQueue, type MartialMove } from "../src/core/martial";
import { newState, SHEET_KEY, SHEET_SCHEMA, STATE_KEY, type UnitSheet } from "../src/core/sheet";
import { readUnit } from "../src/core/unit";
import { FakeScene } from "./fakeGateway";

let scene: FakeScene;
let rolls: number[];
let modes: string[];
vi.mock("@owlbear-rodeo/sdk", () => ({
  default: {
    scene: {
      getMetadata: () => scene.getSceneMetadata(),
      setMetadata: (meta: Record<string, unknown>) => scene.setSceneMetadata(meta),
      items: {
        getItemBounds: (ids: string[]) => scene.getItemBounds(ids),
        updateItems: (ids: string[], update: (items: FakeScene["items"]) => void) => update(scene.items.filter((i) => ids.includes(i.id))),
      },
      grid: { getDpi: async () => 150, getScale: async () => ({ parsed: { multiplier: 5 } }), getMeasurement: async () => "CHEBYSHEV" },
    },
  },
}));
vi.mock("../src/extension/obrGateway", () => ({ get obrGateway() { return scene; } }));
vi.mock("../src/extension/roomSettings", async () => ({
  roomSettings: () => ({ martialOptions: true }),
  roomSystem: () => game.DND5E_2024,
}));
vi.mock("../src/extension/gmRoll", () => ({
  gmRoll: async (_formula: string, _label: string, opts: { mode?: string }) => { modes.push(opts.mode ?? "normal"); return { total: rolls.shift() ?? 1 }; },
}));
const game = await import("../src/core/systems");

const sheet = (name: string): UnitSheet => ({
  schema: SHEET_SCHEMA, name, kind: "creature", size: "M", ac: 13, hp: { max: 20 }, speed: { walk: 30 },
  abilities: { str: 16, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, saves: {}, skills: [], defenses: {}, proficiencyBonus: 2,
  initiative: { modifier: 0, advantage: false, disadvantage: false, reasons: [] },
  traits: [], actions: [{ name: "Longbow", text: "Ranged Weapon Attack: +5 [1d20+5] to hit, range 150/600 ft. Hit: 7 (1d8+3 [1d8+3]) Piercing damage." }], bonusActions: [], reactions: [], legendary: [], spells: [], inventory: [], source: { provenance: "homebrew" }, flags: [],
});
const base = { v: 1 as const, playerId: "gm", playerName: "GM" };
function turn(turnId: string, round: number) {
  return scene.setSceneMetadata({ [ENCOUNTER_KEY]: { v: 1, started: true, round, turnId } });
}
function token(id: string) { return scene.items.find((i) => i.id === id)!; }
function keys(id: string) { return readUnit(token(id).metadata)!.state.conditions.map((c) => c.key); }

async function move(actor: string, target: string, round: number, declaration: MartialMove, holdingLimb?: string) {
  await turn(actor, round);
  await martialRequest({ ...base, type: "martial", unitId: actor, targetId: target, round, move: declaration }, true);
  const entry = readMartialQueue(scene.sceneMeta)[0]!;
  return martialRequest({ ...base, type: "martial-review", unitId: actor, entryId: entry.id, options: {
    defense: "str", ability: "str", acAdjustment: 0, permanent: false, breathless: false, partAc: 0, partHp: 0, partImmune: "", holdingLimb,
  } }, true);
}

describe("martial declarations through GM review", () => {
  beforeEach(() => {
    scene = new FakeScene();
    rolls = [];
    modes = [];
    for (const [id, x, y] of [["fighter", 0, 0], ["enemy", 150, 0], ["ally", 0, 150]] as const) {
      const u = sheet(id);
      scene.items.push({
        id, type: "IMAGE", layer: "CHARACTER", name: id, position: { x, y }, size: { w: 150, h: 150 },
        metadata: { [SHEET_KEY]: u, [STATE_KEY]: newState(u, { inEncounter: true, initiative: 10 }) },
      });
    }
  });

  it("releases the correct grapple and both instances of Body Pin when an ally intervenes", async () => {
    await move("enemy", "fighter", 1, { op: "grapple" });
    await move("enemy", "fighter", 2, { op: "advance", hold: "body", detail: "" });
    expect(keys("enemy")).toEqual(["restrained"]);
    expect(keys("fighter")).toEqual(["grappled", "restrained"]);
    rolls = [20];
    expect(await move("ally", "enemy", 2, { op: "rescue", ally: "fighter" })).toMatch(/freed/);
    expect(keys("enemy")).toEqual([]);
    expect(keys("fighter")).toEqual([]);
  });

  it("converts a maintained pin into a persistent binding with a separate escape roll", async () => {
    await move("fighter", "enemy", 1, { op: "grapple" });
    await move("fighter", "enemy", 2, { op: "advance", hold: "arms", detail: "" });
    await move("fighter", "enemy", 3, { op: "bind" });
    await martialWatch({ round: 3, turnId: "fighter" }, null);
    expect(readMartial(token("enemy").metadata)).toMatchObject({ grapples: [], binding: { hold: "arms", hp: 2 } });
    expect(keys("enemy")).toEqual(["custom"]);
    await expect(move("enemy", "enemy", 3, { op: "untie" })).rejects.toThrow(/another unit/);
    expect(await move("ally", "enemy", 3, { op: "untie" })).toMatch(/free of the ropes/);
    expect(keys("enemy")).toEqual([]);
  });
  it("checks a successful shot to the holding arm without requiring a lingering injury", async () => {
    await move("enemy", "fighter", 1, { op: "grapple" });
    const { actionBar } = await import("../src/core/actions");
    const attack = actionBar(sheet("ally")).items.find((a) => a.name === "Longbow")!.key;
    rolls = [17, 3, 9];
    expect(await move("ally", "enemy", 2, { op: "shot", part: "arm", detail: "Left arm", attack, mode: "normal" }, "fighter")).toMatch(/fighter breaks free/);
    expect(keys("fighter")).toEqual([]);
  });

  it("checks the ally's AC separately with advantage while body-bound", async () => {
    await move("fighter", "enemy", 1, { op: "grapple" });
    await move("fighter", "enemy", 2, { op: "advance", hold: "body", detail: "" });
    await move("fighter", "enemy", 3, { op: "bind" });
    const { actionBar } = await import("../src/core/actions");
    const attack = actionBar(sheet("ally")).items.find((a) => a.name === "Longbow")!.key;
    rolls = [14, 12, 2];
    expect(await move("ally", "enemy", 3, { op: "shoot-ropes", attack, mode: "normal" })).toMatch(/free of the ropes.*misses enemy/);
    expect(modes.at(-2)).toBe("advantage");
    expect(readUnit(token("enemy").metadata)!.state.hp).toBe(20);
  });

  it("moves both tokens after a successful Strength save and breaks opposed displacement without a save", async () => {
    await move("enemy", "fighter", 1, { op: "grapple" });
    rolls = [20];
    const push = { ...base, type: "martial-displace" as const, unitId: "enemy", heldId: "fighter", dc: 12, canFollow: true };
    await martialRequest({ ...push, grapplerMove: { x: 5, y: 0 }, heldMove: { x: 0, y: 0 } }, true);
    expect(token("enemy").position.x).toBe(300);
    expect(token("fighter").position.x).toBe(150);
    expect(keys("fighter")).toEqual(["grappled"]);
    rolls = [20];
    await martialRequest({ ...push, grapplerMove: { x: 5, y: 0 }, heldMove: { x: -5, y: 0 } }, true);
    expect(rolls).toEqual([20]);
    expect(keys("fighter")).toEqual([]);
  });

});
