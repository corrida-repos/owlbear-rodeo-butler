import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { entered, hazardDef, HAZARDS, readHazard, resolveHazard, HAZARD_KEY } from "../src/core/hazards";

describe("hazards and traps (2024 DMG)", () => {
  it("covers the book's 12 hazards and 8 traps, each with a picture", () => {
    expect(HAZARDS.filter((h) => h.kind === "hazard")).toHaveLength(12);
    expect(HAZARDS.filter((h) => h.kind === "trap")).toHaveLength(8);
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
