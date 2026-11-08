import { describe, expect, it } from "vitest";
import index from "../public/data/monsters.json";
import { decodeEnvs, encodeEnvs, guessEnvs, normalizeEnvs } from "../src/core/habitat";
import { activeFilterCount, browse, crValue, matchesFilters, NO_FILTERS, type IndexRow } from "../src/core/search";

const row = (over: Partial<IndexRow>): IndexRow => ({
  name: "X", source: "XMM", cr: "1", type: "beast", size: "M", token: true, book: "MM", rules: "2024", envs: ["forest"], envAssigned: false, caster: false, ...over,
});

describe("environments", () => {
  it("normalizes 5etools environments; planes collapse to planar; any stays any", () => {
    expect(normalizeEnvs(["forest", "planar, feywild", "planar, abyss"])).toEqual(["forest", "planar"]);
    expect(normalizeEnvs(["any"])).toBe("any");
    expect(normalizeEnvs([])).toBeNull();
    expect(normalizeEnvs(undefined)).toBeNull();
  });
  it("encodes compactly with the assigned marker", () => {
    expect(encodeEnvs(["forest", "hill"], true)).toBe("~fh");
    expect(decodeEnvs("~fh")).toEqual({ envs: ["forest", "hill"], assigned: true });
    expect(decodeEnvs("*")).toEqual({ envs: "any", assigned: false });
  });
  it("assigns sensible environments by name, type and traits", () => {
    const g = (name: string, type: string, extra: Partial<Parameters<typeof guessEnvs>[0]> = {}) => guessEnvs({ name, type, speed: { walk: 30 }, traits: "", ...extra });
    expect(g("Young White Dragon", "dragon")).toContain("arctic");
    expect(g("Adult Black Dragon", "dragon")).toContain("swamp");
    expect(g("Frost Giant Jarl", "giant")).toContain("arctic");
    expect(g("Reef Shark", "beast", { speed: { swim: 40 } })).toContain("underwater");
    expect(g("Glabrezu", "fiend")).toContain("planar");
    expect(g("Gibbering Thing", "aberration")).toContain("underdark");
    expect(g("Town Crier", "humanoid")).toEqual(["urban"]);
    expect(g("Cave Lurker", "monstrosity", { traits: "Sunlight Sensitivity" })).toContain("underdark");
    expect(g("Nameless Beast", "beast", { speed: { walk: 30, fly: 60 } })).toEqual(["forest", "mountain"]);
  });
});

describe("search filters", () => {
  it("CR values and active count", () => {
    expect(crValue("1/4")).toBe(0.25);
    expect(crValue("")).toBeNull();
    expect(activeFilterCount(NO_FILTERS)).toBe(0);
    expect(activeFilterCount({ ...NO_FILTERS, crMin: "1", types: ["undead"], caster: "yes" })).toBe(3);
  });
  it("combines CR range, type, environment, size and spellcaster", () => {
    const f = { crMin: "1", crMax: "3", types: ["undead"], envs: ["swamp" as const], sizes: [], caster: "yes" as const };
    expect(matchesFilters(row({ cr: "2", type: "undead", envs: ["swamp"], caster: true }), f)).toBe(true);
    expect(matchesFilters(row({ cr: "5", type: "undead", envs: ["swamp"], caster: true }), f)).toBe(false);
    expect(matchesFilters(row({ cr: "2", type: "beast", envs: ["swamp"], caster: true }), f)).toBe(false);
    expect(matchesFilters(row({ cr: "2", type: "undead", envs: ["forest"], caster: true }), f)).toBe(false);
    expect(matchesFilters(row({ cr: "2", type: "undead", envs: "any", caster: true }), f)).toBe(true);
    expect(matchesFilters(row({ cr: "2", type: "undead", envs: ["swamp"], caster: false }), f)).toBe(false);
    expect(matchesFilters(row({ size: "L" }), { ...NO_FILTERS, sizes: ["T", "S"] })).toBe(false);
    expect(matchesFilters(row({ type: "beast/monstrosity" }), { ...NO_FILTERS, types: ["monstrosity"] })).toBe(true);
  });
  it("browsing with filters sorts by CR then name", () => {
    const out = browse([row({ name: "B", cr: "1" }), row({ name: "A", cr: "1/2" }), row({ name: "C", cr: "1" })], NO_FILTERS);
    expect(out.map((r) => r.name)).toEqual(["A", "B", "C"]);
  });
  it("the bundled index gives every creature an environment and the new columns", () => {
    const j = index as { columns: string[]; rows: unknown[][] };
    expect(j.columns).toEqual(["name", "source", "cr", "type", "size", "token", "env", "caster"]);
    expect(j.rows.every((r) => typeof r[6] === "string" && (r[6] as string).replace("~", "").length > 0)).toBe(true);
    const rows = j.rows.map(([name, source, cr, type, size, token, env, caster]) => {
      const e = decodeEnvs(String(env));
      return row({ name: String(name), source: String(source), cr: String(cr), type: String(type), size: String(size), token: !!token, envs: e.envs, envAssigned: e.assigned, caster: caster === 1 });
    });
    const swampUndeadCasters = browse(rows, { crMin: "1", crMax: "3", types: ["undead"], envs: ["swamp"], sizes: [], caster: "yes" });
    expect(swampUndeadCasters.length).toBeGreaterThan(0);
    expect(browse(rows, { ...NO_FILTERS, envs: ["arctic"], types: ["dragon"] }).some((r) => /White Dragon/.test(r.name))).toBe(true);
  });
});
