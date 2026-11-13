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
}

const DDB_KIND: Record<string, ItemKind> = {
  weapon: "weapon", armor: "armor", potion: "potion", scroll: "scroll", wand: "wand", rod: "rod", staff: "staff", ring: "ring", "wondrous item": "wondrous",
};

/** From a D&D Beyond inventory item. */
export function ddbItemInfo(i: any): ItemInfo {
  const d = i?.definition ?? {};
  const kind = DDB_KIND[String(d.filterType ?? "").toLowerCase()] ?? "gear";
  const properties = (d.properties ?? []).map((p: any) => p?.name).filter((n: unknown): n is string => typeof n === "string");
  return {
    kind,
    ...(d.magic ? { magic: true } : {}),
    ...(properties.length ? { properties } : {}),
    ...(i?.quantity > 1 ? { quantity: i.quantity } : {}),
  };
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
