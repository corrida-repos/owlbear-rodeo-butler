/**
 * Environments / habitats for the creature search filters (F16). 5etools gives an environment to about a third of
 * its creatures (the 2014 and 2024 Monster Manual names are the same set); Butler assigns one to the rest, from the
 * same creature in another book, else from rules on type, name and traits. Assigned ones are marked as guesses.
 */

export type Env = "arctic" | "coastal" | "desert" | "forest" | "grassland" | "hill" | "mountain" | "swamp" | "underdark" | "underwater" | "urban" | "planar";

export const ENVS: Env[] = ["arctic", "coastal", "desert", "forest", "grassland", "hill", "mountain", "swamp", "underdark", "underwater", "urban", "planar"];
export const ENV_LABEL: Record<Env, string> = {
  arctic: "Arctic", coastal: "Coastal", desert: "Desert", forest: "Forest", grassland: "Grassland", hill: "Hill", mountain: "Mountain",
  swamp: "Swamp", underdark: "Underdark", underwater: "Underwater", urban: "Urban", planar: "Planar",
};
/** One letter per environment for the compact search index; "*" = any environment. */
export const ENV_CODE: Record<Env, string> = {
  arctic: "a", coastal: "c", desert: "d", forest: "f", grassland: "g", hill: "h", mountain: "m", swamp: "s", underdark: "u", underwater: "w", urban: "r", planar: "p",
};
const CODE_ENV = Object.fromEntries(Object.entries(ENV_CODE).map(([k, v]) => [v, k])) as Record<string, Env>;

/** 5etools environment strings → filter environments ("planar, feywild" → planar); "any" → every environment. */
export function normalizeEnvs(raw: unknown): Env[] | "any" | null {
  if (!Array.isArray(raw) || !raw.length) return null;
  const out = new Set<Env>();
  for (const r of raw) {
    const s = String(r).toLowerCase();
    if (s === "any") return "any";
    const base = s.split(",")[0]!.trim();
    if ((ENVS as string[]).includes(base)) out.add(base as Env);
  }
  return out.size ? [...out] : null;
}

export interface CreatureFacts {
  name: string;
  type: string;
  /** Speeds in feet; `swim` only (no walk) suggests water. */
  speed: { walk?: number; swim?: number; fly?: number; burrow?: number; climb?: number };
  /** Trait names and text, for keywords like "Amphibious", "Sunlight Sensitivity". */
  traits: string;
  languages?: string;
}

const has = (s: string, ...words: string[]) => words.some((w) => new RegExp(`\\b${w}`, "i").test(s));

/** Rules for creatures 5etools gives no environment. Always returns at least one. */
export function guessEnvs(c: CreatureFacts): Env[] {
  const n = c.name.toLowerCase();
  const t = c.type.toLowerCase();
  const tr = c.traits;
  const out = new Set<Env>();
  const add = (...e: Env[]) => e.forEach((x) => out.add(x));

  // Names that say it outright.
  if (has(n, "frost", "ice", "snow", "winter", "polar", "yeti", "remorhaz")) add("arctic");
  if (has(n, "sand", "desert", "dune", "sphinx", "mummy", "lamia")) add("desert");
  if (has(n, "swamp", "bog", "marsh", "mire", "bullywug", "lizardfolk", "hag", "crocodile")) add("swamp");
  if (has(n, "sea", "shark", "merfolk", "merrow", "sahuagin", "kraken", "octopus", "squid", "eel", "whale", "kuo-toa", "aboleth", "triton", "marid", "reef", "deep ", "kelp")) add("underwater");
  if (has(n, "pirate", "sailor", "harpy", "crab", "sea hag", "gull", "coast")) add("coastal");
  if (has(n, "drow", "duergar", "svirfneblin", "deep gnome", "mind flayer", "illithid", "beholder", "grimlock", "hook horror", "umber hulk", "myconid", "troglodyte", "cloaker", "darkmantle", "piercer", "roper", "derro", "quaggoth", "kuo-toa", "gibbering", "spectator")) add("underdark");
  if (has(n, "guard", "noble", "merchant", "thug", "spy", "cultist", "priest", "acolyte", "commoner", "bandit", "veteran", "knight", "mage", "assassin", "gladiator", "scout", "urchin", "city", "watch", "smith", "innkeeper", "sewer", "wererat")) add("urban");
  if (has(n, "dryad", "treant", "pixie", "sprite", "satyr", "unicorn", "owlbear", "wood", "forest", "elk", "dire wolf", "wolf", "bear", "boar", "panther", "spider", "blight", "druid", "ranger")) add("forest");
  if (has(n, "lion", "hyena", "jackal", "horse", "gnoll", "centaur", "elephant", "rhinoceros", "zebra", "pony", "bison", "griffon", "hippogriff", "ankheg", "bulette", "plains")) add("grassland");
  if (has(n, "hill", "ogre", "goblin", "hobgoblin", "bugbear", "orc", "worg", "peryton", "manticore")) add("hill");
  if (has(n, "mountain", "eagle", "goat", "roc", "wyvern", "giant (stone|fire|cloud|storm)", "dwarf", "aarakocra", "galeb", "chimera", "cockatrice")) add("mountain");
  if (has(n, "devil", "demon", "imp", "quasit", "yugoloth", "angel", "deva", "planetar", "solar", "slaad", "modron", "githyanki", "githzerai", "elemental", "genie", "djinni", "efreeti", "dao", "nightmare", "hell hound", "astral", "ethereal", "fey ", "archfey", "feywild", "shadowfell", "shadow ")) add("planar");

  // Dragons by colour / metal.
  if (t.includes("dragon")) {
    if (has(n, "red", "copper", "brass")) add(has(n, "brass") ? "desert" : "mountain", has(n, "copper") ? "hill" : "mountain");
    if (has(n, "blue")) add("desert", "coastal");
    if (has(n, "green")) add("forest");
    if (has(n, "black")) add("swamp");
    if (has(n, "white", "silver")) add(has(n, "silver") ? "mountain" : "arctic");
    if (has(n, "gold")) add("grassland", "forest");
    if (has(n, "bronze")) add("coastal");
    if (has(n, "shadow", "dracolich")) add("underdark");
  }
  // Giants by kind.
  if (t.includes("giant")) {
    if (has(n, "frost")) add("arctic");
    if (has(n, "fire")) add("mountain", "underdark");
    if (has(n, "hill")) add("hill");
    if (has(n, "stone")) add("mountain", "underdark");
    if (has(n, "cloud")) add("mountain");
    if (has(n, "storm")) add("coastal", "underwater");
  }

  // Traits and movement.
  const swimOnly = (c.speed.swim ?? 0) > 0 && !(c.speed.walk ?? 0) && !(c.speed.fly ?? 0);
  if (swimOnly || has(tr, "water breathing") && !has(tr, "amphibious")) add("underwater");
  if (has(tr, "amphibious")) add("coastal");
  if (has(tr, "sunlight sensitivity", "sunlight hypersensitivity", "light sensitivity")) add("underdark");
  if (has(tr, "snow camouflage", "ice walk")) add("arctic");
  if (has(tr, "sand camouflage")) add("desert");
  if (has(tr, "swamp camouflage")) add("swamp");
  if (has(tr, "tree stride", "forest camouflage", "speak with beasts and plants")) add("forest");
  if (has(tr, "magic resistance") && (t.includes("fiend") || t.includes("celestial"))) add("planar");

  if (out.size) return [...out];

  // By creature type, as a last resort.
  if (t.includes("fiend") || t.includes("celestial") || t.includes("elemental")) return ["planar"];
  if (t.includes("fey")) return ["forest", "planar"];
  if (t.includes("aberration") || t.includes("ooze")) return ["underdark"];
  if (t.includes("plant")) return ["forest", "swamp"];
  if (t.includes("undead")) return ["urban", "underdark"];
  if (t.includes("construct")) return ["urban"];
  if (t.includes("humanoid")) return ["urban"];
  if (t.includes("dragon")) return ["mountain"];
  if (t.includes("giant")) return ["hill", "mountain"];
  if (t.includes("beast")) return (c.speed.fly ?? 0) > 0 ? ["forest", "mountain"] : (c.speed.burrow ?? 0) > 0 ? ["grassland", "desert"] : ["forest", "grassland"];
  if (t.includes("monstrosity")) return (c.speed.burrow ?? 0) > 0 ? ["underdark", "desert"] : ["forest", "hill"];
  return ["urban"];
}

/** Index cell: "fg" (from 5etools), "~fg" (assigned by Butler), "*" (any environment). */
export function encodeEnvs(envs: Env[] | "any", assigned: boolean): string {
  if (envs === "any") return "*";
  return `${assigned ? "~" : ""}${envs.map((e) => ENV_CODE[e]).join("")}`;
}

export function decodeEnvs(cell: string): { envs: Env[] | "any"; assigned: boolean } {
  if (cell === "*") return { envs: "any", assigned: false };
  const assigned = cell.startsWith("~");
  return { envs: [...cell.replace("~", "")].map((ch) => CODE_ENV[ch]!).filter(Boolean), assigned };
}
