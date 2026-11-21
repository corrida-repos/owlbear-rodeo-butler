import { describe, expect, it } from "vitest";
import { seededRng } from "../src/core/dice";
import {
  addRolled, band, coinMix, coinValueGp, expectedPurse, gearName, hoardValue, inferGear, lootEligible, lootFields, lootPostText, markPosted,
  partyIncome, planLoot, rarityFor, removeLine, rollMagicItem, rollPurse, THEMES, RARITIES, type Economy,
} from "../src/core/loot";
import { THEME_TABLES } from "../src/core/lootTables";
import { makeNote, rollText } from "../src/core/rolls";

const L5: Economy = { partyLevel: 5, partySize: 4 };
const goblin = { cr: 0.25, type: "Fey (Goblinoid)", treasure: ["implements", "individual"], gear: ["Leather Armor", "Scimitar", "Shield", "Shortbow"] };

describe("who gets loot", () => {
  it("monsters and NPCs, never the party or D&D Beyond characters", () => {
    expect(lootEligible({ kind: "creature" }, { party: false })).toBe(true);
    expect(lootEligible({ kind: "creature" }, { party: true })).toBe(false);
    expect(lootEligible({ kind: "character" }, { party: false })).toBe(false);
  });
});

describe("CR bands and rarity", () => {
  it("uses the DMG's bands", () => {
    expect([undefined, 0, 4, 5, 10, 11, 16, 17, 30].map(band)).toEqual(["0–4", "0–4", "0–4", "5–10", "5–10", "11–16", "11–16", "17+", "17+"]);
  });
  it("reads the DMG Magic Item Rarities table", () => {
    expect([1, 54, 55, 91, 92, 100].map((d) => rarityFor("0–4", d))).toEqual(["Common", "Common", "Uncommon", "Uncommon", "Rare", "Rare"]);
    expect([30, 81, 98, 99].map((d) => rarityFor("5–10", d))).toEqual(["Common", "Uncommon", "Rare", "Very Rare"]);
    expect([11, 34, 70, 93, 94].map((d) => rarityFor("11–16", d))).toEqual(["Common", "Uncommon", "Rare", "Very Rare", "Legendary"]);
    expect([1, 20, 21, 64, 65, 100].map((d) => rarityFor("17+", d))).toEqual(["Rare", "Rare", "Very Rare", "Very Rare", "Legendary", "Legendary"]);
  });
});

describe("generated tables", () => {
  it("every theme and rarity covers 1–100 without gaps", () => {
    for (const t of THEMES) for (const r of RARITIES) {
      const rows = THEME_TABLES[t][r];
      expect(rows[0]!.min, `${t} ${r}`).toBe(1);
      for (let i = 1; i < rows.length; i++) expect(rows[i]!.min, `${t} ${r} row ${i}`).toBe(rows[i - 1]!.max + 1);
      expect(rows[rows.length - 1]!.max).toBe(100);
      for (const row of rows) expect(row.name).not.toMatch(/[{}@|]/);
    }
  });
});

describe("planLoot", () => {
  it("2024 Goblin Warrior: its gear, individual coins and an Implements roll offered", () => {
    const l = planLoot(goblin, L5, seededRng(1));
    expect(l.lines.filter((x) => x.kind === "gear").map((x) => x.text)).toEqual(goblin.gear);
    const coins = l.lines.find((x) => x.kind === "coins")!;
    expect(coins.text).toMatch(/^[\d,]+ (pp|gp|ep|sp|cp)(, [\d,]+ (pp|gp|ep|sp|cp))*$/);
    expect(coins.detail).toMatch(/^Worth .* gp\. Expected .* gp for CR 1\/4 against a level 5 party of 4/);
    expect(l.themes).toEqual(["Implements"]);
    expect(l.any).toBeUndefined();
    expect(new Set(l.lines.map((x) => x.id)).size).toBe(l.lines.length);
  });

  it("Treasure: Any (Bandit Captain) has money and lets the GM pick any theme", () => {
    const l = planLoot({ cr: 2, treasure: ["any"], gear: ["Scimitar"] }, L5, seededRng(2));
    expect(l.any).toBe(true);
    expect(l.themes).toEqual([...THEMES]);
    expect(l.lines.map((x) => x.kind)).toEqual(["gear", "coins"]);
    expect(l.lines[1]!.text).toMatch(/\d+ gp/);
  });

  it("every themed Treasure line comes with money", () => {
    for (const t of ["arcana", "armaments", "implements", "relics"]) {
      expect(planLoot({ cr: 12, type: "Fiend", treasure: [t] }, L5, seededRng(5)).lines.map((x) => x.kind)).toEqual(["coins"]);
    }
  });

  it("an empty Treasure line still has money unless it's a beast-like creature", () => {
    expect(planLoot({ cr: 5, type: "Undead", treasure: [] }, L5, seededRng(3)).lines.map((x) => x.kind)).toEqual(["coins"]);
  });

  it("a 2024 beast whose book lists no treasure gets nothing", () => {
    const l = planLoot({ cr: 0.25, type: "Beast", treasure: [] }, L5, seededRng(3));
    expect(l.lines).toEqual([]);
    expect(l.themes).toEqual([]);
    expect(l.note).toMatch(/no treasure/);
  });

  it("without a Gear line, gear comes from its armor and weapon attacks", () => {
    const goblin2014 = {
      cr: 0.25, type: "Humanoid (Goblinoid)", flags: ["AC source: leather armor, shield."],
      actions: [{ name: "Scimitar", text: "" }, { name: "Shortbow", text: "" }, { name: "Bite", text: "" }, { name: "Multiattack", text: "" }],
    };
    const l = planLoot(goblin2014, L5, seededRng(6));
    expect(l.lines.filter((x) => x.kind === "gear").map((x) => x.text)).toEqual(["Leather Armor", "Shield", "Scimitar", "Shortbow"]);
    expect(l.lines[0]!.detail).toMatch(/from its armor and attacks/);
    expect(inferGear({ acNote: "studded leather", actions: [{ name: "Longsword (Two-Handed)", text: "" }, { name: "Longsword", text: "" }, { name: "Bone Bow", text: "" }] }))
      .toEqual(["Studded Leather Armor", "Longsword"]);
    expect(inferGear({ flags: ["AC source: half plate, shield."] })).toEqual(["Half Plate Armor", "Shield"]);
    expect(inferGear({ flags: ["AC source: natural armor."], actions: [{ name: "Claw", text: "" }] })).toEqual([]);
  });

  it("a stat block's Gear line wins over inferred gear", () => {
    const l = planLoot({ ...goblin, actions: [{ name: "Dagger", text: "" }] }, L5, seededRng(6));
    expect(l.lines.filter((x) => x.kind === "gear").map((x) => x.text)).toEqual(goblin.gear);
  });

  it("without a Treasure line: beasts carry nothing, others carry money", () => {
    expect(planLoot({ cr: 1, type: "Swarm of Tiny Beasts" }, L5, seededRng(4)).lines).toEqual([]);
    expect(planLoot({ cr: 1, type: "Ooze" }, L5, seededRng(4)).note).toMatch(/Ooze/);
    const l = planLoot({ cr: 3, type: "Humanoid (Human)" }, L5, seededRng(4));
    expect(l.lines).toHaveLength(1);
    expect(l.lines[0]!.kind).toBe("coins");
  });
});

describe("money", () => {
  const average = (cr: number, e: Economy, n = 2000) => {
    const rng = seededRng(11);
    let sum = 0;
    for (let i = 0; i < n; i++) sum += coinValueGp(Object.fromEntries(rollPurse(cr, e, rng).text.split(", ").map((p) => { const [c, k] = p.split(" "); return [k, Number(c!.replace(/,/g, ""))]; })));
    return sum / n;
  };

  it("the party's coin per level: a 2024 DMG hoard per session plus a quest reward, purses on top", () => {
    expect(hoardValue(2.5)).toBeCloseTo(500, 5);
    expect(hoardValue(7.5)).toBeCloseTo(4400, 5);
    expect(hoardValue(13.5)).toBeCloseTo(36000, 5);
    expect(hoardValue(18.5)).toBeCloseTo(330000, 5);
    for (let l = 2; l <= 20; l++) expect(hoardValue(l)).toBeGreaterThan(hoardValue(l - 1));
    const i3 = partyIncome(3);
    expect(i3.hoardsAndQuests).toBeCloseTo(hoardValue(3) * 3, 5); // two sessions and one quest
    expect(i3.purses / (i3.purses + i3.hoardsAndQuests)).toBeCloseTo(0.2, 5);
  });

  it("a purse is the monster's XP share of the purses found over the level, never more than a hoard", () => {
    // Level 5, party of 4: 1,483 gp hoards × 3 → 4,450; purses 1,112; XP over level 5 is 7,500 each, 30,000 in all.
    expect(expectedPurse(5, L5)).toBeCloseTo(1800 * partyIncome(5).purses / 30000, 5);
    expect(expectedPurse(2, { partyLevel: 5, partySize: 8 })).toBeCloseTo(expectedPurse(2, L5) / 2, 5);
    expect(expectedPurse(30, { partyLevel: 3, partySize: 4 })).toBe(hoardValue(3));
  });

  it("grows with CR, and a weak monster carries little whatever the party's level", () => {
    const crs = [0, 0.125, 0.25, 0.5, 1, 2, 3, 4, 5, 6, 8, 10, 11, 13, 16, 17, 20, 24, 30];
    const atOwnLevel = crs.map((cr) => expectedPurse(cr));
    for (let i = 1; i < crs.length; i++) expect(atOwnLevel[i]!, `CR ${crs[i]}`).toBeGreaterThan(atOwnLevel[i - 1]!);
    expect(expectedPurse(0.25)).toBeGreaterThan(2);
    expect(expectedPurse(0.25)).toBeLessThan(10);
    expect(expectedPurse(0.125, { partyLevel: 15, partySize: 4 })).toBeLessThan(15);
    // Against the same party, a tougher monster carries more.
    for (const [lo, hi] of [[0.25, 1], [1, 5], [5, 10]]) expect(expectedPurse(hi!, L5)).toBeGreaterThan(expectedPurse(lo!, L5));
  });

  it("rolled purses average about the expected value", () => {
    for (const cr of [0.25, 2, 10]) {
      const avg = average(cr, L5);
      expect(avg / expectedPurse(cr, L5), `CR ${cr}`).toBeGreaterThan(0.85);
      expect(avg / expectedPurse(cr, L5), `CR ${cr}`).toBeLessThan(1.15);
    }
  });

  it("coins come in believable mixes", () => {
    const rng = seededRng(5);
    const kinds = new Set<string>();
    for (let i = 0; i < 300; i++) {
      const v = 0.5 + rng() * 20000;
      const c = coinMix(v, rng);
      const ks = Object.keys(c);
      ks.forEach((k) => kinds.add(k));
      expect(ks.length).toBeGreaterThanOrEqual(1);
      expect(ks.length).toBeLessThanOrEqual(3);
      expect(Math.abs(coinValueGp(c) - v) / v, `value ${v}`).toBeLessThan(0.1);
      // Copper never piles up in a rich purse, and the smallest coin is just change.
      if (v > 100) expect(c.cp ?? 0).toBe(0);
    }
    expect([...kinds].sort()).toEqual(["cp", "ep", "gp", "pp", "sp"]);
    expect(Object.keys(coinMix(0.05, rng))).toEqual(["cp"]);
  });

  it("says how the money was worked out", () => {
    const d = rollPurse(2, { partyLevel: 3, partySize: 4 }, seededRng(1)).detail!;
    expect(d).toMatch(/^Worth [\d.,]+ gp\. Expected [\d.,]+ gp for CR 2 against a level 3 party of 4, whose coin at this level is ~1,864 gp from hoards and quests plus 20% from monsters/);
    expect(rollPurse(2, {}, seededRng(1)).detail).toMatch(/CR used as the level: no party in the scene/);
  });
});

describe("rolls", () => {
  it("magic items come from the theme's table, at a rarity the CR band allows", () => {
    for (let s = 0; s < 50; s++) {
      const low = rollMagicItem("Arcana", 1, seededRng(s));
      expect(low.kind).toBe("item");
      expect(low.text).toMatch(/\((Common|Uncommon|Rare)\)$/);
      expect(low.detail).toMatch(/^2024 DMG Arcana – /);
      const high = rollMagicItem("Relics", 20, seededRng(s));
      expect(high.text).toMatch(/\((Rare|Very Rare|Legendary)\)$/);
    }
  });

  it("a row listing variants rolls one of them", () => {
    const names = new Set<string>();
    for (let s = 0; s < 400; s++) names.add(rollMagicItem("Arcana", 1, seededRng(s)).text);
    expect([...names].some((n) => /^Spell Scroll \((Cantrip|Level 1)\) \(Common\)$/.test(n))).toBe(true);
    expect([...names].some((n) => /^Spell Scroll \(/.test(n) && !/Cantrip|Level/.test(n))).toBe(false);
  });
});

describe("GM choices", () => {
  const base = planLoot({ cr: 2, treasure: ["any"] }, L5, seededRng(9));
  const item = rollMagicItem("Armaments", 2, seededRng(9), "x1");

  it("picking a theme for Any ends the choice (one roll per monster)", () => {
    const l = addRolled(base, item, "Armaments");
    expect(l.themes).toEqual([]);
    expect(l.any).toBeUndefined();
    expect(l.lines.at(-1)!.id).toBe("x1");
  });

  it("a listed theme is used up", () => {
    const l = addRolled({ lines: [], themes: ["Arcana", "Relics"] }, item, "Arcana");
    expect(l.themes).toEqual(["Relics"]);
  });

  it("removing and posting lines", () => {
    const l = { lines: [{ id: "a", kind: "gear" as const, text: "Scimitar" }, { id: "b", kind: "coins" as const, text: "7 gp" }], themes: [] };
    expect(removeLine(l, "a").lines.map((x) => x.id)).toEqual(["b"]);
    expect(markPosted(l, ["b"]).lines.map((x) => !!x.posted)).toEqual([false, true]);
  });

  it("the posted text", () => {
    const lines = [{ id: "a", kind: "gear" as const, text: "Scimitar" }, { id: "b", kind: "coins" as const, text: "7 gp" }];
    expect(lootPostText("Goblin 2", lines)).toBe("Loot from Goblin 2: Scimitar, 7 gp");
    expect(lootPostText("Goblin 2", lines, "Aria")).toBe("Aria takes Scimitar, 7 gp from Goblin 2");
  });

  it("is posted as a roll-log note, without a total", () => {
    const n = makeNote("Loot from Goblin 2: 7 gp", { id: "gm", name: "GM", role: "GM" }, "public", { newId: () => "n1", now: () => new Date(0) });
    expect(n.note).toBe(true);
    expect(rollText(n)).toBe("Loot from Goblin 2: 7 gp");
  });
});

describe("5etools fields", () => {
  it("Gear names", () => {
    expect(gearName("studded leather armor|xphb")).toBe("Studded Leather Armor");
    expect(gearName({ item: "arrow|xphb", quantity: 20 })).toBe("Arrow ×20");
    expect(gearName("potion of healing|xdmg")).toBe("Potion of Healing");
    expect(gearName(42)).toBeNull();
  });

  it("Treasure and Gear from a raw monster", () => {
    expect(lootFields({ source: "XMM", treasure: ["implements", "individual"], gear: ["scimitar|xphb"] })).toEqual({ treasure: ["implements", "individual"], gear: ["Scimitar"] });
    expect(lootFields({ source: "XMM" })).toEqual({ treasure: [] });
    expect(lootFields({ source: "MM" })).toEqual({});
  });
});
