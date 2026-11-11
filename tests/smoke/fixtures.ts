/** Scene contents for the smoke tests: a party member, a goblin and a lair dragon with limited uses. */
import { newState, SHEET_KEY, SHEET_SCHEMA, STATE_KEY, type UnitSheet, type UnitState } from "../../src/core/sheet";

const base = (name: string, over: Partial<UnitSheet>): UnitSheet => ({
  schema: SHEET_SCHEMA, name, kind: "creature", size: "M", ac: 12, hp: { max: 20 }, speed: { walk: 30 },
  abilities: { str: 10, dex: 14, con: 12, int: 10, wis: 10, cha: 10 }, saves: {}, skills: [], defenses: {}, proficiencyBonus: 2,
  initiative: { modifier: 2, advantage: false, disadvantage: false, reasons: [] },
  traits: [], actions: [], bonusActions: [], reactions: [], legendary: [], spells: [], inventory: [], source: { provenance: "homebrew" }, flags: [], ...over,
});

export const thorn = base("Thorn", { kind: "character", level: 5, ac: 16, hp: { max: 44 }, proficiencyBonus: 3 });
export const goblin = base("Goblin", { actions: [{ name: "Scimitar", text: "Melee Attack Roll: +4 [1d20+4], reach 5 ft. Hit: 5 [1d6+2] Slashing damage." }] });
export const dragon = base("Adult Red Dragon", {
  size: "H", ac: 19, hp: { max: 256, formula: "19d12+133" }, cr: 17, proficiencyBonus: 6,
  traits: [{ name: "Legendary Resistance (3/Day)", text: "If the dragon fails a saving throw, it can choose to succeed instead." }],
  actions: [
    { name: "Bite", text: "Melee Attack Roll: +14 [1d20+14], reach 10 ft. Hit: 19 [2d10+8] Piercing damage." },
    { name: "Fire Breath (Recharge 5–6)", text: "Dexterity Saving Throw: DC 21. Failure: 63 [18d6] Fire damage. Success: Half damage." },
  ],
  legendary: [
    { name: "Legendary Actions", text: "The dragon can take 3 legendary actions, choosing from the options below." },
    { name: "Detect", text: "The dragon makes a Wisdom (Perception) check." },
    { name: "Wing Attack (Costs 2 Actions)", text: "The dragon beats its wings." },
  ],
  lair: [{ name: "Lair Actions", text: "On initiative count 20 (losing initiative ties), the dragon takes a lair action." }],
});

const IMG = { url: "/owlbear-rodeo-butler/tokens/party-placeholder.png", width: 300, height: 300, mime: "image/png" };

export function unitItem(id: string, sheet: UnitSheet, state: Partial<UnitState>, extra: Record<string, unknown> = {}) {
  return {
    id, type: "IMAGE", layer: "CHARACTER", name: sheet.name, visible: true, locked: false, createdUserId: "gm-1",
    zIndex: 1, lastModified: "2026-11-11T00:00:00Z", lastModifiedUserId: "gm-1", position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1 },
    image: IMG, grid: { dpi: 300, offset: { x: 150, y: 150 } }, text: { plainText: sheet.name, type: "LABEL", style: {}, richText: [] },
    metadata: { [SHEET_KEY]: sheet, [STATE_KEY]: newState(sheet, state) },
    ...extra,
  };
}

export const scene = () => ({
  items: [
    unitItem("pc", thorn, { party: true, initiative: 15, inEncounter: true, controlledBy: "player-1" }),
    unitItem("gob", goblin, { initiative: 22, inEncounter: true }),
    unitItem("drg", dragon, { initiative: 12, inEncounter: true }),
  ],
  players: [{ id: "player-1", connectionId: "c-2", role: "PLAYER", name: "Ana", color: "#f00", syncView: false, metadata: {}, selection: undefined }],
});
