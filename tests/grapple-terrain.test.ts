import { beforeEach, describe, expect, it } from "vitest";
import { adjacentSpot, areAdjacent, intercepts, isGrappling, type Box } from "../src/core/grapple";
import { speedLimit, unitSpeedLimit } from "../src/core/movement";
import { newState, SHEET_KEY, SHEET_SCHEMA, STATE_KEY, type UnitSheet, type UnitState } from "../src/core/sheet";
import { DND5E_2024 } from "../src/core/systems";
import { difficultExtra, isDifficultTerrain, pointInPolygon, TERRAIN_KEY, zonePolygon } from "../src/core/terrain";
import { addConditionTo, encounterAction, expireConditions, removeConditionFrom } from "../src/core/tracker";
import { isPlayerRequest } from "../src/core/turns";
import { readUnit } from "../src/core/unit";
import { FakeScene } from "./fakeGateway";

const C = 150; // pixels per square
const sq = (cx: number, cy: number, n = 1): Box => ({ minX: cx * C, minY: cy * C, maxX: (cx + n) * C, maxY: (cy + n) * C });

const sheet = (name: string): UnitSheet => ({
  schema: SHEET_SCHEMA, name, kind: "creature", size: "M", ac: 12, hp: { max: 30 }, speed: { walk: 30 },
  abilities: { str: 10, dex: 14, con: 10, int: 10, wis: 10, cha: 10 }, saves: {}, skills: [], defenses: {}, proficiencyBonus: 2,
  initiative: { modifier: 2, advantage: false, disadvantage: false, reasons: [] },
  traits: [], actions: [], bonusActions: [], reactions: [], legendary: [], spells: [], inventory: [], source: { provenance: "homebrew" }, flags: [],
});

describe("grapple geometry", () => {
  it("knows adjacent squares (sides and corners), not overlapping or a square apart", () => {
    expect(areAdjacent(sq(0, 0), sq(1, 0), C)).toBe(true);
    expect(areAdjacent(sq(0, 0), sq(1, 1), C)).toBe(true);
    expect(areAdjacent(sq(0, 0), sq(2, 0), C)).toBe(false);
    expect(areAdjacent(sq(0, 0), sq(0, 0), C)).toBe(false);
    expect(areAdjacent(sq(0, 0, 2), sq(2, 1), C)).toBe(true); // Large grappler
  });

  it("moves the grappled token to the nearest spot next to the grappler (trailing it), avoiding other tokens", () => {
    // Grappler moved from (1,0) to (4,0); the target at (0,0) is pulled to (3,0), right behind it.
    expect(adjacentSpot(sq(4, 0), sq(0, 0), C)).toEqual({ x: 3.5 * C, y: 0.5 * C });
    // Already adjacent: stays.
    expect(adjacentSpot(sq(1, 0), sq(0, 0), C)).toBeNull();
    // (3,0) is taken: the next nearest free spot ((3,-1) and (3,1) tie; the first wins).
    expect(adjacentSpot(sq(4, 0), sq(0, 0), C, [sq(3, 0)])).toEqual({ x: 3.5 * C, y: -0.5 * C });
    // Large grappler at (4,0)-(6,2): the target ends up touching its left side.
    const s = adjacentSpot(sq(4, 0, 2), sq(0, 0), C)!;
    expect(s).toEqual({ x: 3.5 * C, y: 0.5 * C });
  });

  it("detects attacks that pass through the grappled creature", () => {
    const grappled = sq(1, 0);
    const grappler = { x: 0.5 * C, y: 0.5 * C };
    expect(intercepts({ x: 5.5 * C, y: 0.5 * C }, grappler, grappled, C * 0.1)).toBe(true); // straight through
    expect(intercepts({ x: 0.5 * C, y: 5.5 * C }, grappler, grappled, C * 0.1)).toBe(false); // from below
    expect(intercepts({ x: 1.5 * C, y: 1.5 * C + 1 }, grappler, sq(1, 0), C * 0.1)).toBe(false); // only grazes the corner
  });
});

describe("speed while grappling", () => {
  it("halves the speed before Dash doubles it, after exhaustion", () => {
    expect(speedLimit({ speed: { walk: 30 } }, { halve: true })).toBe(15);
    expect(speedLimit({ speed: { walk: 30 } }, { halve: true, dash: true })).toBe(30);
    const st: Pick<UnitState, "conditions"> = { conditions: [{ id: "g", key: "grappling", with: "x" }, { id: "e", key: "exhaustion", level: 2 }] };
    expect(isGrappling(st)).toBe(true);
    expect(unitSpeedLimit(DND5E_2024, { speed: { walk: 30 } }, st, false)).toBe(10);
  });
});

describe("difficult terrain", () => {
  const rect = (x: number, y: number, w: number, h: number) => zonePolygon({ type: "SHAPE", shapeType: "RECTANGLE", width: w * C, height: h * C, position: { x: x * C, y: y * C }, rotation: 0, scale: { x: 1, y: 1 } })!;
  const at = (cx: number, cy: number) => ({ x: (cx + 0.5) * C, y: (cy + 0.5) * C });

  it("costs 1 extra foot per foot moved inside a zone", () => {
    const mud = rect(2, 0, 2, 1); // squares (2,0) and (3,0)
    // 6 squares (30 ft) east, entering 2 difficult squares: +10 ft.
    expect(difficultExtra(at(0, 0), at(6, 0), 30, [mud], C)).toBe(10);
    // Ending the move in the mud: entering (2,0) is the only difficult square.
    expect(difficultExtra(at(0, 0), at(2, 0), 10, [mud], C)).toBe(5);
    // Leaving the mud costs nothing extra.
    expect(difficultExtra(at(3, 0), at(5, 0), 10, [mud], C)).toBe(0);
    // Never touching it.
    expect(difficultExtra(at(0, 2), at(6, 2), 30, [mud], C)).toBe(0);
    expect(difficultExtra(at(0, 0), at(6, 0), 30, [], C)).toBe(0);
  });

  it("checks the whole space of a Large token", () => {
    const mud = rect(0, 2, 6, 1); // a strip in row 2
    // Large token (rows 0–1) moving east along row 0–1: never in the strip; one row lower it is.
    const large = (cx: number, cy: number) => ({ x: (cx + 1) * C, y: (cy + 1) * C });
    expect(difficultExtra(large(0, 0), large(3, 0), 15, [mud], C, 2)).toBe(0);
    expect(difficultExtra(large(0, 1), large(3, 1), 15, [mud], C, 2)).toBe(15);
  });

  it("builds outlines for shapes (rotated, centred on Owlbear's bounds) and polygons", () => {
    const circle = zonePolygon({ type: "SHAPE", shapeType: "CIRCLE", width: 300, height: 300, position: { x: 500, y: 500 }, rotation: 0, scale: { x: 1, y: 1 } })!;
    expect(pointInPolygon({ x: 500, y: 600 }, circle)).toBe(true);
    expect(pointInPolygon({ x: 640, y: 640 }, circle)).toBe(false);
    // A rotated rectangle: 90° around its top-left corner.
    const r = zonePolygon({ type: "SHAPE", shapeType: "RECTANGLE", width: 300, height: 100, position: { x: 0, y: 0 }, rotation: 90, scale: { x: 1, y: 1 } })!;
    expect(pointInPolygon({ x: -50, y: 150 }, r)).toBe(true);
    expect(pointInPolygon({ x: 150, y: 50 }, r)).toBe(false);
    // Bounds win over our guess of the origin.
    const shifted = zonePolygon({ type: "SHAPE", shapeType: "RECTANGLE", width: 100, height: 100, position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1 } }, { minX: 1000, minY: 0, maxX: 1100, maxY: 100 })!;
    expect(pointInPolygon({ x: 1050, y: 50 }, shifted)).toBe(true);
    const poly = zonePolygon({ type: "CURVE", points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 100 }], position: { x: 10, y: 10 }, rotation: 0, scale: { x: 2, y: 2 } })!;
    expect(pointInPolygon({ x: 50, y: 50 }, poly)).toBe(true);
    expect(pointInPolygon({ x: 180, y: 180 }, poly)).toBe(false);
    // Freehand paths fall back to their bounds.
    expect(zonePolygon({ type: "PATH", position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1 } }, { minX: 0, minY: 0, maxX: 10, maxY: 10 })).toHaveLength(4);
    expect(isDifficultTerrain({ [TERRAIN_KEY]: { difficult: true } })).toBe(true);
    expect(isDifficultTerrain({})).toBe(false);
  });
});

describe("grappling in a scene", () => {
  let scene: FakeScene;
  const add = (id: string, init: number) => scene.items.push({
    id, type: "IMAGE", layer: "CHARACTER", name: id, label: id, metadata: { [SHEET_KEY]: sheet(id), [STATE_KEY]: newState(sheet(id), { initiative: init, inEncounter: true }) },
    position: { x: 0, y: 0 }, size: { w: 1, h: 1 },
  });
  const conds = (id: string) => readUnit(scene.items.find((i) => i.id === id)!.metadata)!.state.conditions;
  beforeEach(() => { scene = new FakeScene(); add("a", 20); add("b", 15); add("c", 10); });

  it("links Grappling and Grappled, and ending either side ends both", async () => {
    await addConditionTo(scene, ["a"], "grappling", { with: "b" });
    expect(conds("a").map((c) => [c.key, c.with])).toEqual([["grappling", "b"]]);
    expect(conds("b").map((c) => [c.key, c.with])).toEqual([["grappled", "a"]]);
    // A second creature held by the same grappler.
    await addConditionTo(scene, ["a"], "grappling", { with: "c" });
    expect(conds("a").map((c) => c.with)).toEqual(["b", "c"]);
    // Escaping (removing Grappled from b) ends a's grapple on b only.
    await removeConditionFrom(scene, "b", conds("b")[0]!.id);
    expect(conds("b")).toEqual([]);
    expect(conds("a").map((c) => c.with)).toEqual(["c"]);
    await removeConditionFrom(scene, "a", conds("a")[0]!.id);
    expect(conds("c")).toEqual([]);
  });

  it("adds Grappling from the Grappled side, needs a target, and can't grapple itself", async () => {
    await addConditionTo(scene, ["c"], "grappled", { with: "a" });
    expect(conds("a").map((c) => [c.key, c.with])).toEqual([["grappling", "c"]]);
    await expect(addConditionTo(scene, ["a"], "grappling", {})).rejects.toThrow(/Choose/);
    await addConditionTo(scene, ["b"], "grappling", { with: "b" });
    expect(conds("b")).toEqual([]);
    // Plain Grappled with nobody named stays a lone condition.
    await addConditionTo(scene, ["b"], "grappled");
    expect(conds("b").map((c) => [c.key, c.with])).toEqual([["grappled", undefined]]);
  });

  it("expires both halves together", async () => {
    await encounterAction(scene, "start");
    await addConditionTo(scene, ["a"], "grappling", { with: "c", duration: { kind: "turn", turnOf: "b", at: "start" } });
    expect(await expireConditions(scene, { round: 1, turnId: "a" }, { round: 1, turnId: "b" }, DND5E_2024)).toEqual(["Grappling ended on a.", "Grappled ended on c."]);
    expect(conds("a")).toEqual([]);
    expect(conds("c")).toEqual([]);
  });

  it("accepts the grappled creature in players' requests", () => {
    const base = { v: 1, unitId: "a", playerId: "p", playerName: "P", type: "condition-add", key: "grappling" };
    expect(isPlayerRequest({ ...base, with: "b" })).toBe(true);
    expect(isPlayerRequest({ ...base, with: 3 })).toBe(false);
  });
});
