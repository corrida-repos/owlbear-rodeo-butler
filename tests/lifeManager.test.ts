import { expect, it } from "vitest";
import { quickStatblock } from "../src/core/custom";
import { importLifeManagerEncounter, lifeManagerMatch, lifeManagerOpponentIds, lifeManagerResult } from "../src/core/lifeManager";
import { parseTacticalEncounter, parseTacticalResult } from "../src/core/lifeManagerProtocol";
import { STATE_KEY } from "../src/core/sheet";
import { readUnit, unitMetadata, unitState } from "../src/core/unit";
import { FakeScene } from "./fakeGateway";

it("reuses the party, imports hidden creatures, and returns only linked campaign members", async () => {
  const scene = new FakeScene();
  const sheet = quickStatblock({ name: "A", ac: 13, hp: 20, initiative: 1 });
  const wolf = quickStatblock({ name: "Wolf", ac: 13, hp: 11, initiative: 2 });
  const image = { url: "https://example.com/token.png", mime: "image/png", width: 256, height: 256 };
  await scene.addImages([{ id: "pc", name: "A", layer: "CHARACTER", image,
    grid: { dpi: 256, offset: { x: 0, y: 0 } }, position: { x: 0, y: 0 }, visible: true, locked: false,
    metadata: unitMetadata(sheet, unitState(sheet, { max: 20, current: 20 }, null, { party: true, initiative: 17 })),
  }]);
  const encounter = parseTacticalEncounter(JSON.stringify({
    schema: "life-manager/encounter@1", id: "night", at: 600, title: "One wolf", activity: "rest",
    place: "Camp", distanceFt: 30, context: "On watch: A.", attitude: "Hostile", fightOrFlight: { kind: "save", leader: "Wolf", roll: 12, modifier: 1 }, rules: "2024", participants: [
      { id: "a", name: "A", side: "party", surprised: true, initiative: 17,
        vitals: { hp: 14, maxHp: 20, tempHp: 2, status: "alive", successes: 0, failures: 0, conditions: [] } },
      { id: "w", name: "Wolf", side: "encounter", source: "XMM", influencedAlly: true },
    ],
  }));
  const selection = { a: lifeManagerMatch(encounter.participants[0]!, await scene.getItems()), w: "create" };
  const creatures = new Map([["w", { sheet: wolf, image }]]);
  const center = { x: 0, y: 0 };
  await importLifeManagerEncounter(scene, encounter, selection, creatures, center, () => "wolf");
  expect(lifeManagerOpponentIds(scene.sceneMeta)).toEqual(["wolf"]);
  expect(encounter.fightOrFlight).toEqual({ kind: "save", leader: "Wolf", roll: 12, modifier: 1 });
  await expect(importLifeManagerEncounter(scene, encounter, selection, creatures, center)).rejects.toThrow("already");
  expect(scene.items.map((item) => [item.id, item.spec?.visible])).toEqual([["pc", true], ["wolf", false]]);
  const imported = readUnit(scene.items[0]!.metadata)!.state;
  expect(imported).toMatchObject({ hp: 14, tempHp: 2, initiative: 17, conditions: [{ key: "surprised" }] });
  expect(readUnit(scene.items[1]!.metadata)!.state).toMatchObject({ initiative: null, party: false, influencedAlly: true });
  await scene.patchMetadata([{ id: "pc", key: STATE_KEY, patch: { hp: 3, conditions: [{ id: "p", key: "prone" }] } }]);
  const result = parseTacticalResult(JSON.stringify(await lifeManagerResult(scene, 13, () => "done", "Creatures fled")));
  expect(result).toMatchObject({ id: "done", encounterId: "night", elapsedSeconds: 13, disposition: "Creatures fled",
    participants: [{ id: "a", vitals: { hp: 3, conditions: [{ key: "prone" }] } }] });
});
