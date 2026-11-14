import { describe, expect, it } from "vitest";
import fighter from "./fixtures/ddb-synthetic-fighter.json";
import { bandFor, gridFeet, isAim, meleeReachOf, reachOf, widest, type Box } from "../src/core/reach";
import { actionBar, barLayout, ATTACK_KEY } from "../src/core/actions";
import { convertDdbCharacter } from "../src/core/ddb";

const r = (text: string, name = "X") => reachOf({ key: `actions:${name}`, name, text });
const kinds = (text: string) => r(text)?.bands.map((b) => `${b.kind} ${b.feet}`);

describe("reach: parsing an action's reach and range", () => {
  it("reads weapon reach and range, long range included", () => {
    expect(kinds("Melee Attack Roll: +5 [1d20+5], reach 5 ft. Hit: 1d8+3 [1d8+3] Slashing damage.")).toEqual(["reach 5"]);
    expect(kinds("Melee Attack Roll: +10 [1d20+10], reach 10 ft. Hit: 2d10+6 [2d10+6] Slashing damage.")).toEqual(["reach 10"]);
    expect(kinds("Ranged Attack Roll: +4 [1d20+4], range 80/320 ft. Hit: 1d8+2 [1d8+2] Piercing damage.")).toEqual(["range 80", "long 320"]);
    expect(kinds("Melee or Ranged Attack Roll: +4 [1d20+4], reach 5 ft. or range 20/60 ft. Hit: 1d6+2 Piercing.")).toEqual(["reach 5", "range 20", "long 60"]);
    expect(kinds("Ranged Attack Roll: +5 [1d20+5], range 60 ft. Hit: 11 (2d10) Radiant damage.")).toEqual(["range 60"]);
    expect(r("Ranged Attack Roll: +4, range 80/320 ft.")!.bands.at(-1)!.label).toContain("Disadvantage");
  });

  it("reads a D&D Beyond spell's range tag, Touch, and areas on the caster", () => {
    expect(kinds("Ranged spell attack +5 [1d20+5]; 2d10 [2d10] fire. [Action, 120 ft.] Hurl a mote of fire.")).toEqual(["range 120"]);
    expect(kinds("Cure. [Action, Touch] A creature you touch regains hit points.")).toEqual(["reach 5"]);
    expect(r("+5 AC. [Reaction, Self]")).toBeNull();
    expect(r("Teleport. [Bonus Action, Self]")).toBeNull();
    // Older syncs: the area is only in the description; newer ones put it in the tag.
    expect(kinds("Dex save DC 13. [Action, Self] Each creature in a 15-foot cone must make a saving throw.")).toEqual(["aim 15"]);
    expect(kinds("Dex save DC 13. [Action, Self (15-ft. Cone)] Flames.")).toEqual(["aim 15"]);
    expect(kinds("[Action, Concentration, Self (10-ft. Emanation)] Spirits swirl around you.")).toEqual(["area 10"]);
    const fireball = r("Dex save DC 15. [Action, 150 ft. (20-ft. Sphere)] A bright streak flashes.")!;
    expect(fireball.bands.map((b) => `${b.kind} ${b.feet}`)).toEqual(["range 150"]);
    expect(fireball.note).toBe("20-ft-radius Sphere at a point in range");
    expect(kinds("A ward. [1 minute, Ritual, 30 ft.]")).toEqual(["range 30"]);
  });

  it("reads a creature's breath, auras and targets within a distance", () => {
    expect(kinds("Dexterity Saving Throw: DC 17, each creature in a 30-foot Cone. Failure: 16d6 [16d6] Fire damage.")).toEqual(["aim 30"]);
    expect(kinds("Each creature in a 60-foot-long, 5-foot-wide Line must make a DC 13 save.")).toEqual(["aim 60"]);
    expect(kinds("The dragon exhales acid in a line that is 30 feet long and 5 feet wide.")).toEqual(["aim 30"]);
    expect(kinds("Each creature within 10 ft. makes a DC 18 Dexterity save.")).toEqual(["area 10"]);
    expect(kinds("Each creature within 5 feet of it must make a DC 14 Constitution saving throw.")).toEqual(["area 5"]);
    expect(kinds("Each creature of its choice within 120 feet of it must succeed on a DC 16 Wisdom save.")).toEqual(["area 120"]);
    expect(kinds("The dragon exhales: a 20-foot-radius Sphere centered on itself.")).toEqual(["area 20"]);
    expect(kinds("The hag targets one creature it can see within 60 feet of it.")).toEqual(["range 60"]);
    const point = r("Each creature in a 20-foot-radius Sphere centered on a point within 150 feet must save.")!;
    expect(point.bands.map((b) => `${b.kind} ${b.feet}`)).toEqual(["range 150"]);
    expect(point.note).toContain("20-ft-radius Sphere");
  });

  it("uses the unit's reach for the rules' options that say within reach, and nothing for Dash", () => {
    expect(reachOf({ key: "common:Shove", name: "Shove", text: "Push a creature no more than one size larger than you, within reach." }, 10)!.bands)
      .toEqual([{ kind: "reach", feet: 10, label: "Reach 10 ft" }]);
    expect(r("When a creature you can see leaves your reach, you can make one melee attack.")!.bands[0]!.feet).toBe(5);
    expect(r("Double your movement for the turn.")).toBeNull();
    expect(r("The wolf has Advantage on an attack roll against a creature if at least one of its allies is within 5 feet of the creature.")).toBeNull();
    expect(meleeReachOf(["Melee Attack Roll: +5, reach 5 ft.", "Melee Attack Roll: +7, reach 15 ft."])).toBe(15);
    expect(meleeReachOf([])).toBe(5);
  });

  it("gives the Attack tile the farthest reach and range of its attacks", () => {
    const sheet = convertDdbCharacter(fighter).sheet;
    sheet.actions.push({ name: "Longbow", text: "Ranged Attack Roll: +5 [1d20+5], range 150/600 ft. Hit: 1d8+3 [1d8+3] Piercing damage." });
    const layout = barLayout(actionBar(sheet, "2024"));
    expect(layout.attackOptions.some((o) => o.key !== ATTACK_KEY)).toBe(true);
    const w = widest(layout.attackOptions.map((o) => reachOf(o)))!;
    expect(w.bands.map((b) => `${b.kind} ${b.feet}`)).toEqual(["reach 5", "range 150", "long 600"]);
    expect(widest([null, null])).toBeNull();
  });
});

describe("reach: distances on the grid", () => {
  const cell = 100;
  /** A token covering `size` cells with its top-left cell at (x, y). */
  const at = (x: number, y: number, size = 1): Box => ({ min: { x: x * cell, y: y * cell }, max: { x: (x + size) * cell, y: (y + size) * cell } });

  it("counts edge to edge: next to you is 5 ft, diagonals depend on the grid's measurement", () => {
    expect(gridFeet(at(0, 0), at(1, 0), cell, 5)).toBe(5);
    expect(gridFeet(at(0, 0), at(1, 1), cell, 5)).toBe(5);
    expect(gridFeet(at(0, 0), at(3, 0), cell, 5)).toBe(15);
    expect(gridFeet(at(0, 0), at(3, 3), cell, 5, "CHEBYSHEV")).toBe(15);
    expect(gridFeet(at(0, 0), at(3, 3), cell, 5, "ALTERNATING")).toBe(20);
    expect(gridFeet(at(0, 0), at(3, 3), cell, 5, "MANHATTAN")).toBe(30);
    expect(gridFeet(at(0, 0), at(3, 4), cell, 5, "EUCLIDEAN")).toBe(25);
  });

  it("measures from the edge of a large creature's space, and tolerates tokens a bit off the grid", () => {
    // A Large (2×2) creature at (0,0)-(2,2): a target at (3,0) is one square past its edge.
    expect(gridFeet(at(0, 0, 2), at(3, 0), cell, 5)).toBe(10);
    expect(gridFeet(at(0, 0, 2), at(2, 1), cell, 5)).toBe(5);
    const nudged: Box = { min: { x: 104, y: 3 }, max: { x: 196, y: 95 } };
    expect(gridFeet(at(0, 0), nudged, cell, 5)).toBe(5);
    expect(gridFeet(at(0, 0), at(2, 0), cell, 10)).toBe(20);
  });

  it("puts a target in the nearest band that reaches it", () => {
    const bow = r("Ranged Attack Roll: +5, range 80/320 ft.")!;
    expect(bandFor(bow, 60)!.kind).toBe("range");
    expect(bandFor(bow, 80)!.kind).toBe("range");
    expect(bandFor(bow, 85)!.kind).toBe("long");
    expect(bandFor(bow, 325)).toBeNull();
  });
});

describe("reach: messages from the action bar", () => {
  it("accepts a well-formed aim and rejects anything else", () => {
    const aim = { unitId: "u1", name: "Longbow", reach: r("Ranged Attack Roll: +5, range 80/320 ft.")! };
    expect(isAim(aim)).toBe(true);
    expect(isAim(JSON.parse(JSON.stringify(aim)))).toBe(true);
    expect(isAim(null)).toBe(false);
    expect(isAim({ unitId: "u1", name: "x", reach: { bands: [{ kind: "nope", feet: 5, label: "" }] } })).toBe(false);
    expect(isAim({ unitId: "u1", name: "x", reach: { bands: [{ kind: "reach", feet: Infinity, label: "" }] } })).toBe(false);
  });
});

describe("reach: the rules' options", () => {
  const sheet = convertDdbCharacter(fighter).sheet;
  const bar = actionBar(sheet, "2024", { dmg: true });
  const of = (name: string, reach = 5) => reachOf(bar.items.find((i) => i.key === `common:${name}`)!, reach);

  it("reach for attack options, 5 ft for Help and Stabilize, a thrown range for an improvised weapon, nothing for Dash", () => {
    expect(of("Grapple", 10)!.bands).toEqual([{ kind: "reach", feet: 10, label: "Reach 10 ft" }]);
    expect(of("Shove")!.bands.map((b) => b.kind)).toEqual(["reach"]);
    expect(of("Help")!.bands[0]!.feet).toBe(5);
    expect(of("Improvised Weapon")!.bands.map((b) => `${b.kind} ${b.feet}`)).toEqual(["reach 5", "range 20", "long 60"]);
    expect(of("Dash")).toBeNull();
    expect(of("Dodge")).toBeNull();
  });
});
