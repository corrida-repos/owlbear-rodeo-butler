import { beforeEach, describe, expect, it } from "vitest";
import fighter from "./fixtures/ddb-synthetic-fighter.json";
import { Assembler, isChunk, splitMessage } from "../src/core/chunks";
import { BUTLER_ITEM_KEY } from "../src/core/constants";
import { applySelfSync, partyFromDdbExport } from "../src/core/party";
import { newState, SHEET_KEY, STATE_KEY } from "../src/core/sheet";
import { EDIT_REQUESTS, isPlayerRequest } from "../src/core/turns";
import { readUnit } from "../src/core/unit";
import { FakeScene } from "./fakeGateway";

const member = partyFromDdbExport({ schema: "owlbear-butler/ddb-export@1", single: true, campaign: { name: "Saga" }, fetchedAt: "2026-11-08T00:00:00Z", characters: [fighter], partyInventory: null }).members[0]!;

describe("chunked messages", () => {
  it("splits big payloads and reassembles them in any order", () => {
    const payload = { type: "sheet-sync", text: "x".repeat(30_000), n: 42 };
    const chunks = splitMessage("m1", payload, 12_000);
    expect(chunks).toHaveLength(3);
    expect(chunks.every(isChunk)).toBe(true);
    const a = new Assembler();
    expect(a.add(chunks[2]!)).toBeUndefined();
    expect(a.add(chunks[0]!)).toBeUndefined();
    expect(a.add(chunks[1]!)).toEqual(payload);
  });
  it("drops stale partial messages and rejects malformed chunks", () => {
    let t = 0;
    const a = new Assembler(1000, () => t);
    const [c0, c1] = splitMessage("m2", { s: "y".repeat(100) }, 60);
    a.add(c0!);
    t = 5000;
    expect(a.add(c1!)).toBeUndefined(); // c0 expired
    expect(isChunk({ v: 1, id: "x", seq: 3, total: 2, part: "" })).toBe(false);
    expect(isChunk({ v: 1, id: "x", seq: 0, total: 1000, part: "" })).toBe(false);
  });
});

describe("player requests", () => {
  const base = { v: 1, unitId: "u", playerId: "p", playerName: "Ana" };
  it("validates each type", () => {
    expect(isPlayerRequest({ ...base, type: "hp", change: { kind: "damage", amount: 4 } })).toBe(true);
    expect(isPlayerRequest({ ...base, type: "hp", change: { kind: "explode", amount: 4 } })).toBe(false);
    expect(isPlayerRequest({ ...base, type: "initiative", value: null })).toBe(true);
    expect(isPlayerRequest({ ...base, type: "condition-add", key: "prone" })).toBe(true);
    expect(isPlayerRequest({ ...base, type: "condition-remove", conditionId: "c1" })).toBe(true);
    expect(isPlayerRequest({ ...base, type: "sheet-sync", member, hp: "keep" })).toBe(true);
    expect(isPlayerRequest({ ...base, type: "sheet-sync", member, hp: "all" })).toBe(false);
    expect(isPlayerRequest({ ...base, type: "nope" })).toBe(false);
  });
  it("edits are gated by the player-edits setting, rolls and movement aren't", () => {
    expect(EDIT_REQUESTS).toEqual(expect.arrayContaining(["hp", "initiative", "condition-add", "condition-remove", "sheet-sync", "end-turn"]));
    expect(EDIT_REQUESTS).not.toContain("death-save");
    expect(EDIT_REQUESTS).not.toContain("rewind");
  });
  it("a synced character fits through the chunked channel", () => {
    const req = { ...base, type: "sheet-sync", member, hp: "keep" };
    const chunks = splitMessage("s", req);
    const a = new Assembler();
    let out: unknown;
    for (const c of chunks) out = a.add(c) ?? out;
    expect(isPlayerRequest(out)).toBe(true);
  });
});

describe("player self-sync from D&D Beyond (applied by the GM's client)", () => {
  let scene: FakeScene;
  const add = (id: string, label: string, extra: Record<string, unknown> = {}) => scene.items.push({
    id, type: "IMAGE", layer: "CHARACTER", name: label, label,
    metadata: { [SHEET_KEY]: member.sheet, [STATE_KEY]: newState(member.sheet, { hp: 3, tempHp: 2, party: true, inEncounter: true, initiative: 14, controlledBy: "ana" }), ...extra },
    position: { x: 0, y: 0 }, size: { w: 1, h: 1 },
  });
  beforeEach(() => { scene = new FakeScene(); });

  it("updates only the sheet, keeps HP and live state by default, records the D&D Beyond id", async () => {
    add("t1", member.name);
    const levelled = { ...member, sheet: { ...member.sheet, ac: member.sheet.ac + 1 } };
    expect(await applySelfSync(scene, "t1", levelled, "keep")).toBe(member.name);
    const u = readUnit(scene.items[0]!.metadata)!;
    expect(u.sheet.ac).toBe(member.sheet.ac + 1);
    expect(u.state).toMatchObject({ hp: 3, tempHp: 2, initiative: 14, controlledBy: "ana", inEncounter: true });
    expect((scene.items[0]!.metadata[BUTLER_ITEM_KEY] as { ddbId: number }).ddbId).toBe(member.ddbId);
  });

  it("takes HP from D&D Beyond when asked", async () => {
    add("t1", member.name);
    await applySelfSync(scene, "t1", member, "ddb");
    expect(readUnit(scene.items[0]!.metadata)!.state.hp).toBe(member.hp.current);
  });

  it("refuses another character: different D&D Beyond id, or a name that doesn't match", async () => {
    add("t1", member.name, { [BUTLER_ITEM_KEY]: { role: "party", ddbId: member.ddbId + 1, partyId: "x", syncedAt: "" } });
    await expect(applySelfSync(scene, "t1", member, "keep")).rejects.toThrow(/isn't the character/);
    add("t2", "Somebody Else");
    await expect(applySelfSync(scene, "t2", member, "keep")).rejects.toThrow(/doesn't match/);
    await expect(applySelfSync(scene, "gone", member, "keep")).rejects.toThrow(/no longer/);
  });

  it("accepts a token named with the first name only", async () => {
    add("t1", member.name.split(" ")[0]!);
    await expect(applySelfSync(scene, "t1", member, "keep")).resolves.toBe(member.name);
  });
});
