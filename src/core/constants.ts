/** Namespace for this importer's own metadata (items + scene). */
export const BUTLER_NS = "dev.owlbear-butler";
export const BUTLER_ITEM_KEY = `${BUTLER_NS}/import`;
export const BUTLER_SCENE_KEY = `${BUTLER_NS}/imports`;
export const PACKAGE_SCHEMA = "owlbear-butler/encounter@1";

/** Forge! extension id; every Forge unit/room key is `${FORGE_NS}/<key>`. */
export const FORGE_NS = "com.battle-system.forge";

/**
 * Forge unit-level keys (non-attribute). Source: Forge 1.6.0 bundle,
 * assets/MetadataKeys-*.js (fetched 2026-11-04) + earlier live experiment.
 */
export const FORGE_KEYS = {
  UNIT_NAME: `${FORGE_NS}/name`,
  FABRICATED: `${FORGE_NS}/fabd`,
  ON_LIST: `${FORGE_NS}/on-list`,
  IN_PARTY: `${FORGE_NS}/in-party`,
  INITIATIVE: `${FORGE_NS}/init`,
  PORTRAIT_URL: `${FORGE_NS}/porturl`,
} as const;

/** Room metadata keys Forge uses to record which system is loaded (assets/systemKeys-*.js). */
export const FORGE_ROOM_KEYS = {
  SYSTEM_NAME: `${FORGE_NS}/SystemName`,
  SNAPSHOT_PUBLIC_ID: `${FORGE_NS}/SnapshotPublicId`,
} as const;

export type ForgeAttrType = "numb" | "text" | "list";

export interface ForgeAttribute {
  bid: string;
  abbr: string;
  name: string;
  type: ForgeAttrType;
}

/**
 * Complete attribute dictionary of Forge's built-in "Dungeons & Dragons 5E" system
 * (system id `default-game-system`), transcribed from the Forge 1.6.0 bundle
 * assets/defaultgamesystem-*.js on 2026-11-04. Not invented: every BID below exists there.
 */
export const FORGE_DEFAULT_DND5E: ForgeAttribute[] = [
  { bid: "Z001", abbr: "LVL", name: "Level", type: "numb" },
  { bid: "Z002", abbr: "SIZ", name: "Size", type: "text" },
  { bid: "Z003", abbr: "ALN", name: "Alignment", type: "text" },
  { bid: "Z004", abbr: "SPC", name: "Species", type: "text" },
  { bid: "Z005", abbr: "HP", name: "Hit Points", type: "numb" },
  { bid: "Z006", abbr: "MHP", name: "Max Hit Points", type: "numb" },
  { bid: "Z007", abbr: "AC", name: "Armor Class", type: "numb" },
  { bid: "Z008", abbr: "WSP", name: "Walk Speed", type: "numb" },
  { bid: "Z009", abbr: "SSP", name: "Swim Speed", type: "numb" },
  { bid: "Z010", abbr: "BSP", name: "Burrow Speed", type: "numb" },
  { bid: "Z011", abbr: "CSP", name: "Climb Speed", type: "numb" },
  { bid: "Z012", abbr: "FSP", name: "Fly Speed", type: "numb" },
  { bid: "Z013", abbr: "SSS", name: "Senses", type: "text" },
  { bid: "Z014", abbr: "SKS", name: "Skills", type: "text" },
  { bid: "Z015", abbr: "LNG", name: "Languages", type: "text" },
  { bid: "Z016", abbr: "CRT", name: "Challenge Rating", type: "numb" },
  { bid: "Z017", abbr: "STR", name: "Strength", type: "numb" },
  { bid: "Z018", abbr: "DEX", name: "Dexterity", type: "numb" },
  { bid: "Z019", abbr: "CON", name: "Constitution", type: "numb" },
  { bid: "Z020", abbr: "INT", name: "Intelligence", type: "numb" },
  { bid: "Z021", abbr: "WIS", name: "Wisdom", type: "numb" },
  { bid: "Z022", abbr: "CHA", name: "Charisma", type: "numb" },
  { bid: "Z023", abbr: "SST", name: "STR Saving Throw", type: "numb" },
  { bid: "Z024", abbr: "DST", name: "DEX Saving Throw", type: "numb" },
  { bid: "Z025", abbr: "CST", name: "CON Saving Throw", type: "numb" },
  { bid: "Z026", abbr: "IST", name: "INT Saving Throw", type: "numb" },
  { bid: "Z027", abbr: "WST", name: "WIS Saving Throw", type: "numb" },
  { bid: "Z028", abbr: "HST", name: "CHA Saving Throw", type: "numb" },
  { bid: "Z029", abbr: "PFC", name: "Proficiency", type: "numb" },
  { bid: "Z030", abbr: "VLN", name: "Vulnerable", type: "text" },
  { bid: "Z031", abbr: "RST", name: "Resistance", type: "text" },
  { bid: "Z032", abbr: "IMN", name: "Immunity", type: "text" },
  { bid: "Z033", abbr: "SIM", name: "Status Immunity", type: "text" },
  { bid: "Z034", abbr: "ABL", name: "Abilities", type: "list" },
  { bid: "Z035", abbr: "ACT", name: "Actions", type: "list" },
  { bid: "Z036", abbr: "BCT", name: "Bonus Actions", type: "list" },
  { bid: "Z037", abbr: "RCT", name: "Reactions", type: "list" },
  { bid: "Z038", abbr: "LCT", name: "Legendary Actions", type: "list" },
  { bid: "Z039", abbr: "SCT", name: "Spell List", type: "list" },
  { bid: "Z040", abbr: "INV", name: "Inventory", type: "list" },
  { bid: "Z041", abbr: "SAV", name: "Saving Throws", type: "text" },
  { bid: "Z042", abbr: "THP", name: "Temporary Hit Points", type: "numb" },
];

export const FORGE_DEFAULT_DICTIONARY_ID = "forge-default-dnd5e@1.6.0";
export const FORGE_DEFAULT_SYSTEM_NAME = "Dungeons & Dragons 5E";

/** Forge's formula parser only accepts these die sizes (assets/hpAttributeMapping-*.js). */
export const FORGE_DIE_SIZES = new Set([2, 4, 6, 8, 10, 12, 20, 100]);

export const SIZE_NAMES: Record<string, string> = {
  T: "Tiny", S: "Small", M: "Medium", L: "Large", H: "Huge", G: "Gargantuan",
};
/** Footprint in grid cells per size category (5 ft grid). Tiny = half a cell. */
export const SIZE_CELLS: Record<string, number> = {
  T: 0.5, S: 1, M: 1, L: 2, H: 3, G: 4,
};
