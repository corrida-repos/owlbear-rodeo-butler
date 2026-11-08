/** Namespace for this importer's own metadata (items + scene). */
export const BUTLER_NS = "dev.owlbear-butler";
export const BUTLER_ITEM_KEY = `${BUTLER_NS}/import`;
export const BUTLER_SCENE_KEY = `${BUTLER_NS}/imports`;
export const PACKAGE_SCHEMA = "owlbear-butler/encounter@2";

/** Dice the roller accepts in `[formula]` chips: up to 100 dice of 2–1000 sides. */
export const MAX_DICE = 100;
export const MAX_DIE_SIDES = 1000;

export const SIZE_NAMES: Record<string, string> = {
  T: "Tiny", S: "Small", M: "Medium", L: "Large", H: "Huge", G: "Gargantuan",
};
/** Footprint in grid cells per size category (5 ft grid). Tiny = half a cell. */
export const SIZE_CELLS: Record<string, number> = {
  T: 0.5, S: 1, M: 1, L: 2, H: 3, G: 4,
};
