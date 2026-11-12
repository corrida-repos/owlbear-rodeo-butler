import { describe, expect, it } from "vitest";
import fighter from "./fixtures/ddb-synthetic-fighter.json";
import { actionBar, explain, inTab, legendaryPerRound, parseEntryName, saveOf, spellLevelOf, summaryOf } from "../src/core/actions";
import { combatOptions, DMG_OPTIONS, skillBonus } from "../src/core/combatOptions";
import { DEFAULT_SETTINGS, readSettings, SETTINGS_KEY, settingsUpdate } from "../src/core/settings";
import { castingTime, convertDdbCharacter } from "../src/core/ddb";
import { EDIT_REQUESTS } from "../src/core/turns";
import type { UnitSheet } from "../src/core/sheet";

const brann = convertDdbCharacter(fighter);

/** A small dragon-ish creature with legendary actions, a recharge, spell lists and a limited trait. */
const dragon: UnitSheet = {
  ...brann.sheet, kind: "creature", name: "Young Test Dragon", level: undefined, cr: 10,
  traits: [{ name: "Legendary Resistance (3/Day, or 4/Day in Lair)", text: "If it fails a saving throw, it can choose to succeed instead." }, { name: "Amphibious", text: "Breathes air and water." }],
  actions: [
    { name: "Rend", text: "Melee Attack Roll: +10 [1d20+10], reach 10 ft. Hit: 2d10+6 [2d10+6] Slashing damage." },
    { name: "Fire Breath (Recharge 5–6)", text: "Dexterity Saving Throw: DC 17, each creature in a 30-foot Cone. Failure: 16d6 [16d6] Fire damage. Success: Half damage." },
  ],
  bonusActions: [], reactions: [{ name: "Tail Swipe", text: "When hit, it swipes." }],
  legendary: [
    { name: "Legendary Actions", text: "Legendary Action Uses: 3. Immediately after another creature's turn, the dragon can expend a use." },
    { name: "Pounce", text: "The dragon moves up to half its Speed." },
    { name: "Wing Attack (Costs 2 Actions)", text: "Each creature within 10 ft. makes a DC 18 Dexterity save." },
  ],
  spells: [
    { name: "Spellcasting", text: "The dragon casts spells (spell save DC 17)." },
    { name: "At Will", text: "fire bolt" },
    { name: "1/Day Each", text: "fireball, fly" },
  ],
  inventory: [],
};

describe("action bar: parsing entry names", () => {
  it("reads limits, recharges and legendary costs, and strips them (and D&D Beyond's used count) from the name", () => {
    expect(parseEntryName("Second Wind (2/Long Rest, 1 used)")).toEqual({ name: "Second Wind", limit: { max: 2, reset: "long", label: "2/Long Rest" } });
    expect(parseEntryName("Action Surge (1/Short Rest)").limit).toMatchObject({ max: 1, reset: "short" });
    expect(parseEntryName("Fire Breath (Recharge 5–6)")).toEqual({ name: "Fire Breath", recharge: 5 });
    expect(parseEntryName("Wing Attack (Costs 2 Actions)")).toEqual({ name: "Wing Attack", legendaryCost: 2 });
    const lr = parseEntryName("Legendary Resistance (3/Day, or 4/Day in Lair)");
    expect(lr.limit).toMatchObject({ max: 3, reset: "long" });
    expect(lr.name).toBe("Legendary Resistance (3/Day, or 4/Day in Lair)");
    expect(parseEntryName("Misty Step (Level 2, Fey Touched 1/Long Rest or with a slot)").limit).toMatchObject({ max: 1, reset: "long" });
    expect(parseEntryName("1/Day Each").limit).toBeUndefined();
  });
  it("spell levels, saves and summaries", () => {
    expect(spellLevelOf("Fire Bolt (Cantrip)")).toBe(0);
    expect(spellLevelOf("Shield (Level 1)")).toBe(1);
    expect(spellLevelOf("Rend")).toBeUndefined();
    expect(saveOf("WIS save DC 13.")).toEqual({ dc: 13, ability: "Wisdom" });
    expect(saveOf("Dexterity Saving Throw: DC 17")).toEqual({ dc: 17, ability: "Dexterity" });
    expect(summaryOf("Melee Attack Roll: +5 [1d20+5], reach 5 ft. Hit: 1d8+3 [1d8+3] Slashing damage.")).toBe("+5 · 1d8+3 Slashing");
    expect(summaryOf("Dexterity Saving Throw: DC 17, Failure: 16d6 [16d6] Fire damage.")).toBe("16d6 Fire · DC 17 Dex");
    // D&D Beyond spell text: dice followed by the damage type.
    expect(summaryOf("Ranged spell attack +5 [1d20+5]; 2d10 [2d10] fire. [Action, 120 ft.] Hurl a mote of fire.")).toBe("+5 · 2d10 Fire");
  });
});

describe("action bar from a D&D Beyond character", () => {
  const bar = actionBar(brann.sheet);
  it("groups weapons, bonus actions and common actions", () => {
    expect(bar.items.find((i) => i.name === "Second Wind")).toMatchObject({ cost: "bonus", category: "bonus", limit: { max: 2, reset: "long" } });
    expect(bar.items.find((i) => i.name === "Unarmed Strike")).toMatchObject({ cost: "action" });
    expect(bar.items.filter((i) => i.category === "common").map((i) => i.name)).toContain("Dash");
    expect(bar.items.filter((i) => inTab(i, "bonus")).map((i) => i.name)).toEqual(["Second Wind"]);
    expect(bar.items.some((i) => i.name === "Improved Critical")).toBe(false);
    expect(actionBar(brann.sheet, "2014").items.some((i) => i.name === "Use an Object")).toBe(true);
  });
  it("D&D Beyond casting times become costs and show on the card", () => {
    expect(castingTime({ activationType: 3, activationTime: 1 })).toEqual({ cost: "bonus", label: "Bonus Action" });
    expect(castingTime({ activationType: 4 })).toEqual({ cost: "reaction", label: "Reaction" });
    expect(castingTime({ activationType: 6, activationTime: 10 })).toEqual({ cost: "longer", label: "10 minutes" });
    expect(castingTime(undefined)).toEqual({ label: "" });
    const caster = structuredClone(fighter) as any;
    caster.classes[0].definition = { name: "Wizard", spellCastingAbilityId: 4, spellRules: { levelSpellSlots: [[], [2], [3], [4, 2]] } };
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
    expect(b.items.find((i) => i.name === "Misty Step")).toMatchObject({ category: "spell", cost: "bonus", spellLevel: 2 });
    const hold = b.items.find((i) => i.name === "Hold Person")!;
    expect(hold).toMatchObject({ cost: "action", concentration: true });
    expect(b.items.filter((i) => inTab(i, "reaction")).map((i) => i.name)).toEqual(["Shield"]);
    expect(b.items.some((i) => i.name.startsWith("Spellcasting"))).toBe(false);
    // Explanations.
    const shield = explain(b.items.find((i) => i.name === "Shield")!);
    expect(shield[0]).toMatch(/Reaction/);
    expect(shield).toContain("Trigger: when you are hit by an attack.");
    expect(shield.some((l) => /level 1 spell slot/.test(l))).toBe(true);
    const holdHow = explain(hold);
    expect(holdHow.some((l) => /DC \d+ Wisdom saving throw/.test(l))).toBe(true);
    expect(holdHow.some((l) => /^Concentration:/.test(l))).toBe(true);
  });
  it("explains attacks and limited features in plain words", () => {
    const strike = explain(bar.items.find((i) => i.name === "Unarmed Strike")!);
    expect(strike[0]).toBe("Uses your Action. You get one Action on each of your turns.");
    expect(strike[1]).toMatch(/^Make an attack roll: d20 \+\d+ against the target's Armor Class/);
    expect(explain(bar.items.find((i) => i.name === "Second Wind")!)).toContain("Limited: 2 times, back after a Long Rest.");
    // Common actions just explain their cost; their rule is the text.
    const oa = explain(bar.items.find((i) => i.name === "Opportunity Attack")!);
    expect(oa[0]).toMatch(/^When a creature you can see leaves your reach/);
    expect(oa[1]).toMatch(/Reaction/);
  });
});

describe("action bar from a creature", () => {
  const bar = actionBar(dragon);
  it("legendary actions, recharges, spell lists and limited traits", () => {
    expect(legendaryPerRound(dragon)).toBe(3);
    expect(bar.items.find((i) => i.name === "Wing Attack")).toMatchObject({ cost: "legendary", legendaryCost: 2 });
    expect(bar.items.find((i) => i.name === "Fire Breath")).toMatchObject({ cost: "action", recharge: 5, summary: "16d6 Fire · DC 17 Dex" });
    expect(bar.items.find((i) => i.name.startsWith("Legendary Resistance"))).toMatchObject({ category: "feature", limit: { max: 3 } });
    expect(bar.items.some((i) => i.name === "Amphibious")).toBe(false);
    expect(bar.items.some((i) => i.name === "Legendary Actions")).toBe(false);
  });
  it("explains them", () => {
    expect(explain(bar.items.find((i) => i.name === "Wing Attack")!, 3)[0]).toBe("A Legendary Action: taken right after another creature's turn ends. The creature has 3 per round, and this one costs 2 of them. They come back at the start of its turn.");
    const breath = explain(bar.items.find((i) => i.name === "Fire Breath")!);
    expect(breath).toContain("Each target makes a DC 17 Dexterity saving throw and needs 17 or more to succeed. On a failure they take 16d6 Fire damage, half as much on a success.");
    expect(breath.at(-1)).toMatch(/^Recharge 5–6: once used, roll a d6/);
    expect(explain(bar.items.find((i) => i.name === "1/Day Each")!)).toContain("Each of these can be cast 1 time(s) per day.");
  });
  it("nothing to track: no player request for it", () => {
    expect(EDIT_REQUESTS).not.toContain("use" as never);
  });
});

describe("combat options anyone has (PHB + DMG optional rules)", () => {
  const sheet = { ...brann.sheet, abilities: { ...brann.sheet.abilities, str: 16, dex: 14 }, proficiencyBonus: 2, speed: { walk: 30 },
    skills: [{ name: "Athletics", bonus: 5 }], actions: brann.sheet.actions.filter((a) => a.name !== "Unarmed Strike") };
  const allDmg = DMG_OPTIONS.map((o) => o.id);
  const opts = combatOptions(sheet, "2024", allDmg);
  const by = (n: string) => opts.find((o) => o.name === n)!;
  it("works out this character's numbers", () => {
    expect(by("Unarmed Strike")).toMatchObject({ cost: "attack", summary: "+5 · 4 Bludgeoning" });
    expect(by("Grapple")).toMatchObject({ cost: "attack", summary: "DC 13 Str/Dex" });
    expect(by("Grapple").text).toContain("against DC 13 (8 + Strength + proficiency)");
    expect(by("Shove").text).toContain("push it 5 ft. away or knock it Prone");
    expect(by("Escape a Grapple").summary).toBe("Athletics +5 or Acrobatics +2");
    expect(by("Jump").summary).toBe("16 ft. / 6 ft.");
    expect(by("Stand Up").summary).toBe("15 ft.");
    expect(by("Dash").summary).toBe("+30 ft.");
    expect(skillBonus(sheet, "Stealth", "dex")).toBe(2);
  });
  it("covers the PHB actions, attack options, movement and the DMG's optional ones", () => {
    const names = opts.map((o) => o.name);
    for (const n of ["Attack", "Dash", "Disengage", "Dodge", "Help", "Hide", "Influence", "Magic", "Ready", "Search", "Study", "Utilize",
      "Grapple", "Shove", "Two-Weapon Fighting", "Opportunity Attack", "Improvised Weapon", "Drop Prone", "Stand Up", "Jump", "Climb", "Swim",
      "Interact with an Object", "Stabilize", "Disarm", "Mark", "Overrun", "Shove Aside", "Tumble", "Climb onto a Bigger Creature"]) expect(names).toContain(n);
    expect(opts.filter((o) => o.source === "DMG").every((o) => o.group === "DMG optional rules")).toBe(true);
    expect(by("Drink or Administer a Potion").cost).toBe("bonus");
  });
  it("uses the 2014 wording and rules in a 5E room", () => {
    const old = combatOptions(sheet, "2014");
    const names = old.map((o) => o.name);
    expect(names).toContain("Cast a Spell");
    expect(names).toContain("Use an Object");
    expect(names).not.toContain("Influence");
    expect(old.find((o) => o.name === "Grapple")!.summary).toBe("Athletics +5");
    expect(old.find((o) => o.name === "Drink a Potion")!.cost).toBe("action");
  });
  it("doesn't repeat an Unarmed Strike the sheet already has, and explains the DMG ones as optional", () => {
    expect(combatOptions(brann.sheet).some((o) => o.name === "Unarmed Strike")).toBe(false);
    const disarm = actionBar(sheet, "2024", ["disarm"]).items.find((i) => i.name === "Disarm")!;
    expect(explain(disarm).at(-1)).toMatch(/optional rule from the Dungeon Master's Guide, switched on by your GM/);
    expect(inTab(disarm, "common")).toBe(true);
  });
});

describe("DMG optional combat rules: switched on one by one in Room settings", () => {
  const dmgNames = (dmg: string[]) => combatOptions(brann.sheet, "2024", dmg).filter((o) => o.source === "DMG").map((o) => o.name);
  it("are all off by default, and each shows only when switched on", () => {
    expect(DEFAULT_SETTINGS.dmgOptions).toEqual([]);
    expect(dmgNames([])).toEqual([]);
    expect(dmgNames(["tumble"])).toEqual(["Tumble"]);
    expect(dmgNames(["mark", "overrun"])).toEqual(["Mark", "Overrun"]);
    expect(dmgNames(DMG_OPTIONS.map((o) => o.id))).toHaveLength(6);
    expect(actionBar(brann.sheet).items.some((i) => i.source === "DMG")).toBe(false);
  });
  it("are stored in the room settings, ignoring unknown or repeated ids", () => {
    const meta = settingsUpdate({}, { dmgOptions: ["disarm", "tumble"] });
    expect(readSettings(meta).dmgOptions).toEqual(["disarm", "tumble"]);
    expect(readSettings({ [SETTINGS_KEY]: { dmgOptions: ["disarm", "disarm", "fly", 3] } }).dmgOptions).toEqual(["disarm"]);
    expect(readSettings({ [SETTINGS_KEY]: { dmgOptions: "disarm" } }).dmgOptions).toEqual([]);
  });
});
