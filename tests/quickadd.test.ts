import { beforeEach, describe, expect, it } from "vitest";
import data from "./fixtures/5etools-xmm-sample.json";
import fighter from "./fixtures/ddb-synthetic-fighter.json";
import { BUTLER_ITEM_KEY } from "../src/core/constants";
import { customFromFivetools, parseFivetoolsJson, quickStatblock } from "../src/core/custom";
import { seededRng } from "../src/core/dice";
import { convertMonster, findMonster } from "../src/core/fivetools";
import { FivetoolsLibrary } from "../src/core/fivetools-library";
import { circularTokenUrl } from "../src/core/images";
import { rollbackImport } from "../src/core/importer";
import { partyFromDdbExport, syncParty } from "../src/core/party";
import { nameCreatures, quickAdd } from "../src/core/quickadd";
import { validateSheet } from "../src/core/sheet";
import { readUnit } from "../src/core/unit";
import { FakeScene } from "./fakeGateway";

const unitOf = (meta: Record<string, unknown>) => readUnit(meta)!;
const wolf = convertMonster(findMonster(data, "Wolf", "XMM"));
const img = { url: "https://raw.githubusercontent.com/5etools-mirror-3/5etools-img/main/bestiary/tokens/XMM/Wolf.webp", width: 512, height: 512, mime: "image/webp" };
let ids = 0;
const newId = () => `q${++ids}`;

describe("quick add", () => {
  let scene: FakeScene;
  beforeEach(() => { scene = new FakeScene(); });

  it("numbers creatures after existing ones", () => {
    expect(nameCreatures("Wolf", 3, [])).toEqual(["Wolf 1", "Wolf 2", "Wolf 3"]);
    expect(nameCreatures("Wolf", 2, ["Wolf 1", "Wolf 2", "Wolf 5"])).toEqual(["Wolf 6", "Wolf 7"]);
    expect(nameCreatures("Strahd", 1, [])).toEqual(["Strahd"]);
    expect(nameCreatures("Wolf", 1, ["Wolf"])).toEqual(["Wolf 2"]);
  });

  it("adds tokens around the view centre with their stat block, HP and individual initiative", async () => {
    const r = await quickAdd([{ statblock: wolf, image: img, count: 3, hp: "roll", hidden: true }], { x: 1000, y: 1000 }, scene, { rng: seededRng(3), newId });
    expect(r.ok).toBe(true);
    expect(r.creatures.map((c) => c.name)).toEqual(["Wolf 1", "Wolf 2", "Wolf 3"]);
    const toks = scene.items.filter((i) => i.name.startsWith("Wolf"));
    expect(toks).toHaveLength(3);
    for (const t of toks) {
      const c = r.creatures.find((x) => x.name === t.name)!;
      const u = unitOf(t.metadata);
      expect(u.sheet.name).toBe("Wolf");
      expect(u.state).toMatchObject({ initiative: c.initiative.total, initiativeRoll: { total: c.initiative.total }, hp: c.hp.current, inEncounter: true, party: false });
      // rolled HP that differs from the stat block's average is stored as the unit's own max
      expect(u.state.maxHpOverride ?? u.sheet.hp.max).toBe(c.hp.max);
      expect(c.hp.method).toBe("rolled");
      expect(t.spec!.visible).toBe(false);
      expect((t.metadata[BUTLER_ITEM_KEY] as any).initiative.dice).toEqual(c.initiative.dice);
    }
    // one row, adjacent cells, centred near (1000,1000), snapped to the 150-dpi grid
    const xs = toks.map((t) => t.spec!.position.x).sort((a, b) => a - b);
    expect(xs[1]! - xs[0]!).toBe(150);
    expect(Math.abs((xs[0]! + xs[2]!) / 2 - 1000)).toBeLessThanOrEqual(150);
    expect((toks[0]!.spec!.position.x - 75) % 150).toBe(0);
    expect(await rollbackImport(r.createdItemIds, scene)).toBe(3);
  });

  it("initiative advantage override rolls 2d20 keep-highest", async () => {
    const r = await quickAdd([{ statblock: wolf, image: img, count: 1, hp: "average", advantage: true }], { x: 0, y: 0 }, scene, { rng: seededRng(1), newId });
    expect(r.creatures[0]!.initiative.mode).toBe("advantage");
    expect(r.creatures[0]!.initiative.dice).toHaveLength(2);
  });

  it("refuses non-public images and players", async () => {
    expect((await quickAdd([{ statblock: wolf, image: { ...img, url: "blob:x" }, count: 1, hp: "average" }], { x: 0, y: 0 }, scene)).ok).toBe(false);
    scene.role = "PLAYER";
    expect((await quickAdd([{ statblock: wolf, image: img, count: 1, hp: "average" }], { x: 0, y: 0 }, scene)).ok).toBe(false);
    expect(scene.items).toHaveLength(0);
  });
});

describe("custom creatures", () => {
  it("quick form makes a valid, clearly non-official stat block with dice chips", () => {
    const sb = quickStatblock({ name: "Brother Garrow", ac: 15, hp: 33, initiative: 1, attacks: "Mace: +4, 1d6+2 bludgeoning" });
    expect(sb.source.provenance).toBe("homebrew");
    expect(validateSheet(sb)).toEqual([]);
    expect(sb.ac).toBe(15);
    expect(sb.actions[0]).toEqual({ name: "Mace", text: "+4 [1d20+4], 1d6+2 [1d6+2] bludgeoning" });
  });
  it("pasted 5etools JSON (single, array or homebrew file)", () => {
    const raw = findMonster(data, "Wolf", "XMM");
    expect(parseFivetoolsJson(JSON.stringify(raw))).toHaveLength(1);
    expect(parseFivetoolsJson(JSON.stringify({ monster: [raw, raw] }))).toHaveLength(2);
    expect(() => parseFivetoolsJson("{nope")).toThrow(/Not valid JSON/);
    const sb = customFromFivetools(raw, "user-provided");
    expect(sb.source.provenance).toBe("user-provided");
    expect(sb.source.book).toBeUndefined();
  });
});

describe("browser 5etools library (fake fetch)", () => {
  it("loads index/books and prepares a creature without Node APIs", async () => {
    const files: Record<string, any> = {
      "bestiary/index.json": { XMM: "bestiary-xmm.json" },
      "books.json": { book: [{ id: "XMM", name: "Monster Manual (2025)", published: "2025-02-18" }] },
      "adventures.json": { adventure: [] },
      "bestiary/bestiary-xmm.json": data,
    };
    const lib = await new FivetoolsLibrary(async (rel) => files[rel]).init();
    const r = await lib.prepare("wolf", "xmm");
    expect(r.monster.name).toBe("Wolf");
    expect(r.catalogEntry?.rules).toBe("2024");
  });
});

describe("party: raw export + circular portraits", () => {
  it("circular URLs go through the CORS-enabled proxy with a circle mask", () => {
    const u = new URL(circularTokenUrl("https://www.dndbeyond.com/avatars/1/2/a.jpeg"));
    expect(u.origin).toBe("https://wsrv.nl");
    expect(u.searchParams.get("mask")).toBe("circle");
    expect(u.searchParams.get("url")).toBe("https://www.dndbeyond.com/avatars/1/2/a.jpeg");
  });

  it("converts the raw D&D Beyond export in-browser and replaces only existing tokens' pictures with portraits", async () => {
    const p = partyFromDdbExport({ schema: "owlbear-butler/ddb-export@1", campaign: { id: 1, name: "Saga" }, fetchedAt: "2026-11-04T00:00:00Z", characters: [fighter], partyInventory: null });
    expect(p.id).toBe("saga");
    expect(p.members[0]!.ac).toBe(20);
    const scene = new FakeScene();
    scene.items.push({ id: "t", type: "IMAGE", layer: "CHARACTER", name: "x", label: "Brann", position: { x: 0, y: 0 }, size: { w: 150, h: 150 },
      image: { url: "https://old/brann.png", width: 300, height: 300, mime: "image/png" }, metadata: {} });
    const portrait = { url: circularTokenUrl("https://www.dndbeyond.com/avatars/x.jpeg"), width: 256, height: 256, mime: "image/png" };
    const r = await syncParty(p, { hp: "ddb", createMissing: false, initiative: "keep", replaceWith: { 1001: portrait }, newId }, scene);
    expect(r.ok).toBe(true);
    expect(scene.items[0]!.image!.url).toBe(portrait.url);
    expect(r.previousImages.t!.image.url).toBe("https://old/brann.png");
  });
});
