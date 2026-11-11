/**
 * Unit card model (F2, F7): who may see what, the names and portrait shown, and the standard rolls
 * (ability checks, saves, skills, initiative). Pure, so the rules are unit-tested; the card page renders it.
 */
import { crLabel, xpForCr } from "./combat";
import { SIZE_NAMES } from "./constants";
import { fmtMod, resolveRollMode } from "./dice";
import type { RollMode } from "./schema";
import { abilityMod, ABILITIES, ABILITY_NAMES, saveBonus, type Ability, type UnitSheet, type UnitState } from "./sheet";

export type CardAccess = "full" | "limited" | "none";

export interface CardViewer { id: string; role: "GM" | "PLAYER" }
export interface CardItem { visible: boolean; createdUserId?: string; label?: string; name: string; imageUrl?: string }

/** Players control a unit when the GM assigned it to them, or (when nobody is assigned) when they own the token. */
export function controls(viewer: CardViewer, item: Pick<CardItem, "createdUserId">, state: Pick<UnitState, "controlledBy">): boolean {
  if (state.controlledBy) return state.controlledBy === viewer.id;
  return !!item.createdUserId && item.createdUserId === viewer.id;
}

/**
 * GM: everything. Player: the full card of units they control (D4); for any other unit only name, image and
 * conditions; nothing at all for hidden tokens.
 */
export function cardAccess(viewer: CardViewer, item: Pick<CardItem, "visible" | "createdUserId">, state: Pick<UnitState, "controlledBy">): CardAccess {
  if (viewer.role === "GM") return "full";
  if (controls(viewer, item, state)) return "full";
  return item.visible ? "limited" : "none";
}

/**
 * The unit's real name: the token label, else the item name, else the sheet name. While an alias is set, the token's
 * label shows the alias on the map (players see it), so the real name is the item name.
 */
export const unitName = (item: Pick<CardItem, "label" | "name">, sheet?: Pick<UnitSheet, "name">, state?: Pick<UnitState, "alias">) =>
  (state?.alias?.trim() ? item.name?.trim() : undefined) || item.label?.trim() || item.name?.trim() || sheet?.name || "Unit";

/** The name a viewer sees: players who don't control the unit see the GM's alias while one is set (F7). */
export function shownName(access: CardAccess, viewer: CardViewer, item: Pick<CardItem, "label" | "name">, sheet: Pick<UnitSheet, "name"> | undefined, state: Pick<UnitState, "alias">): string {
  if (viewer.role !== "GM" && access !== "full" && state.alias?.trim()) return state.alias.trim();
  return unitName(item, sheet, state);
}

/** Portrait: the unit's own portrait URL if set, else the token image. */
export const portraitUrl = (item: Pick<CardItem, "imageUrl">, state: Pick<UnitState, "portraitUrl">) =>
  state.portraitUrl?.trim() || item.imageUrl || "";

/** "Medium Beast, Unaligned" / "Level 5 · Wood Elf Druid". */
export function typeLine(sheet: UnitSheet): string {
  const size = SIZE_NAMES[sheet.size] ?? sheet.size;
  const main = [size, sheet.type].filter(Boolean).join(" ");
  return [main, sheet.alignment].filter(Boolean).join(", ");
}

/** "CR 1/4 (50 XP; PB +2)" or "Level 5 (PB +3)". */
export function challengeLine(sheet: UnitSheet): string {
  const pb = `PB ${fmtMod(sheet.proficiencyBonus)}`;
  if (sheet.level) return `Level ${sheet.level} (${pb})`;
  if (sheet.cr !== undefined) return `CR ${crLabel(sheet.cr)} (${xpForCr(sheet.cr).toLocaleString("en-US")} XP; ${pb})`;
  return pb;
}

export function speedLine(sheet: UnitSheet): string {
  const s = sheet.speed;
  const parts = [`${s.walk} ft.`];
  if (s.burrow) parts.push(`Burrow ${s.burrow} ft.`);
  if (s.climb) parts.push(`Climb ${s.climb} ft.`);
  if (s.fly) parts.push(`Fly ${s.fly} ft.${s.hover ? " (hover)" : ""}`);
  if (s.swim) parts.push(`Swim ${s.swim} ft.`);
  return parts.join(", ");
}

export interface StandardRoll { label: string; formula: string; bonus: number; mode?: RollMode; kind: "check" | "save" | "initiative" }

const d20 = (bonus: number) => `1d20${bonus ? fmtMod(bonus) : ""}`;

export interface AbilityRow { ability: Ability; short: string; score: number; mod: number; check: StandardRoll; save: StandardRoll; proficientSave: boolean }

export function abilityRows(sheet: UnitSheet): AbilityRow[] {
  return ABILITIES.map((a) => {
    const mod = abilityMod(sheet.abilities[a]);
    const save = saveBonus(sheet, a);
    return {
      ability: a, short: a.toUpperCase(), score: sheet.abilities[a], mod,
      check: { label: `${ABILITY_NAMES[a]} check`, formula: d20(mod), bonus: mod, kind: "check" },
      save: { label: `${ABILITY_NAMES[a]} save`, formula: d20(save), bonus: save, kind: "save" },
      proficientSave: sheet.saves[a] !== undefined,
    };
  });
}

export const skillRolls = (sheet: UnitSheet): StandardRoll[] =>
  sheet.skills.map((s) => ({ label: `${s.name} check`, formula: d20(s.bonus), bonus: s.bonus, kind: "check" }));

/** 2014 rules: creatures roll initiative with their Dexterity modifier (2024 stat blocks add proficiency). */
export function initiativeRoll(sheet: UnitSheet, rules: "2024" | "2014" = "2024", state?: Pick<UnitState, "surprised">): StandardRoll {
  const i = sheet.initiative;
  // 2024: surprised → disadvantage on initiative.
  const mode = resolveRollMode(i.advantage, i.disadvantage || (rules === "2024" && !!state?.surprised));
  const mod = rules === "2014" && sheet.kind === "creature" ? abilityMod(sheet.abilities.dex) : i.modifier;
  return { label: "Initiative", formula: d20(mod), bonus: mod, kind: "initiative", ...(mode !== "normal" ? { mode } : {}) };
}

/** Attack wording of the room's edition on the card: 2024 "Melee Attack Roll: +4", 2014 "Melee Weapon Attack: +4". */
export function editionText(text: string, rules: "2024" | "2014"): string {
  if (rules === "2014") return text.replace(/\b(Melee|Ranged|Melee or Ranged) Attack Roll:/g, "$1 Weapon Attack:");
  return text.replace(/\b(Melee|Ranged|Melee or Ranged) (?:Weapon|Spell) Attack:/g, "$1 Attack Roll:");
}

/** The roll mode to use: the click's modifier keys / toggle, combined with a built-in mode (initiative advantage). */
export function combineModes(clicked: RollMode, builtIn: RollMode | undefined): RollMode {
  const adv = clicked === "advantage" || builtIn === "advantage";
  const dis = clicked === "disadvantage" || builtIn === "disadvantage";
  return resolveRollMode(adv, dis);
}

/** Sheet sections shown on the card, in order, with their headings. */
export const SECTIONS = [
  ["traits", "Traits"], ["actions", "Actions"], ["bonusActions", "Bonus Actions"], ["reactions", "Reactions"],
  ["legendary", "Legendary Actions"], ["lair", "Lair Actions"], ["spells", "Spells"], ["inventory", "Inventory"],
] as const;
