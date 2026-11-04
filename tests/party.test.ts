import { beforeEach, describe, expect, it } from "vitest";
import fighter from "./fixtures/ddb-synthetic-fighter.json";
import { BUTLER_ITEM_KEY } from "../src/core/constants";
import { convertDdbCharacter, htmlToText, renderTemplate } from "../src/core/ddb";
import { validateForgeMetadata } from "../src/core/forge";
import { makePartyPackage, matchParty, partyForgeMetadata, previewParty, syncParty } from "../src/core/party";
import { FakeScene } from "./fakeGateway";

const F = (k: string) => `com.battle-system.forge/${k}`;
const brann = convertDdbCharacter(fighter);

describe("D&D Beyond character conversion (synthetic Fighter 3)", () => {
  it("ability scores include race bonuses; HP includes Con and Tough per level", () => {
    expect([brann.forge.Z017, brann.forge.Z019]).toEqual([16, 16]);
    expect(brann.hp).toEqual({ max: 22 + (3 + 2) * 3, current: 37 - 5, temp: 3 });
  });
  it("AC: heavy armor + shield + Defense + attuned ring; unequipped and condition modifiers ignored", () => {
    expect(brann.ac).toBe(16 + 2 + 1 + 1);
    expect(brann.forge.Z007).toBe(20);
  });
  it("initiative, saves, skills, senses, languages, resistances", () => {
    expect(brann.initiative.modifier).toBe(1 + 5);
    expect(brann.initiative.reasons.join(" ")).toMatch(/\+5 from "Alert"/);
    expect([brann.forge.Z023, brann.forge.Z024, brann.forge.Z025]).toEqual([5, 1, 5]);
    expect(brann.forge.Z014).toBe("Athletics +5");
    expect(brann.forge.Z013).toContain("Darkvision 60 ft.");
    expect(brann.forge.Z013).toContain("Passive Perception 11");
    expect(brann.forge.Z015).toBe("Common, Dwarvish");
    expect(brann.forge.Z031).toBe("Poison");
    expect([brann.forge.Z001, brann.forge.Z029, brann.forge.Z008]).toEqual([3, 3, 25]);
  });
  it("weapon attacks with to-hit, damage and versatile dice chips", () => {
    const sword = (brann.forge.Z035 as any[]).find((a) => a.name === "Longsword");
    expect(sword.description).toContain("+5 [1d20+5]");
    expect(sword.description).toContain("1d8+3 [1d8+3] Slashing");
    expect(sword.description).toContain("Versatile: 1d10+3 [1d10+3]");
    expect(sword.description).toContain("Properties: Sap");
  });
  it("D&D Beyond actions go to the right list with uses; features up to current level only", () => {
    expect((brann.forge.Z036 as any[]).map((a) => a.name)).toEqual(["Second Wind (2/Long Rest, 1 used)"]);
    const feats = (brann.forge.Z034 as any[]).map((a) => a.name);
    expect(feats).toEqual(expect.arrayContaining(["Fighting Style", "Improved Critical", "Darkvision", "Dwarven Resilience", "Tough", "Alert"]));
    expect(feats).not.toContain("Extra Attack");
    expect(feats).not.toContain("Speed");
  });
  it("renders D&D Beyond placeholders and HTML", () => {
    const ctx = { pb: 2, level: 3, mod: () => 3, score: {} as any };
    expect(renderTemplate("uses: {{proficiency}}, DC {{savedc:con}}, +{{modifier:wis@min:1}} {{(classlevel*5)}}", ctx)).toBe("uses: 2, DC 13, +3 15");
    expect(htmlToText("<p>Take the [action]Attack[/action] action.</p><ul><li>One</li></ul>")).toBe("Take the Attack action.\n• One");
  });
  it("produces Forge metadata valid against the default dictionary", () => {
    let n = 0;
    expect(validateForgeMetadata(partyForgeMetadata(brann, () => `i${n++}`))).toEqual([]);
  });
});

describe("party sync", () => {
  let scene: FakeScene;
  const pkg = makePartyPackage("test", { name: "Test" }, "2026-11-04T00:00:00Z", [brann, { ...brann, ddbId: 1002, name: "Isolde Nobody" }]);
  let ids = 0;
  const newId = () => `n${++ids}`;

  beforeEach(() => {
    scene = new FakeScene();
    scene.items.push(
      { id: "tok-brann", type: "IMAGE", layer: "CHARACTER", name: "Token image", label: "Brann", position: { x: 0, y: 0 }, size: { w: 150, h: 150 },
        metadata: { [F("init")]: 14, [F("Z005")]: 10, "other.ext/keep": "yes" } },
      { id: "wolf", type: "IMAGE", layer: "CHARACTER", name: "Wolf 1", position: { x: 0, y: 0 }, size: { w: 150, h: 150 }, metadata: {} },
    );
  });

  it("matches by first name and reports unmatched characters", async () => {
    const rows = matchParty(pkg.members, await scene.getItems());
    expect(rows[0]).toMatchObject({ item: { id: "tok-brann" }, by: "first name" });
    expect(rows[1]!.item).toBeNull();
    const pv = await previewParty(pkg, scene);
    expect(pv.forgeErrors).toEqual([]);
  });

  it("writes Forge data onto the existing token without touching other state", async () => {
    const r = await syncParty(pkg, { hp: "ddb", createMissing: false, newId }, scene);
    expect(r.ok).toBe(true);
    expect(r.updated).toHaveLength(1);
    expect(r.skipped[0]).toMatch(/Isolde Nobody: no matching token/);
    const t = scene.items.find((i) => i.id === "tok-brann")!;
    expect(t.metadata[F("Z006")]).toBe(37);
    expect(t.metadata[F("Z005")]).toBe(32);
    expect(t.metadata[F("Z007")]).toBe(20);
    expect(t.metadata[F("in-party")]).toBe(true);
    expect(t.metadata[F("fabd")]).toBe(true);
    expect(t.metadata[F("init")]).toBe(14); // initiative untouched
    expect(t.metadata["other.ext/keep"]).toBe("yes"); // other extensions' data untouched
    expect((t.metadata[BUTLER_ITEM_KEY] as any).ddbId).toBe(1001);
    expect(scene.items.find((i) => i.id === "wolf")!.metadata).toEqual({});
  });

  it('"keep" preserves the token\'s current HP; re-sync matches by D&D Beyond id', async () => {
    await syncParty(pkg, { hp: "keep", createMissing: false, newId }, scene);
    expect(scene.items.find((i) => i.id === "tok-brann")!.metadata[F("Z005")]).toBe(10);
    scene.items.find((i) => i.id === "tok-brann")!.label = "Renamed";
    expect(matchParty(pkg.members, await scene.getItems())[0]).toMatchObject({ by: "D&D Beyond id" });
  });

  it("creates a token for an unmatched character only with a usable public image", async () => {
    const noImg = await syncParty(pkg, { hp: "ddb", createMissing: true, newId }, scene);
    expect(noImg.skipped[0]).toMatch(/no usable avatar/);
    const r = await syncParty(pkg, { hp: "ddb", createMissing: true, newId, avatars: { 1002: { url: "https://cdn.example.org/isolde.png", width: 256, height: 256, mime: "image/png" } } }, scene);
    expect(r.created).toHaveLength(1);
    const t = scene.items.find((i) => i.name === "Isolde Nobody")!;
    expect(t.metadata[F("in-party")]).toBe(true);
    expect(t.metadata[F("on-list")]).toBe(true);
  });

  describe("party initiative", () => {
    const fixed = (...faces: number[]) => { let i = 0; return () => (faces[i++ % faces.length]! - 1) / 20 + 0.001; };
    const pkg2 = makePartyPackage("t2", { name: "T" }, "x", [
      brann, // +6, token already has 14
      { ...brann, ddbId: 1002, name: "Isolde Swift", initiative: { modifier: 3, advantage: true, reasons: [] } }, // token at 0
    ]);
    beforeEach(() => {
      scene.items.push({ id: "tok-isolde", type: "IMAGE", layer: "CHARACTER", name: "x", label: "Isolde", position: { x: 0, y: 0 }, size: { w: 150, h: 150 },
        metadata: { [F("init")]: 0 } });
    });

    it('"unset" rolls only for tokens without initiative (missing or 0), with advantage when the sheet has it', async () => {
      const r = await syncParty(pkg2, { hp: "ddb", createMissing: false, initiative: "unset", rng: fixed(4, 17), newId }, scene);
      expect(r.rolled.map((x) => x.name)).toEqual(["Isolde Swift"]);
      expect(r.rolled[0]!.roll).toMatchObject({ dice: [4, 17], kept: 17, modifier: 3, mode: "advantage", total: 20 });
      const isolde = scene.items.find((i) => i.id === "tok-isolde")!;
      expect(isolde.metadata[F("init")]).toBe(20);
      expect((isolde.metadata[BUTLER_ITEM_KEY] as any).initiative.dice).toEqual([4, 17]);
      expect(scene.items.find((i) => i.id === "tok-brann")!.metadata[F("init")]).toBe(14);
    });

    it('"all" re-rolls everyone; "keep" touches nothing', async () => {
      const r = await syncParty(pkg2, { hp: "ddb", createMissing: false, initiative: "all", rng: fixed(10), newId }, scene);
      expect(r.rolled).toHaveLength(2);
      expect(scene.items.find((i) => i.id === "tok-brann")!.metadata[F("init")]).toBe(10 + 6);
      const k = await syncParty(pkg2, { hp: "ddb", createMissing: false, initiative: "keep", newId }, scene);
      expect(k.rolled).toEqual([]);
      expect(scene.items.find((i) => i.id === "tok-brann")!.metadata[F("init")]).toBe(16);
    });

    it("new tokens get rolled initiative too (unless keep)", async () => {
      const pkg3 = makePartyPackage("t3", { name: "T" }, "x", [{ ...brann, ddbId: 1003, name: "Nobody New" }]);
      const r = await syncParty(pkg3, { hp: "ddb", createMissing: true, initiative: "unset", rng: fixed(7), newId,
        avatars: { 1003: { url: "https://cdn.example.org/n.png", width: 64, height: 64, mime: "image/png" } } }, scene);
      expect(r.created).toHaveLength(1);
      expect(scene.items.find((i) => i.name === "Nobody New")!.metadata[F("init")]).toBe(7 + 6);
    });
  });

  it("refuses for players", async () => {
    scene.role = "PLAYER";
    const r = await syncParty(pkg, { hp: "ddb", createMissing: false, newId }, scene);
    expect(r.ok).toBe(false);
    expect(scene.items.find((i) => i.id === "tok-brann")!.metadata[F("Z006")]).toBeUndefined();
  });
});
