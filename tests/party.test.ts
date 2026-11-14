import { beforeEach, describe, expect, it } from "vitest";
import fighter from "./fixtures/ddb-synthetic-fighter.json";
import { BUTLER_ITEM_KEY } from "../src/core/constants";
import { convertDdbCharacter, htmlToText, renderTemplate } from "../src/core/ddb";
import { makePartyPackage, matchParty, previewParty, syncedState, syncParty, validateParty } from "../src/core/party";
import { SHEET_KEY, STATE_KEY, validateSheet, type UnitState } from "../src/core/sheet";
import { readUnit } from "../src/core/unit";
import { FakeScene } from "./fakeGateway";

const brann = convertDdbCharacter(fighter);
const sh = brann.sheet;

describe("D&D Beyond character conversion (synthetic Fighter 3)", () => {
  it("ability scores include race bonuses; HP includes Con and Tough per level", () => {
    expect([sh.abilities.str, sh.abilities.con]).toEqual([16, 16]);
    expect(brann.hp).toEqual({ max: 22 + (3 + 2) * 3, current: 37 - 5, temp: 3 });
    expect(sh.hp.max).toBe(37);
  });
  it("AC: heavy armor + shield + Defense + attuned ring; unequipped and condition modifiers ignored", () => {
    expect(brann.ac).toBe(16 + 2 + 1 + 1);
    expect(sh.ac).toBe(20);
  });
  it("initiative, saves, skills, senses, languages, resistances", () => {
    expect(brann.initiative.modifier).toBe(1 + 5);
    expect(brann.initiative.reasons.join(" ")).toMatch(/\+5 from "Alert"/);
    expect(sh.initiative).toMatchObject({ modifier: 6, advantage: false });
    expect([sh.saves.str, sh.saves.dex, sh.saves.con]).toEqual([5, 1, 5]);
    expect(sh.skills).toEqual([{ name: "Athletics", bonus: 5 }]);
    expect(sh.senses).toContain("Darkvision 60 ft.");
    expect(sh.passivePerception).toBe(11);
    expect(sh.languages).toBe("Common, Dwarvish");
    expect(sh.defenses.resist).toBe("Poison");
    expect([sh.kind, sh.level, sh.proficiencyBonus, sh.speed.walk]).toEqual(["character", 3, 2, 25]);
  });
  it("weapon attacks with to-hit, damage and versatile dice chips", () => {
    const sword = sh.actions.find((a) => a.name === "Longsword")!;
    expect(sword.text).toContain("+5 [1d20+5]");
    expect(sword.text).toContain("1d8+3 [1d8+3] Slashing");
    expect(sword.text).toContain("Versatile: 1d10+3 [1d10+3]");
    expect(sword.text).toContain("Properties: Sap");
  });
  it("D&D Beyond actions go to the right list with uses; features up to current level only", () => {
    expect(sh.bonusActions.map((a) => a.name)).toEqual(["Second Wind (2/Long Rest, 1 used)"]);
    const feats = sh.traits.map((a) => a.name);
    expect(feats).toEqual(expect.arrayContaining(["Fighting Style", "Improved Critical", "Darkvision", "Dwarven Resilience", "Tough", "Alert"]));
    expect(feats).not.toContain("Extra Attack");
    expect(feats).not.toContain("Speed");
  });
  it("renders D&D Beyond placeholders and HTML", () => {
    const ctx = { pb: 2, level: 3, mod: () => 3, score: {} as any };
    expect(renderTemplate("uses: {{proficiency}}, DC {{savedc:con}}, +{{modifier:wis@min:1}} {{(classlevel*5)}}", ctx)).toBe("uses: 2, DC 13, +3 15");
    expect(htmlToText("<p>Take the [action]Attack[/action] action.</p><ul><li>One</li></ul>")).toBe("Take the Attack action.\n• One");
  });
  it("produces a valid native sheet; old party files are rejected with a hint", () => {
    expect(validateSheet(sh)).toEqual([]);
    expect(validateParty({ schema: "owlbear-butler/party@1", members: [{ name: "x", hp: { max: 1 }, forge: {} }] }).join(" ")).toMatch(/party@2/);
  });
});

describe("party sync", () => {
  let scene: FakeScene;
  const pkg = makePartyPackage("test", { name: "Test" }, "2026-11-04T00:00:00Z", [brann, { ...brann, ddbId: 1002, name: "Isolde Nobody" }]);
  let ids = 0;
  const newId = () => `n${++ids}`;
  const tok = (id: string, label: string, metadata: Record<string, unknown> = {}) =>
    ({ id, type: "IMAGE", layer: "CHARACTER", name: "Token image", label, position: { x: 0, y: 0 }, size: { w: 150, h: 150 }, metadata });
  /** A token that already is a Butler unit, mid-session. */
  const existingUnit = (state: Partial<UnitState>) => ({
    [SHEET_KEY]: sh,
    [STATE_KEY]: { hp: 10, tempHp: 0, initiative: 14, inEncounter: true, party: true, conditions: [{ id: "c1", key: "prone" }], ...state },
    "other.ext/keep": "yes",
  });
  const unitOf = (id: string) => readUnit(scene.items.find((i) => i.id === id)!.metadata)!;

  beforeEach(() => {
    scene = new FakeScene();
    scene.items.push(tok("tok-brann", "Brann", { "other.ext/keep": "yes" }), { ...tok("wolf", ""), name: "Wolf 1", label: undefined });
  });

  it("matches by first name and reports unmatched characters", async () => {
    const rows = matchParty(pkg.members, await scene.getItems());
    expect(rows[0]).toMatchObject({ item: { id: "tok-brann" }, by: "first name" });
    expect(rows[1]!.item).toBeNull();
    const pv = await previewParty(pkg, scene);
    expect(pv.errors).toEqual([]);
  });

  it("writes the sheet and state onto a plain token without touching other data", async () => {
    const r = await syncParty(pkg, { hp: "ddb", createMissing: false, newId }, scene);
    expect(r.ok).toBe(true);
    expect(r.updated).toHaveLength(1);
    expect(r.skipped[0]).toMatch(/Isolde Nobody: no matching token/);
    const t = scene.items.find((i) => i.id === "tok-brann")!;
    const { sheet, state } = unitOf("tok-brann");
    expect([sheet.hp.max, sheet.ac]).toEqual([37, 20]);
    expect(state).toMatchObject({ hp: 32, tempHp: 3, party: true, inEncounter: true, initiative: null, conditions: [] });
    expect(t.metadata["other.ext/keep"]).toBe("yes"); // other extensions' data untouched
    expect((t.metadata[BUTLER_ITEM_KEY] as any).ddbId).toBe(1001);
    expect(scene.items.find((i) => i.id === "wolf")!.metadata).toEqual({});
  });

  it("re-sync keeps the token's conditions and initiative; \"keep\" also keeps HP; matches by D&D Beyond id", async () => {
    scene.items[0]!.metadata = existingUnit({});
    await syncParty(pkg, { hp: "keep", createMissing: false, newId }, scene);
    expect(unitOf("tok-brann").state).toMatchObject({ hp: 10, initiative: 14, conditions: [{ key: "prone" }] });
    await syncParty(pkg, { hp: "ddb", createMissing: false, newId }, scene);
    expect(unitOf("tok-brann").state).toMatchObject({ hp: 32, tempHp: 3, initiative: 14, conditions: [{ key: "prone" }] });
    scene.items[0]!.label = "Renamed";
    expect(matchParty(pkg.members, await scene.getItems())[0]).toMatchObject({ by: "D&D Beyond id" });
  });

  it("a re-sync with nothing new on the sheet writes only the small party record", async () => {
    await syncParty(pkg, { hp: "ddb", createMissing: false, newId }, scene);
    const writes: Record<string, unknown>[] = [];
    const orig = scene.updateMetadata.bind(scene);
    scene.updateMetadata = async (u) => { writes.push(...u.map((x) => x.metadata)); return orig(u); };
    const r = await syncParty(pkg, { hp: "ddb", createMissing: false, newId, now: () => new Date("2030-01-01T00:00:00Z") }, scene);
    expect(r.ok).toBe(true);
    expect(writes.map((w) => Object.keys(w))).toEqual([[BUTLER_ITEM_KEY]]);
    expect((scene.items.find((i) => i.id === "tok-brann")!.metadata[BUTLER_ITEM_KEY] as any).syncedAt).toBe("2030-01-01T00:00:00.000Z");
    expect(unitOf("tok-brann").sheet.ac).toBe(20);
    // a changed sheet is written again
    writes.length = 0;
    await syncParty(makePartyPackage("t", { name: "T" }, "x", [{ ...pkg.members[0]!, sheet: { ...pkg.members[0]!.sheet, ac: 21 } }]), { hp: "ddb", createMissing: false, newId }, scene);
    expect(Object.keys(writes[0]!)).toContain(SHEET_KEY);
    expect(unitOf("tok-brann").sheet.ac).toBe(21);
  });

  it("creates a token for an unmatched character only with a usable public image", async () => {
    const noImg = await syncParty(pkg, { hp: "ddb", createMissing: true, newId }, scene);
    expect(noImg.skipped[0]).toMatch(/no usable avatar/);
    const r = await syncParty(pkg, { hp: "ddb", createMissing: true, newId, avatars: { 1002: { url: "https://cdn.example.org/isolde.png", width: 256, height: 256, mime: "image/png" } } }, scene);
    expect(r.created).toHaveLength(1);
    const t = scene.items.find((i) => i.name === "Isolde Nobody")!;
    expect(readUnit(t.metadata)!.state).toMatchObject({ party: true, inEncounter: true, hp: 32 });
  });

  describe("party initiative", () => {
    const fixed = (...faces: number[]) => { let i = 0; return () => (faces[i++ % faces.length]! - 1) / 20 + 0.001; };
    const pkg2 = makePartyPackage("t2", { name: "T" }, "x", [
      brann, // +6, token already has 14
      { ...brann, ddbId: 1002, name: "Isolde Swift", initiative: { modifier: 3, advantage: true, reasons: [] } }, // token at 0
    ]);
    beforeEach(() => {
      scene.items[0]!.metadata = existingUnit({});
      scene.items.push(tok("tok-isolde", "Isolde", existingUnit({ initiative: 0 })));
    });

    it('"unset" rolls only for tokens without initiative (missing or 0), with advantage when the sheet has it', async () => {
      const r = await syncParty(pkg2, { hp: "ddb", createMissing: false, initiative: "unset", rng: fixed(4, 17), newId }, scene);
      expect(r.rolled.map((x) => x.name)).toEqual(["Isolde Swift"]);
      expect(r.rolled[0]!.roll).toMatchObject({ dice: [4, 17], kept: 17, modifier: 3, mode: "advantage", total: 20 });
      expect(unitOf("tok-isolde").state).toMatchObject({ initiative: 20, initiativeRoll: { dice: [4, 17] } });
      expect((scene.items.find((i) => i.id === "tok-isolde")!.metadata[BUTLER_ITEM_KEY] as any).initiative.dice).toEqual([4, 17]);
      expect(unitOf("tok-brann").state.initiative).toBe(14);
    });

    it('"all" re-rolls everyone; "keep" touches nothing', async () => {
      const r = await syncParty(pkg2, { hp: "ddb", createMissing: false, initiative: "all", rng: fixed(10), newId }, scene);
      expect(r.rolled).toHaveLength(2);
      expect(unitOf("tok-brann").state.initiative).toBe(10 + 6);
      const k = await syncParty(pkg2, { hp: "ddb", createMissing: false, initiative: "keep", newId }, scene);
      expect(k.rolled).toEqual([]);
      expect(unitOf("tok-brann").state.initiative).toBe(16);
    });

    it("new tokens get rolled initiative too (unless keep)", async () => {
      const pkg3 = makePartyPackage("t3", { name: "T" }, "x", [{ ...brann, ddbId: 1003, name: "Nobody New" }]);
      const r = await syncParty(pkg3, { hp: "ddb", createMissing: true, initiative: "unset", rng: fixed(7), newId,
        avatars: { 1003: { url: "https://cdn.example.org/n.png", width: 64, height: 64, mime: "image/png" } } }, scene);
      expect(r.created).toHaveLength(1);
      expect(readUnit(scene.items.find((i) => i.name === "Nobody New")!.metadata)!.state.initiative).toBe(7 + 6);
    });
  });

  it("refuses for players", async () => {
    scene.role = "PLAYER";
    const r = await syncParty(pkg, { hp: "ddb", createMissing: false, newId }, scene);
    expect(r.ok).toBe(false);
    expect(scene.items.find((i) => i.id === "tok-brann")!.metadata[SHEET_KEY]).toBeUndefined();
  });
});

describe("D&D Beyond HP follows the 0-HP rules", () => {
  const at = (current: number) => ({ ...brann, hp: { ...brann.hp, current } });
  const prev = (over: Partial<UnitState>): UnitState => ({ hp: 10, tempHp: 0, initiative: null, inEncounter: true, party: true, conditions: [], ...over });
  it("a sync to 0 HP starts death saves and the 0 HP prompt; back above 0 ends them", () => {
    expect(syncedState(at(0), prev({ hp: 10 }), "ddb")).toMatchObject({ hp: 0, zeroHpPending: true, deathSaves: { successes: 0, failures: 0 } });
    const up = syncedState(at(5), prev({ hp: 0, zeroHpPending: true, deathSaves: { successes: 1, failures: 1 } }), "ddb");
    expect(up.hp).toBe(5);
    expect("deathSaves" in up || "zeroHpPending" in up).toBe(false);
    expect(syncedState(at(0), prev({ hp: 10 }), "keep").zeroHpPending).toBeUndefined();
  });
});
