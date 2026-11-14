import { describe, expect, it } from "vitest";
import fighter from "./fixtures/ddb-synthetic-fighter.json";
import { convertDdbCharacter, fitSheet, inventoryEntries, noteEntries } from "../src/core/ddb";
import { itemActions } from "../src/core/actions";
import { itemDetails } from "../src/core/items";
import { coinsText, validateSheet } from "../src/core/sheet";
import { partyFromDdbExport } from "../src/core/party";

const base: any = JSON.parse(JSON.stringify(fighter));
const long = "A long description. ".repeat(60); // 1,200 characters

const rich: any = {
  ...base,
  id: 5001,
  classes: base.classes.map((k: any) => ({ ...k, hitDiceUsed: 1, definition: { ...k.definition, hitDice: 10 } })),
  currencies: { cp: 3, sp: 0, ep: 0, gp: 42, pp: 1 },
  inventory: [
    ...base.inventory,
    { id: 900, equipped: false, quantity: 1, containerEntityId: 5001, definition: { id: 9000, name: "Backpack", filterType: "Other Gear", isContainer: true, weight: 5 } },
    { id: 901, equipped: false, quantity: 2, containerEntityId: 900, definition: { id: 9001, name: "Potion of Greater Healing", filterType: "Potion", magic: true, rarity: "Common", description: "<p>You regain 2d4 + 2 Hit Points.</p>" } },
    { id: 902, equipped: false, quantity: 1, containerEntityId: 900, notes: "Found in the crypt", limitedUse: { maxUses: 7, numberUsed: 2, resetType: 3 },
      definition: { id: 9002, name: "Wand of Magic Missiles", filterType: "Wand", magic: true, rarity: "Uncommon", description: `<p>${long}</p>` } },
    { id: 903, equipped: false, quantity: 1, containerEntityId: 5001, definition: { id: 9003, name: "Cloak of Elvenkind", filterType: "Wondrous item", magic: true, rarity: "Uncommon", canAttune: true, weight: 1, description: "+1 AC and saves." } },
  ],
  customItems: [{ id: 1, name: "Grandfather's Locket", description: "<p>A silver locket.</p>", quantity: 1, weight: 0.5, notes: "Opens with a click" }],
  background: { hasCustomBackground: false, definition: { name: "Soldier", shortDescription: "<p>War was your life.</p>", featureName: "Military Rank", featureDescription: "<p>Soldiers defer to you.</p>" } },
  traits: { personalityTraits: "I'm always polite.", ideals: "Greater Good", bonds: "My company", flaws: "I obey blindly.", appearance: "<p>Scar over one eye.</p>" },
  notes: { backstory: "<p>Born in the hills.</p>", allies: "The Order", enemies: null, organizations: "", otherNotes: "Owes 10 gp to Mira" },
  age: 54, height: "4'5\"", weight: 160, eyes: "Grey", hair: null, faith: "Moradin", currentXp: 900,
};
const party = {
  partyItems: [
    { id: 950, equipped: false, quantity: 3, definition: { id: 9500, name: "Caltrops", filterType: "Other Gear" } },
    { id: 951, equipped: true, equippedEntityId: 777, quantity: 1, definition: { id: 9501, name: "Shield +1", filterType: "Armor" } },
  ],
  currency: { gp: 120, sp: 5 },
  modifiers: { item: [] },
};

describe("D&D Beyond sync keeps the whole sheet", () => {
  const m = convertDdbCharacter(rich, { partyInventory: party });
  const inv = m.sheet.inventory;
  const named = (n: string) => inv.find((e) => e.name.startsWith(n))!;

  it("keeps every item, says which container it's in, and puts carried items first", () => {
    expect(named("Backpack").item?.container).toBeUndefined();
    expect(named("Potion of Greater Healing ×2").item).toMatchObject({ kind: "potion", container: "Backpack", quantity: 2 });
    const order = inv.map((e) => e.name);
    expect(order.indexOf("Cloak of Elvenkind")).toBeLessThan(order.indexOf("Potion of Greater Healing ×2"));
  });

  it("item charges, notes, rarity, attunement, weight, and the full description", () => {
    const wand = named("Wand of Magic Missiles");
    expect(wand.item).toMatchObject({ kind: "wand", charges: { max: 7, used: 2, reset: "Dawn" }, rarity: "Uncommon" });
    expect(wand.text).toContain("Charges: 5/7 (regain: Dawn).");
    expect(wand.text).toContain("Notes: Found in the crypt");
    expect(wand.text.length).toBeGreaterThan(1000); // no longer cut at 300 characters
    expect(itemDetails(named("Cloak of Elvenkind").item)).toBe("Uncommon · requires attunement · 1 lb.");
    expect(itemDetails(wand.item)).toBe("in Backpack · Uncommon");
  });

  it("custom items, the party's shared stash and coins", () => {
    const locket = named("Grandfather's Locket");
    expect(locket.item).toMatchObject({ custom: true, weight: 0.5 });
    expect(locket.text).toBe("A silver locket.\nNotes: Opens with a click");
    expect(named("Caltrops ×3").item).toMatchObject({ party: true, container: "Party inventory" });
    expect(inv.some((e) => e.name.startsWith("Shield +1"))).toBe(false); // equipped by someone else: on their sheet
    expect(named("Party coins").text).toBe("120 gp, 5 sp");
    expect(m.sheet.currency).toEqual({ cp: 3, sp: 0, ep: 0, gp: 42, pp: 1 });
    expect(coinsText(m.sheet.currency)).toBe("1 pp, 42 gp, 3 cp");
  });

  it("items still land on the action bar (potion, wand, caltrops from the stash)", () => {
    const names = itemActions(m.sheet, "2024").map((a) => a.name);
    expect(names).toEqual(expect.arrayContaining(["Potion of Greater Healing ×2", "Wand of Magic Missiles", "Caltrops ×3"]));
  });

  it("background, personality, appearance, notes, proficiencies and hit dice", () => {
    const notes = m.sheet.notes!;
    expect(notes.map((n) => n.name)).toEqual(["Background: Soldier", "Personality Traits", "Ideals", "Bonds", "Flaws", "Appearance", "Faith",
      "Experience Points", "Backstory", "Allies", "Other Notes"]);
    expect(notes[0]!.text).toBe("War was your life.\nMilitary Rank. Soldiers defer to you.");
    expect(notes.find((n) => n.name === "Appearance")!.text).toBe("Age 54, Height 4'5\", Weight 160 lb., Eyes Grey\nScar over one eye.");
    expect(m.sheet.hitDice).toBe("3d10 (1 used)");
    expect(validateSheet(m.sheet)).toEqual([]);
  });

  it("a character without any of it gets no empty extras", () => {
    const plain = convertDdbCharacter(base);
    expect(plain.sheet.currency).toBeUndefined();
    expect(plain.sheet.notes).toBeUndefined();
    expect(noteEntries({})).toEqual([]);
    expect(inventoryEntries({ id: 1 }, [], null)).toEqual([]);
  });

  it("an old export (only equipped party items) still converts", () => {
    const p = partyFromDdbExport({ schema: "owlbear-butler/ddb-export@1", campaign: { name: "C" }, characters: [rich], partyInventory: { partyItems: [party.partyItems[1]], modifiers: { item: [] } } });
    expect(p.members[0]!.sheet.inventory.some((e) => e.item?.party)).toBe(false);
  });

  it("only a sheet over the size budget has its longest texts shortened, with a flag", () => {
    expect(m.sheet.flags.join(" ")).not.toMatch(/shortened/);
    const flags: string[] = [];
    const fitted = fitSheet({ ...m.sheet, flags }, flags, 4000);
    expect(named("Wand of Magic Missiles").text.length).toBeGreaterThan(1000);
    expect(fitted.inventory.find((e) => e.name.startsWith("Wand"))!.text.length).toBeLessThanOrEqual(1001);
    expect(flags.join(" ")).toMatch(/shortened/);
    expect(fitted.flags.filter((f) => /shortened/.test(f))).toHaveLength(1);
  });

  it("validation rejects malformed extras", () => {
    expect(validateSheet({ ...m.sheet, notes: [{ name: 1 }] })).toContain("notes: array of {name, text}");
    expect(validateSheet({ ...m.sheet, currency: { gp: "x" } })).toContain("currency: numbers");
  });
});
