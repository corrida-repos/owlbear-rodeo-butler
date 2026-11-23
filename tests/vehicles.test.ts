import { describe, expect, it } from "vitest";
import { readChase, CHASE_KEY } from "../src/core/chase";
import {
  crashDice, damageVehicle, driverProficient, effectiveDt, effectiveSpeed, liveVehicles, mishapFor, nextVehicle, placeUnit, readVehicle, ridersOf,
  vehicleComplicationFor, vehicleFromPreset, vehicleGridProblem, vehicleStats, vehicleOf, vehicleTest, VEHICLE_PRESETS, VEHICLE_TABLES, type Vehicle,
} from "../src/core/vehicles";

const preset = (k: string) => VEHICLE_PRESETS.find((p) => p.key === k)!;
const chariot = (patch: Partial<Vehicle> = {}): Vehicle => ({ ...vehicleFromPreset(preset("chariot"), "v1"), dt: 5, ...patch });

describe("vehicles (any vehicle, any terrain)", () => {
  it("presets become vehicles at full HP, named without the parenthesis", () => {
    const v = vehicleFromPreset(preset("chariot"), "v1");
    expect(v).toMatchObject({ name: "Chariot", ac: 17, hp: 30, maxHp: 30, dt: 0, mt: 10, speed: 60, side: "", riders: [], mishaps: [] });
    expect(VEHICLE_PRESETS.every((p) => p.stats.maxHp > 0 && p.stats.speed > 0)).toBe(true);
    expect(new Set(VEHICLE_PRESETS.map((p) => p.stats.terrain))).toEqual(new Set(["land", "water", "air"]));
  });
  it("puts units aboard: a new driver keeps the old one aboard; moving a unit takes it off the other vehicle", () => {
    let list = [chariot(), { ...chariot(), id: "v2", name: "Cart" }];
    list = placeUnit(list, "a", "v1", "driver");
    list = placeUnit(list, "b", "v1", "clinging");
    list = placeUnit(list, "c", "v1", "driver");
    expect(ridersOf(list[0]!)).toEqual([{ id: "c", at: "driver" }, { id: "b", at: "clinging" }, { id: "a", at: "aboard" }]);
    list = placeUnit(list, "c", "v2", "inside");
    expect(list[0]!.driver).toBeUndefined();
    expect(vehicleOf(list, "c")).toMatchObject({ vehicle: { id: "v2" }, at: "inside" });
    expect(vehicleOf(placeUnit(list, "c", null), "c")).toBeNull();
  });
  it("driver proficiency comes from the sheet (Vehicles (Land) / (Water)) unless the GM forces it", () => {
    expect(driverProficient(chariot(), { proficiencies: "Light Armor, Vehicles (Land)" })).toBe(true);
    expect(driverProficient(chariot(), { proficiencies: "Vehicles (Water)" })).toBe(false);
    expect(driverProficient({ terrain: "water" }, { proficiencies: "Vehicles (Water)" })).toBe(true);
    expect(driverProficient(chariot({ proficient: true }), undefined)).toBe(true);
  });
  it("vehicle tests: ability modifier + driver's proficiency; no driver or jammed steering fails; Exhaustion by edition", () => {
    const v = chariot();
    expect(vehicleTest(v, "check", "dex", 2, "2024")).toMatchObject({ auto: null, bonus: 4, mode: "normal" });
    expect(vehicleTest(v, "save", "dex", null, "2024").auto).toMatch(/no driver/);
    expect(vehicleTest(v, "save", "str", null, "2024").auto).toBeNull();
    expect(vehicleTest(chariot({ mishaps: ["steering"] }), "save", "dex", 2, "2024").auto).toMatch(/Jammed Steering/);
    expect(vehicleTest(chariot({ mishaps: ["gear"] }), "check", "dex", 0, "2024").mode).toBe("disadvantage");
    expect(vehicleTest(chariot({ exhaustion: 2 }), "save", "con", 0, "2024").bonus).toBe(1 - 4);
    expect(vehicleTest(chariot({ exhaustion: 1 }), "check", "con", 0, "2014").mode).toBe("disadvantage");
  });
  it("speed after Power Loss and Exhaustion; threshold after Loose Plating", () => {
    expect(effectiveSpeed(chariot({ mishaps: ["power"] }), "2024")).toBe(30);
    expect(effectiveSpeed(chariot({ exhaustion: 2 }), "2024")).toBe(50);
    expect(effectiveSpeed(chariot({ exhaustion: 2 }), "2014")).toBe(30);
    expect(effectiveSpeed(chariot({ exhaustion: 5 }), "2014")).toBe(0);
    expect(effectiveSpeed(chariot({ overturned: true }), "2024")).toBe(0);
    expect(effectiveDt(chariot({ mishaps: ["plating"] }))).toBe(0);
  });
  it("builds any vehicle from material, size, handling and speed", () => {
    expect(vehicleStats({ terrain: "land", size: "H", material: "iron", handling: "steady", speed: 90, weapons: true }))
      .toMatchObject({ ac: 19, maxHp: 120, dt: 10, mt: 20, str: 18, dex: 10, con: 14, speed: 90, weapons: true });
    expect(vehicleStats({ terrain: "air", size: "L", material: "cloth", handling: "agile", speed: 80 })).toMatchObject({ ac: 15, maxHp: 15, dt: 0, mt: 10, dex: 18 });
    expect(vehicleStats({ terrain: "water", size: "G", material: "wood", handling: "clumsy", speed: 30 })).toMatchObject({ ac: 13, maxHp: 200, dt: 5, mt: 20 });
  });
  it("vehicle chases need a grid of at least 100 ft per square", () => {
    expect(vehicleGridProblem({ multiplier: 100, unit: "ft" })).toBeNull();
    expect(vehicleGridProblem({ multiplier: 500, unit: "feet" })).toBeNull();
    expect(vehicleGridProblem({ multiplier: 5, unit: "ft" })).toMatch(/at least 100 ft/);
    expect(vehicleGridProblem({ multiplier: 1, unit: "mi" })).toMatch(/feet/);
    expect(vehicleGridProblem(null)).toBeTruthy();
  });
  it("damage: threshold, Poison/Psychic immunity, a mishap at the mishap threshold while moving", () => {
    expect(damageVehicle(chariot(), 4, "Slashing")).toMatchObject({ applied: 0, mishap: false });
    expect(damageVehicle(chariot(), 9, "Slashing")).toMatchObject({ applied: 9, mishap: false, vehicle: { hp: 21 } });
    expect(damageVehicle(chariot(), 12, "Fire")).toMatchObject({ applied: 12, mishap: true });
    expect(damageVehicle(chariot({ overturned: true }), 12)).toMatchObject({ mishap: false });
    expect(damageVehicle(chariot(), 40)).toMatchObject({ applied: 40, mishap: false, vehicle: { hp: 0 } });
    expect(damageVehicle(chariot(), 20, "Poison").applied).toBe(0);
  });
  it("crashes: 1d6 per 10 feet, at most 20d6", () => {
    expect(crashDice(9)).toBe("");
    expect(crashDice(120)).toBe("12d6");
    expect(crashDice(400)).toBe("20d6");
  });
  it("the next vehicle goes by its driver's initiative; driverless vehicles are skipped", () => {
    const a = chariot({ id: "a", driver: "pa", side: "quarry" }), b = chariot({ id: "b", driver: "pb", side: "pursuer" }), z = chariot({ id: "z", side: "pursuer" });
    const order = ["pb", "x", "pa"];
    expect(nextVehicle(order, [a, b, z], "a")!.id).toBe("b");
    expect(nextVehicle(order, [a, b, z], "b")!.id).toBe("a");
    expect(nextVehicle(order, [a], "a")).toBeNull();
    expect(liveVehicles([a, b, chariot({ id: "w", side: "pursuer", hp: 0 })], { escaped: ["a"], out: [] }).map((v) => v.id)).toEqual(["b"]);
  });
  it("complication tables: four terrains, d20, 1–10 complications and 11–20 none", () => {
    for (const t of Object.values(VEHICLE_TABLES)) {
      expect(t.flatMap((x) => Array.from({ length: x.roll[1] - x.roll[0] + 1 }, (_, i) => x.roll[0] + i))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    }
    expect(vehicleComplicationFor("streets", 11)).toBeNull();
    expect(vehicleComplicationFor("country", 9)).toMatchObject({ ifDashed: true, fail: { crash: true } });
    expect(vehicleComplicationFor("water", 7)!.riders!.thrownOff!.water).toBe(true);
    expect(vehicleComplicationFor("sky", 5)!.success!.cover).toBe(true);
  });
  it("mishaps: the d20 table", () => {
    expect(mishapFor(1).key).toBe("fire");
    expect(mishapFor(4).key).toBe("steering");
    expect(mishapFor(13).key).toBe("smoke");
    expect(mishapFor(20).key).toBe("overturn");
    expect(mishapFor(20).repair).toBeUndefined();
  });
  it("stored vehicles are read safely", () => {
    const c = readChase({ [CHASE_KEY]: { v: 1, mode: "vehicles", vehicleEnv: "water", vehicles: [{ id: "v", maxHp: 20, hp: 50, mishaps: ["fire", "nope"], riders: [{ id: "u", at: "weird" }] }, { nope: 1 }] } });
    expect(c.mode).toBe("vehicles");
    expect(c.vehicleEnv).toBe("water");
    expect(c.vehicles).toHaveLength(1);
    expect(c.vehicles[0]).toMatchObject({ hp: 20, mishaps: ["fire"], riders: [{ id: "u", at: "aboard" }] });
    expect(readVehicle(null)).toBeNull();
  });
});
