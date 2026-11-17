/**
 * What an inventory item is, for the action bar: its kind (weapon, potion, scroll, wand…), whether it's magic, its
 * weapon properties and how many there are. The D&D Beyond sync stores this on each inventory entry (`item`); for
 * older syncs and other sources it's guessed from the name ("Potion of Healing ×2 (equipped)").
 */
import type { SheetEntry } from "./sheet";

export type ItemKind = "weapon" | "armor" | "potion" | "scroll" | "wand" | "rod" | "staff" | "ring" | "wondrous" | "gear";

export interface ItemInfo {
  kind: ItemKind;
  magic?: boolean;
  /** Weapon properties ("Light", "Finesse", "Thrown"…). */
  properties?: string[];
  quantity?: number;
  /** D&D Beyond extras, shown on the card: the container it's carried in ("Backpack", "Party inventory"), charges, etc. */
  container?: string;
  charges?: { max: number; used: number; reset?: string };
  rarity?: string;
  /** Needs attunement (whether it's attuned is in the entry name). */
  attunement?: boolean;
  weight?: number;
  /** A custom item made on D&D Beyond (not from a book). */
  custom?: boolean;
  /** From the campaign's shared party inventory rather than the character's own. */
  party?: boolean;
}

const DDB_KIND: Record<string, ItemKind> = {
  weapon: "weapon", armor: "armor", potion: "potion", scroll: "scroll", wand: "wand", rod: "rod", staff: "staff", ring: "ring", "wondrous item": "wondrous",
};

/** From a D&D Beyond inventory item. */
const RESET: Record<number, string> = { 1: "Short Rest", 2: "Long Rest", 3: "Dawn", 4: "Other" };

export function ddbItemInfo(i: any, extra: Pick<ItemInfo, "container" | "custom" | "party"> = {}): ItemInfo {
  const d = i?.definition ?? {};
  const kind = DDB_KIND[String(d.filterType ?? "").toLowerCase()] ?? "gear";
  const properties = (d.properties ?? []).map((p: any) => p?.name).filter((n: unknown): n is string => typeof n === "string");
  const lu = i?.limitedUse ?? d.limitedUse;
  const maxUses = Number(lu?.maxUses ?? 0);
  const rarity = d.magic && typeof d.rarity === "string" ? d.rarity : undefined;
  return {
    kind,
    ...(d.magic ? { magic: true } : {}),
    ...(properties.length ? { properties } : {}),
    ...(i?.quantity > 1 ? { quantity: i.quantity } : {}),
    ...(maxUses > 0 ? { charges: { max: maxUses, used: Number(lu.numberUsed ?? 0), ...(RESET[lu.resetType] || lu.resetTypeDescription ? { reset: RESET[lu.resetType] ?? String(lu.resetTypeDescription) } : {}) } } : {}),
    ...(rarity ? { rarity } : {}),
    ...(d.canAttune ? { attunement: true } : {}),
    ...(typeof d.weight === "number" && d.weight > 0 ? { weight: d.weight } : {}),
    ...(extra.container ? { container: extra.container } : {}),
    ...(extra.custom ? { custom: true } : {}),
    ...(extra.party ? { party: true } : {}),
  };
}

/** The extra facts the card shows next to an item: "in Backpack · Rare · requires attunement · 3 lb. · custom". */
export function itemDetails(info: ItemInfo | undefined): string {
  if (!info) return "";
  return [
    info.container ? `in ${info.container}` : "",
    info.rarity ?? "",
    info.attunement ? "requires attunement" : "",
    info.weight ? `${info.weight} lb.` : "",
    info.custom ? "custom" : "",
  ].filter(Boolean).join(" · ");
}

/** Light weapons by the PHB (both editions). */
export const LIGHT_WEAPONS = ["Club", "Dagger", "Handaxe", "Light Hammer", "Sickle", "Scimitar", "Shortsword", "Hand Crossbow"];
const WEAPON_NAMES = [...LIGHT_WEAPONS, "Greatclub", "Javelin", "Mace", "Quarterstaff", "Spear", "Dart", "Light Crossbow", "Shortbow", "Sling",
  "Battleaxe", "Flail", "Glaive", "Greataxe", "Greatsword", "Halberd", "Lance", "Longsword", "Maul", "Morningstar", "Pike", "Rapier", "Trident",
  "War Pick", "Warhammer", "Whip", "Blowgun", "Heavy Crossbow", "Longbow", "Musket", "Pistol", "Net"];

/** The item's base name, without D&D Beyond's quantity and status notes. */
export const baseName = (name: string) => name.replace(/\s*×\d+/, "").replace(/\s*\((equipped|attuned|stowed)\)/gi, "").trim();
const quantityOf = (name: string) => Number(/×(\d+)/.exec(name)?.[1] ?? 1);
/** A weapon named in an entry ("Shortsword", "+1 Dagger", "Dagger of Venom", "Scimitar (offhand)"). */
export function weaponIn(name: string): string | undefined {
  const n = baseName(name).toLowerCase();
  return WEAPON_NAMES.find((w) => new RegExp(`(^|[^a-z])${w.toLowerCase()}($|[^a-z])`).test(n));
}

export function itemInfo(entry: SheetEntry): ItemInfo {
  if (entry.item) return entry.item;
  const n = baseName(entry.name);
  const quantity = quantityOf(entry.name);
  const q = quantity > 1 ? { quantity } : {};
  if (/^(Potion|Elixir|Philter|Oil of)\b/i.test(n)) return { kind: "potion", magic: true, ...q };
  if (/^(Spell Scroll|Scroll of)\b/i.test(n)) return { kind: "scroll", magic: true, ...q };
  if (/^Wand\b/i.test(n)) return { kind: "wand", magic: true, ...q };
  if (/^Rod\b/i.test(n)) return { kind: "rod", magic: true, ...q };
  if (/^Staff of\b/i.test(n)) return { kind: "staff", magic: true, ...q };
  if (/^Ring of\b/i.test(n)) return { kind: "ring", magic: true, ...q };
  if (/\b(Armor|Mail|Plate|Shield|Breastplate|Splint|Padded|Leather|Hide|Chain Shirt|Half Plate)\b/i.test(n) && !/^(Potion|Scroll)/i.test(n)) return { kind: "armor", ...(/^\+\d|\bof\b/i.test(n) ? { magic: true } : {}), ...q };
  const w = weaponIn(n);
  if (w) return { kind: "weapon", ...(LIGHT_WEAPONS.includes(w) ? { properties: ["Light"] } : {}), ...(/^\+\d|\bof\b/i.test(n) ? { magic: true } : {}), ...q };
  return { kind: "gear", ...q };
}

/** How many Light weapons the sheet has: inventory items (counting quantity), else the sheet's weapon attacks. */
export function lightWeaponCount(sheet: { inventory: SheetEntry[]; actions: SheetEntry[] }): number {
  const fromInventory = sheet.inventory.map((e) => ({ e, i: itemInfo(e) }))
    .filter(({ i }) => i.kind === "weapon" && (i.properties ?? []).some((p) => /^Light$/i.test(p)))
    .reduce((n, { i }) => n + (i.quantity ?? 1), 0);
  if (sheet.inventory.length) return fromInventory;
  return new Set(sheet.actions.map((a) => weaponIn(a.name)).filter((w) => w && LIGHT_WEAPONS.includes(w))).size;
}

// ------------------------------------------------------------------ injury poisons

/**
 * Poisons applied to a weapon or ammunition (DMG "Injury" poisons, and the PHB's Basic Poison), with what a hit does,
 * by edition. 2024: applying one is a Bonus Action (DMG 2024 "Poison"; PHB 2024 Basic Poison); 2014: an action.
 */
export const INJURY_POISONS: { name: RegExp; label: string; text: Record<"2024" | "2014", string> }[] = [
  { name: /^(basic poison|poison,? basic)\b/i, label: "Basic Poison", text: {
    "2024": "Coat one weapon or up to three pieces of ammunition. A creature that takes Piercing or Slashing damage from it takes an extra [1d4] Poison damage. Potent for 1 minute or until its damage is dealt.",
    "2014": "Coat one slashing or piercing weapon or up to three pieces of ammunition. A creature hit by it makes a DC 10 Constitution saving throw or takes [1d4] poison damage. Potent for 1 minute.",
  } },
  { name: /^serpent venom\b/i, label: "Serpent Venom", text: {
    "2024": "A creature that takes Piercing or Slashing damage from the coated weapon makes a DC 11 Constitution saving throw, taking 10 ([3d6]) Poison damage on a failed save or half as much on a success.",
    "2014": "A creature hit by the coated weapon makes a DC 11 Constitution saving throw, taking 10 ([3d6]) poison damage on a failed save, or half as much on a success.",
  } },
  { name: /^wyvern poison\b/i, label: "Wyvern Poison", text: {
    "2024": "A creature that takes Piercing or Slashing damage from the coated weapon makes a DC 14 Constitution saving throw, taking 24 ([7d6]) Poison damage on a failed save or half as much on a success.",
    "2014": "A creature hit by the coated weapon makes a DC 15 Constitution saving throw, taking 24 ([7d6]) poison damage on a failed save, or half as much on a success.",
  } },
  { name: /^purple worm poison\b/i, label: "Purple Worm Poison", text: {
    "2024": "A creature that takes Piercing or Slashing damage from the coated weapon makes a DC 21 Constitution saving throw, taking 35 ([10d6]) Poison damage on a failed save or half as much on a success.",
    "2014": "A creature hit by the coated weapon makes a DC 19 Constitution saving throw, taking 42 ([12d6]) poison damage on a failed save, or half as much on a success.",
  } },
  { name: /^(lolth's sting|drow poison)\b/i, label: "Lolth's Sting", text: {
    "2024": "A creature that takes Piercing or Slashing damage from the coated weapon makes a DC 13 Constitution saving throw or has the Poisoned condition for 1 hour; failing by 5 or more also makes it Unconscious while Poisoned this way (it wakes if it takes damage or is shaken awake with an action).",
    "2014": "A creature hit by the coated weapon makes a DC 13 Constitution saving throw or is poisoned for 1 hour; failing by 5 or more also leaves it unconscious while poisoned this way (it wakes if it takes damage or is shaken awake with an action).",
  } },
];

/** Weapons that only deal Bludgeoning damage (an injury poison needs Piercing or Slashing). */
const BLUDGEONING_ONLY = ["Club", "Greatclub", "Light Hammer", "Mace", "Quarterstaff", "Flail", "Maul", "Warhammer", "Sling", "Net"];

/** The injury poisons in the inventory and the weapons they can coat (Piercing or Slashing; the sheet's weapon attacks
 *  count for creatures without an inventory of weapons). Nothing when either is missing. */
export function poisonsToApply(sheet: { inventory: SheetEntry[]; actions: SheetEntry[] }, rules: "2024" | "2014"): { poison: string; label: string; quantity: number; weapons: string[]; text: string }[] {
  const weapons = new Set<string>();
  for (const e of sheet.inventory) {
    const info = itemInfo(e);
    const w = weaponIn(e.name);
    if (info.kind === "weapon" && (!w || !BLUDGEONING_ONLY.includes(w))) weapons.add(baseName(e.name));
    if (/^(Arrows?|Crossbow Bolts?|Bolts?|Blowgun Needles?|Needles?)\b/i.test(baseName(e.name))) weapons.add(baseName(e.name));
  }
  for (const a of sheet.actions) {
    const w = weaponIn(a.name);
    if (w && !BLUDGEONING_ONLY.includes(w) && /\b(Piercing|Slashing)\b/i.test(a.text)) weapons.add(baseName(a.name));
  }
  if (!weapons.size) return [];
  const out: { poison: string; label: string; quantity: number; weapons: string[]; text: string }[] = [];
  for (const e of sheet.inventory) {
    const n = baseName(e.name);
    const p = INJURY_POISONS.find((x) => x.name.test(n));
    if (!p || out.some((o) => o.label === p.label)) continue;
    out.push({ poison: n, label: p.label, quantity: itemInfo(e).quantity ?? 1, weapons: [...weapons], text: p.text[rules] });
  }
  return out;
}
