/**
 * The action bar (BG3-style hotbar), read-only: what a unit can do, grouped by what it costs (Action, Bonus Action,
 * Reaction, Legendary), with a plain explanation of how each option works. Nothing is counted or spent here (Butler
 * only tracks HP): it's for players to consult. Built from the unit's sheet (for party members: the D&D Beyond sync),
 * so a re-sync updates it. Pure, so the parsing and explanations are unit-tested; the actions page renders it.
 */
import { parseChips, rollSegments } from "./chips";
import type { SheetEntry, UnitSheet } from "./sheet";

/** What using an entry costs. "longer": a casting time of a minute or more; "none": passive or unknown. */
export type Cost = "action" | "bonus" | "reaction" | "legendary" | "free" | "longer" | "none";
export type Category = "common" | "action" | "bonus" | "reaction" | "legendary" | "spell" | "feature";
export type Reset = "short" | "long" | "turn" | "other";

/** A rule limit as written on the sheet ("2/Long Rest"). Shown as information only, never counted. */
export interface Limit { max: number; reset: Reset; label: string }

export interface ActionItem {
  key: string;
  /** Name without the uses / recharge note. */
  name: string;
  text: string;
  section: "traits" | "actions" | "bonusActions" | "reactions" | "legendary" | "spells" | "common";
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

type SheetSection = Exclude<ActionItem["section"], "common">;

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

// ------------------------------------------------------------------ common actions

interface CommonDef { name: string; cost: Cost; text: string }
const COMMON_2024: CommonDef[] = [
  { name: "Attack", cost: "action", text: "Make an attack with a weapon or an Unarmed Strike. With Extra Attack you make more than one attack with this same action." },
  { name: "Dash", cost: "action", text: "Gain extra movement equal to your Speed for this turn (so you can move twice as far)." },
  { name: "Disengage", cost: "action", text: "Your movement doesn't provoke Opportunity Attacks for the rest of this turn." },
  { name: "Dodge", cost: "action", text: "Until the start of your next turn, attack rolls against you have Disadvantage and you make Dexterity saving throws with Advantage. You lose this if you're Incapacitated or your Speed is 0." },
  { name: "Help", cost: "action", text: "Help an ally with an ability check (they get Advantage on their next one), or distract an enemy within 5 ft. of you so an ally's next attack against it has Advantage." },
  { name: "Hide", cost: "action", text: "While Heavily Obscured or behind Three-Quarters or Total Cover, make a DC 15 Dexterity (Stealth) check. On a success you have the Invisible condition until you're found, make noise or attack." },
  { name: "Influence", cost: "action", text: "Try to get a creature to do something: a Charisma (Deception, Intimidation, Performance or Persuasion) or Wisdom (Animal Handling) check." },
  { name: "Magic", cost: "action", text: "Cast a spell with a casting time of an action, or use a magic item or magical feature that takes an action." },
  { name: "Ready", cost: "action", text: "Choose a trigger (\"if the goblin steps out\") and an action. When the trigger happens, you can use your Reaction to take that action. A readied spell needs Concentration until it's released." },
  { name: "Search", cost: "action", text: "Look for something: a Wisdom (Insight, Medicine, Perception or Survival) check." },
  { name: "Study", cost: "action", text: "Recall or work something out: an Intelligence (Arcana, History, Investigation, Nature or Religion) check." },
  { name: "Utilize", cost: "action", text: "Use a nonmagical object: pull a lever, light a torch, open a stuck door." },
  { name: "Opportunity Attack", cost: "reaction", text: "When a creature you can see leaves your reach, you can make one melee attack against it." },
];
const COMMON_2014: CommonDef[] = [
  { name: "Attack", cost: "action", text: "Make one melee or ranged attack. With Extra Attack you make more than one attack with this same action." },
  { name: "Cast a Spell", cost: "action", text: "Cast a spell with a casting time of 1 action." },
  { name: "Dash", cost: "action", text: "Gain extra movement equal to your speed for this turn (so you can move twice as far)." },
  { name: "Disengage", cost: "action", text: "Your movement doesn't provoke opportunity attacks for the rest of the turn." },
  { name: "Dodge", cost: "action", text: "Until your next turn, attack rolls against you have disadvantage (if you can see the attacker) and you make Dexterity saving throws with advantage." },
  { name: "Help", cost: "action", text: "Give an ally advantage on their next ability check, or on their next attack against a creature within 5 ft. of you." },
  { name: "Hide", cost: "action", text: "Make a Dexterity (Stealth) check to hide from creatures that can't clearly see you." },
  { name: "Ready", cost: "action", text: "Choose a trigger and an action. When the trigger happens, you can use your reaction to take that action. A readied spell needs concentration." },
  { name: "Search", cost: "action", text: "Look for something: a Wisdom (Perception) or Intelligence (Investigation) check." },
  { name: "Use an Object", cost: "action", text: "Use an object that needs your action, or interact with a second object this turn." },
  { name: "Opportunity Attack", cost: "reaction", text: "When a hostile creature you can see moves out of your reach, you can make one melee attack against it." },
];

export function commonActions(rules: "2024" | "2014"): ActionItem[] {
  return (rules === "2014" ? COMMON_2014 : COMMON_2024).map((c) => ({
    key: `common:${c.name}`, name: c.name, text: c.text, section: "common", category: "common", cost: c.cost, summary: "",
  }));
}

// ------------------------------------------------------------------ the bar

export interface ActionBar { items: ActionItem[]; legendary: number }

export function actionBar(sheet: UnitSheet, rules: "2024" | "2014" = "2024"): ActionBar {
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
  return { items: [...items, ...commonActions(rules)], legendary: legendaryPerRound(sheet) };
}

/** Which tab an item shows under. Spells and features show under their cost too. */
export function inTab(it: ActionItem, tab: Category | "all"): boolean {
  if (tab === "all") return it.category !== "common";
  if (tab === it.category) return true;
  if (tab === "action" || tab === "bonus" || tab === "reaction" || tab === "legendary") return it.cost === tab && it.category !== "common";
  return false;
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
  }
  if (it.category === "common") return out;

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
