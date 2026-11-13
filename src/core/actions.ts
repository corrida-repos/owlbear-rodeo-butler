/**
 * The action bar (BG3-style hotbar), read-only: what a unit can do, grouped by what it costs (Action, Bonus Action,
 * Reaction, Legendary), with a plain explanation of how each option works. The sheet's own entries and the options
 * anyone has by the rules (PHB, the DMG's optional ones unless the GM turns them off, and the room's homebrew) sit
 * together in one list; the Attack action gathers every way to make an attack (the sheet's weapons, Unarmed Strike,
 * Grapple, Shove…). Nothing is counted or spent here (Butler
 * only tracks HP): it's for players to consult. Built from the unit's sheet (for party members: the D&D Beyond sync),
 * so a re-sync updates it. Pure, so the parsing and explanations are unit-tested; the actions page renders it.
 */
import { parseChips, rollSegments } from "./chips";
import { combatOptions, type OptionGroup } from "./combatOptions";
import type { HomebrewAction } from "./homebrew";
import { baseName, itemInfo, LIGHT_WEAPONS, lightWeaponCount, weaponIn } from "./items";
import type { SheetEntry, UnitSheet } from "./sheet";

/** What using an entry costs. "longer": a casting time of a minute or more; "none": passive or unknown. */
export type Cost = "action" | "bonus" | "reaction" | "legendary" | "free" | "longer" | "move" | "attack" | "none";
export type Category = "common" | "action" | "bonus" | "reaction" | "legendary" | "spell" | "feature" | "item";
export type Reset = "short" | "long" | "turn" | "other";

/** A rule limit as written on the sheet ("2/Long Rest"). Shown as information only, never counted. */
export interface Limit { max: number; reset: Reset; label: string }

export interface ActionItem {
  key: string;
  /** Name without the uses / recharge note. */
  name: string;
  text: string;
  section: "traits" | "actions" | "bonusActions" | "reactions" | "legendary" | "spells" | "common" | "homebrew" | "inventory";
  category: Category;
  cost: Cost;
  /** Casting time or cost note ("1 minute", "Reaction: when you are hit…", "Costs 2 Actions"). */
  costNote?: string;
  legendaryCost?: number;
  limit?: Limit;
  /** Recharge X–6: the minimum d6 roll that brings it back. */
  recharge?: number;
  /** 0 = cantrip. */
  spellLevel?: number;
  concentration?: boolean;
  ritual?: boolean;
  /** "+5 · 1d8+3 Slashing · DC 13 Dex" */
  summary: string;
  /** Combat options: their group ("Attack options", "Movement"…) and book (DMG = optional rule, Homebrew = the GM's). */
  group?: OptionGroup;
  source?: "PHB" | "DMG" | "Homebrew";
  /** Done along with an attack of the Attack action (shown under Attack though it costs nothing). */
  withAttack?: boolean;
  /** Done with another action, so revealed under that action's tile (its key): 2024 Stabilize under Help, a potion
   *  under Drink a Potion, a wand under Magic, caltrops under Utilize… */
  under?: string;
  /** Homebrew entries: their id in the room's list. */
  homebrewId?: string;
  /** Combat options shown only while the unit has (or lacks) a condition (see CombatOption). */
  ifCondition?: string;
  unlessCondition?: string;
}

// ------------------------------------------------------------------ parsing

const USES_RE = /\s*\((\d+)\/(Short Rest|Long Rest|Dawn|Day|Turn|Round|Other|rest)\b([^)]*)\)/i;
const USES_ANY_RE = /\b(\d+)\/(Short Rest|Long Rest|Dawn|Day|Turn|Round)\b/i;
const RECHARGE_RE = /\s*\(Recharge (\d)(?:\s*[–-]\s*6)?\)/i;
const RECHARGE_REST_RE = /\s*\(Recharges after a (Short|Long|Short or Long) Rest\)/i;
const COSTS_RE = /\s*\(Costs (\d) Actions\)/i;

function resetOf(word: string): Reset {
  const w = word.toLowerCase();
  if (w === "short rest") return "short";
  if (w === "long rest" || w === "dawn" || w === "day") return "long";
  if (w === "turn" || w === "round") return "turn";
  return "other";
}

/** Limit, recharge and legendary cost from an entry name; returns the name without those notes (and without
 *  D&D Beyond's "1 used", which Butler doesn't track). */
export function parseEntryName(raw: string): { name: string; limit?: Limit; recharge?: number; legendaryCost?: number } {
  let name = raw;
  const out: { limit?: Limit; recharge?: number; legendaryCost?: number } = {};
  const u = USES_RE.exec(name) ?? USES_ANY_RE.exec(name);
  // "1/Day Each" (a creature's spell list) is once per spell: explained, not a shared limit.
  if (u && !/\beach\b/i.test(name)) {
    out.limit = { max: Number(u[1]), reset: resetOf(u[2]!), label: `${u[1]}/${u[2]}` };
    if (/^\s*\(\d+\/\w[\w ]*(?:,\s*\d+ used)?\)\s*$/i.test(u[0])) name = name.replace(u[0], "");
  }
  const r = RECHARGE_RE.exec(name);
  if (r) { out.recharge = Number(r[1]); name = name.replace(r[0], ""); }
  const rr = RECHARGE_REST_RE.exec(name);
  if (rr && !out.limit) { out.limit = { max: 1, reset: /short/i.test(rr[1]!) ? "short" : "long", label: `1/${rr[1]} Rest` }; name = name.replace(rr[0], ""); }
  const c = COSTS_RE.exec(name);
  if (c) { out.legendaryCost = Number(c[1]); name = name.replace(c[0], ""); }
  return { name: name.trim() || raw, ...out };
}

/** A D&D Beyond spell's level from its name: "Fire Bolt (Cantrip)", "Shield (Level 1, …)". */
export function spellLevelOf(name: string): number | undefined {
  const m = /\((Cantrip|Level (\d))\b/.exec(name);
  if (!m) return undefined;
  return m[1] === "Cantrip" ? 0 : Number(m[2]);
}

/** The casting-time tag the D&D Beyond sync writes ("[Bonus Action, Concentration, 60 ft.]"). */
function tagOf(text: string): string[] {
  const m = /\[([^\]]*(?:Action|Reaction|Concentration|Ritual|ft\.|Self|Touch|minute|hour)[^\]]*)\]/i.exec(text);
  return m ? m[1]!.split(",").map((s) => s.trim()) : [];
}

function costFromTags(tags: string[]): { cost?: Cost; note?: string } {
  for (const t of tags) {
    if (/^(1 )?Bonus Action$/i.test(t)) return { cost: "bonus" };
    if (/^(1 )?Reaction/i.test(t)) return { cost: "reaction" };
    if (/^(1 )?Action$/i.test(t)) return { cost: "action" };
    if (/^No Action$/i.test(t)) return { cost: "free" };
    if (/^\d+ (minute|hour)s?$/i.test(t)) return { cost: "longer", note: t };
  }
  return {};
}

const ABILITY = "Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma|STR|DEX|CON|INT|WIS|CHA";
const FULL: Record<string, string> = { str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma" };

/** The save an entry asks for: "DC 17 Dexterity". */
export function saveOf(text: string): { dc: number; ability: string } | null {
  const m = new RegExp(`\\b(?:DC (\\d+)\\s+(${ABILITY})|(${ABILITY}) save DC (\\d+)|(${ABILITY}) Saving Throw: DC (\\d+))`, "i").exec(text);
  if (!m) return null;
  const ab = (m[2] ?? m[3] ?? m[5] ?? "").toLowerCase().slice(0, 3);
  return { dc: Number(m[1] ?? m[4] ?? m[6]), ability: FULL[ab] ?? ab };
}

const DAMAGE_TYPES = "Acid|Bludgeoning|Cold|Fire|Force|Lightning|Necrotic|Piercing|Poison|Psychic|Radiant|Slashing|Thunder";

/** Damage dice: "damage" chips, or (D&D Beyond spells: "1d10 [1d10] Fire") dice followed by a damage type. */
export function damageOf(text: string): string[] {
  const segs = parseChips(text);
  const out = rollSegments(segs).filter((r) => r.kind === "damage").map((d) => `${d.display}${d.damageType ? ` ${d.damageType}` : ""}`);
  if (out.length) return out;
  segs.forEach((sg, i) => {
    const next = segs[i + 1];
    const type = next?.t === "text" ? new RegExp(`^\\s*(${DAMAGE_TYPES})\\b`, "i").exec(next.text)?.[1] : undefined;
    if (sg.t === "roll" && sg.kind === "dice" && type) out.push(`${sg.display} ${type[0]!.toUpperCase()}${type.slice(1).toLowerCase()}`);
  });
  return out;
}

/** "+5 · 1d8+3 Slashing · DC 13 Dex" from the entry's dice. */
export function summaryOf(text: string): string {
  const rolls = rollSegments(parseChips(text));
  const parts: string[] = [];
  const atk = rolls.find((r) => r.kind === "attack");
  if (atk) parts.push(atk.display);
  parts.push(...damageOf(text).slice(0, 2));
  const save = saveOf(text);
  if (save) parts.push(`DC ${save.dc} ${save.ability.slice(0, 3)}`);
  if (!parts.length) {
    const other = rolls.find((r) => r.kind === "dice" || r.kind === "check" || r.kind === "save");
    if (other) parts.push(other.display);
  }
  return parts.join(" · ");
}

const SECTION_COST: Record<string, Cost> = { actions: "action", bonusActions: "bonus", reactions: "reaction", legendary: "legendary" };
const SECTION_CATEGORY: Record<string, Category> = { actions: "action", bonusActions: "bonus", reactions: "reaction", legendary: "legendary", spells: "spell", traits: "feature" };

const isHeader = (section: string, name: string) =>
  (section === "legendary" && /^(Legendary|Mythic) Actions$/i.test(name)) || /^Spellcasting\b/i.test(name) || (section === "spells" && /other known spells$/i.test(name));

type SheetSection = Exclude<ActionItem["section"], "common" | "homebrew" | "inventory">;

function itemOf(entry: SheetEntry, section: SheetSection): ActionItem | null {
  if (isHeader(section, entry.name)) return null;
  const parsed = parseEntryName(entry.name);
  const tags = tagOf(entry.text);
  const fromTags = costFromTags(tags);
  const cost: Cost = entry.cost ?? SECTION_COST[section] ?? fromTags.cost ?? "none";
  const spellLevel = section === "spells" ? spellLevelOf(entry.name) : undefined;
  const name = section === "spells" && spellLevel !== undefined ? parsed.name.replace(/\s*\((Cantrip|Level \d)[^)]*\)$/, "") : parsed.name;
  const costNote = parsed.legendaryCost ? `Costs ${parsed.legendaryCost} Actions` : entry.costNote ?? fromTags.note;
  return {
    key: `${section}:${name}`,
    name,
    text: entry.text,
    section,
    category: SECTION_CATEGORY[section]!,
    cost,
    ...(costNote ? { costNote } : {}),
    ...(parsed.legendaryCost ? { legendaryCost: parsed.legendaryCost } : {}),
    ...(parsed.limit ? { limit: parsed.limit } : {}),
    ...(parsed.recharge ? { recharge: parsed.recharge } : {}),
    ...(spellLevel !== undefined ? { spellLevel } : {}),
    ...(tags.some((t) => /^Concentration$/i.test(t)) ? { concentration: true } : {}),
    ...(tags.some((t) => /^Ritual$/i.test(t)) ? { ritual: true } : {}),
    summary: summaryOf(entry.text),
  };
}

/** How many Legendary Actions a creature gets per round (0 if none). */
export function legendaryPerRound(sheet: Pick<UnitSheet, "legendary">): number {
  if (!sheet.legendary.length) return 0;
  const header = sheet.legendary.find((e) => /^Legendary Actions$/i.test(e.name))?.text ?? "";
  const m = /Legendary Action Uses:\s*(\d+)/i.exec(header) ?? /\b(\d+|one|two|three|four|five)\s+legendary actions/i.exec(header);
  const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };
  if (!m) return 3;
  return words[m[1]!.toLowerCase()] ?? Number(m[1]);
}

// ------------------------------------------------------------------ combat options (PHB + DMG)

export interface BarOptions {
  /** Include the DMG's optional action options (room setting, on by default). */
  dmg?: boolean;
  /** The room's homebrew actions. */
  homebrew?: HomebrewAction[];
  /** The unit's condition keys: options that depend on a condition (Escape a Grapple, Stand Up, Mount / Dismount…)
   *  show only when it applies. Left out, every option shows. */
  conditions?: string[];
}

/** Everything anyone can do in combat by the rules (see combatOptions.ts), with this unit's numbers, plus homebrew. */
export function commonActions(sheet: UnitSheet, rules: "2024" | "2014", opts: BarOptions = {}): ActionItem[] {
  const rulesOptions: ActionItem[] = combatOptions(sheet, rules, { dmg: opts.dmg }).map((c) => ({
    key: `common:${c.name}`, name: c.name, text: c.text, section: "common", category: "common", cost: c.cost,
    ...(c.costNote ? { costNote: c.costNote } : {}), summary: c.summary ?? "", group: c.group, source: c.source,
    ...(c.withAttack ? { withAttack: true } : {}),
    ...(c.under ? { under: `common:${c.under}` } : {}),
    ...(c.ifCondition ? { ifCondition: c.ifCondition } : {}),
    ...(c.unlessCondition ? { unlessCondition: c.unlessCondition } : {}),
  }));
  const homebrew: ActionItem[] = (opts.homebrew ?? []).map((hb) => ({
    key: `homebrew:${hb.id}`, name: hb.name, text: hb.text, section: "homebrew", category: "common", cost: hb.cost,
    ...(hb.cost === "attack" ? { costNote: "One attack of the Attack action" } : {}),
    summary: hb.summary ?? "", source: "Homebrew", homebrewId: hb.id,
  }));
  return [...rulesOptions, ...homebrew];
}

// ------------------------------------------------------------------ inventory

/** The rules' tiles items are used through, by edition. */
export function itemKeys(rules: "2024" | "2014") {
  return rules === "2024"
    ? { magic: "common:Magic", potion: "common:Drink or Administer a Potion", utilize: "common:Utilize" }
    : { magic: "common:Use an Object", potion: "common:Drink a Potion", utilize: "common:Use an Object" };
}

const THROWN_FLASKS = /^(Acid|Alchemist's Fire|Holy Water)\b/i;
const UTILIZE_GEAR = /^(Ball Bearings|Caltrops|Healer's Kit|Hunting Trap|Manacles|Oil|Rope|Grappling Hook|Chain(?! Mail| Shirt)|Lock|Spikes|Tinderbox)\b/i;
/** Wording that marks an item as magic when the sync didn't say (older syncs, other sources). */
const MAGIC_HINT = /\b(Magic action|Bonus Action|charges?|command word|attun)/i;
const ACTIVATED = /\b(Magic action|as an action|an action to|use an action|take an action|Bonus Action|Reaction|expend (?:\d+|one|1)(?: of its)? charges?|command word)\b/i;

/** The inventory items you use in combat, as tiles under the action that uses them. Armor, rings that just sit
 *  there and weapons (their attacks are on the sheet already) don't appear. */
export function itemActions(sheet: Pick<UnitSheet, "inventory">, rules: "2024" | "2014"): ActionItem[] {
  const keys = itemKeys(rules);
  const o2024 = rules === "2024";
  const out: ActionItem[] = [];
  const seen = new Set<string>();
  for (const e of sheet.inventory) {
    const info = itemInfo(e);
    const base = baseName(e.name);
    const name = info.quantity && info.quantity > 1 ? `${base} ×${info.quantity}` : base;
    const make = (cost: Cost, under?: string, costNote?: string): ActionItem => ({
      key: `inventory:${base}`, name, text: e.text, section: "inventory", category: "item", cost,
      ...(under ? { under } : {}), ...(costNote ? { costNote } : {}), summary: summaryOf(e.text),
    });
    let it: ActionItem | null = null;
    if (info.kind === "potion") it = make(o2024 ? "bonus" : "action", keys.potion);
    else if (/^Antitoxin\b/i.test(base)) it = o2024 ? make("bonus") : make("action", keys.utilize);
    else if (THROWN_FLASKS.test(base)) it = o2024 ? make("attack", undefined, "Replaces one attack of the Attack action") : make("action", keys.utilize);
    else if (info.kind === "gear" && !info.magic && UTILIZE_GEAR.test(base)) it = make("action", keys.utilize);
    else if ((info.magic || (!e.item && MAGIC_HINT.test(e.text))) && info.kind !== "weapon" && info.kind !== "armor"
      && (info.kind === "scroll" || info.kind === "wand" || info.kind === "staff" || info.kind === "rod" || ACTIVATED.test(e.text))) {
      if (/\bas a Bonus Action\b|\bBonus Action to\b|\bBonus Action,? you\b/i.test(e.text)) it = make("bonus");
      else if (/\b(as a|your|use a|take a) Reaction\b/i.test(e.text)) it = make("reaction");
      else it = make("action", keys.magic);
    }
    if (it && !seen.has(it.key)) { seen.add(it.key); out.push(it); }
  }
  return out;
}

// ------------------------------------------------------------------ the bar

export interface ActionBar { items: ActionItem[]; legendary: number; attacks: number; dualWielder?: boolean }

/** Attacks per Attack action, from Extra Attack and its upgrades on the sheet. */
export function attacksPerAction(sheet: Pick<UnitSheet, "traits" | "actions">): number {
  const names = [...sheet.traits, ...sheet.actions].map((e) => e.name);
  if (names.some((n) => /\bThree Extra Attacks\b/i.test(n))) return 4;
  if (names.some((n) => /\bTwo Extra Attacks\b/i.test(n))) return 3;
  if (names.some((n) => /^Extra Attack\b/i.test(n))) return 2;
  return 1;
}

export const TWF_KEY = "common:Two-Weapon Fighting";
const POTION_KEYS = ["common:Drink or Administer a Potion", "common:Drink a Potion"];

export function actionBar(sheet: UnitSheet, rules: "2024" | "2014" = "2024", opts: BarOptions = {}): ActionBar {
  const items: ActionItem[] = [];
  const seen = new Set<string>();
  for (const section of ["actions", "bonusActions", "reactions", "legendary", "spells", "traits"] as const) {
    for (const e of sheet[section]) {
      const it = itemOf(e, section);
      if (!it || seen.has(it.key)) continue;
      // Traits only belong on the bar when they're something you use: a limit, a recharge, or a cost.
      if (section === "traits" && !it.limit && !it.recharge && it.cost === "none") continue;
      seen.add(it.key);
      items.push(it);
    }
  }
  const attacks = attacksPerAction(sheet);
  const dualWielder = [...sheet.traits, ...sheet.bonusActions].some((e) => /^Dual Wielder\b/i.test(e.name));
  const conds = opts.conditions && new Set(opts.conditions);
  const common = commonActions(sheet, rules, opts)
    .filter((it) => !conds || ((!it.ifCondition || conds.has(it.ifCondition)) && (!it.unlessCondition || !conds.has(it.unlessCondition))))
    .map((it) =>
    it.key === ATTACK_KEY && attacks > 1 ? { ...it, summary: `${attacks} attacks` } : it);
  const all = [...items, ...itemActions(sheet, rules), ...common];
  // What the sheet rules out: Magic with no spells, magic items or magical actions (a wolf); Cast a Spell with no
  // spells; drinking a potion with none; Two-Weapon Fighting without two Light weapons (unless Dual Wielder).
  const usesOf = (key: string) => all.some((it) => it.key !== key && parentKey(it, all) === key);
  const hidden = new Set<string>([
    ...MAGIC_KEYS.filter((k) => !usesOf(k)),
    ...POTION_KEYS.filter((k) => !usesOf(k)),
    ...(lightWeaponCount(sheet) < 2 && !dualWielder ? [TWF_KEY] : []),
  ]);
  return { items: all.filter((it) => !hidden.has(it.key)), legendary: legendaryPerRound(sheet), attacks, ...(dualWielder ? { dualWielder } : {}) };
}

export const ATTACK_KEY = "common:Attack";
/** The Magic action (2024) or Cast a Spell (2014): hovering it reveals the sheet's Magic options. */
export const MAGIC_KEYS = ["common:Magic", "common:Cast a Spell"];
export const HELP_KEY = "common:Help";
export const isMultiattack = (it: Pick<ActionItem, "section" | "name">) => it.section === "actions" && /^Multiattack\b/i.test(it.name);

/** Revealed under the Attack action: the sheet's attacks (weapons, a creature's natural weapons), every option that
 *  replaces one attack (Unarmed Strike, Grapple, Shove, Disarm, a thrown flask of Acid, homebrew…), and what goes with
 *  an attack (2024: equip or unequip a weapon). Multiattack is an Action of its own, shown first. */
export function isAttackOption(it: ActionItem): boolean {
  if (it.category === "common" || it.category === "item") return it.cost === "attack" || !!it.withAttack;
  return it.section === "actions" && it.cost === "action" && !isMultiattack(it) && /\[1d20[+-]\d+\]/.test(it.text);
}

/** Revealed under Magic (Cast a Spell in 5E): the sheet's spells cast with an action (and spells or spell lists whose
 *  casting time isn't known, almost always an action), and the sheet's actions that say they're a Magic action.
 *  Magic items join them in 5.5E (see itemActions). */
export function isMagicOption(it: ActionItem): boolean {
  if (it.category === "spell") return it.cost === "action" || it.cost === "none";
  return (it.category === "action" || it.category === "feature") && it.cost === "action" && !isAttackOption(it) && !isMultiattack(it) && /\bMagic action\b/i.test(it.text);
}

/** The tile an item is revealed under (its key), or null if it stands on its own. */
export function parentKey(it: ActionItem, items: Pick<ActionItem, "key">[]): string | null {
  const has = (k: string) => items.some((x) => x.key === k);
  if (isAttackOption(it)) return has(ATTACK_KEY) ? ATTACK_KEY : null;
  if (it.under) return has(it.under) ? it.under : null;
  if (isMagicOption(it)) return MAGIC_KEYS.find(has) ?? null;
  return null;
}

export type BarFilter = "all" | "action" | "bonus" | "reaction" | "legendary" | "spell" | "feature" | "move";
export type SectionId = "action" | "bonus" | "reaction" | "legendary" | "spell" | "feature" | "move" | "free";
export interface BarSection { id: SectionId; title: string; items: ActionItem[] }

export const SECTION_TITLES: Record<SectionId, string> = {
  action: "Actions", bonus: "Bonus Actions", reaction: "Reactions", legendary: "Legendary Actions",
  spell: "Longer spells & rituals", feature: "Limited features", move: "Movement", free: "Free & other",
};
const SECTION_ORDER: SectionId[] = ["action", "bonus", "reaction", "legendary", "spell", "feature", "move", "free"];

/** Which section an item stands in by its cost (items revealed under another tile aren't placed: see parentKey).
 *  Spells go by their casting time like everything else; the ones that take longer get their own. */
export function sectionOf(it: ActionItem): SectionId {
  const byCost = it.cost === "action" || it.cost === "bonus" || it.cost === "reaction" || it.cost === "legendary" ? it.cost : null;
  if (byCost) return byCost;
  if (it.category === "spell") return it.cost === "free" ? "free" : "spell";
  if (it.category === "feature") return "feature";
  if (it.cost === "move") return "move";
  return "free";
}

/** Sheet entries first, then the rules' options. */
const sheetFirst = (items: ActionItem[]) => [...items.filter((it) => it.category !== "common"), ...items.filter((it) => it.category === "common")];

export interface BarLayout {
  sections: BarSection[];
  /** What each tile reveals, by the tile's key (only tiles shown in `sections`). */
  reveals: Record<string, ActionItem[]>;
  attackOptions: ActionItem[];
  magicOptions: ActionItem[];
  helpOptions: ActionItem[];
}

/** The bar as shown: sections in order, and what Attack, Magic, Help, Utilize, a potion action or Two-Weapon
 *  Fighting reveal. Filtering by Spells lists every spell. */
export function barLayout(bar: ActionBar, filter: BarFilter = "all"): BarLayout {
  const empty = { reveals: {}, attackOptions: [], magicOptions: [], helpOptions: [] };
  if (filter === "spell") {
    const spells = bar.items.filter((it) => it.category === "spell");
    return { sections: spells.length ? [{ id: "spell", title: "Spells", items: spells }] : [], ...empty };
  }
  const reveals: Record<string, ActionItem[]> = {};
  const by = new Map<SectionId, ActionItem[]>(SECTION_ORDER.map((id) => [id, []]));
  for (const it of bar.items) {
    const p = parentKey(it, bar.items);
    if (p) (reveals[p] ??= []).push(it);
    else by.get(sectionOf(it))!.push(it);
  }
  if (reveals[ATTACK_KEY]) reveals[ATTACK_KEY] = sheetFirst(reveals[ATTACK_KEY]);
  // Two-Weapon Fighting: the sheet's Light weapon attacks (any weapon attack with Dual Wielder). They stay under Attack too.
  if (bar.items.some((it) => it.key === TWF_KEY)) {
    const weapons = bar.items.filter((it) => it.section === "actions" && isAttackOption(it) && (() => { const w = weaponIn(it.name); return !!w && (bar.dualWielder || LIGHT_WEAPONS.includes(w)); })());
    if (weapons.length) reveals[TWF_KEY] = weapons;
  }
  // Help's ordinary use (help with a check or an attack) sits first among its options, next to first aid.
  const help = bar.items.find((it) => it.key === HELP_KEY);
  if (help && reveals[HELP_KEY]?.length) reveals[HELP_KEY] = [{ ...help, key: `${HELP_KEY}#assist` }, ...reveals[HELP_KEY]];
  // Multiattack leads the Actions, then Attack, then the sheet's own, then everyone's (Magic among them).
  const actions = by.get("action")!;
  const lead = [...actions.filter(isMultiattack), ...actions.filter((it) => it.key === ATTACK_KEY)];
  by.set("action", [...lead, ...sheetFirst(actions.filter((it) => !lead.includes(it)))]);
  for (const id of ["bonus", "reaction", "legendary"] as const) by.set(id, sheetFirst(by.get(id)!));
  const ids: SectionId[] = filter === "all" ? SECTION_ORDER : filter === "move" ? ["move", "free"] : [filter];
  const sections = ids.map((id) => ({ id, title: SECTION_TITLES[id], items: by.get(id)! })).filter((sec) => sec.items.length);
  const shown = new Set(sections.flatMap((sec) => sec.items.map((it) => it.key)));
  const visible = Object.fromEntries(Object.entries(reveals).filter(([k, v]) => shown.has(k) && v.length));
  return {
    sections, reveals: visible,
    attackOptions: visible[ATTACK_KEY] ?? [],
    magicOptions: MAGIC_KEYS.flatMap((k) => visible[k] ?? []),
    helpOptions: visible[HELP_KEY] ?? [],
  };
}

/** How many entries a filter shows, what its tiles reveal included. */
export function filterCount(bar: ActionBar, filter: BarFilter): number {
  const { sections, reveals } = barLayout(bar, filter);
  return sections.reduce((n, s) => n + s.items.length, 0) + Object.values(reveals).reduce((n, r) => n + r.length, 0);
}

// ------------------------------------------------------------------ explanations

/** What each kind of cost means, for the tabs and the tile's detail. */
export const COST_EXPLAINED: Record<Cost, string> = {
  action: "Uses your Action. You get one Action on each of your turns.",
  bonus: "Uses your Bonus Action. You get one per turn, but only something that says \"Bonus Action\" can use it.",
  reaction: "Uses your Reaction: an instant response to a trigger, even on someone else's turn. You get one, and it comes back at the start of your turn.",
  legendary: "A Legendary Action: taken right after another creature's turn ends. The creature has a few per round and gets them back at the start of its own turn.",
  free: "Doesn't take an action.",
  longer: "Takes longer than a turn to do, so it's usually not something for the middle of a fight.",
  move: "Uses movement, not an action: spend it before, after or between your actions.",
  attack: "Done as one of the attacks of your Attack action (so with Extra Attack you can mix it with other attacks).",
  none: "",
};

const RESET_TEXT: Record<Reset, string> = { short: "Short or Long Rest", long: "Long Rest", turn: "turn", other: "rest" };

/** How an option works, in plain words: what it costs, what to roll, what the target does, and its limits. */
export function explain(it: ActionItem, legendaryPerRound = 0): string[] {
  const out: string[] = [];
  if (it.cost === "legendary") {
    out.push(`A Legendary Action: taken right after another creature's turn ends.${legendaryPerRound ? ` The creature has ${legendaryPerRound} per round` : ""}${it.legendaryCost ? `${legendaryPerRound ? "," : ""} and this one costs ${it.legendaryCost} of them` : ""}. They come back at the start of its turn.`);
  } else if (it.cost === "longer") {
    out.push(`Takes ${it.costNote ?? "a minute or more"}, so it's usually not something for the middle of a fight.`);
  } else if (it.cost !== "none") {
    out.push(COST_EXPLAINED[it.cost]);
    if (it.cost === "reaction" && it.costNote) out.push(`Trigger: ${it.costNote.replace(/^Reaction:\s*/i, "")}.`);
    if (it.category === "common" && it.costNote && it.cost !== "attack") out.push(`${it.costNote}.`);
  }
  if (it.category === "common") {
    // The rule, with this unit's numbers, comes first; then what it costs.
    if (it.text) out.unshift(it.text);
    if (it.source === "DMG") out.push("An optional rule from the Dungeon Master's Guide (the GM can turn these off in Room settings).");
    if (it.source === "Homebrew") out.push("Homebrew: added by the GM for this room.");
    return out;
  }

  const rolls = rollSegments(parseChips(it.text));
  const atk = rolls.find((r) => r.kind === "attack");
  const dmg = damageOf(it.text);
  const save = saveOf(it.text);
  if (atk) {
    out.push(`Make an attack roll: d20 ${atk.display} against the target's Armor Class (AC). Equal or higher hits.`);
    if (dmg.length) out.push(`On a hit, roll ${dmg.join(" plus ")} damage. A natural 20 is a critical hit: roll the damage dice twice.`);
  }
  if (save) {
    const half = /half (as much )?damage|Success: Half/i.test(it.text);
    out.push(`Each target makes a DC ${save.dc} ${save.ability} saving throw and needs ${save.dc} or more to succeed.${!atk && dmg.length ? ` On a failure they take ${dmg.join(" plus ")} damage${half ? ", half as much on a success" : ""}.` : ""}`);
  }
  if (!atk && !save && dmg.length) out.push(`Deals ${dmg.join(" plus ")} damage.`);
  if (!atk && !save && !dmg.length && rolls.length && /regain|heal/i.test(it.text)) out.push(`Roll ${rolls.map((r) => r.display).join(" plus ")} to see how many Hit Points are regained.`);

  if (it.spellLevel === 0) out.push("A cantrip: cast it as often as you like, no spell slot needed.");
  else if (it.spellLevel) out.push(`Needs a level ${it.spellLevel} spell slot or higher. Some spells get stronger from a higher slot.`);
  if (it.category === "spell" && it.spellLevel === undefined) {
    if (/^At Will$/i.test(it.name)) out.push("Each of these can be cast any number of times.");
    else if (/^(\d+)\/Day Each$/i.test(it.name)) out.push(`Each of these can be cast ${/^(\d+)/.exec(it.name)![1]} time(s) per day.`);
    else if (/^Level (\d) \((\d+) slots?\)$/.test(it.name)) out.push("Spells of this level, cast with this creature's spell slots.");
  }
  if (it.concentration) out.push("Concentration: it lasts only while you concentrate. Casting another Concentration spell ends it, and taking damage means a Constitution save to keep it.");
  if (it.ritual) out.push("Ritual: you can cast it without a spell slot if you take 10 extra minutes.");
  if (it.limit) {
    const free = it.category === "spell" && it.spellLevel ? " without a spell slot" : "";
    out.push(it.limit.reset === "turn"
      ? `Limited: ${it.limit.max} time${it.limit.max === 1 ? "" : "s"} per turn${free}.`
      : `Limited: ${it.limit.max} time${it.limit.max === 1 ? "" : "s"}${free}, back after a ${RESET_TEXT[it.limit.reset]}.`);
  }
  if (it.recharge) out.push(`Recharge ${it.recharge}–6: once used, roll a d6 at the start of each of the creature's turns. On ${it.recharge === 6 ? "a 6" : `${it.recharge} or higher`} it can be used again.`);
  return out;
}
