import { describe, expect, it } from "vitest";
import {
  adjacent, afterLoss, atTurnEnd, atTurnStart, attackFactors, attackOutcome, BATTLE_KEY, BATTLE_UNIT_KEY, battleOrder, canAttack, cellDistance,
  compositionBr, creatureBr, friendlyCheckIds, gridProblem, groupBr, memberFromSheet, membersFromSheets, moraleFromFactors, nextBattleTurn,
  nextTurnRound, previousBattleTurn, readBattle, readBattleUnit, removeCreatures, sheetRangeFt, sideStrength, squaresAllowed, startBattle,
  strengthWords, unitBrNow, unitInitiative, unitInitiativeOf, unitMorale, unitRange, unitSpace, unitSpeed, unitWarnings, NEW_BATTLE,
  type BattleUnit, type FieldUnit, type Member,
} from "../src/core/massCombat";
import { blankSheet } from "../src/core/collection";

const m = (name: string, cr: number, count: number, extra: Partial<Member> = {}): Member =>
  ({ name, cr, size: "M", speed: { walk: 30 }, rangeFt: 0, count, role: "soldier", ...extra });
const unit = (patch: Partial<BattleUnit> = {}): BattleUnit => ({
  v: 1, name: "Unit", side: "A", members: [m("Orc", 1 / 2, 100)], commander: { name: "Warchief", cr: 4, cha: 2 }, moraleBase: 0,
  startBr: null, brLost: 0, halfChecked: false, removed: null, characters: [], tie: 0.5, ...patch,
});
const field = (id: string, side: string, col: number, row: number, extra: Partial<FieldUnit> = {}): FieldUnit =>
  ({ id, side, cell: { col, row }, removed: false, defending: false, range: null, ...extra });

describe("mass combat (UA 2017): Battle Rating", () => {
  it("follows the Battle Rating by Challenge Rating table, row by row", () => {
    const table: [number, number][] = [[2, 1], [3, 2], [4, 3], [5, 4], [6, 5], [7, 6], [8, 8], [9, 10], [10, 12], [11, 16], [12, 18], [13, 22],
      [14, 26], [15, 30], [16, 34], [17, 38], [18, 42], [19, 46], [20, 50]];
    for (const [cr, br] of table) expect(creatureBr(cr)).toBe(br);
    expect(creatureBr(1)).toBe(0);
    expect(creatureBr(21)).toBe(54); // beyond the table: +4 per CR (A12)
  });

  it("small creatures give BR only in whole groups (the UA's example: five CR 1/2 creatures = +1)", () => {
    expect(groupBr(1 / 2, 5)).toBe(1);
    expect(groupBr(1 / 2, 4)).toBe(0);
    expect(groupBr(1 / 2, 9)).toBe(1);
    expect(groupBr(1 / 8, 40)).toBe(2);
    expect(groupBr(1 / 4, 10)).toBe(1);
    expect(groupBr(1, 3)).toBe(1);
    expect(groupBr(0, 400)).toBe(0);
    expect(groupBr(5, 3)).toBe(12);
  });

  it("a unit's BR counts every creature and the commander, per CR group; mounts count too", () => {
    expect(compositionBr([m("Orc", 1 / 2, 300), m("Ogre", 2, 30)], { name: "Warchief", cr: 4, cha: 3 })).toBe(60 + 30 + 3);
    // A CR 1 commander joins the CR 1 group: 3 + 1 = 4 creatures = +2.
    expect(compositionBr([m("Thug", 1 / 2, 0), m("Veteran", 1, 3)], { name: "Captain", cr: 1, cha: 1 })).toBe(2);
    expect(compositionBr([m("Knight", 3, 50, { role: "rider" }), m("Warhorse", 1 / 2, 50, { role: "mount" })], { name: "Lord", cr: 3, cha: 2 })).toBe(100 + 10 + 2);
  });
});

describe("mass combat: building units", () => {
  it("space: the UA's example of 50 Large and 200 Medium creatures is a full unit of 400", () => {
    expect(unitSpace([m("Ogre", 2, 50, { size: "L" }), m("Orc", 1 / 2, 200)])).toBe(400);
    expect(unitSpace([m("Rat", 0, 50, { size: "T" })])).toBe(0); // no BR, doesn't count
    expect(unitWarnings({ members: [m("Ogre", 2, 51, { size: "L" }), m("Orc", 1 / 2, 200)], commander: { name: "c", cr: 1, cha: 0 } })[0]).toMatch(/404/);
  });

  it("speed: 10 × the slowest member; modes only if everyone has them; riders move on their mounts", () => {
    expect(unitSpeed([m("Orc", 1 / 2, 10), m("Dwarf", 1 / 2, 10, { speed: { walk: 25 } })])).toEqual({ walk: 250 });
    expect(unitSpeed([m("Griffon", 2, 10, { speed: { walk: 30, fly: 80 } }), m("Hippogriff", 1, 10, { speed: { walk: 40, fly: 60 } })])).toEqual({ walk: 300, fly: 600 });
    expect(unitSpeed([m("Griffon", 2, 10, { speed: { walk: 30, fly: 80 } }), m("Orc", 1 / 2, 10)])).toEqual({ walk: 300 });
    expect(unitSpeed([m("Knight", 3, 50, { role: "rider" }), m("Warhorse", 1 / 2, 50, { role: "mount", speed: { walk: 60 } })])).toEqual({ walk: 600 });
  });

  it("range: every member but mounts needs an at-will attack of 100 ft or more; the shortest wins", () => {
    expect(unitRange([m("Archer", 3, 50, { rangeFt: 600 }), m("Scout", 1 / 2, 50, { rangeFt: 320 })])).toBe(320);
    expect(unitRange([m("Archer", 3, 50, { rangeFt: 600 }), m("Guard", 1 / 8, 50, { rangeFt: 0 })])).toBeNull();
    expect(unitRange([m("Horse archer", 1, 50, { role: "rider", rangeFt: 320 }), m("Riding horse", 1 / 4, 50, { role: "mount" })])).toBe(320);
  });

  it("reads ranged attacks from a stat block, skipping Recharge and per-day attacks", () => {
    const s = blankSheet("Scout");
    s.actions = [
      { name: "Longbow", text: "Ranged Attack Roll: +4, range 150/600 ft. Hit: 6 (1d8 + 2) Piercing damage." },
      { name: "Fire Breath (Recharge 5–6)", text: "Ranged: range 900 ft." },
      { name: "Shortsword", text: "Melee Attack Roll: +4, reach 5 ft." },
    ];
    expect(sheetRangeFt(s)).toBe(600);
    s.cr = 0.5;
    expect(memberFromSheet(s, 20)).toMatchObject({ name: "Scout", cr: 0.5, count: 20, rangeFt: 600 });
    expect(membersFromSheets([s, s, { ...s, name: "Captain", cr: 3 }]).map((x) => [x.name, x.count])).toEqual([["Scout", 2], ["Captain", 1]]);
  });

  it("morale: one row per factor on the Morale Ratings table, then the commander's Charisma", () => {
    expect(moraleFromFactors({})).toBe(0);
    expect(moraleFromFactors({ pay: -1, foe: -1 })).toBe(-4);
    expect(moraleFromFactors({ stake: 1, equipment: 1, commander: 1 })).toBe(8);
    expect(moraleFromFactors({ treatment: -1, animosity: -1, pay: -1, stake: -1, commander: -1, foe: -1, equipment: -1 })).toBe(-10);
    expect(unitMorale(2, 3)).toBe(5);
    expect(unitMorale(10, 4)).toBe(10);
  });

  it("initiative is 10 + morale + the commander's Charisma, counting Charisma twice as written (A1)", () => {
    expect(unitInitiative(5, 3)).toBe(18);
    expect(unitInitiativeOf(unit({ moraleBase: 2, commander: { name: "c", cr: 1, cha: 3 } }))).toBe(10 + 5 + 3);
  });
});

describe("mass combat: attacks and morale", () => {
  it("opposed BR checks: tie, target wins, attacker by 10, attacker by 11", () => {
    expect(attackOutcome(20, 20)).toMatchObject({ kind: "none", brLoss: 0 });
    expect(attackOutcome(12, 20)).toMatchObject({ kind: "none", brLoss: 0 });
    expect(attackOutcome(30, 20)).toMatchObject({ kind: "casualties", brLoss: 2, margin: 10 });
    expect(attackOutcome(31, 20)).toMatchObject({ kind: "heavy", brLoss: 5, margin: 11 });
  });

  it("after a loss: removal at BR 0 or below (A3), else DC 10 for heavy casualties, then DC 15 once at half strength (A4, A5)", () => {
    expect(afterLoss(0, 20, { heavy: true, halfChecked: false })).toEqual({ removed: true, checks: [], halfReached: true });
    expect(afterLoss(-3, 20, { heavy: false, halfChecked: true }).removed).toBe(true);
    expect(afterLoss(15, 20, { heavy: true, halfChecked: false }).checks.map((c) => c.dc)).toEqual([10]);
    expect(afterLoss(10, 20, { heavy: true, halfChecked: false }).checks.map((c) => c.dc)).toEqual([10, 15]);
    expect(afterLoss(10, 20, { heavy: false, halfChecked: false }).checks.map((c) => c.dc)).toEqual([15]);
    expect(afterLoss(8, 20, { heavy: false, halfChecked: true }).checks).toEqual([]);
  });

  it("current BR = the creatures left − BR lost to attacks (A2)", () => {
    const u = unit({ members: [m("Orc", 1 / 2, 100)], brLost: 4 });
    expect(unitBrNow(u)).toBe(20 + 3 - 4);
    expect(unitBrNow({ ...u, members: removeCreatures(u.members, "Orc", 30) })).toBe(14 + 3 - 4);
    expect(strengthWords({ ...u, startBr: 23, brLost: 0 })).toBe("unhurt");
    expect(strengthWords({ ...u, startBr: 23, brLost: 13 })).toBe("badly mauled");
  });
});

describe("mass combat: the map", () => {
  it("grid: square, in feet, at least 100 ft per square", () => {
    expect(gridProblem({ type: "SQUARE", multiplier: 100, unit: "ft" })).toBeNull();
    expect(gridProblem({ type: "SQUARE", multiplier: 200, unit: "ft" })).toBeNull();
    expect(gridProblem({ type: "SQUARE", multiplier: 5, unit: "ft" })).toMatch(/at least 100 ft/);
    expect(gridProblem({ type: "SQUARE", multiplier: 100, unit: "m" })).toMatch(/feet/);
    expect(gridProblem({ type: "HEX_VERTICAL", multiplier: 100, unit: "ft" })).toMatch(/square/);
  });

  it("adjacency includes diagonals (A8); movement enters a square with half its cost left", () => {
    expect(adjacent({ col: 0, row: 0 }, { col: 1, row: 1 })).toBe(true);
    expect(cellDistance({ col: 0, row: 0 }, { col: 2, row: 1 })).toBe(2);
    expect(squaresAllowed(300, 100)).toBe(3);
    expect(squaresAllowed(250, 100)).toBe(3);
    expect(squaresAllowed(240, 100)).toBe(2);
    expect(squaresAllowed(300, 200)).toBe(2);
  });

  it("attacks: adjacent for melee, otherwise within the unit's range", () => {
    const archers = field("a", "A", 0, 0, { range: 320 });
    expect(canAttack(archers, field("t", "B", 1, 0), 100)).toMatchObject({ ok: true, how: "melee" });
    expect(canAttack(archers, field("t", "B", 3, 0), 100)).toMatchObject({ ok: true, how: "ranged" });
    expect(canAttack(archers, field("t", "B", 4, 0), 100).ok).toBe(false);
    expect(canAttack(field("f", "A", 0, 0), field("t", "B", 2, 0), 100).ok).toBe(false);
    expect(canAttack(archers, field("t", "A", 1, 0), 100).ok).toBe(false);
  });

  it("Advantage and Disadvantage come from the map and cancel each other", () => {
    const a = field("a", "A", 0, 0), t = field("t", "B", 1, 0);
    expect(attackFactors(a, t, [a, t], { highGround: false, cover: false }).mode).toBe("normal");
    const flank = field("f", "A", 2, 0);
    expect(attackFactors(a, t, [a, t, flank], { highGround: false, cover: false })).toMatchObject({ mode: "advantage" });
    const f1 = field("b1", "B", 1, 1), f2 = field("b2", "B", 2, 1);
    expect(attackFactors(a, t, [a, t, f1, f2], { highGround: false, cover: false }).mode).toBe("disadvantage");
    expect(attackFactors(a, t, [a, t, flank, f1, f2], { highGround: false, cover: false }).mode).toBe("normal");
    expect(attackFactors(a, { ...t, defending: true }, [a, t], { highGround: true, cover: false }).mode).toBe("normal");
    expect(attackFactors(a, t, [a, t, { ...flank, removed: true }], { highGround: false, cover: true }).mode).toBe("disadvantage");
  });

  it("friendly casualties: same-side units within 500 ft check when a unit is removed", () => {
    const gone = field("x", "A", 0, 0);
    const all = [gone, field("near", "A", 5, 0), field("far", "A", 6, 0), field("foe", "B", 1, 0), field("dead", "A", 1, 1, { removed: true })];
    expect(friendlyCheckIds(gone, all, 100)).toEqual(["near"]);
    expect(friendlyCheckIds(gone, all, 200)).toEqual([]);
  });
});

describe("mass combat: turns", () => {
  const ou = (id: string, moraleBase: number, cha: number, tie: number, extra: Partial<BattleUnit> = {}) => ({ id, unit: unit({ moraleBase, commander: { name: id, cr: 1, cha }, tie, ...extra }) });

  it("fixed order by initiative; ties keep the random draw made once; removed units are skipped", () => {
    const units = [ou("a", 0, 0, 0.2), ou("b", 2, 1, 0.1), ou("c", 0, 0, 0.9), ou("d", 4, 0, 0, { removed: { round: 1, why: "fled" } })];
    expect(battleOrder(units).map((u) => u.id)).toEqual(["b", "c", "a"]);
    expect(battleOrder(units).map((u) => u.id)).toEqual(["b", "c", "a"]);
  });

  it("start, next (wrapping into a new round), previous, and passing on from a removed unit", () => {
    const order = battleOrder([ou("a", 4, 0, 0), ou("b", 2, 0, 0), ou("c", 0, 0, 0)]);
    let b = startBattle({ ...NEW_BATTLE }, order);
    expect([b.round, b.turnId]).toEqual([1, "a"]);
    b = { ...b, ...nextBattleTurn(b, order, ["a", "b", "c"]) };
    b = { ...b, ...nextBattleTurn(b, order, ["a", "b", "c"]) };
    expect([b.round, b.turnId]).toEqual([1, "c"]);
    b = { ...b, ...nextBattleTurn(b, order, ["a", "b", "c"]) };
    expect([b.round, b.turnId]).toEqual([2, "a"]);
    expect(previousBattleTurn(b, order)).toEqual({ round: 1, turnId: "c" });
    // "b" is removed during its own turn: the turn passes to "c".
    const without = order.filter((u) => u.id !== "b");
    expect(nextBattleTurn({ ...b, round: 2, turnId: "b" }, without, ["a", "b", "c"])).toEqual({ round: 2, turnId: "c" });
  });

  it("Defend lasts until the end of the unit's next turn; Guard until its next turn starts; Shaken for its next turn", () => {
    const u = unit({ defendUntil: 3, guardRound: 2, shakenRound: 3 });
    expect(atTurnEnd(u, 2)).toEqual({});
    expect(atTurnEnd(u, 3)).toEqual({ defendUntil: undefined, shakenRound: undefined });
    expect(atTurnStart(u, 2)).toEqual({});
    expect(atTurnStart(u, 3)).toEqual({ guardRound: undefined });
    const order = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(nextTurnRound("c", "b", order, 2)).toBe(2);
    expect(nextTurnRound("a", "b", order, 2)).toBe(3);
    expect(nextTurnRound("b", "b", order, 2)).toBe(3);
  });

  it("side strength counts the units left and their BR", () => {
    expect(sideStrength([ou("a", 0, 0, 0), ou("b", 0, 0, 0, { side: "B" }), ou("c", 0, 0, 0, { side: "B", removed: { round: 1, why: "fled" } })]))
      .toEqual([{ side: "A", units: 1, br: 20, removed: 0 }, { side: "B", units: 1, br: 20, removed: 1 }]); // a lone CR 1 commander adds nothing
  });

  it("reads stored records defensively", () => {
    expect(readBattle({})).toEqual(NEW_BATTLE);
    expect(readBattle({ [BATTLE_KEY]: { v: 1, active: true, round: 3, turnId: "x", log: [{ pub: "hi" }, { nope: 1 }] } })).toMatchObject({ active: true, round: 3, turnId: "x", log: [{ pub: "hi" }] });
    expect(readBattleUnit({})).toBeNull();
    const u = readBattleUnit({ [BATTLE_UNIT_KEY]: { v: 1, name: "Pikes", members: [{ name: "Guard", cr: 0.125, size: "Q", count: 40.7 }], commander: { cr: 2, cha: 1 } } })!;
    expect(u.members[0]).toMatchObject({ size: "M", count: 40, role: "soldier", speed: { walk: 0 } });
    expect(unitBrNow(u)).toBe(2 + 1);
  });
});

describe("mass combat: what players see", () => {
  it("visible units in words; BR only for a unit the player commands when the GM allows it; the public log only", async () => {
    const { playerBattleView } = await import("../src/core/massCombat");
    const b = { ...NEW_BATTLE, showCommandedBr: false, active: true, round: 2, turnId: "a", log: [{ pub: "Orcs attack: casualties.", gm: "17 vs 12" }, { pub: "", gm: "morale 9 vs DC 15" }] };
    const units = [
      { id: "a", visible: true, unit: unit({ name: "Orcs", startBr: 23, brLost: 2, commandedBy: "p1" }) },
      { id: "b", visible: true, unit: unit({ name: "Pikes", side: "B", startBr: 23, defendUntil: 3 }) },
      { id: "c", visible: false, unit: unit({ name: "Ambush", side: "B" }) },
    ];
    const v = playerBattleView(units, b, "p1");
    expect(v.rows.map((r) => r.name)).toEqual(["Orcs", "Pikes"]);
    expect(v.rows[0]).toMatchObject({ active: true, mine: true, status: "bloodied ranks", numbers: undefined });
    expect(v.rows[1]).toMatchObject({ status: "unhurt, defending", makeup: "Orc; led by Warchief" });
    expect(JSON.stringify(v)).not.toMatch(/BR|17 vs/);
    expect(v.log).toEqual(["Orcs attack: casualties."]);
    expect(playerBattleView(units, { ...b, showCommandedBr: true }, "p1").rows[0]!.numbers).toBe("BR 21, morale +2");
    expect(playerBattleView(units, { ...b, showCommandedBr: true }, "p2").rows[0]!.numbers).toBeUndefined();
  });
});

describe("mass combat: a scripted skirmish", () => {
  it("attacks wear a unit down, the half-strength check comes once, and BR 0 removes it and shakes a neighbour", () => {
    // Pikes: 100 CR 1/2 guards + a CR 2 captain = BR 21. Orcs attack them three times.
    let pikes = unit({ name: "Pikes", side: "B", members: [m("Guard", 1 / 2, 100)], commander: { name: "Captain", cr: 2, cha: 1 } });
    pikes = { ...pikes, startBr: unitBrNow(pikes) };
    expect(pikes.startBr).toBe(21);
    const hit = (totals: [number, number]) => {
      const o = attackOutcome(...totals);
      pikes = { ...pikes, brLost: pikes.brLost + o.brLoss };
      const r = afterLoss(unitBrNow(pikes), pikes.startBr!, { heavy: o.kind === "heavy", halfChecked: pikes.halfChecked });
      if (r.halfReached) pikes = { ...pikes, halfChecked: true };
      return { o, r };
    };
    expect(hit([25, 20]).r.checks).toEqual([]); // −2 → 19
    expect(hit([31, 10]).r.checks.map((c) => c.dc)).toEqual([10]); // −5 → 14 (heavy: DC 10)
    expect(hit([40, 10]).r.checks.map((c) => c.dc)).toEqual([10, 15]); // −5 → 9, half of 21 or less: DC 15 too
    expect(hit([22, 21]).r.checks).toEqual([]); // −2 → 7, the half check was already made
    // Characters cut down 35 guards: 65 left = +13, + captain 1, − 14 lost = 0 → removed.
    pikes = { ...pikes, members: removeCreatures(pikes.members, "Guard", 35) };
    expect(unitBrNow(pikes)).toBe(0);
    expect(afterLoss(unitBrNow(pikes), 21, { heavy: false, halfChecked: true }).removed).toBe(true);
    const all = [field("pikes", "B", 3, 3), field("archers", "B", 7, 3), field("reserve", "B", 9, 3), field("orcs", "A", 4, 3)];
    expect(friendlyCheckIds(all[0]!, all, 100)).toEqual(["archers"]);
  });
});

describe("mass combat: a commanding player's orders", () => {
  it("moves one square at a time: within the allowance, stopping next to enemies unless disengaged, never into a held square", async () => {
    const { checkStep, moveAllowance, movedSquares } = await import("../src/core/massCombat");
    const u = unit(); // 30 ft creatures: 300 ft = 3 squares at 100 ft
    const me = field("me", "A", 0, 0);
    const b = { round: 1, turn: { startCell: { col: 0, row: 0 } } };
    expect(moveAllowance(u, b.turn, 100)).toBe(3);
    expect(moveAllowance(u, { action: "dash" }, 100)).toBe(6);
    expect(moveAllowance(u, { action: "disengage", disengaged: true }, 100)).toBe(2);
    expect(moveAllowance(u, { action: "disengage", disengaged: false }, 100)).toBe(0);
    expect(checkStep(me, u, [me], b, 100, "e")).toEqual({ ok: true, cell: { col: 1, row: 0 } });
    expect(checkStep({ ...me, cell: { col: 3, row: 0 } }, u, [me], { ...b, turn: { ...b.turn, moved: 3 } }, 100, "e")).toMatchObject({ ok: false, why: "no movement left" });
    expect(movedSquares({ startCell: { col: 0, row: 0 }, moved: 1 }, { col: 2, row: 2 })).toBe(2);
    const foe = field("foe", "B", 1, 1);
    expect(checkStep(me, u, [me, foe], b, 100, "w")).toMatchObject({ ok: false, why: expect.stringMatching(/next to an enemy/) });
    expect(checkStep(me, u, [me, foe], { ...b, turn: { ...b.turn, action: "disengage", disengaged: true } }, 100, "w").ok).toBe(true);
    expect(checkStep(me, u, [me, field("ally", "A", 1, 0)], b, 100, "e")).toMatchObject({ ok: false, why: "another unit holds that square" });
    expect(checkStep(me, { ...u, shakenRound: 1 }, [me], b, 100, "e").ok).toBe(false);
  });

  it("a guard triggers when the acting unit comes next to it, not when it started there", async () => {
    const { guardTriggers } = await import("../src/core/massCombat");
    const mover = field("m", "A", 2, 0);
    const all = [mover, field("g1", "B", 3, 0), field("g2", "B", 1, 1), field("idle", "B", 3, 1)];
    expect(guardTriggers(mover, new Set(["g1", "g2"]), all, { col: 0, row: 0 })).toEqual(["g1"]);
  });

  it("commanders see their unit's BR by default; old records without the option keep it on", () => {
    expect(NEW_BATTLE.showCommandedBr).toBe(true);
    expect(readBattle({ [BATTLE_KEY]: { v: 1 } }).showCommandedBr).toBe(true);
    expect(readBattle({ [BATTLE_KEY]: { v: 1, showCommandedBr: false } }).showCommandedBr).toBe(false);
  });

  it("orders are validated as player requests; mass combat is off by default", async () => {
    const { isPlayerRequest } = await import("../src/core/turns");
    const { DEFAULT_SETTINGS, readSettings } = await import("../src/core/settings");
    const base = { v: 1, unitId: "u", playerId: "p", playerName: "Alice", type: "battle", round: 2 };
    expect(isPlayerRequest({ ...base, op: "move", dir: "ne" })).toBe(true);
    expect(isPlayerRequest({ ...base, op: "move", dir: "up" })).toBe(false);
    expect(isPlayerRequest({ ...base, op: "attack", targetId: "t" })).toBe(true);
    expect(isPlayerRequest({ ...base, op: "attack" })).toBe(false);
    expect(isPlayerRequest({ ...base, op: "end-turn" })).toBe(true);
    expect(isPlayerRequest({ ...base, op: "fireball" })).toBe(false);
    expect(DEFAULT_SETTINGS.massCombat).toBe(false);
    expect(readSettings({}).massCombat).toBe(false);
  });
});
