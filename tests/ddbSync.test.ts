/** Conditions synced from D&D Beyond (alongside ones added in Owlbear), and no limited-use counters on D&D Beyond characters. */
import { beforeEach, describe, expect, it } from "vitest";
import fighter from "./fixtures/ddb-synthetic-fighter.json";
import { ddbConditions } from "../src/core/ddb";
import { condition } from "../src/core/hp";
import { applySelfSync, partyFromDdbExport, syncedConditions, syncParty } from "../src/core/party";
import { isDdbSheet, newState, SHEET_KEY, STATE_KEY, type ConditionInstance } from "../src/core/sheet";
import { readUnit } from "../src/core/unit";
import { sheetUses } from "../src/core/uses";
import { FakeScene } from "./fakeGateway";

const exportWith = (conditions: unknown[]) => ({
  schema: "owlbear-butler/ddb-export@1", single: true, campaign: { name: "Saga" }, fetchedAt: "2026-11-11T00:00:00Z",
  characters: [{ ...fighter, conditions }], partyInventory: null,
});
const memberWith = (conditions: unknown[]) => partyFromDdbExport(exportWith(conditions)).members[0]!;
const keys = (cs: ConditionInstance[]) => cs.map((c) => `${c.key}${c.level ? ` ${c.level}` : ""}${c.source ? ` (${c.source})` : ""}`);

describe("conditions from D&D Beyond", () => {
  it("reads D&D Beyond's condition ids, Exhaustion with its level; unknown ids are flagged, not guessed", () => {
    expect(ddbConditions({ conditions: [{ id: 12, level: null }, { id: 4, level: 3 }, { id: 99 }] })).toEqual({
      conditions: [{ key: "prone" }, { key: "exhaustion", level: 3 }], unknown: [99],
    });
    const m = memberWith([{ id: 11 }, { id: 99 }]);
    expect(m.conditions).toEqual([{ key: "poisoned" }]);
    expect(m.flags.join(" ")).toMatch(/not recognised.*99/);
    expect(m.flags.join(" ")).not.toMatch(/not applied\)\.$|Active conditions on D&D Beyond/);
  });

  it("merges with conditions added in Owlbear", () => {
    const manualProne = condition("prone");
    const manualHex = condition("custom", { label: "Hexed" });
    const conc = condition("concentration");
    const oldSync = condition("poisoned", { source: "ddb" });
    const prev = [manualProne, manualHex, conc, oldSync];
    // D&D Beyond now says Prone and Exhaustion 2: its Prone replaces the Owlbear one; Poisoned (no longer on D&D Beyond) goes.
    const next = syncedConditions(prev, { conditions: [{ key: "prone" }, { key: "exhaustion", level: 2 }] });
    expect(keys(next)).toEqual(["custom", "concentration", "prone (ddb)", "exhaustion 2 (ddb)"]);
    // Nothing on D&D Beyond: synced ones are removed, Owlbear ones stay.
    expect(keys(syncedConditions(next, { conditions: [] }))).toEqual(["custom", "concentration"]);
    // An export without condition data (older bookmark): nothing changes.
    expect(syncedConditions(prev, {})).toBe(prev);
    // A player's self-sync can't slip in Butler's own statuses or junk.
    expect(keys(syncedConditions([], { conditions: [{ key: "dead" }, { key: "stunned" }, { key: "exhaustion", level: 40 }] as any }))).toEqual(["stunned (ddb)", "exhaustion 6 (ddb)"]);
  });

  describe("in a scene", () => {
    let scene: FakeScene;
    const m0 = memberWith([]);
    beforeEach(() => {
      scene = new FakeScene();
      scene.items.push({ id: "t1", type: "IMAGE", layer: "CHARACTER", name: m0.name, label: m0.name, position: { x: 0, y: 0 }, size: { w: 1, h: 1 },
        metadata: { [SHEET_KEY]: m0.sheet, [STATE_KEY]: newState(m0.sheet, { party: true, controlledBy: "ana", conditions: [condition("custom", { label: "Blessed" })] }) } });
    });
    const conds = () => keys(readUnit(scene.items[0]!.metadata)!.state.conditions);

    it("a player's self-sync applies D&D Beyond's conditions and keeps Owlbear's", async () => {
      await applySelfSync(scene, "t1", memberWith([{ id: 1 }, { id: 4, level: 1 }]), "keep");
      expect(conds()).toEqual(["custom", "blinded (ddb)", "exhaustion 1 (ddb)"]);
      await applySelfSync(scene, "t1", memberWith([{ id: 4, level: 2 }]), "keep");
      expect(conds()).toEqual(["custom", "exhaustion 2 (ddb)"]);
    });

    it("the GM's party sync does the same", async () => {
      const pkg = partyFromDdbExport(exportWith([{ id: 14 }]));
      await syncParty(pkg, { hp: "keep", createMissing: false }, scene);
      expect(conds()).toEqual(["custom", "stunned (ddb)"]);
    });
  });
});

describe("limited uses on D&D Beyond characters", () => {
  it("D&D Beyond sheets get no counters (their uses stay on D&D Beyond); others still do", () => {
    const m = memberWith([]);
    expect(isDdbSheet(m.sheet)).toBe(true);
    const withUses = { ...m.sheet, bonusActions: [...m.sheet.bonusActions, { name: "Second Wind (2/Short Rest, 1 used)", text: "" }] };
    expect(sheetUses(withUses)).toEqual([]);
    const homebrew = { ...withUses, source: { provenance: "homebrew" as const } };
    expect(isDdbSheet(homebrew)).toBe(false);
    expect(sheetUses(homebrew).map((r) => r.label)).toContain("Second Wind");
  });
});
