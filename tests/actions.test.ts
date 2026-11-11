import { beforeEach, describe, expect, it } from "vitest";
import fighter from "./fixtures/ddb-synthetic-fighter.json";
import {
  actionBar, applyUse, castableWith, currentEconomy, inTab, isUseChange, legendaryPerRound, ownTurnRound, parseEntryName, slotPools,
  spellLevelOf, summaryOf, unavailable, useOnUnit, usesLeft,
} from "../src/core/actions";
import { castingTime, convertDdbCharacter } from "../src/core/ddb";
import { EMPTY_ENCOUNTER, ENCOUNTER_KEY, type EncounterState } from "../src/core/encounter";
import { syncedState } from "../src/core/party";
import { newState, SHEET_KEY, STATE_KEY, type UnitSheet } from "../src/core/sheet";
import { EDIT_REQUESTS, isPlayerRequest } from "../src/core/turns";
import { readUnit } from "../src/core/unit";
import { FakeScene } from "./fakeGateway";

const brann = convertDdbCharacter(fighter);

/** A small dragon-ish creature with legendary actions, a recharge, spell slots and a limited trait. */
const dragon: UnitSheet = {
  ...brann.sheet, kind: "creature", name: "Young Test Dragon", level: undefined, cr: 10,
  traits: [{ name: "Legendary Resistance (3/Day, or 4/Day in Lair)", text: "If it fails a saving throw, it can choose to succeed instead." }, { name: "Amphibious", text: "Breathes air and water." }],
  actions: [
    { name: "Rend", text: "Melee Attack Roll: +10 [1d20+10], reach 10 ft. Hit: 2d10+6 [2d10+6] Slashing damage." },
    { name: "Fire Breath (Recharge 5–6)", text: "Dexterity Saving Throw: DC 17, each creature in a 30-foot Cone. Failure: 16d6 [16d6] Fire damage." },
  ],
  bonusActions: [], reactions: [{ name: "Tail Swipe", text: "When hit, it swipes." }],
  legendary: [
    { name: "Legendary Actions", text: "Legendary Action Uses: 3. Immediately after another creature's turn, the dragon can expend a use." },
    { name: "Pounce", text: "The dragon moves up to half its Speed." },
    { name: "Wing Attack (Costs 2 Actions)", text: "Each creature within 10 ft. makes a DC 18 Dexterity save." },
  ],
  spells: [
    { name: "Spellcasting", text: "The dragon casts spells (spell save DC 17)." },
    { name: "Cantrips", text: "fire bolt" },
    { name: "Level 1 (4 slots)", text: "shield, magic missile" },
    { name: "1/Day Each", text: "fireball, fly" },
  ],
  inventory: [],
};

describe("action bar: parsing entry names", () => {
  it("reads uses, recharges and legendary costs, and strips them from the name", () => {
    expect(parseEntryName("Second Wind (2/Long Rest, 1 used)")).toEqual({ name: "Second Wind", uses: { max: 2, used: 1, reset: "long", label: "2/Long Rest" } });
    expect(parseEntryName("Action Surge (1/Short Rest)").uses).toMatchObject({ max: 1, used: 0, reset: "short" });
    expect(parseEntryName("Fire Breath (Recharge 5–6)")).toEqual({ name: "Fire Breath", recharge: 5 });
    expect(parseEntryName("Wing Attack (Costs 2 Actions)")).toEqual({ name: "Wing Attack", legendaryCost: 2 });
    // A note that says more keeps the name as written.
    const lr = parseEntryName("Legendary Resistance (3/Day, or 4/Day in Lair)");
    expect(lr.uses).toMatchObject({ max: 3, reset: "long" });
    expect(lr.name).toBe("Legendary Resistance (3/Day, or 4/Day in Lair)");
    // A D&D Beyond spell with a free cast from a feat.
    expect(parseEntryName("Misty Step (Level 2, Fey Touched 1/Long Rest or with a slot)").uses).toMatchObject({ max: 1, reset: "long" });
    // A creature's "1/Day Each" spell list is per spell, not a pool.
    expect(parseEntryName("1/Day Each").uses).toBeUndefined();
  });
  it("spell levels and summaries", () => {
    expect(spellLevelOf("Fire Bolt (Cantrip)")).toBe(0);
    expect(spellLevelOf("Shield (Level 1)")).toBe(1);
    expect(spellLevelOf("Rend")).toBeUndefined();
    expect(summaryOf("Melee Attack Roll: +5 [1d20+5], reach 5 ft. Hit: 1d8+3 [1d8+3] Slashing damage.")).toEqual({ summary: "+5 · 1d8+3 Slashing", rollable: true });
    expect(summaryOf("Dexterity Saving Throw: DC 17, Failure: 16d6 [16d6] Fire damage.").summary).toBe("16d6 Fire · DC 17 Dex");
    expect(summaryOf("CON save DC 14. 2d6 [2d6] fire").summary).toContain("DC 14 Con");
  });
});

describe("action bar from a D&D Beyond character", () => {
  const bar = actionBar(brann.sheet);
  it("groups weapons, bonus actions and common actions, with D&D Beyond's uses", () => {
    const wind = bar.items.find((i) => i.name === "Second Wind")!;
    expect(wind).toMatchObject({ cost: "bonus", category: "bonus", uses: { max: 2, used: 1, reset: "long" } });
    expect(bar.items.find((i) => i.name === "Unarmed Strike")).toMatchObject({ cost: "action", rollable: true });
    expect(bar.items.filter((i) => i.category === "common").map((i) => i.name)).toContain("Dash");
    expect(bar.items.filter((i) => inTab(i, "bonus")).map((i) => i.name)).toEqual(["Second Wind"]);
    // Plain features (no uses, no cost) stay on the card, not the bar.
    expect(bar.items.some((i) => i.name === "Improved Critical")).toBe(false);
  });
  it("D&D Beyond casting times become costs and show on the card", () => {
    expect(castingTime({ activationType: 3, activationTime: 1 })).toEqual({ cost: "bonus", label: "Bonus Action" });
    expect(castingTime({ activationType: 4 })).toEqual({ cost: "reaction", label: "Reaction" });
    expect(castingTime({ activationType: 6, activationTime: 10 })).toEqual({ cost: "longer", label: "10 minutes" });
    expect(castingTime(undefined)).toEqual({ label: "" });
    const caster = structuredClone(fighter) as any;
    caster.classes[0].definition = { name: "Wizard", spellCastingAbilityId: 4, spellRules: { levelSpellSlots: [[], [2], [3], [4, 2]] } };
    caster.spellSlots = [{ level: 1, used: 1 }];
    caster.classSpells = [{ characterClassId: caster.classes[0].id, spells: [
      { prepared: true, definition: { name: "Misty Step", level: 2, activation: { activationType: 3, activationTime: 1 }, range: { origin: "Self" }, snippet: "Teleport 30 ft." } },
      { prepared: true, definition: { name: "Shield", level: 1, activation: { activationType: 4, activationTime: 1 }, castingTimeDescription: "when you are hit by an attack", range: { origin: "Self" }, snippet: "+5 AC." } },
      { prepared: true, definition: { name: "Hold Person", level: 2, concentration: true, activation: { activationType: 1, activationTime: 1 }, range: { rangeValue: 60 }, saveDcAbilityId: 5, snippet: "Paralyzed." } },
    ] }];
    const m = convertDdbCharacter(caster);
    const misty = m.sheet.spells.find((s) => s.name.startsWith("Misty Step"))!;
    expect(misty).toMatchObject({ cost: "bonus" });
    expect(misty.text).toContain("[Bonus Action, Self]");
    expect(m.sheet.spells.find((s) => s.name.startsWith("Shield"))).toMatchObject({ cost: "reaction", costNote: "Reaction: when you are hit by an attack" });
    const b = actionBar(m.sheet);
    expect(b.slots).toEqual([
      { key: "slots:Wizard:1", level: 1, max: 4, used: 1, source: "Wizard", pact: false },
      { key: "slots:Wizard:2", level: 2, max: 2, used: 0, source: "Wizard", pact: false },
    ]);
    expect(b.items.find((i) => i.name === "Misty Step")).toMatchObject({ category: "spell", cost: "bonus", spellLevel: 2, key: "spells:Misty Step" });
    expect(b.items.find((i) => i.name === "Hold Person")).toMatchObject({ cost: "action", concentration: true, summary: expect.stringMatching(/^DC \d+ Wis$/) });
    // Spells show under their cost too.
    expect(b.items.filter((i) => inTab(i, "reaction")).map((i) => i.name)).toEqual(["Shield"]);
    // The spellcasting header isn't a tile.
    expect(b.items.some((i) => i.name.startsWith("Spellcasting"))).toBe(false);
  });
});

describe("action bar from a creature", () => {
  const bar = actionBar(dragon);
  it("legendary actions, recharges, spell slots and limited traits", () => {
    expect(legendaryPerRound(dragon)).toBe(3);
    expect(bar.legendary).toBe(3);
    expect(bar.items.find((i) => i.name === "Wing Attack")).toMatchObject({ cost: "legendary", legendaryCost: 2 });
    expect(bar.items.find((i) => i.name === "Fire Breath")).toMatchObject({ cost: "action", recharge: 5, summary: "16d6 Fire · DC 17 Dex" });
    expect(bar.items.find((i) => i.name.startsWith("Legendary Resistance"))).toMatchObject({ category: "feature", uses: { max: 3 } });
    expect(bar.items.some((i) => i.name === "Amphibious")).toBe(false);
    expect(bar.items.some((i) => i.name === "Legendary Actions")).toBe(false);
    expect(slotPools(dragon)).toEqual([{ key: "slots:Spellcasting:1", level: 1, max: 4, used: 0, source: "Spellcasting", pact: false }]);
  });
  it("greys out what can't be used now", () => {
    const st = { used: {}, turn: undefined };
    const eco = { round: 2, action: true, legendary: 2 };
    const rend = bar.items.find((i) => i.name === "Rend")!;
    const wing = bar.items.find((i) => i.name === "Wing Attack")!;
    const pounce = bar.items.find((i) => i.name === "Pounce")!;
    const breath = bar.items.find((i) => i.name === "Fire Breath")!;
    expect(unavailable(rend, bar, st, eco)).toBe("Action used");
    expect(unavailable(wing, bar, st, eco)).toBe("No Legendary Actions left");
    expect(unavailable(pounce, bar, st, eco)).toBeNull();
    expect(unavailable(breath, bar, { used: { "actions:Fire Breath": 1 } }, { round: 2 })).toBe("Recharging (5–6)");
  });
});

describe("action economy and uses", () => {
  const order = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const enc = (round: number, turnId: string): EncounterState => ({ ...EMPTY_ENCOUNTER, started: true, round, turnId, turnIndex: order.findIndex((u) => u.id === turnId) });
  it("a unit's turn round: this round once its turn has come, else last round; 0 outside combat", () => {
    expect(ownTurnRound(EMPTY_ENCOUNTER, order, "b")).toBe(0);
    expect(ownTurnRound(enc(3, "a"), order, "b")).toBe(2);
    expect(ownTurnRound(enc(3, "b"), order, "b")).toBe(3);
    expect(ownTurnRound(enc(3, "c"), order, "b")).toBe(3);
    expect(ownTurnRound(enc(3, "c"), order, "zzz")).toBe(0);
  });
  it("what was spent resets when the unit's next turn starts (the Reaction too)", () => {
    const state = { turn: { round: 2, action: true, reaction: true } };
    expect(currentEconomy(state, 2)).toEqual({ round: 2, action: true, reaction: true });
    expect(currentEconomy(state, 3)).toEqual({ round: 3 });
  });
  it("spends and regains economy, uses and slots; rests bring them back", () => {
    const st = { turn: { round: 1, bonus: true }, used: {} as Record<string, number> };
    expect(applyUse(brann.sheet, st, { economy: { action: true } }, 1)).toEqual({ turn: { round: 1, bonus: true, action: true } });
    // A new turn: the old Bonus Action doesn't carry over.
    expect(applyUse(brann.sheet, st, { economy: { action: true } }, 2)).toEqual({ turn: { round: 2, action: true } });
    expect(applyUse(brann.sheet, st, { economy: { bonus: false } }, 1)).toEqual({ turn: { round: 1 } });
    const wind = actionBar(brann.sheet).items.find((i) => i.name === "Second Wind")!;
    expect(usesLeft(wind, {})).toBe(1); // D&D Beyond: 1 of 2 used
    const spent = applyUse(brann.sheet, st, { used: { [wind.key]: 2 } }, 1);
    expect(usesLeft(wind, spent as any)).toBe(0);
    expect(applyUse(brann.sheet, { used: { [wind.key]: 2 } }, { rest: "short" }, 1).used).toEqual({ [wind.key]: 2 }); // Long Rest feature
    expect(applyUse(brann.sheet, { used: { [wind.key]: 2 } }, { rest: "long" }, 1).used).toEqual({ [wind.key]: 0 });
    const pools = slotPools(dragon);
    expect(castableWith(1, pools, { used: { "slots:Spellcasting:1": 4 } })).toEqual([]);
    expect(applyUse(dragon, { used: { "slots:Spellcasting:1": 4, "actions:Fire Breath": 1 } }, { rest: "long" }, 1).used)
      .toEqual({ "slots:Spellcasting:1": 0, "actions:Fire Breath": 0, "traits:Legendary Resistance (3/Day, or 4/Day in Lair)": 0 });
  });
  it("validates changes sent by players", () => {
    expect(isUseChange({ economy: { action: true }, used: { "spells:Shield": 1 } })).toBe(true);
    expect(isUseChange({ economy: { teleport: true } })).toBe(false);
    expect(isUseChange({ used: { x: -1 } })).toBe(false);
    expect(isUseChange({ used: { x: 1.5 } })).toBe(false);
    expect(isUseChange({ rest: "nap" })).toBe(false);
    const base = { v: 1, unitId: "u", playerId: "p", playerName: "Ana" };
    expect(isPlayerRequest({ ...base, type: "use", change: { resetTurn: true } })).toBe(true);
    expect(isPlayerRequest({ ...base, type: "use", change: { legendary: 99 } })).toBe(false);
    expect(EDIT_REQUESTS).toContain("use");
  });
  it("a D&D Beyond re-sync starts the uses again from D&D Beyond", () => {
    const prev = newState(brann.sheet, { used: { "bonusActions:Second Wind": 2 }, turn: { round: 1, action: true } });
    const next = syncedState(brann, prev, "keep");
    expect(next.used).toBeUndefined();
    expect(next.turn).toEqual({ round: 1, action: true });
  });
});

describe("action bar on the scene", () => {
  let scene: FakeScene;
  beforeEach(() => {
    scene = new FakeScene();
    for (const [id, init] of [["pc", 18], ["drake", 12]] as const) {
      const sheet = id === "pc" ? brann.sheet : dragon;
      scene.items.push({ id, type: "IMAGE", layer: "CHARACTER", name: sheet.name, label: sheet.name,
        metadata: { [SHEET_KEY]: sheet, [STATE_KEY]: newState(sheet, { initiative: init, inEncounter: true }) }, position: { x: 0, y: 0 }, size: { w: 1, h: 1 } });
    }
  });
  const state = (id: string) => readUnit(scene.items.find((i) => i.id === id)!.metadata)!.state;
  it("records what's spent against the unit's current turn", async () => {
    scene.sceneMeta = { [ENCOUNTER_KEY]: { ...EMPTY_ENCOUNTER, started: true, round: 2, turnId: "pc", turnIndex: 0 } };
    await useOnUnit(scene, "pc", { economy: { action: true }, used: { "bonusActions:Second Wind": 2 } });
    expect(state("pc").turn).toEqual({ round: 2, action: true });
    expect(state("pc").used).toEqual({ "bonusActions:Second Wind": 2 });
    // The dragon hasn't had its round-2 turn yet: its legendary actions count against round 1.
    await useOnUnit(scene, "drake", { legendary: 1 });
    expect(state("drake").turn).toEqual({ round: 1, legendary: 1 });
    await expect(useOnUnit(scene, "gone", { resetTurn: true })).rejects.toThrow();
  });
});
