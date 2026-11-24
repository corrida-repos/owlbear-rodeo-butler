import { describe, expect, it } from "vitest";
import {
  actionCount, afterFiring, attackMode, bosunRepair, canPatch, canTurn, crashPlan, crashRules, damageShip, fallDamageFeet, fallDice, fallReason, fallStep, fullSpeedAhead,
  groupResult, mutinyResult, NAVAL_KEY, readNaval, shipActions, shipFromPreset, shipInitiativeBonus, shipSpeed, shipsUpBetween, startShipTurn, staysAloft,
  takeAim, weaponReady, weaponStep, windGrounds, type Ship,
} from "../src/core/naval";
import { SHIP_PRESETS } from "../src/core/shipData";
import { DEFAULT_SETTINGS, readSettings } from "../src/core/settings";

const preset = (name: string, source?: string) => SHIP_PRESETS.find((p) => p.name === name && (!source || p.source === source))!;
const ship = (name: string, patch: Partial<Ship> = {}, source?: string): Ship => ({ ...shipFromPreset(preset(name, source), `s-${name}`), ...patch });
const comp = (s: Ship, name: string) => s.comps.find((c) => c.name === name)!;

describe("naval and aerial combat: setting", () => {
  it("is off by default and read from room metadata", () => {
    expect(DEFAULT_SETTINGS.naval).toBe(false);
    expect(readSettings({}).naval).toBe(false);
    expect(readSettings({ "dev.owlbear-butler/settings": { naval: true } }).naval).toBe(true);
  });
});

describe("ship stat blocks from 5etools", () => {
  it("has the GoS ships, AI balloon, AAG spelljammers, EFA airships and the 2024 PHB airship", () => {
    expect(SHIP_PRESETS.filter((p) => p.source === "GoS").map((p) => p.name).sort()).toEqual(["Galley", "Keelboat", "Longship", "Rowboat", "Sailing Ship", "Warship"]);
    expect(SHIP_PRESETS.filter((p) => p.type === "spelljammer")).toHaveLength(16);
    expect(SHIP_PRESETS.filter((p) => p.type === "airship")).toHaveLength(3);
    expect(preset("Battle Balloon")).toBeTruthy();
    expect(preset("Airship", "XPHB").hull).toEqual({ ac: 13, hp: 300 });
    expect(SHIP_PRESETS.every((p) => p.hull.hp > 0 && p.components.some((c) => c.kind === "movement"))).toBe(true);
  });
  it("parses weapons: attack bonus, range, minimum range, damage; load and aim actions", () => {
    const m = comp(ship("Sailing Ship"), "Mangonel");
    expect(m).toMatchObject({ ac: 15, hp: 100, maxHp: 100 });
    expect(m.attacks![0]).toMatchObject({ bonus: 5, normal: 200, long: 800, min: 60, damage: [{ dice: "5d10", type: "Bludgeoning" }] });
    const sj = ship("Space Galleon");
    expect(comp(sj, "Mangonel")).toMatchObject({ load: 2, aim: 2, crew: 5 });
    expect(comp(sj, "Ballista 1")).toMatchObject({ load: 1, aim: 1, group: "Ballistae" });
    expect(comp(ship("Battle Balloon"), "Green Flame Arbalester").attacks![0]!.damage).toEqual([{ dice: "3d10", type: "Piercing" }, { dice: "4d10", type: "Fire" }]);
  });
  it("splits counted weapons into components with their own HP", () => {
    const g = ship("Galley");
    expect(g.comps.filter((c) => c.group === "Ballistas").map((c) => c.name)).toEqual(["Ballista 1", "Ballista 2", "Ballista 3", "Ballista 4"]);
    expect(g.comps.filter((c) => c.group === "Mangonels")).toHaveLength(2);
    expect(comp(g, "Naval Ram")).toMatchObject({ ram: true, dt: 10 });
    expect(g).toMatchObject({ size: "G", str: 24, dex: 4, con: 20, hull: { ac: 15, hp: 500, maxHp: 500, dt: 20 }, crew: 80, quality: 4, thresholds: [3, 20, 40] });
  });
  it("sizes spelljammers by their length", () => {
    expect(ship("Space Galleon").size).toBe("G");
    expect(ship("Rowboat").size).toBe("L");
  });
});

describe("ship turns", () => {
  it("counts actions from the crew left (GoS thresholds)", () => {
    const s = ship("Sailing Ship");
    expect(actionCount(s)).toBe(3);
    expect(actionCount({ ...s, crew: 19 })).toBe(2);
    expect(actionCount({ ...s, crew: 9 })).toBe(1);
    expect(actionCount({ ...s, crew: 2 })).toBe(0);
    expect(actionCount(ship("Space Galleon"))).toBeNull();
    expect(actionCount({ ...s, hull: { ...s.hull, hp: 0 } })).toBe(0);
  });
  it("offers Move and Fire per weapon group with a working weapon", () => {
    const g = ship("Galley");
    expect(shipActions(g).map((a) => a.label)).toEqual(["Move", "Fire Ballistas", "Fire Mangonels"]);
    const broken = { ...g, comps: g.comps.map((c) => (c.group === "Mangonels" ? { ...c, hp: 0 } : c)) };
    expect(shipActions(broken).map((a) => a.label)).toEqual(["Move", "Fire Ballistas"]);
  });
  it("initiative: Dexterity modifier plus crew quality; none without Dexterity", () => {
    expect(shipInitiativeBonus(ship("Sailing Ship"))).toBe(-2 + 4);
    expect(shipInitiativeBonus(ship("Space Galleon"))).toBeNull();
  });
  it("finds the ships whose initiative came up, acting after units on the same count, across the round", () => {
    const a = ship("Sailing Ship", { id: "a", initiative: 15 }), b = ship("Warship", { id: "b", initiative: 8 }), c = ship("Galley", { id: "c", initiative: 20 });
    expect(shipsUpBetween([a, b, c], 18, 12, false).map((s) => s.id)).toEqual(["a"]);
    expect(shipsUpBetween([a, b, c], 15, 12, false).map((s) => s.id)).toEqual(["a"]);
    expect(shipsUpBetween([a, b, c], 18, 15, false)).toEqual([]);
    expect(shipsUpBetween([a, b, c], 10, 17, true).map((s) => s.id)).toEqual(["b", "c"]);
    expect(shipsUpBetween([ship("Space Galleon", { initiative: 14 })], 18, 12, false)).toEqual([]);
  });
  it("Full Speed Ahead lasts until the end of the ship's next turn and doesn't stack; Take Aim the same", () => {
    let s = startShipTurn(ship("Sailing Ship"));
    s = fullSpeedAhead(s, 4).ship;
    expect(shipSpeed(s, "breeze").speed).toBe(65);
    expect(fullSpeedAhead(s, 2)).toMatchObject({ kept: true });
    s = takeAim(s, comp(s, "Ballista").id);
    s = startShipTurn(s);
    expect(shipSpeed(s, "breeze").speed).toBe(65);
    expect(comp(s, "Ballista").aimAdv).toBe(2);
    s = startShipTurn(s);
    expect(shipSpeed(s, "breeze").speed).toBe(45);
    expect(comp(s, "Ballista").aimAdv).toBeUndefined();
  });
});

describe("ship movement", () => {
  it("uses the wind: into, with, dead calm (sails stop, oars row on)", () => {
    const s = ship("Sailing Ship");
    expect(shipSpeed(s, "breeze")).toMatchObject({ speed: 45, via: "Sails" });
    expect(shipSpeed({ ...s, heading: "into" }, "breeze").speed).toBe(15);
    expect(shipSpeed({ ...s, heading: "with" }, "strong").speed).toBe(60);
    expect(shipSpeed(s, "calm").speed).toBe(0);
    expect(shipSpeed(ship("Galley"), "calm")).toMatchObject({ speed: 30, via: "Oars" });
    expect(shipSpeed(ship("Battle Balloon"), "calm").speed).toBe(80);
  });
  it("loses speed as its movement component is damaged, and oars need their crew", () => {
    const s = ship("Sailing Ship");
    const sails = comp(s, "Sails");
    expect(shipSpeed({ ...s, comps: s.comps.map((c) => (c.id === sails.id ? { ...c, hp: 49 } : c)) }, "breeze").speed).toBe(35);
    expect(shipSpeed({ ...s, comps: s.comps.map((c) => (c.id === sails.id ? { ...c, hp: 0 } : c)) }, "breeze").speed).toBe(0);
    expect(shipSpeed({ ...ship("Galley"), crew: 39 }, "calm").speed).toBe(0);
  });
  it("can't turn without a helm; a balloon that's destroyed can't keep altitude", () => {
    const s = ship("Sailing Ship");
    expect(canTurn({ ...s, comps: s.comps.map((c) => (c.name === "Helm" ? { ...c, hp: 0 } : c)) })).toBe(false);
    const b = ship("Battle Balloon");
    expect(staysAloft(b)).toBe(true);
    expect(staysAloft({ ...b, comps: b.comps.map((c) => (c.name === "Balloon" ? { ...c, hp: 0 } : c)) })).toBe(false);
  });
});

describe("damage to ships", () => {
  it("applies the hull's damage threshold and immunity to Poison and Psychic; wrecks at 0", () => {
    const s = ship("Sailing Ship");
    expect(damageShip(s, "hull", 14)).toMatchObject({ applied: 0, why: "below the damage threshold of 15" });
    expect(damageShip(s, "hull", 40, "Poison")).toMatchObject({ applied: 0 });
    const hit = damageShip(s, "hull", 300);
    expect(hit).toMatchObject({ applied: 300, wrecked: true });
    expect(hit.ship.hull.hp).toBe(0);
  });
  it("destroys components at 0 HP; parts with no HP of their own can't be hit", () => {
    const s = ship("Sailing Ship");
    const helm = comp(s, "Helm");
    expect(damageShip(s, helm.id, 50)).toMatchObject({ applied: 50, destroyed: true });
    const sj = ship("Space Galleon");
    expect(damageShip(sj, comp(sj, "Spelljamming helm").id, 30).applied).toBe(0);
  });
  it("bosun's repairs heal each damaged part by its roll plus quality (at least 1) and revive destroyed components, not the hull", () => {
    const s = ship("Sailing Ship", { quality: -6 });
    const helm = comp(s, "Helm");
    const hurt = { ...s, hull: { ...s.hull, hp: 200 }, comps: s.comps.map((c) => (c.id === helm.id ? { ...c, hp: 0 } : c)) };
    const fixed = bosunRepair(hurt, { hull: 4, [helm.id]: 3 });
    expect(fixed.hull.hp).toBe(201);
    expect(comp(fixed, "Helm").hp).toBe(1);
    expect(bosunRepair({ ...s, hull: { ...s.hull, hp: 0 } }, { hull: 6 }).hull.hp).toBe(0);
  });
});

describe("ship weapons", () => {
  it("range: long range Disadvantage, inside the minimum or past long range can't; strong wind Disadvantage; Take Aim Advantage", () => {
    const a = comp(ship("Sailing Ship"), "Mangonel").attacks![0]!;
    expect(attackMode(a, { distance: 300, wind: "breeze" })).toMatchObject({ ok: true, mode: "disadvantage" });
    expect(attackMode(a, { distance: 50, wind: "breeze" }).ok).toBe(false);
    expect(attackMode(a, { distance: 900, wind: "breeze" }).ok).toBe(false);
    expect(attackMode(a, { distance: 150, wind: "strong", aimed: true })).toMatchObject({ ok: true, mode: "normal" });
    expect(attackMode(a, { wind: "breeze", aimed: true }).mode).toBe("advantage");
  });
  it("spelljammer weapons take their load and aim actions before they fire, then start over", () => {
    let m = comp(ship("Space Galleon"), "Mangonel");
    expect(weaponReady(m)).toBe(false);
    const did: string[] = [];
    for (let i = 0; i < 4; i++) { const r = weaponStep(m); did.push(r.did!); m = r.comp; }
    expect(did).toEqual(["load", "load", "aim", "aim"]);
    expect(weaponReady(m)).toBe(true);
    expect(weaponReady(afterFiring(m))).toBe(false);
  });
});

describe("crashing", () => {
  it("GoS: no crash against something two sizes smaller; stops against something at most one size smaller; ram", () => {
    const g = ship("Galley");
    expect(crashPlan(g, "M")).toMatchObject({ rules: "gos", noCrash: true, stops: false, targetDice: "16d10", dexDc: 17 });
    expect(crashPlan(g, "H")).toMatchObject({ noCrash: false, stops: true, shipDice: "8d10" });
    expect(crashPlan(g, "H").ram?.name).toBe("Naval Ram");
    expect(crashPlan(g, "S", { immovable: true })).toMatchObject({ noCrash: false, stops: true });
  });
  it("AAG: damage by the size of what was hit, stops against Gargantuan or immovable", () => {
    const sj = ship("Space Galleon");
    expect(crashPlan(sj, "H")).toMatchObject({ rules: "aag", shipDice: "8d10", targetDice: "8d10", stops: false });
    expect(crashPlan(sj, "G").stops).toBe(true);
  });
});

describe("crew", () => {
  it("group checks and mutiny", () => {
    expect(groupResult(5, 5)).toBe("total success");
    expect(groupResult(3, 5)).toBe("success");
    expect(groupResult(2, 5)).toBe("failure");
    expect(groupResult(0, 5)).toBe("total failure");
    expect(mutinyResult(0).mutiny).toBe(true);
    expect(mutinyResult(5)).toMatchObject({ mutiny: false, qualityChange: -1 });
    expect(mutinyResult(12).qualityChange).toBe(0);
  });
});

describe("creatures in the air", () => {
  const up = { ft: 60 };
  it("falls when Prone or stopped; 2024 also when Incapacitated; hovering or magic keeps it up", () => {
    expect(fallReason({ conditions: [{ key: "prone" }], fly: 60 }, up, "2024")).toMatch(/Prone/);
    expect(fallReason({ conditions: [{ key: "grappled" }], fly: 60 }, up, "2024")).toMatch(/speed 0/);
    expect(fallReason({ conditions: [{ key: "incapacitated" }], fly: 60 }, up, "2024")).toMatch(/Incapacitated/);
    expect(fallReason({ conditions: [{ key: "incapacitated" }], fly: 60 }, up, "2014")).toBeNull();
    expect(fallReason({ conditions: [{ key: "stunned" }], fly: 60 }, up, "2014")).toMatch(/Stunned/);
    expect(fallReason({ conditions: [{ key: "prone" }], fly: 60, hover: true }, up, "2024")).toBeNull();
    expect(fallReason({ conditions: [{ key: "prone" }] }, { ft: 60, magic: true }, "2024")).toBeNull();
    expect(fallReason({ conditions: [{ key: "prone" }] }, { ft: 0 }, "2024")).toBeNull();
    expect(fallReason({ conditions: [{ key: "exhaustion", level: 5 }], fly: 30 }, up, "2014")).toMatch(/Exhaustion/);
    expect(fallReason({ conditions: [{ key: "exhaustion", level: 6 }], fly: 30 }, up, "2024")).toMatch(/Exhaustion/);
  });
  it("fall distance and damage: 1d6 per 10 ft (at most 20d6), 500 ft per step with the rate of falling, minus fly speed for fliers", () => {
    expect(fallDice(35)).toBe("3d6");
    expect(fallDice(1000)).toBe("20d6");
    expect(fallDice(5)).toBe("");
    expect(fallStep(1200, false)).toBe(1200);
    expect(fallStep(1200, true)).toBe(500);
    expect(fallDamageFeet(100, { flierRule: true, fly: 60, conscious: true })).toBe(40);
    expect(fallDamageFeet(100, { flierRule: true, fly: 60, conscious: false })).toBe(100);
    expect(fallDamageFeet(100, { flierRule: false, fly: 60, conscious: true })).toBe(100);
  });
  it("a strong wind grounds fliers without magic or hovering", () => {
    expect(windGrounds("strong", up)).toBe(true);
    expect(windGrounds("breeze", up)).toBe(false);
    expect(windGrounds("strong", { ft: 60, magic: true })).toBe(false);
    expect(windGrounds("strong", up, true)).toBe(false);
  });
});

describe("naval state", () => {
  it("reads defaults and survives junk", () => {
    expect(readNaval({})).toMatchObject({ ships: [], wind: "breeze", underwater: false, aloft: {}, publicRolls: true });
    const n = readNaval({ [NAVAL_KEY]: { ships: [ship("Rowboat"), { nope: 1 }], wind: "strong", aloft: { a: { ft: 40, falling: { fallen: 10 } }, b: null } } });
    expect(n.ships).toHaveLength(1);
    expect(n.ships[0]!.comps.map((c) => c.name)).toEqual(["Oars"]);
    expect(n.wind).toBe("strong");
    expect(n.aloft).toEqual({ a: { ft: 40, falling: { fallen: 10 } } });
  });
});

describe("elemental airships (Forge of the Artificer)", () => {
  it("have a breakable core shard immune to Piercing and Slashing; a broken core stops the ship, a suppressed one leaves Fly 5", () => {
    const a = ship("Lyrandar Skyskiff");
    const core = comp(a, "Elemental core shard");
    expect(core).toMatchObject({ ac: 17, hp: 10 });
    expect(damageShip(a, core.id, 20, "Slashing").applied).toBe(0);
    expect(shipSpeed(a, "strong")).toMatchObject({ speed: 70 });
    expect(shipSpeed({ ...a, coreOff: true }, "breeze").speed).toBe(5);
    expect(shipSpeed(damageShip(a, core.id, 10, "Bludgeoning").ship, "breeze").speed).toBe(0);
  });
  it("crash with EFA's rules: damage by size struck (Medium or smaller 2d10), stops against its size or larger, dodge and deck saves", () => {
    const a = ship("Strider Airship");
    expect(crashRules(a)).toBe("efa");
    expect(crashPlan(a, "M")).toMatchObject({ rules: "efa", shipDice: "2d10", targetDice: "2d10", dodgeDc: 15, aboardDc: 10, stops: false });
    expect(crashPlan(a, "G").stops).toBe(true);
    expect(crashPlan(ship("Lyrandar Skyskiff"), "H").stops).toBe(true);
  });
  it("emergency repairs: a damaged part with at least 1 HP, once until docked", () => {
    const a = ship("Lyrandar Skyskiff");
    expect(canPatch(a, "hull")).toMatch(/isn't damaged/);
    const hurt = { ...a, hull: { ...a.hull, hp: 100 } };
    expect(canPatch(hurt, "hull")).toBeNull();
    expect(canPatch({ ...hurt, patched: ["hull"] }, "hull")).toMatch(/docked/);
    expect(canPatch({ ...a, hull: { ...a.hull, hp: 0 } }, "hull")).toMatch(/0 HP/);
  });
});
