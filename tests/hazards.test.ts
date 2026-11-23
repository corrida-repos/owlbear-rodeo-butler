import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { imageSize } from "../scripts/lib/image-size";
import { MAP_ART } from "../scripts/map-art";
import { attackHits, entered, hasEffect, hazardDef, hazardOptions, HAZARDS, readHazard, resolveHazard, HAZARD_KEY } from "../src/core/hazards";
import { isRollable } from "../src/core/dice";

describe("hazards and traps (2024 DMG)", () => {
  it("covers the book's 12 hazards and 8 traps, each with a picture", () => {
    expect(HAZARDS.filter((h) => h.kind === "hazard")).toHaveLength(12);
    expect(HAZARDS.filter((h) => h.kind === "trap" && h.source === "XDMG")).toHaveLength(8);
    for (const h of HAZARDS) expect(existsSync(`public/hazards/${h.image}`), h.image).toBe(true);
  });
  it("save for half: Brown Mold DC 12 Con, 4d10 Cold", () => {
    const d = hazardDef("brown-mold")!;
    expect(resolveHazard(d, "Wolf", 8, [22])).toMatchObject({ damage: 22, failed: true });
    expect(resolveHazard(d, "Wolf", 14, [22])).toMatchObject({ damage: 11, failed: false });
  });
  it("save or condition: Webs restrain on a failure only", () => {
    const d = hazardDef("webs")!;
    expect(resolveHazard(d, "Ana", 5, []).conditions.map((c) => c.key)).toEqual(["restrained"]);
    expect(resolveHazard(d, "Ana", 12, []).conditions).toEqual([]);
    expect(resolveHazard(d, "Ana", 12, []).text).toBe("Webs → Ana: 12 vs DC 12: succeeds.");
  });
  it("no save: a Spiked Pit always hurts and knocks Prone; Razorvine does nothing on a success", () => {
    const pit = resolveHazard(hazardDef("spiked-pit")!, "Bo", null, [3, 9]);
    expect(pit).toMatchObject({ damage: 12, failed: true });
    expect(pit.conditions.map((c) => c.key)).toEqual(["prone"]);
    expect(resolveHazard(hazardDef("razorvine")!, "Bo", 11, [6]).damage).toBe(0);
  });
  it("reads placed hazards and finds newly entered ones", () => {
    expect(readHazard({ [HAZARD_KEY]: { key: "webs" } })).toEqual({ key: "webs", armed: true });
    expect(readHazard({ [HAZARD_KEY]: { key: "nope" } })).toBeNull();
    expect(entered(new Set(["a"]), new Set(["a", "b"]))).toEqual(["b"]);
  });
});

// Every trap in 5etools' trapshazards.json (official books and adventures), as name|source.
const FIVETOOLS_TRAPS: string[] = ["Balance and Ruin|BMT", "Bear Trap|XGE", "Collapsing Roof|DMG", "Collapsing Roof|XDMG", "Crossbow Trap|XGE", "Danse Macabre|VRGR", "Death Fog Trap|RtG", "Faceless Malice|VRGR", "Falling Net|DMG", "Falling Net|XDMG", "Falling Portcullis|XGE", "Fiery Blast Trap|XGE", "Fire-Breathing Statue|DMG", "Fire-Casting Statue|XDMG", "Hidden Pit|XDMG", "Icon of the Lower Aerial Kingdoms|VRGR", "Malfunctioning Phase Transference Emitter|AZfyT", "Morbid Memory|VRGR", "Net Trap|XGE", "Path of Blades|XGE", "Pit Trap|XGE", "Pits|DMG", "Poison Darts|DMG", "Poison Needle Trap|XGE", "Poison Needle|DMG", "Poisoned Darts|XDMG", "Poisoned Needle|XDMG", "Poisoned Tempest|XGE", "Rolling Sphere|DMG", "Rolling Stone|XDMG", "Scything Blade Trap|XGE", "Sleep of Ages Trap|XGE", "Sphere of Annihilation|DMG", "Sphere of Crushing Doom|XGE", "Spiked Pit|XDMG", "Surface of the Sun|BMT", "Test of the Empty Moon|BMT"];

describe("every official trap in 5etools", () => {
  it("each 5etools trap has a deployable entry", () => {
    const have = new Set(HAZARDS.filter((h) => h.kind === "trap").map((h) => h.fivetools ?? `${h.name}|${h.source}`));
    expect(FIVETOOLS_TRAPS.filter((n) => !have.has(n))).toEqual([]);
  });
  it("every picture is 512 × 512 (placement assumes it); every hazard and trap has top-down map art", () => {
    for (const h of HAZARDS) expect(imageSize(readFileSync(`public/hazards/${h.image}`)), h.image).toMatchObject({ width: 512, height: 512 });
    expect(HAZARDS.filter((h) => !MAP_ART[h.key]).map((h) => h.key)).toEqual([]);
  });
  it("keys are unique; every entry does something and its dice roll", () => {
    expect(new Set(HAZARDS.map((h) => h.key)).size).toBe(HAZARDS.length);
    for (const h of HAZARDS) {
      const opts = hazardOptions(h);
      expect(opts.length, h.key).toBeGreaterThan(0);
      // Automatic triggers run the main effect, so there must be one.
      if (h.triggers.length) expect(hasEffect(h), h.key).toBe(true);
      for (const o of opts) for (const dm of o.effect.damage ?? []) expect(/^\d+$/.test(dm.formula) || isRollable(dm.formula), `${o.name}: ${dm.formula}`).toBe(true);
    }
  });
  it("attack traps: a miss does nothing, each hit deals damage and adds the condition", () => {
    const bear = hazardDef("bear-trap")!;
    expect(resolveHazard(bear, "Ana", null, [], undefined, { hits: 0 })).toMatchObject({ damage: 0, conditions: [], text: "Bear Trap → Ana: Misses." });
    const hit = resolveHazard(bear, "Ana", null, [6], undefined, { hits: 1 });
    expect(hit.damage).toBe(6);
    expect(hit.conditions.map((c) => c.label)).toEqual(["Bear Trap"]);
    expect(resolveHazard(hazardDef("crossbow-trap")!, "Bo", null, [11], undefined, { hits: 2 }).text).toBe("Crossbow Trap → Bo: 2 of 2 attacks hit. 11 Piercing damage.");
    expect(attackHits(20, 5, 30)).toEqual({ hit: true, crit: true });
    expect(attackHits(1, 30, 10)).toEqual({ hit: false, crit: false });
    expect(attackHits(12, 18, 18)).toEqual({ hit: true, crit: false });
  });
  it("damage and conditions taken whatever the save", () => {
    // 2014 Poison Needle: 1 Piercing + 2d10 Poison regardless; Poisoned only on a failure.
    const needle = hazardDef("poison-needle")!;
    expect(resolveHazard(needle, "Cy", 18, [1, 12])).toMatchObject({ damage: 13, conditions: [] });
    expect(resolveHazard(needle, "Cy", 3, [1, 12]).conditions.map((c) => c.key)).toEqual(["poisoned"]);
    // 2014 Poison Darts: hit → 1d4 Piercing, then a Con save for half of the 2d10 Poison.
    expect(resolveHazard(hazardDef("poison-darts")!, "Cy", 20, [3, 10], undefined, { hits: 1 }).text).toBe("Poison Darts → Cy: Hit. 20 vs DC 15: succeeds. 3 Piercing + 5 Poison damage (half).");
    // 2014 Falling Net: Restrained regardless, Prone on a failed Strength save.
    const net = hazardDef("falling-net-2014")!;
    expect(resolveHazard(net, "Di", 15, []).conditions.map((c) => c.key)).toEqual(["restrained"]);
    expect(resolveHazard(net, "Di", 4, []).conditions.map((c) => c.key)).toEqual(["restrained", "prone"]);
  });
  it("complex traps offer their elements; a trap that only announces says so", () => {
    expect(hazardOptions(hazardDef("path-of-blades")!).map((o) => o.name)).toEqual([
      "Path of Blades: Whirling Blades (initiative 20)", "Path of Blades: Crushing Pillars (initiative 10)",
      "Path of Blades: Rune of Fear (initiative 10, and end of turn)", "Path of Blades: Whirling Blades (end of turn)"]);
    expect(hazardOptions(hazardDef("surface-of-the-sun")!).map((o) => o.name)).toEqual(["Surface of the Sun", "Surface of the Sun: Talons Pedestal"]);
    const pillars = hazardOptions(hazardDef("path-of-blades")!)[1]!;
    expect(resolveHazard({ ...pillars.effect, name: pillars.name }, "Ed", 9, [12]).text).toBe("Path of Blades: Crushing Pillars (initiative 10) → Ed: 9 vs DC 15: fails. 12 Bludgeoning damage. Prone.");
    expect(resolveHazard(hazardDef("falling-portcullis")!, "Ed", null, []).text).toBe("Falling Portcullis → Ed: An iron portcullis drops from the ceiling, blocking the way.");
  });
});

describe("hazard damage and the creature's defenses", async () => {
  const { damageAgainst, immuneToCondition, parseDefenses } = await import("../src/core/defenses");
  it("reads defense lines, keeping qualified B/P/S conditional", () => {
    const d = parseDefenses("Cold, Fire; Bludgeoning, Piercing, and Slashing from Nonmagical Attacks");
    expect([...d.always]).toEqual(["Cold", "Fire"]);
    expect([...d.conditional].sort()).toEqual(["Bludgeoning", "Piercing", "Slashing"]);
    // 5etools flattens the group into one comma list: still only B/P/S are conditional.
    expect([...parseDefenses("Acid, Bludgeoning, Piercing, Slashing from nonmagical attacks").always]).toEqual(["Acid"]);
  });
  it("Immunity, Resistance (round down), Vulnerability (×2), conditional reported", () => {
    expect(damageAgainst({ immune: "Poison" }, 12, "Poison")).toEqual({ amount: 0, note: "Immunity to Poison" });
    expect(damageAgainst({ resist: "Cold" }, 11, "cold").amount).toBe(5);
    expect(damageAgainst({ vulnerable: "Fire" }, 7, "Fire").amount).toBe(14);
    expect(damageAgainst({ resist: "Bludgeoning from nonmagical attacks" }, 10, "Bludgeoning")).toEqual({ amount: 10, note: "a conditional Bludgeoning defense on its sheet wasn't applied" });
    expect(damageAgainst(undefined, 9, "Acid").amount).toBe(9);
    expect(immuneToCondition({ conditionImmune: "Charmed, Poisoned" }, "poisoned")).toBe(true);
    expect(immuneToCondition({ conditionImmune: "Charmed" }, "restrained")).toBe(false);
  });
  it("Brown Mold vs a creature resistant to Cold: half on a save, then halved again", () => {
    const d = hazardDef("brown-mold")!;
    const r = resolveHazard(d, "Yeti", 14, [22], { resist: "Cold" });
    expect(r.damage).toBe(5);
    expect(r.text).toBe("Brown Mold → Yeti: 14 vs DC 12: succeeds. 5 Cold damage (half; Resistance to Cold).");
    expect(resolveHazard(d, "Fire elemental", 3, [22], { immune: "Cold" }).text).toBe("Brown Mold → Fire elemental: 3 vs DC 12: fails. No damage (Immunity to Cold).");
  });
  it("mixed damage types are handled one by one; immune conditions are skipped", () => {
    // Spiked Pit: 1d6 Bludgeoning + 2d8 Piercing, Prone.
    const r = resolveHazard(hazardDef("spiked-pit")!, "Golem", null, [4, 10], { immune: "Piercing" });
    expect(r.damage).toBe(4);
    const ooze = resolveHazard(hazardDef("yellow-mold")!, "Ooze", 2, [11], { immune: "Poison", conditionImmune: "Poisoned" });
    expect(ooze).toMatchObject({ damage: 0, conditions: [] });
    expect(ooze.text).toMatch(/Immune to Poisoned\.$/);
  });
});

describe("defenses for chase complications and mob rolls", async () => {
  const { hitAgainst } = await import("../src/core/defenses");
  it("one hit with several damage types: each type on its own, untyped as it is", () => {
    // A flame tongue hit (5 Slashing + 7 Fire) on a creature resistant to Fire.
    expect(hitAgainst({ resist: "Fire" }, [{ amount: 5, type: "Slashing" }, { amount: 7, type: "Fire" }])).toEqual({ amount: 8, notes: ["Resistance to Fire"] });
    expect(hitAgainst({ immune: "Slashing" }, [{ amount: 5, type: "Slashing" }, { amount: 4 }])).toEqual({ amount: 4, notes: ["Immunity to Slashing"] });
  });
});
