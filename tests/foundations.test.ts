import { describe, expect, it } from "vitest";
import { seededRng } from "../src/core/dice";
import { canSeeRoll, isRollMessage, makeRoll, rollDestination, rollText } from "../src/core/rolls";
import { DEFAULT_SETTINGS, readSettings, SETTINGS_KEY, settingsUpdate } from "../src/core/settings";
import { migrateSheet, newState, normalizeState, SHEET_SCHEMA, validateSheet, type UnitSheet } from "../src/core/sheet";
import { displayConditions, DND5E_2014, DND5E_2024, getSystem, isBloodied, needsDeathSaves, searchableSource } from "../src/core/systems";

const wolf: UnitSheet = {
  schema: SHEET_SCHEMA, name: "Wolf", kind: "creature", size: "M", type: "Beast", ac: 12, hp: { max: 11, formula: "2d8+2" },
  speed: { walk: 40 }, abilities: { str: 14, dex: 15, con: 12, int: 3, wis: 12, cha: 6 }, saves: {}, skills: [{ name: "Perception", bonus: 5 }],
  defenses: {}, cr: 0.25, proficiencyBonus: 2, initiative: { modifier: 2, advantage: false, disadvantage: false, reasons: [] },
  traits: [{ name: "Pack Tactics", text: "…" }], actions: [{ name: "Bite", text: "+4 [1d20+4], 7 [2d4+2] piercing" }],
  bonusActions: [], reactions: [], legendary: [], spells: [], inventory: [], source: { provenance: "official", book: "XMM" }, flags: [],
};

describe("unit sheet", () => {
  it("validates and migrates v1", () => {
    expect(validateSheet(wolf)).toEqual([]);
    expect(migrateSheet(wolf)).toBe(wolf);
    expect(() => migrateSheet({ ...wolf, schema: "butler-sheet@99" })).toThrow(/Unknown/);
    expect(validateSheet({ ...wolf, hp: { max: 0 } })).toContain("hp.max: > 0");
  });
  it("new and normalized state", () => {
    expect(newState(wolf)).toMatchObject({ hp: 11, tempHp: 0, initiative: null, inEncounter: false, party: false, conditions: [] });
    expect(normalizeState({ hp: 3 }, wolf)).toMatchObject({ hp: 3, tempHp: 0, conditions: [] });
  });
});

describe("game systems", () => {
  it("offers only the room edition's core books in the 5etools search", () => {
    expect(["PHB", "MM", "DMG", "XPHB", "XMM", "XDMG", "CoS", "MPMM"].filter((b) => searchableSource(DND5E_2024, b))).toEqual(["XPHB", "XMM", "XDMG", "CoS", "MPMM"]);
    expect(["PHB", "MM", "DMG", "XPHB", "XMM", "XDMG", "CoS", "MPMM"].filter((b) => searchableSource(DND5E_2014, b))).toEqual(["PHB", "MM", "DMG", "CoS", "MPMM"]);
  });
  it("defaults to 5.5E", () => {
    expect(getSystem(undefined).id).toBe("dnd5e-2024");
    expect(getSystem("dnd5e-2014").id).toBe("dnd5e-2014");
  });
  it("concentration DC: 2024 caps at 30, 2014 doesn't", () => {
    expect(DND5E_2024.concentrationDc(5)).toBe(10);
    expect(DND5E_2024.concentrationDc(23)).toBe(11);
    expect(DND5E_2024.concentrationDc(100)).toBe(30);
    expect(DND5E_2014.concentrationDc(100)).toBe(50);
  });
  it("Bloodied: 5.5E only, at half HP or less, not once Dead", () => {
    const s = (hp: number, extra: object = {}) => ({ ...newState(wolf), hp, ...extra });
    expect(isBloodied(DND5E_2024, wolf, s(6))).toBe(false); // 6*2 = 12 > 11
    expect(isBloodied(DND5E_2024, wolf, s(5))).toBe(true);
    expect(isBloodied(DND5E_2014, wolf, s(5))).toBe(false);
    expect(isBloodied(DND5E_2024, wolf, s(0, { conditions: [{ id: "1", key: "dead" }] }))).toBe(false);
    expect(isBloodied(DND5E_2024, wolf, s(10, { maxHpOverride: 20 }))).toBe(true);
  });
  it("Death Saves: party members at 0 HP; Dead supersedes it", () => {
    const pc = { ...newState(wolf), party: true, hp: 0 };
    expect(needsDeathSaves(pc)).toBe(true);
    expect(needsDeathSaves({ ...pc, party: false })).toBe(false);
    expect(needsDeathSaves({ ...pc, hp: 1 })).toBe(false);
    const dead = { ...pc, conditions: [{ id: "1", key: "dead" }] };
    expect(needsDeathSaves(dead)).toBe(false);
    expect(displayConditions(DND5E_2024, wolf, dead).map((c) => c.key)).toEqual(["dead"]);
    const stable = { ...pc, conditions: [{ id: "1", key: "stable" }] };
    expect(needsDeathSaves(stable)).toBe(false);
    expect(displayConditions(DND5E_2014, wolf, stable).map((c) => c.key)).toEqual(["stable"]);
    expect(displayConditions(DND5E_2014, wolf, { ...pc, deathSaves: { successes: 1, failures: 2 } })).toEqual([
      { key: "death-saves", label: "Death Saves", automatic: true, detail: "1 ✓ / 2 ✗" },
    ]);
  });
  it("automatic conditions are derived, never read from storage", () => {
    const st = { ...newState(wolf), hp: 11, conditions: [{ id: "1", key: "bloodied" }, { id: "2", key: "prone" }] };
    expect(displayConditions(DND5E_2024, wolf, st).map((c) => c.key)).toEqual(["prone"]);
  });
});

describe("room settings", () => {
  it("defaults and merges", () => {
    expect(readSettings({})).toEqual(DEFAULT_SETTINGS);
    expect(readSettings({ [SETTINGS_KEY]: { system: "nope", playerEdits: false } })).toEqual({ ...DEFAULT_SETTINGS, playerEdits: false });
    const meta = settingsUpdate({}, { system: "dnd5e-2014" });
    expect(readSettings(meta).system).toBe("dnd5e-2014");
    expect(readSettings(settingsUpdate(meta, { autoDeadAtZero: true }))).toEqual({ ...DEFAULT_SETTINGS, system: "dnd5e-2014", autoDeadAtZero: true });
    expect(DEFAULT_SETTINGS.handheld).toBe(false);
    expect(readSettings(settingsUpdate(meta, { handheld: true })).handheld).toBe(true);
  });
});

describe("roll messages", () => {
  const gm = { id: "gm", name: "DM", role: "GM" as const };
  const ana = { id: "ana", name: "Ana", role: "PLAYER" as const };
  const opts = { rng: seededRng(1), newId: () => "r1", now: () => new Date("2026-11-08T00:00:00Z") };

  it("rolls and formats", () => {
    const m = makeRoll("1d20 + 4", "Scimitar · to hit", gm, "public", { ...opts, unit: { id: "t", name: "Goblin 2" } });
    expect(isRollMessage(m)).toBe(true);
    expect(m.total).toBe(m.dice[0]! + 4);
    expect(rollText(m)).toBe(`Goblin 2 · Scimitar · to hit: ${m.total} (1d20+4 → ${m.dice[0]} +4)`);
  });
  it("visibility: GM private stays local; player private reaches player + GMs only", () => {
    const pub = makeRoll("1d20", "x", ana, "public", opts);
    const gmPriv = makeRoll("1d20", "x", gm, "private", opts);
    const anaPriv = makeRoll("1d20", "x", ana, "private", opts);
    expect(rollDestination(pub)).toBe("ALL");
    expect(rollDestination(gmPriv)).toBe("LOCAL");
    expect(rollDestination(anaPriv)).toBe("ALL");
    const bob = { id: "bob", role: "PLAYER" as const };
    expect(canSeeRoll(pub, bob)).toBe(true);
    expect(canSeeRoll(anaPriv, bob)).toBe(false);
    expect(canSeeRoll(anaPriv, { id: "ana", role: "PLAYER" })).toBe(true);
    expect(canSeeRoll(anaPriv, { id: "gm", role: "GM" })).toBe(true);
    expect(rollText(anaPriv).startsWith("(private) ")).toBe(true);
  });
});
