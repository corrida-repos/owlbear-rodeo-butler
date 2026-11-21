import { describe, expect, it } from "vitest";
import { seededRng } from "../src/core/dice";
import {
  addRolled, band, coinScale, gearName, inferGear, lootEligible, lootFields, lootPostText, markPosted, planLoot, rarityFor, removeLine, rollCoins, rollMagicItem,
  THEMES, RARITIES,
} from "../src/core/loot";
import { INDIVIDUAL_2014, INDIVIDUAL_2024, THEME_TABLES } from "../src/core/lootTables";
import { makeNote, rollText } from "../src/core/rolls";

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
  it("individual treasure covers CR 0–30 in both editions", () => {
    for (const t of [INDIVIDUAL_2014, INDIVIDUAL_2024]) {
      expect(t.map((b) => [b.crMin, b.crMax])).toEqual([[0, 4], [5, 10], [11, 16], [17, 30]]);
      for (const b of t) expect(b.rows[b.rows.length - 1]!.max).toBe(100);
    }
  });
});

describe("planLoot", () => {
  it("2024 Goblin Warrior: its gear, individual coins and an Implements roll offered", () => {
    const l = planLoot(goblin, "2024", seededRng(1));
    expect(l.lines.filter((x) => x.kind === "gear").map((x) => x.text)).toEqual(goblin.gear);
    const coins = l.lines.find((x) => x.kind === "coins")!;
    // 3d6 gp scaled to CR 1/4 (× 0.5): 2–9 gp.
    const gp = Number(/^(\d+) gp$/.exec(coins.text)![1]);
    expect(gp).toBeGreaterThanOrEqual(1);
    expect(gp).toBeLessThanOrEqual(9);
    expect(coins.detail).toMatch(/2024 DMG Individual Treasure, CR 0–4: 3d6/);
    expect(l.themes).toEqual(["Implements"]);
    expect(l.any).toBeUndefined();
    expect(new Set(l.lines.map((x) => x.id)).size).toBe(l.lines.length);
  });

  it("Treasure: Any (Bandit Captain) has money and lets the GM pick any theme", () => {
    const l = planLoot({ cr: 2, treasure: ["any"], gear: ["Scimitar"] }, "2024", seededRng(2));
    expect(l.any).toBe(true);
    expect(l.themes).toEqual([...THEMES]);
    expect(l.lines.map((x) => x.kind)).toEqual(["gear", "coins"]);
    expect(l.lines[1]!.text).toMatch(/^\d+ gp$/);
  });

  it("every themed Treasure line comes with money", () => {
    for (const t of ["arcana", "armaments", "implements", "relics"]) {
      expect(planLoot({ cr: 12, type: "Fiend", treasure: [t] }, "2024", seededRng(5)).lines.map((x) => x.kind)).toEqual(["coins"]);
    }
  });

  it("an empty Treasure line still has money unless it's a beast-like creature", () => {
    expect(planLoot({ cr: 5, type: "Undead", treasure: [] }, "2024", seededRng(3)).lines.map((x) => x.kind)).toEqual(["coins"]);
  });

  it("a 2024 beast whose book lists no treasure gets nothing", () => {
    const l = planLoot({ cr: 0.25, type: "Beast", treasure: [] }, "2024", seededRng(3));
    expect(l.lines).toEqual([]);
    expect(l.themes).toEqual([]);
    expect(l.note).toMatch(/no treasure/);
  });

  it("without a Gear line, gear comes from its armor and weapon attacks", () => {
    const goblin2014 = {
      cr: 0.25, type: "Humanoid (Goblinoid)", flags: ["AC source: leather armor, shield."],
      actions: [{ name: "Scimitar", text: "" }, { name: "Shortbow", text: "" }, { name: "Bite", text: "" }, { name: "Multiattack", text: "" }],
    };
    const l = planLoot(goblin2014, "2014", seededRng(6));
    expect(l.lines.filter((x) => x.kind === "gear").map((x) => x.text)).toEqual(["Leather Armor", "Shield", "Scimitar", "Shortbow"]);
    expect(l.lines[0]!.detail).toMatch(/from its armor and attacks/);
    expect(inferGear({ acNote: "studded leather", actions: [{ name: "Longsword (Two-Handed)", text: "" }, { name: "Longsword", text: "" }, { name: "Bone Bow", text: "" }] }))
      .toEqual(["Studded Leather Armor", "Longsword"]);
    expect(inferGear({ flags: ["AC source: half plate, shield."] })).toEqual(["Half Plate Armor", "Shield"]);
    expect(inferGear({ flags: ["AC source: natural armor."], actions: [{ name: "Claw", text: "" }] })).toEqual([]);
  });

  it("a stat block's Gear line wins over inferred gear", () => {
    const l = planLoot({ ...goblin, actions: [{ name: "Dagger", text: "" }] }, "2024", seededRng(6));
    expect(l.lines.filter((x) => x.kind === "gear").map((x) => x.text)).toEqual(goblin.gear);
  });

  it("without a Treasure line: beasts carry nothing, others roll coins on the room's edition table", () => {
    expect(planLoot({ cr: 1, type: "Swarm of Tiny Beasts" }, "2014", seededRng(4)).lines).toEqual([]);
    expect(planLoot({ cr: 1, type: "Ooze" }, "2014", seededRng(4)).note).toMatch(/Ooze/);
    const l = planLoot({ cr: 3, type: "Humanoid (Human)" }, "2014", seededRng(4));
    expect(l.lines).toHaveLength(1);
    expect(l.lines[0]!.detail).toMatch(/^2014 DMG Individual Treasure, CR 0–4 \(d100 \d+\)/);
    expect(l.lines[0]!.text).toMatch(/^\d+ (cp|sp|ep|gp|pp)$/);
  });
});

describe("rolls", () => {
  const GP: Record<string, number> = { pp: 10, gp: 1, ep: 0.5, sp: 0.1, cp: 0.01 };
  const gpOf = (text: string) => text.split(", ").reduce((v, p) => { const [n, k] = p.split(" "); return v + Number(n!.replace(/,/g, "")) * GP[k!]!; }, 0);
  const average = (cr: number, rules: "2024" | "2014") => {
    const rng = seededRng(11);
    let sum = 0;
    for (let i = 0; i < 2000; i++) sum += gpOf(rollCoins(cr, rules, rng).text);
    return sum / 2000;
  };

  it("money grows with CR, with no jump at the DMG's band edges", () => {
    for (const rules of ["2024", "2014"] as const) {
      const crs = [0, 0.25, 1, 2, 3, 4, 5, 6, 8, 10, 11, 13, 16, 17, 20, 24];
      const avgs = crs.map((cr) => average(cr, rules));
      for (let i = 1; i < avgs.length; i++) expect(avgs[i]!, `${rules} CR ${crs[i]} vs ${crs[i - 1]}`).toBeGreaterThan(avgs[i - 1]!);
      // Neighbouring CRs across a band edge differ by well under the DMG's 9× step.
      for (const [lo, hi] of [[4, 5], [10, 11], [16, 17]]) expect(average(hi!, rules) / average(lo!, rules)).toBeLessThan(2);
    }
  });

  it("each band's average stays at its middle CR", () => {
    expect(coinScale(2, "2024")).toBeCloseTo(1, 5);
    expect(coinScale(7.5, "2024")).toBeCloseTo(1, 5);
    expect(coinScale(20, "2024")).toBeCloseTo(1, 5);
    expect(average(2, "2024")).toBeGreaterThan(9);
    expect(average(2, "2024")).toBeLessThan(11.5);
    expect(coinScale(30, "2024")).toBe(coinScale(24, "2024"));
  });

  it("small amounts become smaller coins, and the roll is explained", () => {
    const c = rollCoins(0, "2024", seededRng(3));
    expect(c.text).toMatch(/^\d+ (gp|sp|cp)$/);
    expect(c.detail).toMatch(/3d6 → .* = \d+ gp; × 0\.\d\d for CR 0$/);
  });

  it("2014 coins can mix denominations with multipliers", () => {
    const seen = new Set<string>();
    for (let s = 0; s < 60; s++) seen.add(rollCoins(7, "2014", seededRng(s)).text.split(", ").map((p) => p.split(" ")[1]).join("+"));
    expect([...seen].some((x) => x.includes("+"))).toBe(true);
    for (const x of seen) expect(x).toMatch(/^(cp|sp|ep|gp|pp)(\+(cp|sp|ep|gp|pp))?$/);
  });

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
  const base = planLoot({ cr: 2, treasure: ["any"] }, "2024", seededRng(9));
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
