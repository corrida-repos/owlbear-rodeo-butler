import { describe, expect, it } from "vitest";
import { seededRng } from "../src/core/dice";
import {
  addRolled, band, coinMix, coinValueGp, coinWeightLb, expectedPurse, gemText, itemChance, itemValue, rollThemeItem, lootBudget, lootValue, purseCap, rarityWithin, splitGems, gearName, hoardValue, inferGear, lootEligible, lootFields, lootPostText, markPosted,
  partyIncome, planLoot, rarityFor, removeLine, rollMagicItem, rollPurse, THEMES, RARITIES, type Economy,
} from "../src/core/loot";
import { GEMSTONES, THEME_TABLES } from "../src/core/lootTables";
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
    expect(coins.detail).toMatch(/^Worth .* gp \(.* lb\)\. Expected .* gp for CR 1\/4 against a level 5 party of 4/);
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

/** A purse's worth from its lines: "63 pp, 6 gp" plus "Gems: 2 × Ruby (5,000 gp each), Onyx (50 gp)". */
function purseValue(lines: { kind: string; text: string }[]): number {
  let v = 0;
  for (const l of lines) {
    if (l.kind === "coins") v += coinValueGp(Object.fromEntries(l.text.split(", ").map((p) => { const [c, k] = p.split(" "); return [k, Number(c!.replace(/,/g, ""))]; })));
    if (l.kind === "gems") for (const m of l.text.matchAll(/(?:(\d+) × )?[^,(]+\(([\d,]+) gp/g)) v += Number(m[1] ?? 1) * Number(m[2]!.replace(/,/g, ""));
  }
  return v;
}

describe("money", () => {
  const average = (cr: number, e: Economy, n = 2000) => {
    const rng = seededRng(11);
    let sum = 0;
    for (let i = 0; i < n; i++) sum += purseValue(rollPurse(cr, e, rng));
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

  it("coins are light: the bulk in the best coin there are three of, then at most nine of each smaller coin", () => {
    const rng = seededRng(5);
    const kinds = new Set<string>();
    for (let i = 0; i < 400; i++) {
      const v = i % 4 === 0 ? 0.05 + rng() * 9 : 0.05 + rng() * rng() * 30000;
      const c = coinMix(v, rng);
      Object.keys(c).forEach((k) => kinds.add(k));
      const order = ["pp", "gp", "ep", "sp", "cp"].filter((k) => c[k as keyof typeof c]);
      for (const k of order.slice(1)) expect(c[k as keyof typeof c]!, `${k} in ${JSON.stringify(c)}`).toBeLessThanOrEqual(k === "ep" ? 1 : 9);
      // The value is kept (rounded to the silver above 10 gp, the gold above 100 gp).
      expect(Math.abs(coinValueGp(c) - v), `value ${v}`).toBeLessThanOrEqual(v >= 100 ? 0.5 : v >= 10 ? 0.05 : 0.005);
      // As light as change-making allows: never more than a pound beyond the bulk coin's own weight.
      const bulk = c[order[0] as keyof typeof c]!;
      expect(coinWeightLb(c) - bulk / 50).toBeLessThanOrEqual(1);
      if (v >= 30) expect(order[0]).toBe("pp");
    }
    expect([...kinds].sort()).toEqual(["cp", "ep", "gp", "pp", "sp"]);
    expect(coinMix(0.05, rng)).toEqual({ cp: 5 });
    expect(coinMix(2.5, rng)).toEqual({ sp: 25 });
    expect(coinMix(1234.4, rng)).toEqual({ pp: 123, gp: 4 });
  });

  it("small purses are all coins", () => {
    expect(splitGems(500, seededRng(1))).toEqual({ coinsGp: 500, gems: [] });
    for (let s = 0; s < 50; s++) expect(rollPurse(1, L5, seededRng(s)).map((l) => l.kind)).toEqual(["coins"]);
  });

  it("a large purse holds part of its value in 2024 DMG gemstones", () => {
    const allNames = new Set(Object.values(GEMSTONES).flat());
    for (let s = 0; s < 200; s++) {
      const rng = seededRng(s);
      const v = 501 + rng() * rng() * 400000;
      const { coinsGp, gems } = splitGems(v, rng);
      expect(coinsGp + gems.reduce((a, g) => a + g.value, 0)).toBeCloseTo(v, 6);
      // Coins: at least 100 gp of spending money, never more than 4,000 gp (8 lb of platinum).
      expect(coinsGp).toBeGreaterThanOrEqual(100);
      expect(coinsGp).toBeLessThanOrEqual(4050);
      expect(gems.length).toBeGreaterThan(0);
      for (const g of gems) {
        expect(g.value).toBeGreaterThanOrEqual(50);
        expect(GEMSTONES[g.value]).toContain(g.name);
        expect(allNames.has(g.name)).toBe(true);
      }
      // Most valuable stones that fit: never several smaller stones where one bigger would do, beyond the variety steps.
      if (v > 20000) expect(gems.filter((g) => g.value === 5000).length).toBeGreaterThan(0);
    }
  });

  it("gems are grouped, most valuable first, and the purse adds up", () => {
    expect(gemText([{ value: 100, name: "Jet" }, { value: 5000, name: "Ruby" }, { value: 100, name: "Jet" }, { value: 50, name: "Onyx" }]))
      .toBe("Ruby (5,000 gp), 2 × Jet (100 gp each), Onyx (50 gp)");
    const lines = rollPurse(17, { partyLevel: 17, partySize: 4 }, seededRng(2));
    expect(lines.map((l) => l.kind)).toEqual(["coins", "gems"]);
    expect(lines[1]!.text).toMatch(/^Gems: /);
    expect(lines[0]!.detail).toMatch(/the purse's other [\d,]+ gp is in gemstones/);
    expect(lines[1]!.detail).toMatch(/gemstones? worth [\d,]+ gp \(2024 DMG gemstone tables\)/);
    expect(new Set(lines.map((l) => l.id)).size).toBe(2);
  });

  it("the whole loot stays within what a monster of its CR should be worth", () => {
    // The DMG's hoard for one monster, by its CR (smoothed): a goblin's loot is worth a few hundred gp at most.
    expect(lootBudget(0.25)).toBeCloseTo(hoardValue(1), 5);
    expect(lootBudget(10)).toBeCloseTo(hoardValue(10), 5);
    expect(lootBudget(30)).toBeCloseTo(hoardValue(20), 5);
    // A strong party doesn't make weak monsters rich: the purse is capped by the monster's own CR.
    expect(purseCap(2)).toBeCloseTo(2 * expectedPurse(2, {}), 5);
    for (let s = 0; s < 100; s++) {
      const lines = rollPurse(2, { partyLevel: 20, partySize: 4 }, seededRng(s));
      expect(purseValue(lines)).toBeLessThanOrEqual(purseCap(2) + 0.5);
      expect(lines.reduce((v, l) => v + (l.valueGp ?? 0), 0)).toBeCloseTo(purseValue(lines), 1);
    }
    expect(rollPurse(2, { partyLevel: 20, partySize: 4 }, seededRng(1))[0]!.detail).toMatch(/capped at 75 gp, the most a CR 2 monster carries/);
    // Purse plus the best item that still fits never passes the budget, at any CR.
    for (const cr of [0.125, 0.25, 1, 2, 4, 5, 8, 10, 13, 17, 20, 30]) {
      for (let s = 0; s < 30; s++) {
        let loot = planLoot({ cr, type: "Humanoid", treasure: ["any"] }, { partyLevel: 20, partySize: 4 }, seededRng(s));
        const item = rollMagicItem("Arcana", cr, seededRng(s + 1), "i", lootBudget(cr) - lootValue(loot));
        if (item) loot = addRolled(loot, item, "Arcana");
        expect(lootValue(loot), `CR ${cr}`).toBeLessThanOrEqual(lootBudget(cr) + 0.5);
      }
    }
    // Gear doesn't count.
    expect(lootValue({ lines: [{ id: "g", kind: "gear", text: "Plate Armor" }, { id: "c", kind: "coins", text: "5 gp", valueGp: 5 }] })).toBe(5);
  });

  it("says how the money was worked out", () => {
    const d = rollPurse(2, { partyLevel: 3, partySize: 4 }, seededRng(1))[0]!.detail!;
    expect(d).toMatch(/^Worth [\d.,]+ gp \((under 1|[\d.]+) lb\)\. Expected [\d.,]+ gp for CR 2 against a level 3 party of 4, whose coin at this level is ~1,864 gp from hoards and quests plus 20% from monsters/);
    expect(rollPurse(2, {}, seededRng(1))[0]!.detail).toMatch(/CR used as the level: no party in the scene/);
  });
});

describe("rolls", () => {
  it("magic items come from the theme's table, at a rarity the CR band allows", () => {
    for (let s = 0; s < 50; s++) {
      const low = rollMagicItem("Arcana", 1, seededRng(s))!;
      expect(low.kind).toBe("item");
      expect(low.text).toMatch(/\((Common|Uncommon|Rare)\)$/);
      expect(low.detail).toMatch(/^Worth [\d,]+ gp\. 2024 DMG Arcana – /);
      const high = rollMagicItem("Relics", 20, seededRng(s))!;
      expect(high.text).toMatch(/\((Rare|Very Rare|Legendary)\)$/);
    }
  });

  it("an item's rarity is lowered to fit the budget, and none comes when not even a Common one fits", () => {
    for (let s = 0; s < 100; s++) {
      const l = rollMagicItem("Relics", 20, seededRng(s), "x", 5000)!;
      expect(l.text).toMatch(/\((Common|Uncommon|Rare)\)$/);
      expect(l.valueGp!).toBeLessThanOrEqual(5000);
    }
    const lowered = [...Array(100).keys()].map((s) => rollMagicItem("Relics", 20, seededRng(s), "x", 5000)!).find((l) => /lowered/.test(l.detail!));
    expect(lowered!.detail).toMatch(/rolled (Very Rare|Legendary) but lowered to fit what a CR 20 monster's loot should be worth/);
    expect(rollMagicItem("Arcana", 1, seededRng(1), "x", 99)).toBeNull();
    expect(rarityWithin(99)).toBeNull();
    expect(rarityWithin(400)).toBe("Uncommon");
    expect(rarityWithin(1e9)).toBe("Legendary");
  });

  it("low-CR monsters seldom carry a magic item", () => {
    expect([0, 0.25, 2, 5, 10, 20, 30].map((cr) => Math.round(itemChance(cr) * 100))).toEqual([10, 11, 18, 30, 50, 90, 90]);
    const found = (cr: number) => {
      let n = 0;
      for (let s = 0; s < 1000; s++) if (rollThemeItem({ lines: [], themes: ["Arcana"] }, "Arcana", cr, seededRng(s)).lines.length) n++;
      return n / 1000;
    };
    const low = found(0.25), mid = found(5), high = found(20);
    expect(low).toBeGreaterThan(0.07);
    expect(low).toBeLessThan(0.15);
    expect(mid).toBeGreaterThan(0.25);
    expect(mid).toBeLessThan(0.35);
    expect(high).toBeGreaterThan(0.86);
  });

  it("a theme roll is used up either way; a miss is noted", () => {
    let miss = null, hit = null;
    for (let s = 0; s < 200 && !(miss && hit); s++) {
      const l = rollThemeItem({ lines: [], themes: ["Arcana", "Relics"] }, "Arcana", 2, seededRng(s));
      expect(l.themes).toEqual(["Relics"]);
      if (l.lines.length) hit = l; else miss = l;
    }
    expect(miss!.misses).toEqual([expect.stringMatching(/^Arcana: no magic item \(d100 \d+, needed 18 or less for CR 2\)$/)]);
    expect(hit!.lines[0]!.detail).toMatch(/found on d100 \d+ \(18% chance for CR 2\)$/);
    // Over budget: no item even on a hit.
    const outcomes = [...Array(200).keys()].map((s) => rollThemeItem({ lines: [{ id: "c", kind: "coins", text: "20 pp", valueGp: 200 }], themes: ["Arcana"] }, "Arcana", 0.25, seededRng(s)));
    for (const o of outcomes) expect(o.lines).toHaveLength(1);
    expect(outcomes.some((o) => /already worth as much as a CR 1\/4 monster should carry/.test(o.misses![0]!))).toBe(true);
  });

  it("item values follow the 2024 DMG", () => {
    expect(itemValue("Cloak of Billowing", "Common")).toBe(100);
    expect(itemValue("Flame Tongue", "Rare")).toBe(4000);
    expect(itemValue("Potion of Giant Strength", "Rare")).toBe(2000);
    expect(itemValue("+2 Ammunition", "Rare")).toBe(2000);
    expect(itemValue("Spell Scroll (Cantrip)", "Common")).toBe(30);
    expect(itemValue("Spell Scroll (Level 3)", "Uncommon")).toBe(300);
    expect(itemValue("Spell Scroll (Level 9)", "Legendary")).toBe(100000);
    expect(itemValue("Spell Scroll (level 9 spell)", "Legendary")).toBe(100000);
  });

  it("a row listing variants rolls one of them", () => {
    const names = new Set<string>();
    for (let s = 0; s < 400; s++) names.add(rollMagicItem("Arcana", 1, seededRng(s))!.text);
    expect([...names].some((n) => /^Spell Scroll \((Cantrip|Level 1)\) \(Common\)$/.test(n))).toBe(true);
    expect([...names].some((n) => /^Spell Scroll \(/.test(n) && !/Cantrip|Level/.test(n))).toBe(false);
  });
});

describe("GM choices", () => {
  const base = planLoot({ cr: 2, treasure: ["any"] }, L5, seededRng(9));
  const item = rollMagicItem("Armaments", 2, seededRng(9), "x1")!;

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
