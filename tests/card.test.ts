import { describe, expect, it } from "vitest";
import { abilityRows, cardAccess, challengeLine, combineModes, initiativeRoll, portraitUrl, shownName, skillRolls, speedLine, typeLine } from "../src/core/card";
import { damageAfter, parseChips, rollLabel, rollSegments, stripChips, type RollSegment } from "../src/core/chips";
import { critFormula, isD20Test, isRollable, naturalD20, rollFormula, seededRng, withRollMode, type Rng } from "../src/core/dice";
import { appendRollLog, makeRoll, rollText, ROLL_LOG_MAX, type RollMessage } from "../src/core/rolls";
import { SHEET_SCHEMA, type UnitSheet } from "../src/core/sheet";

/** RNG that returns die faces in order for d20s etc.: value v on a dN is produced by (v - 0.5) / N. */
function faces(sides: number, ...vals: number[]): Rng {
  let i = 0;
  return () => (vals[i++ % vals.length]! - 0.5) / sides;
}

const wolf: UnitSheet = {
  schema: SHEET_SCHEMA, name: "Wolf", kind: "creature", size: "M", type: "Beast", alignment: "Unaligned", ac: 12, hp: { max: 11, formula: "2d8+2" },
  speed: { walk: 40 }, abilities: { str: 14, dex: 15, con: 12, int: 3, wis: 12, cha: 6 }, saves: { dex: 4 }, skills: [{ name: "Perception", bonus: 5 }, { name: "Stealth", bonus: 4 }],
  defenses: {}, cr: 0.25, proficiencyBonus: 2, initiative: { modifier: 2, advantage: true, disadvantage: false, reasons: [] },
  traits: [], actions: [{ name: "Bite", text: "Melee Attack Roll: +4 [1d20+4], reach 5 ft. Hit: 5 (1d6 + 2 [1d6+2]) Piercing damage. If the target is a Medium or smaller creature, it has the Prone condition." }],
  bonusActions: [], reactions: [], legendary: [], spells: [], inventory: [], source: { provenance: "official", book: "XMM" }, flags: [],
};

describe("dice: keep highest/lowest, modes, crits", () => {
  it("keeps the highest or lowest die", () => {
    const adv = rollFormula("2d20kh1+4", faces(20, 7, 15));
    expect(adv).toMatchObject({ dice: [15], modifier: 4, total: 19 });
    expect(adv.groups[0]).toMatchObject({ rolls: [7, 15], kept: [15], keep: { which: "high", n: 1 } });
    const dis = rollFormula("2d20kl1+4", faces(20, 7, 15));
    expect(dis.total).toBe(11);
    expect(rollFormula("4d6kh3", faces(6, 1, 5, 3, 6)).total).toBe(14);
  });
  it("turns a d20 test into advantage / disadvantage, leaves other rolls", () => {
    expect(withRollMode("1d20+4", "advantage")).toBe("2d20kh1+4");
    expect(withRollMode("1d20 - 1", "disadvantage")).toBe("2d20kl1-1");
    expect(withRollMode("1d20+4", "normal")).toBe("1d20+4");
    expect(withRollMode("1d6+2", "advantage")).toBe("1d6+2");
    expect(withRollMode("1d200", "advantage")).toBe("1d200");
    expect(isD20Test("2d20kh1+3")).toBe(true);
    expect(isD20Test("1d6+2")).toBe(false);
  });
  it("doubles damage dice on a crit, not modifiers", () => {
    expect(critFormula("1d6 + 2")).toBe("2d6+2");
    expect(critFormula("2d8+1d6+3")).toBe("4d8+2d6+3");
  });
  it("finds the natural d20", () => {
    expect(naturalD20(rollFormula("2d20kh1+4", faces(20, 20, 3)))).toBe(20);
    expect(naturalD20(rollFormula("1d20", faces(20, 1)))).toBe(1);
    expect(naturalD20(rollFormula("1d6+2", seededRng(1)))).toBeUndefined();
  });
  it("checks rollable formulas and limits", () => {
    expect(isRollable("1d20+4")).toBe(true);
    expect(isRollable("2d20kh1")).toBe(true);
    expect(isRollable("Concentration")).toBe(false);
    expect(isRollable("15")).toBe(false);
    expect(isRollable("101d6")).toBe(false);
    expect(isRollable("2d20kh3")).toBe(false);
  });
});

describe("dice chips in sheet text", () => {
  it("folds the printed value into the roll and classifies it (5etools)", () => {
    const segs = parseChips(wolf.actions[0]!.text);
    expect(segs[0]).toEqual({ t: "text", text: "Melee Attack Roll: " });
    const rolls = rollSegments(segs);
    expect(rolls).toEqual([
      { t: "roll", formula: "1d20+4", display: "+4", kind: "attack" },
      { t: "roll", formula: "1d6+2", display: "1d6 + 2", kind: "damage", damageType: "Piercing" },
    ]);
    expect(stripChips(wolf.actions[0]!.text)).toBe("Melee Attack Roll: +4, reach 5 ft. Hit: 5 (1d6 + 2) Piercing damage. If the target is a Medium or smaller creature, it has the Prone condition.");
    expect(damageAfter(segs, rolls[0]!)).toEqual([rolls[1]]);
    expect(rollLabel("Bite", rolls[0]!)).toBe("Bite · to hit");
    expect(rollLabel("Bite", rolls[1]!)).toBe("Bite · Piercing damage");
  });
  it("handles D&D Beyond and quick-stats text, spell attacks and saves", () => {
    const ddb = rollSegments(parseChips("Melee Attack Roll: +5 [1d20+5], reach 5 ft. Hit: 1d8+3 [1d8+3] Slashing damage."));
    expect(ddb.map((r) => [r.display, r.kind, r.damageType])).toEqual([["+5", "attack", undefined], ["1d8+3", "damage", "Slashing"]]);
    const spell = rollSegments(parseChips("Fire Bolt. Ranged spell attack +5 [1d20+5]. 1d10 [1d10] fire"));
    expect(spell.map((r) => r.kind)).toEqual(["attack", "dice"]);
    const save = rollSegments(parseChips("Dexterity Saving Throw: +3 [1d20+3]"));
    expect(save[0]!.kind).toBe("save");
    const plain = rollSegments(parseChips("Perception +5 [1d20+5]"));
    expect(plain[0]).toMatchObject({ kind: "check", display: "+5" });
  });
  it("leaves non-dice brackets and unprinted chips alone", () => {
    expect(parseChips("[Concentration, Ritual] Lasts 1 hour")).toEqual([{ t: "text", text: "[Concentration, Ritual] Lasts 1 hour" }]);
    const r = rollSegments(parseChips("Takes [2d6] fire damage"));
    expect(r[0]).toMatchObject({ formula: "2d6", display: "2d6", kind: "damage", damageType: "Fire" });
  });
  it("makes bare parenthesised dice rollable (books without damage tags)", () => {
    const segs = parseChips("Melee Weapon Attack: +10 [1d20+10] to hit, reach 5 ft. Hit: 13 (2d6 + 6) slashing damage plus 3 (1d6) fire damage.");
    const rolls = rollSegments(segs);
    expect(rolls.map((r) => [r.display, r.kind, r.damageType])).toEqual([["+10", "attack", undefined], ["2d6 + 6", "damage", "Slashing"], ["1d6", "damage", "Fire"]]);
    expect(stripChips("Hit: 13 (2d6 + 6) slashing")).toBe("Hit: 13 (2d6 + 6) slashing");
    expect(rollSegments(parseChips("returns to life in 10 (1d20 [1d20]) days"))[0]!.kind).toBe("dice");
  });
  it("multiple damage parts after one attack, stopping at the next attack", () => {
    const segs = parseChips("Attack: +6 [1d20+6]. Hit: 7 (1d8 + 3 [1d8+3]) Slashing damage plus 7 (2d6 [2d6]) Fire damage. Second attack: +6 [1d20+6]. Hit: 4 (1d4 + 2 [1d4+2]) Piercing damage.");
    const rolls = rollSegments(segs);
    expect(damageAfter(segs, rolls[0]!).map((r) => r.damageType)).toEqual(["Slashing", "Fire"]);
    expect(damageAfter(segs, rolls[3]!).map((r) => r.damageType)).toEqual(["Piercing"]);
  });
});

describe("roll messages", () => {
  const by = { id: "p1", name: "Ana", role: "PLAYER" as const };
  it("records advantage, natural 20 and dropped dice", () => {
    const m = makeRoll("1d20+4", "Bite · to hit", by, "public", { rng: faces(20, 20, 6), mode: "advantage", kind: "attack", newId: () => "x", now: () => new Date(0) });
    expect(m).toMatchObject({ formula: "2d20kh1+4", total: 24, natural: 20, mode: "advantage", kind: "attack" });
    expect(rollText(m)).toBe("Ana · Bite · to hit: 24 NATURAL 20! (adv 2d20kh1+4 → 20 / 6 +4)");
  });
  it("doubles dice on crit damage", () => {
    const m = makeRoll("1d6+2", "Bite · Piercing damage", by, "public", { rng: faces(6, 3, 5), crit: true, unit: { id: "u", name: "Wolf" } });
    expect(m).toMatchObject({ formula: "2d6+2", total: 10, crit: true });
    expect(rollText(m)).toBe("Wolf · Bite · Piercing damage (critical): 10 (2d6+2 → 3 + 5 +2)");
  });
  it("ignores roll modes on non-d20 rolls", () => {
    const m = makeRoll("1d6", "x", by, "public", { rng: faces(6, 2), mode: "advantage" });
    expect(m.mode).toBeUndefined();
    expect(m.formula).toBe("1d6");
  });
  it("keeps a bounded, de-duplicated session log", () => {
    let log: RollMessage[] = [];
    const mk = (i: number) => makeRoll("1d4", "t", by, "public", { rng: seededRng(i), newId: () => `id${i}` });
    for (let i = 0; i < ROLL_LOG_MAX + 5; i++) log = appendRollLog(log, mk(i));
    expect(log).toHaveLength(ROLL_LOG_MAX);
    expect(log[0]!.id).toBe(`id${ROLL_LOG_MAX + 4}`);
    expect(appendRollLog(log, mk(ROLL_LOG_MAX + 4))).toBe(log);
  });
});

describe("unit card rules", () => {
  const gm = { id: "gm", role: "GM" as const };
  const ana = { id: "ana", role: "PLAYER" as const };
  const item = { visible: true, createdUserId: "gm", name: "Wolf", label: "Wolf 2", imageUrl: "https://x/wolf.png" };

  it("GM sees all; players see full cards of units they control, limited otherwise, nothing when hidden", () => {
    expect(cardAccess(gm, { ...item, visible: false }, {})).toBe("full");
    expect(cardAccess(ana, item, { controlledBy: "ana" })).toBe("full");
    expect(cardAccess(ana, item, { controlledBy: "bob" })).toBe("limited");
    expect(cardAccess(ana, item, {})).toBe("limited");
    expect(cardAccess(ana, { ...item, visible: false }, {})).toBe("none");
    expect(cardAccess(ana, { ...item, createdUserId: "ana" }, {})).toBe("full");
    expect(cardAccess(ana, { ...item, createdUserId: "ana" }, { controlledBy: "bob" })).toBe("limited");
  });
  it("aliases hide the real name from players who don't control the unit", () => {
    // While an alias is set, the token label shows it on the map and the item name keeps the real name.
    const aliased = { ...item, name: "Wolf 2", label: "Hooded figure" };
    expect(shownName("limited", ana, aliased, wolf, { alias: "Hooded figure" })).toBe("Hooded figure");
    expect(shownName("full", gm, aliased, wolf, { alias: "Hooded figure" })).toBe("Wolf 2");
    expect(shownName("full", ana, aliased, wolf, { alias: "Hooded figure" })).toBe("Wolf 2");
    expect(shownName("full", gm, item, wolf, {})).toBe("Wolf 2");
    expect(shownName("limited", ana, { name: "Wolf" }, wolf, {})).toBe("Wolf");
  });
  it("portrait defaults to the token image", () => {
    expect(portraitUrl(item, {})).toBe("https://x/wolf.png");
    expect(portraitUrl(item, { portraitUrl: "https://x/p.png" })).toBe("https://x/p.png");
  });
  it("lines and standard rolls", () => {
    expect(typeLine(wolf)).toBe("Medium Beast, Unaligned");
    expect(challengeLine(wolf)).toBe("CR 1/4 (50 XP; PB +2)");
    expect(speedLine({ ...wolf, speed: { walk: 30, fly: 60, hover: true } })).toBe("30 ft., Fly 60 ft. (hover)");
    const rows = abilityRows(wolf);
    expect(rows[1]).toMatchObject({ short: "DEX", mod: 2, proficientSave: true, save: { formula: "1d20+4" }, check: { formula: "1d20+2", label: "Dexterity check" } });
    expect(rows[3]!.check.formula).toBe("1d20-4");
    expect(rows[0]!.save.formula).toBe("1d20+2");
    expect(skillRolls(wolf)[0]).toMatchObject({ label: "Perception check", formula: "1d20+5" });
    expect(initiativeRoll(wolf)).toMatchObject({ formula: "1d20+2", mode: "advantage" });
  });
  it("combines a clicked mode with a built-in one (they cancel)", () => {
    expect(combineModes("normal", "advantage")).toBe("advantage");
    expect(combineModes("disadvantage", "advantage")).toBe("normal");
    expect(combineModes("disadvantage", undefined)).toBe("disadvantage");
  });
});

// Type-only check that RollSegment stays exported for the card page.
export type _Seg = RollSegment;
