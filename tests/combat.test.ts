import { beforeEach, describe, expect, it } from "vitest";
import data from "./fixtures/5etools-xmm-sample.json";
import { COMBAT_KEY, encounterDifficulty, INIT_KEY, listCombatants, partyBudgets, rollSceneInitiative, sceneDifficulty, setCombatSettings, xpForCr } from "../src/core/combat";
import { seededRng } from "../src/core/dice";
import { convertMonster, findMonster } from "../src/core/fivetools";
import { quickAdd } from "../src/core/quickadd";
import { FakeScene } from "./fakeGateway";

const F = (k: string) => `com.battle-system.forge/${k}`;
const wolf = convertMonster(findMonster(data, "Wolf", "XMM"));
const img = { url: "https://raw.githubusercontent.com/5etools-mirror-3/5etools-img/main/bestiary/tokens/XMM/Wolf.webp", width: 512, height: 512, mime: "image/webp" };
let ids = 0;
const newId = () => `c${++ids}`;

describe("difficulty (2024 DMG budgets + Extreme)", () => {
  it("uses the per-character budgets and XP by CR", () => {
    expect(partyBudgets([1, 1, 1, 1])).toEqual({ low: 200, moderate: 300, high: 400, extreme: 600 });
    expect(partyBudgets([5])).toEqual({ low: 500, moderate: 750, high: 1100, extreme: 1650 });
    expect(xpForCr(0.25)).toBe(50);
    expect(xpForCr(5)).toBe(1800);
    expect(xpForCr(0)).toBe(10);
  });

  it("picks the highest budget reached", () => {
    const lv = [3, 3, 3, 3]; // Low 600 · Moderate 900 · High 1600 · Extreme 2400
    const wolves = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `Wolf ${i + 1}`, cr: 0.25 }));
    expect(encounterDifficulty(lv, wolves(4)).tier).toBe("Low"); // 200 XP
    expect(encounterDifficulty(lv, wolves(4)).belowLow).toBe(true);
    expect(encounterDifficulty(lv, [{ name: "Ogre", cr: 2 }, { name: "Ogre 2", cr: 2 }]).tier).toBe("Moderate"); // 900
    expect(encounterDifficulty(lv, [{ name: "Troll", cr: 5 }]).tier).toBe("High"); // 1800
    expect(encounterDifficulty(lv, [{ name: "Young dragon", cr: 7 }]).tier).toBe("Extreme"); // 2900
  });

  it("warns about creatures above the party level and has no tier without both sides", () => {
    const d = encounterDifficulty([2, 2], [{ name: "Troll", cr: 5 }]);
    expect(d.warnings.some((w) => w.includes("Troll"))).toBe(true);
    expect(encounterDifficulty([], [{ name: "Wolf", cr: 0.25 }]).tier).toBeNull();
    expect(encounterDifficulty([3], []).tier).toBeNull();
  });
});

describe("combat in the scene", () => {
  let scene: FakeScene;
  beforeEach(async () => {
    scene = new FakeScene();
    await quickAdd([{ statblock: wolf, image: img, count: 3, hp: "average" }], { x: 0, y: 0 }, scene, { rng: seededRng(1), newId });
    const hero = { ...wolf, name: "Ayla", forge: { ...wolf.forge, Z001: 3, Z016: 0 } };
    await quickAdd([{ statblock: hero, image: img, count: 1, hp: "average" }], { x: 0, y: 0 }, scene, { rng: seededRng(2), newId, inParty: true });
  });

  it("quick add can put tokens in Forge's Party", () => {
    const ayla = scene.items.find((i) => i.name === "Ayla")!;
    expect(ayla.metadata[F("in-party")]).toBe(true);
    expect(scene.items.filter((i) => i.metadata[F("in-party")] === false)).toHaveLength(3);
  });

  it("lists party members (with level) and creatures, and excluded creatures stop counting", async () => {
    const cs = listCombatants(await scene.getItems());
    expect(cs.filter((c) => c.party).map((c) => [c.name, c.level, c.levelSource])).toEqual([["Ayla", 3, "sheet"]]);
    expect(cs.filter((c) => !c.party)).toHaveLength(3);
    expect(sceneDifficulty(cs).xp).toBe(150);
    const wolf1 = cs.find((c) => c.name === "Wolf 1")!;
    await setCombatSettings(scene, wolf1.id, { exclude: true });
    const after = listCombatants(await scene.getItems());
    expect(sceneDifficulty(after).xp).toBe(100);
    expect(scene.items.find((i) => i.id === wolf1.id)!.metadata[COMBAT_KEY]).toEqual({ exclude: true });
  });

  it("a level set in the Combat tab overrides the sheet", async () => {
    const ayla = scene.items.find((i) => i.name === "Ayla")!;
    await setCombatSettings(scene, ayla.id, { level: 7 });
    expect(listCombatants(await scene.getItems()).find((c) => c.party)!).toMatchObject({ level: 7, levelSource: "set" });
  });

  it("rolls only creatures, or everyone, with each token's own modifier", async () => {
    const before = scene.items.find((i) => i.name === "Ayla")!.metadata[F("init")];
    const r = await rollSceneInitiative(scene, "creatures", { rng: seededRng(9) });
    expect(r.rolled.map((x) => x.party)).toEqual([false, false, false]);
    expect(scene.items.find((i) => i.name === "Ayla")!.metadata[F("init")]).toBe(before);
    for (const x of r.rolled) {
      const t = scene.items.find((i) => i.id === x.id)!;
      expect(t.metadata[F("init")]).toBe(x.roll.total);
      expect(x.roll.modifier).toBe(wolf.initiative.modifier);
      expect(t.metadata[INIT_KEY]).toMatchObject({ total: x.roll.total });
    }
    const all = await rollSceneInitiative(scene, "all", { rng: seededRng(10) });
    expect(all.rolled).toHaveLength(4);
    expect(all.rolled.map((x) => x.roll.total)).toEqual([...all.rolled.map((x) => x.roll.total)].sort((a, b) => b - a));
  });

  it("only the GM can roll", async () => {
    scene.role = "PLAYER";
    await expect(rollSceneInitiative(scene, "all")).rejects.toThrow(/GM/);
  });
});
