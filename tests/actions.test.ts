import { describe, expect, it } from "vitest";
import fighter from "./fixtures/ddb-synthetic-fighter.json";
import { actionBar, attacksPerAction, barLayout, explain, filterCount, isAttackOption, legendaryPerRound, parseEntryName, saveOf, spellLevelOf, summaryOf, type ActionBar, type BarFilter } from "../src/core/actions";
import { ddbItemInfo, itemInfo, lightWeaponCount } from "../src/core/items";
import { HOMEBREW_KEY, readHomebrew, removeHomebrew, upsertHomebrew } from "../src/core/homebrew";
import { combatOptions, skillBonus } from "../src/core/combatOptions";
import { parseChips, rollSegments } from "../src/core/chips";
import { castingTime, convertDdbCharacter } from "../src/core/ddb";
import { EDIT_REQUESTS } from "../src/core/turns";
import type { UnitSheet } from "../src/core/sheet";

/** Names an item shows under (attack options count under Action), like the old tabs. */
const under = (bar: ActionBar, f: BarFilter) => { const l = barLayout(bar, f); return [...l.sections.flatMap((s) => s.items), ...Object.values(l.reveals).flat()]; };
const inTab = (it: { key: string }, bar: ActionBar, f: BarFilter) => under(bar, f).some((x) => x.key === it.key);

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
    expect(under(bar, "bonus").filter((i) => i.category !== "common").map((i) => i.name)).toEqual(["Second Wind", "Potion of Healing ×2"]);
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
    expect(under(b, "reaction").filter((i) => i.category !== "common").map((i) => i.name)).toEqual(["Shield"]);
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
    expect(bar.items.find((i) => i.name === "Fire Breath")).toMatchObject({ cost: "action", recharge: 5, summary: "16d6 [16d6] Fire · DC 17 Dex" });
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
  const opts = combatOptions(sheet, "2024");
  const by = (n: string) => opts.find((o) => o.name === n)!;
  it("works out this character's numbers", () => {
    expect(by("Unarmed Strike")).toMatchObject({ cost: "attack", summary: "+5 [1d20+5] · 4 Bludgeoning" });
    expect(by("Grapple")).toMatchObject({ cost: "attack", summary: "DC 13 Str/Dex" });
    expect(by("Grapple").text).toContain("against DC 13 (8 + Strength + proficiency)");
    expect(by("Shove").text).toContain("push it 5 ft. away or knock it Prone");
    expect(by("Escape a Grapple").summary).toBe("Athletics +5 [1d20+5] or Acrobatics +2 [1d20+2]");
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
    expect(opts.filter((o) => o.source === "DMG").map((o) => o.name)).toEqual(["Disarm", "Mark", "Overrun", "Shove Aside", "Tumble", "Climb onto a Bigger Creature"]);
    expect(combatOptions(sheet, "2024", { dmg: false }).some((o) => o.source === "DMG")).toBe(false);
    expect(by("Drink or Administer a Potion").cost).toBe("bonus");
  });
  it("gives every option with a roll its modifier or dice, as a rollable chip", () => {
    const rolls = (n: string) => rollSegments(parseChips(by(n).summary ?? "")).map((r) => `${r.display}=${r.formula}`);
    expect(rolls("Hide")).toEqual(["+2=1d20+2"]);
    expect(rolls("Unarmed Strike")).toEqual(["+5=1d20+5"]);
    expect(rolls("Improvised Weapon")).toEqual(["+3=1d20+3", "1d4 + 3=1d4+3"]);
    expect(rolls("Escape a Grapple")).toEqual(["+5=1d20+5", "+2=1d20+2"]);
    expect(rolls("Shove Aside")).toEqual(["+5 dis=2d20kl1+5"]);
    for (const n of ["Influence", "Search", "Study", "Stabilize", "Climb", "Swim", "Disarm", "Overrun", "Tumble", "Climb onto a Bigger Creature"]) {
      expect(rolls(n).length, n).toBeGreaterThan(0);
    }
    // Every roll in a rule's text is a chip too, with its kind from the wording.
    const kinds = (n: string) => rollSegments(parseChips(by(n).text)).map((r) => r.kind);
    expect(kinds("Unarmed Strike")).toEqual(["attack"]);
    expect(kinds("Influence")).toEqual(["check", "check", "check", "check", "check"]);
    // Saves show the DC, not a roll.
    expect(kinds("Dismount")).toEqual([]);
    expect(by("Dismount").summary).toBe("15 ft. · DC 10 Dex save");
    expect(rolls("Grapple")).toEqual([]);
    expect(by("Grapple").summary).toBe("DC 13 Str/Dex");
    expect(kinds("Improvised Weapon")).toEqual(["attack", "attack", "damage"]);
  });
  it("keeps a sheet entry's dice rollable on its tile", () => {
    expect(summaryOf("Melee Attack Roll: +5 [1d20+5], reach 5 ft. Hit: 1d8+3 [1d8+3] Slashing damage.", true)).toBe("+5 [1d20+5] · 1d8+3 [1d8+3] Slashing");
    expect(summaryOf("Dexterity Saving Throw: DC 17, Failure: 16d6 [16d6] Fire damage.", true)).toBe("16d6 [16d6] Fire · DC 17 Dex");
    expect(summaryOf("Make a saving throw +3 [1d20+3].", true)).toBe("");
  });
  it("2024: equipping or unequipping a weapon goes with an attack, not the free object interaction", () => {
    expect(by("Equip or Unequip a Weapon")).toMatchObject({ cost: "free", withAttack: true });
    expect(by("Equip or Unequip a Weapon").text).toMatch(/one swap per attack/);
    expect(by("Equip or Unequip a Weapon").text).toMatch(/War Magic/);
    expect(by("Equip or Unequip a Weapon").text).toMatch(/spellcasting focus isn't one/);
    expect(by("Interact with an Object").text).toMatch(/spellcasting focus or component pouch uses this/);
    expect(by("Magic").text).toMatch(/free hand/);
    expect(by("Interact with an Object").text).not.toMatch(/draw or sheathe a weapon/);
    expect(by("Attack").text).toMatch(/equip or unequip one weapon/);
    const layout = barLayout(actionBar(sheet));
    expect(layout.attackOptions.map((o) => o.name)).toContain("Equip or Unequip a Weapon");
    expect(layout.sections.flatMap((s) => s.items).some((i) => i.name === "Equip or Unequip a Weapon")).toBe(false);
    const old = combatOptions(sheet, "2014");
    expect(old.some((o) => o.name === "Equip or Unequip a Weapon")).toBe(false);
    expect(old.find((o) => o.name === "Interact with an Object")!.text).toMatch(/draw or sheathe a weapon/);
  });
  it("shows options that depend on a condition only when it applies", () => {
    const names = (conditions: string[]) => actionBar(sheet, "2024", { conditions }).items.map((i) => i.name);
    const none = names([]);
    expect(none).not.toContain("Escape a Grapple");
    expect(none).not.toContain("Stand Up");
    expect(none).not.toContain("Dismount");
    expect(none).toEqual(expect.arrayContaining(["Drop Prone", "Mount"]));
    const hampered = names(["grappled", "prone", "mounted"]);
    expect(hampered).toEqual(expect.arrayContaining(["Escape a Grapple", "Stand Up", "Dismount"]));
    expect(hampered).not.toContain("Drop Prone");
    expect(hampered).not.toContain("Mount");
    // Without the unit's conditions (reference use), every option shows.
    expect(actionBar(sheet).items.map((i) => i.name)).toEqual(expect.arrayContaining(["Escape a Grapple", "Mount", "Dismount"]));
  });
  it("uses the 2014 wording and rules in a 5E room", () => {
    const old = combatOptions(sheet, "2014");
    const names = old.map((o) => o.name);
    expect(names).toContain("Cast a Spell");
    expect(names).toContain("Use an Object");
    expect(names).not.toContain("Influence");
    expect(old.find((o) => o.name === "Grapple")!.summary).toBe("Athletics +5 [1d20+5]");
    expect(old.find((o) => o.name === "Drink a Potion")!.cost).toBe("action");
  });
  it("doesn't repeat an Unarmed Strike the sheet already has, and explains the DMG ones as optional", () => {
    expect(combatOptions(brann.sheet).some((o) => o.name === "Unarmed Strike")).toBe(false);
    const disarm = actionBar(sheet).items.find((i) => i.name === "Disarm")!;
    expect(explain(disarm).at(-1)).toMatch(/optional rule from the Dungeon Master's Guide/);
    expect(isAttackOption(disarm)).toBe(true);
  });
});

describe("one list: the sheet and the rules together, Attack gathering every way to attack", () => {
  const bar = actionBar(brann.sheet);
  const layout = barLayout(bar);
  it("Attack leads the Actions and reveals the sheet's weapons, then the rules' attack options (not bonus/reaction ones)", () => {
    const actions = layout.sections.find((s) => s.id === "action")!;
    expect(actions.items[0]!.name).toBe("Attack");
    const names = layout.attackOptions.map((o) => o.name);
    expect(names).toContain("Unarmed Strike");
    expect(names).toEqual(expect.arrayContaining(["Grapple", "Shove", "Improvised Weapon", "Disarm", "Shove Aside"]));
    expect(names).not.toContain("Two-Weapon Fighting");
    expect(names).not.toContain("Opportunity Attack");
    expect(names).not.toContain("Mark");
    // Sheet attacks come first.
    const firstCommon = layout.attackOptions.findIndex((o) => o.category === "common");
    expect(layout.attackOptions.slice(0, firstCommon).every((o) => o.category !== "common")).toBe(true);
    expect(firstCommon).toBeGreaterThan(0);
    // ...and aren't repeated elsewhere.
    expect(layout.sections.flatMap((s) => s.items).some((i) => i.name === "Unarmed Strike")).toBe(false);
  });
  it("no separate tab for the sheet or for the DMG: they're sorted by cost with the rest", () => {
    const bonus = layout.sections.find((s) => s.id === "bonus")!.items.map((i) => i.name);
    expect(bonus).toEqual(expect.arrayContaining(["Second Wind", "Drink or Administer a Potion"]));
    expect(bonus).not.toContain("Two-Weapon Fighting"); // one Longsword, no Light weapons
    expect(layout.sections.find((s) => s.id === "reaction")!.items.map((i) => i.name)).toContain("Opportunity Attack");
    expect(layout.sections.find((s) => s.id === "action")!.items.map((i) => i.name)).toEqual(expect.arrayContaining(["Dash", "Overrun", "Tumble"]));
    expect(layout.sections.some((s) => /DMG/.test(s.title))).toBe(false);
    expect(filterCount(bar, "action")).toBe(under(bar, "action").length);
  });
  it("the room setting leaves the DMG options out", () => {
    const off = actionBar(brann.sheet, "2024", { dmg: false });
    expect(off.items.some((i) => i.source === "DMG")).toBe(false);
  });
  it("Extra Attack shows on the Attack tile", () => {
    expect(attacksPerAction({ traits: [{ name: "Extra Attack", text: "" }], actions: [] })).toBe(2);
    expect(attacksPerAction({ traits: [{ name: "Two Extra Attacks", text: "" }], actions: [] })).toBe(3);
    const b = actionBar({ ...brann.sheet, traits: [...brann.sheet.traits, { name: "Extra Attack", text: "Attack twice." }] });
    expect(b.items.find((i) => i.name === "Attack")!.summary).toBe("2 attacks");
  });
  it("Multiattack is the first Action, then Attack (with the creature's natural weapons under it); the breath weapon stays an Action", () => {
    const d = barLayout(actionBar({ ...dragon, actions: [...dragon.actions, { name: "Multiattack", text: "The dragon makes two Rend attacks." }] }));
    const actions = d.sections.find((s) => s.id === "action")!.items.map((i) => i.name);
    expect(actions.slice(0, 2)).toEqual(["Multiattack", "Attack"]);
    expect(actions).toContain("Fire Breath");
    expect(d.attackOptions[0]!.name).toBe("Rend");
    expect(d.attackOptions.some((o) => o.name === "Multiattack")).toBe(false);
    expect(d.sections.find((s) => s.id === "legendary")!.items.map((i) => i.name)).toEqual(["Pounce", "Wing Attack"]);
  });
});

describe("Magic reveals the sheet's spells cast with an action and its Magic actions", () => {
  const caster: UnitSheet = { ...dragon, spells: [
    { name: "Fire Bolt (Cantrip)", text: "Ranged spell attack +5 [1d20+5]; 2d10 [2d10] fire. [Action, 120 ft.]" },
    { name: "Misty Step (Level 2)", text: "Teleport. [Bonus Action, Self]" },
    { name: "Shield (Level 1)", text: "+5 AC. [Reaction, Self]" },
    { name: "Alarm (Level 1)", text: "A ward. [1 minute, Ritual, 30 ft.]" },
    ...dragon.spells,
  ], actions: [...dragon.actions, { name: "Change Shape", text: "The dragon shape-shifts (Magic action)… it takes a Magic action to do so." }] };
  const bar = actionBar(caster);
  const l = barLayout(bar);
  it("action spells, creature spell lists and Magic actions under Magic; other spells by their casting time", () => {
    expect(l.magicOptions.map((o) => o.name)).toEqual(["Change Shape", "Fire Bolt", "At Will", "1/Day Each"]);
    const names = (id: string) => l.sections.find((s) => s.id === id)?.items.map((i) => i.name) ?? [];
    expect(names("bonus")).toContain("Misty Step");
    expect(names("reaction")).toContain("Shield");
    expect(names("spell")).toEqual(["Alarm"]);
    expect(names("action")).not.toContain("Fire Bolt");
    expect(names("action")).not.toContain("Change Shape");
    expect(names("action")).toContain("Magic");
  });
  it("the Spells filter still lists every spell, and the Action filter counts what Attack and Magic gather", () => {
    expect(barLayout(bar, "spell").sections[0]!.items.map((i) => i.name)).toEqual(["Fire Bolt", "Misty Step", "Shield", "Alarm", "At Will", "1/Day Each"]);
    const a = barLayout(bar, "action");
    expect(filterCount(bar, "action")).toBe(under(bar, "action").length);
    expect(barLayout(bar, "bonus").magicOptions).toEqual([]);
  });
});

describe("Help reveals first aid (5.5E)", () => {
  it("Stabilize sits under Help in 5.5E, and is its own Action in 5E", () => {
    const l = barLayout(actionBar(brann.sheet));
    expect(l.helpOptions.map((o) => o.name)).toEqual(["Help", "Stabilize"]);
    expect(l.sections.flatMap((s) => s.items).some((i) => i.name === "Stabilize")).toBe(false);
    const old = barLayout(actionBar(brann.sheet, "2014"));
    expect(old.helpOptions).toEqual([]);
    expect(old.sections.find((s) => s.id === "action")!.items.map((i) => i.name)).toContain("Stabilize");
  });
});

describe("the inventory, and actions the sheet rules out", () => {
  const inv = (name: string, text = "", item?: any) => ({ name, text, ...(item ? { item } : {}) });
  const kit = { ...brann.sheet, inventory: [
    inv("Potion of Healing ×2"), inv("Wand of Magic Missiles", "This wand has 7 charges. While holding it, you can take a Magic action to expend 1 or more of its charges."),
    inv("Caltrops (bag of 20)", "As a Utilize action, spread them."), inv("Acid", "Throw a vial."), inv("Ring of Protection (equipped)", "+1 AC and saves."),
    inv("Boots of Speed", "While wearing them, you can take a Bonus Action to click the heels together."), inv("Chain Mail (equipped)", ""),
  ] };
  it("reads what each item is, from D&D Beyond or its name", () => {
    expect(ddbItemInfo({ quantity: 2, definition: { filterType: "Weapon", magic: false, properties: [{ name: "Light" }, { name: "Finesse" }] } }))
      .toEqual({ kind: "weapon", properties: ["Light", "Finesse"], quantity: 2 });
    expect(itemInfo(inv("Potion of Healing ×2"))).toEqual({ kind: "potion", magic: true, quantity: 2 });
    expect(itemInfo(inv("Dagger ×2 (equipped)"))).toMatchObject({ kind: "weapon", properties: ["Light"], quantity: 2 });
    expect(convertDdbCharacter(fighter).sheet.inventory.find((e) => e.name.startsWith("Longsword"))!.item).toMatchObject({ kind: "weapon", properties: ["Versatile", "Sap"] });
  });
  it("puts each usable item under the action that uses it (5.5E)", () => {
    const l = barLayout(actionBar(kit));
    expect(l.reveals["common:Drink or Administer a Potion"]!.map((o) => o.name)).toEqual(["Potion of Healing ×2"]);
    expect(l.magicOptions.map((o) => o.name)).toEqual(["Wand of Magic Missiles"]);
    expect(l.reveals["common:Utilize"]!.map((o) => o.name)).toEqual(["Caltrops (bag of 20)"]);
    expect(l.attackOptions.map((o) => o.name)).toContain("Acid");
    expect(l.sections.find((s) => s.id === "bonus")!.items.map((i) => i.name)).toContain("Boots of Speed");
    const everywhere = [...l.sections.flatMap((s) => s.items), ...Object.values(l.reveals).flat()].map((i) => i.name);
    expect(everywhere).not.toContain("Ring of Protection");
    expect(everywhere).not.toContain("Chain Mail");
  });
  it("5E: magic items and flasks are used with Use an Object", () => {
    const l = barLayout(actionBar(kit, "2014"));
    expect(l.reveals["common:Use an Object"]!.map((o) => o.name)).toEqual(["Wand of Magic Missiles", "Caltrops (bag of 20)", "Acid"]);
    expect(l.reveals["common:Drink a Potion"]!.map((o) => o.name)).toEqual(["Potion of Healing ×2"]);
  });
  it("hides Magic, potions and Two-Weapon Fighting when the sheet has nothing for them (a wolf)", () => {
    const wolf: UnitSheet = { ...dragon, name: "Wolf", traits: [], legendary: [], spells: [], inventory: [], reactions: [],
      actions: [{ name: "Bite", text: "Melee Attack Roll: +4 [1d20+4], reach 5 ft. Hit: 2d4+2 [2d4+2] Piercing damage." }] };
    const names = actionBar(wolf).items.map((i) => i.name);
    expect(names).not.toContain("Magic");
    expect(names).not.toContain("Drink or Administer a Potion");
    expect(names).not.toContain("Two-Weapon Fighting");
    expect(actionBar(wolf, "2014").items.map((i) => i.name)).not.toContain("Cast a Spell");
    expect(names).toContain("Attack");
    // Spells bring Magic back.
    expect(actionBar(dragon).items.map((i) => i.name)).toContain("Magic");
  });
  it("Two-Weapon Fighting needs two Light weapons, and reveals them", () => {
    const duelist = { ...brann.sheet, inventory: [inv("Dagger ×2")],
      actions: [...brann.sheet.actions, { name: "Dagger", text: "Melee Attack Roll: +5 [1d20+5], reach 5 ft. Hit: 1d4+3 [1d4+3] Piercing damage." }] };
    expect(lightWeaponCount(duelist)).toBe(2);
    const l = barLayout(actionBar(duelist));
    expect(l.reveals["common:Two-Weapon Fighting"]!.map((o) => o.name)).toEqual(["Dagger"]);
    expect(l.attackOptions.map((o) => o.name)).toContain("Dagger");
    const goblin: UnitSheet = { ...dragon, inventory: [], actions: [{ name: "Scimitar", text: "+4 [1d20+4]" }, { name: "Shortsword", text: "+4 [1d20+4]" }] };
    expect(lightWeaponCount(goblin)).toBe(2);
  });
});

describe("homebrew actions", () => {
  it("are added, edited and removed, and checked before saving", () => {
    let list = upsertHomebrew([], { name: "Called Shot", cost: "attack", summary: "-5 to hit", text: "Aim for a weak spot." });
    expect(list).toHaveLength(1);
    const id = list[0]!.id;
    list = upsertHomebrew(list, { id, name: "Called Shot", cost: "attack", text: "Aim carefully." });
    expect(list).toEqual([{ id, name: "Called Shot", cost: "attack", text: "Aim carefully." }]);
    expect(() => upsertHomebrew(list, { name: "called shot", cost: "action", text: "" })).toThrow(/already/);
    expect(() => upsertHomebrew(list, { name: " ", cost: "action", text: "" })).toThrow(/name/);
    expect(() => upsertHomebrew(list, { name: "Long", cost: "action", text: "x".repeat(700) })).toThrow(/under/);
    expect(removeHomebrew(list, id)).toEqual([]);
    expect(readHomebrew({ [HOMEBREW_KEY]: [...list, { name: "bad", cost: "teleport" }, null] })).toEqual(list);
  });
  it("show on the bar by their cost, attack ones under Attack", () => {
    const homebrew = upsertHomebrew(upsertHomebrew([], { name: "Called Shot", cost: "attack", text: "Aim." }), { name: "Flourish", cost: "bonus", summary: "+1d4", text: "Twirl." });
    const bar = actionBar(brann.sheet, "2024", { homebrew });
    const l = barLayout(bar);
    expect(l.attackOptions.map((o) => o.name)).toContain("Called Shot");
    const flourish = l.sections.find((s) => s.id === "bonus")!.items.find((i) => i.name === "Flourish")!;
    expect(flourish).toMatchObject({ source: "Homebrew", summary: "+1d4" });
    expect(explain(flourish)).toEqual(["Twirl.", expect.stringMatching(/Bonus Action/), "Homebrew: added by the GM for this room."]);
  });
});
