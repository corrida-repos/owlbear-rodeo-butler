/**
 * D&D Beyond character → Forge party member.
 *
 * D&D Beyond's character-service JSON is raw: the sheet computes AC, HP, saves, skills, initiative etc.
 * client-side from base values + "modifiers" (race/class/background/feat/item). This module re-derives
 * them. Values that can't be derived reliably are flagged, never guessed silently.
 */
import { FORGE_DIE_SIZES } from "./constants";
import { fmtMod } from "./dice";
import { evalMath } from "./fivetools-copy";
import type { ListEntry } from "./schema";

export const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"] as const;
export type Ability = (typeof ABILITIES)[number];
const ABILITY_NAME: Record<Ability, string> = { str: "strength", dex: "dexterity", con: "constitution", int: "intelligence", wis: "wisdom", cha: "charisma" };
const statAbility = (id: number | null | undefined): Ability | undefined => (id && id >= 1 && id <= 6 ? ABILITIES[id - 1] : undefined);

export const SKILLS: Record<string, Ability> = {
  acrobatics: "dex", "animal-handling": "wis", arcana: "int", athletics: "str", deception: "cha", history: "int",
  insight: "wis", intimidation: "cha", investigation: "int", medicine: "wis", nature: "int", perception: "wis",
  performance: "cha", persuasion: "cha", religion: "int", "sleight-of-hand": "dex", stealth: "dex", survival: "wis",
};
const CONDITIONS = new Set(["blinded", "charmed", "deafened", "exhaustion", "frightened", "grappled", "incapacitated", "invisible",
  "paralyzed", "petrified", "poisoned", "prone", "restrained", "stunned", "unconscious"]);
const SIZE_BY_ID: Record<number, string> = { 2: "T", 3: "S", 4: "M", 5: "L", 6: "H", 7: "G" };
const SIZE_NAME: Record<string, string> = { T: "Tiny", S: "Small", M: "Medium", L: "Large", H: "Huge", G: "Gargantuan" };
const ALIGNMENT: Record<number, string> = { 1: "Lawful Good", 2: "Neutral Good", 3: "Chaotic Good", 4: "Lawful Neutral", 5: "Neutral", 6: "Chaotic Neutral", 7: "Lawful Evil", 8: "Neutral Evil", 9: "Chaotic Evil" };
const ACTIVATION: Record<number, "action" | "bonus" | "reaction" | "other"> = { 1: "action", 3: "bonus", 4: "reaction" };
const RESET: Record<number, string> = { 1: "Short Rest", 2: "Long Rest", 3: "Dawn", 4: "Other" };

export interface PartyMember {
  ddbId: number;
  name: string;
  player?: string;
  level: number;
  classes: string;
  species: string;
  size: string; // T/S/M/L/H/G
  avatarUrl?: string;
  hp: { max: number; current: number; temp: number };
  ac: number;
  initiative: { modifier: number; advantage: boolean; reasons: string[] };
  /** Forge default-system attribute values keyed by BID (lists without ids). */
  forge: Record<string, number | string | ListEntry[]>;
  flags: string[];
}

// ------------------------------------------------------------------ text helpers

const ENTITIES: Record<string, string> = { "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&rsquo;": "’", "&lsquo;": "‘", "&ldquo;": "“", "&rdquo;": "”", "&mdash;": "—", "&ndash;": "–", "&times;": "×", "&minus;": "−" };
export function htmlToText(html: string | null | undefined): string {
  if (!html) return "";
  return html
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|li|h\d|tr)>/gi, "\n").replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/\[(\w+)\]([^[]*)\[\/\1\]/g, "$2") // [action]Attack[/action]
    .replace(/&[a-z]+;|&#\d+;/gi, (e) => ENTITIES[e] ?? (e.startsWith("&#") ? String.fromCharCode(Number(e.slice(2, -1))) : e))
    .replace(/�/g, "’")
    .replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
}

/** Forge dice chip for simple formulas, else "". */
export function chip(formula: string): string {
  const f = formula.replace(/\s+/g, "");
  if (!/^\d+d\d+([+-]\d+)?$/i.test(f)) return "";
  const m = /^(\d+)d(\d+)/i.exec(f)!;
  return Number(m[1]) <= 100 && FORGE_DIE_SIZES.has(Number(m[2])) ? `[${f}]` : "";
}
const withChip = (formula: string) => { const c = chip(formula); return c ? `${formula} ${c}` : formula; };

// ------------------------------------------------------------------ main

export interface DdbConvertOptions {
  /** Campaign party inventory (character-service /party/inventory/<campaignId>): items a member equips from it count. */
  partyInventory?: { partyItems?: any[]; modifiers?: { item?: any[] } } | null;
}

export function convertDdbCharacter(c: any, opts: DdbConvertOptions = {}): PartyMember {
  const flags: string[] = [];

  // ---- inventory incl. party-inventory items this character has equipped
  const fromParty = (opts.partyInventory?.partyItems ?? []).filter((i: any) => i.equipped && i.equippedEntityId === c.id);
  const inv: any[] = [...(c.inventory ?? []), ...fromParty.map((i: any) => ({ ...i, _fromParty: true }))];
  if (fromParty.length) flags.push(`Using party-inventory item(s): ${fromParty.map((i: any) => i.definition?.name).join(", ")}.`);
  const partyItemMods = (opts.partyInventory?.modifiers?.item ?? []);

  // ---- active modifiers: everything except items that aren't equipped (or need attunement and aren't attuned)
  const equippedDefs = new Map<number, any>();
  for (const i of inv) if (i.equipped) equippedDefs.set(i.definition?.id, i);
  const mods: any[] = [];
  for (const [group, list] of Object.entries<any[]>({ ...c.modifiers, item: [...(c.modifiers?.item ?? []), ...partyItemMods] })) {
    if (group === "condition") continue;
    for (const m of list ?? []) {
      if (group === "item") {
        const it = equippedDefs.get(m.componentId);
        if (!it) continue;
        if (m.requiresAttunement && !it.isAttuned) continue;
      }
      mods.push({ ...m, _group: group });
    }
  }
  const find = (type: string, sub: string | RegExp) =>
    mods.filter((m) => m.type === type && (typeof sub === "string" ? m.subType === sub : sub.test(m.subType)));

  // ---- ability scores
  const score = {} as Record<Ability, number>;
  ABILITIES.forEach((a, i) => {
    const id = i + 1;
    const override = c.overrideStats?.find((s: any) => s.id === id)?.value;
    const base = c.stats?.find((s: any) => s.id === id)?.value ?? 10;
    const bonusStat = c.bonusStats?.find((s: any) => s.id === id)?.value ?? 0;
    let v = override ?? base + bonusStat + find("bonus", `${ABILITY_NAME[a]}-score`).reduce((s, m) => s + (m.value ?? m.fixedValue ?? 0), 0);
    for (const m of find("set", `${ABILITY_NAME[a]}-score`)) v = Math.max(v, m.value ?? m.fixedValue ?? 0);
    score[a] = v;
  });
  const mod = (a: Ability) => Math.floor((score[a] - 10) / 2);
  const level = (c.classes ?? []).reduce((s: number, k: any) => s + (k.level ?? 0), 0) || 1;
  const pb = Math.ceil(level / 4) + 1;

  /** Value of a bonus modifier: fixed value, an ability modifier (statId), or the proficiency bonus (bonusTypes [1]). */
  const bonusValue = (m: any): number => {
    if (typeof m.value === "number") return m.value;
    if (typeof m.fixedValue === "number" && !m.dice) return m.fixedValue;
    const a = statAbility(m.statId);
    if (a) return Math.max(mod(a), 1);
    if (Array.isArray(m.bonusTypes) && m.bonusTypes.includes(1)) return pb;
    return 0;
  };
  const sumBonus = (sub: string) => find("bonus", sub).reduce((s, m) => s + bonusValue(m), 0);

  // ---- hit points
  const conMod = mod("con");
  const perLevel = sumBonus("hit-points-per-level");
  const flatHp = find("bonus", "hit-points").filter((m) => !m.dice).reduce((s, m) => s + bonusValue(m), 0);
  const maxHp = c.overrideHitPoints ?? (c.baseHitPoints ?? 0) + (c.bonusHitPoints ?? 0) + (conMod + perLevel) * level + flatHp;
  const hp = { max: maxHp, current: Math.max(0, maxHp - (c.removedHitPoints ?? 0)), temp: c.temporaryHitPoints ?? 0 };

  // ---- armor class
  const equippedArmor = inv.filter((i) => i.equipped && i.definition?.filterType === "Armor");
  const dex = mod("dex");
  const mediumCapPre = find("set", "ac-max-dex-armored-modifier")[0]?.value ?? 2;
  const armorTotal = (d: any) => d.armorClass + (d.armorTypeId === 1 ? dex : d.armorTypeId === 2 ? Math.min(dex, mediumCapPre) : 0);
  // Like D&D Beyond: if several body armors are equipped, the best total AC wins.
  const body = equippedArmor.filter((i) => [1, 2, 3].includes(i.definition.armorTypeId)).sort((a, b) => armorTotal(b.definition) - armorTotal(a.definition))[0];
  const shield = equippedArmor.find((i) => i.definition.armorTypeId === 4);
  let ac: number;
  const acNotes: string[] = [];
  if (body) {
    const d = body.definition;
    const mediumCap = find("set", "ac-max-dex-armored-modifier")[0]?.value ?? 2;
    ac = d.armorClass + (d.armorTypeId === 1 ? dex : d.armorTypeId === 2 ? Math.min(dex, mediumCap) : 0);
    acNotes.push(d.name);
    const armorProf = find("proficiency", d.armorTypeId === 1 ? "light-armor" : d.armorTypeId === 2 ? "medium-armor" : "heavy-armor").length;
    const specific = find("proficiency", new RegExp(`^${String(d.baseArmorName ?? d.name).toLowerCase().replace(/[^a-z]+/g, "-")}$`)).length;
    if (!armorProf && !specific) flags.push(`Wearing ${d.name}: no ${d.armorTypeId === 1 ? "light" : d.armorTypeId === 2 ? "medium" : "heavy"} armor proficiency found in the D&D Beyond data — check the sheet (without it: no spellcasting, disadvantage on Str/Dex rolls).`);
    if (d.armorTypeId === 3 && d.stealthCheck === 2) acNotes.push("stealth disadvantage");
    ac += sumBonus("armored-armor-class");
  } else {
    const unarmored = find("set", "unarmored-armor-class");
    const candidates = [10 + dex, ...unarmored.map((m) => (m.value ?? 10) + dex + (statAbility(m.statId) ? mod(statAbility(m.statId)!) : 0))];
    ac = Math.max(...candidates);
    if (unarmored.length) acNotes.push("Unarmored Defense/natural armor");
    ac += sumBonus("unarmored-armor-class");
  }
  if (shield) { ac += shield.definition.armorClass ?? 2; acNotes.push("shield"); }
  ac += sumBonus("armor-class");
  const acOverride = (c.characterValues ?? []).find((v: any) => v.typeId === 1 && typeof v.value === "number");
  if (acOverride) { ac = acOverride.value; flags.push(`AC overridden on D&D Beyond to ${ac}.`); }

  // ---- saves, skills, passives
  const saveVal = (a: Ability) => mod(a) + (find("proficiency", `${ABILITY_NAME[a]}-saving-throws`).length ? pb : 0) + sumBonus("saving-throws") + sumBonus(`${ABILITY_NAME[a]}-saving-throws`);
  const halfAll = find("half-proficiency", "ability-checks").length > 0;
  const skillVal = (s: string) => {
    const a = SKILLS[s]!;
    const prof = find("expertise", s).length ? 2 : find("proficiency", s).length ? 1 : find("half-proficiency", s).length || halfAll ? 0.5 : 0;
    return { total: mod(a) + Math.floor(prof * pb) + sumBonus(s) + sumBonus("ability-checks"), prof, bonus: sumBonus(s) };
  };
  const skillText = Object.keys(SKILLS)
    .map((s) => ({ s, ...skillVal(s) }))
    .filter((x) => x.prof >= 1 || x.bonus)
    .map((x) => `${x.s.replace(/-/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase())} ${fmtMod(x.total)}${x.prof === 2 ? " (expertise)" : ""}`)
    .join(", ");
  const passive = (s: string) => 10 + skillVal(s).total + sumBonus(`passive-${s}`);

  // ---- initiative
  const initBonus = find("bonus", "initiative");
  const initiative = {
    modifier: dex + initBonus.reduce((s, m) => s + bonusValue(m), 0),
    advantage: find("advantage", "initiative").length > 0,
    reasons: [`Dex ${fmtMod(dex)}`, ...initBonus.map((m) => `${fmtMod(bonusValue(m))} from ${componentName(c, m) ?? m._group}`),
      ...find("advantage", "initiative").map((m) => `advantage from ${componentName(c, m) ?? m._group}`)],
  };

  // ---- speeds & senses
  const rs = c.race?.weightSpeeds?.normal ?? {};
  const walkBase = c.race?.weightSpeeds?.override?.walk ?? rs.walk ?? 30;
  const walk = walkBase + sumBonus("speed") + sumBonus("speed-walking") + (body ? 0 : sumBonus("unarmored-movement"));
  const innate = (kind: string, raceVal: number) => {
    const set = find("set", `innate-speed-${kind}`).map((m) => m.value ?? walk);
    return Math.max(raceVal ?? 0, ...set, 0) + (raceVal || set.length ? sumBonus(`speed-${kind}`) : 0);
  };
  const senses: string[] = [];
  for (const s of ["darkvision", "blindsight", "tremorsense", "truesight"]) {
    const vals = [...find("set-base", s), ...find("sense", s)].map((m) => m.value ?? m.fixedValue ?? 0);
    const custom = (c.customSenses ?? []).filter((x: any) => x.senseId && x.distance && s === ["", "blindsight", "darkvision", "tremorsense", "truesight"][x.senseId]).map((x: any) => x.distance);
    const v = Math.max(0, ...vals, ...custom) + sumBonus(s);
    if (v) senses.push(`${s[0]!.toUpperCase()}${s.slice(1)} ${v} ft.`);
  }
  senses.push(`Passive Perception ${passive("perception")}`, `Passive Insight ${passive("insight")}`, `Passive Investigation ${passive("investigation")}`);

  const listOf = (type: string) => [...new Set(mods.filter((m) => m.type === type).map((m) => m.friendlySubtypeName as string))];
  const immunities = listOf("immunity");
  const languages = listOf("language");

  // ---- size
  const sizeMod = find("size", /.*/)[0]?.subType as string | undefined;
  const size = sizeMod ? ({ tiny: "T", small: "S", medium: "M", large: "L", huge: "H", gargantuan: "G" } as Record<string, string>)[sizeMod] ?? "M" : SIZE_BY_ID[c.race?.sizeId] ?? "M";

  // ---- actions: weapons, unarmed strike, D&D Beyond actions
  const actions: ListEntry[] = [];
  const bonusActions: ListEntry[] = [];
  const reactions: ListEntry[] = [];
  const abilities: ListEntry[] = [];
  const seen = new Set<string>();
  const profWeapon = (d: any) =>
    (d.categoryId === 1 && find("proficiency", "simple-weapons").length) || (d.categoryId === 2 && find("proficiency", "martial-weapons").length) ||
    find("proficiency", new RegExp(`^${String(d.type ?? d.name).toLowerCase().replace(/\s+/g, "-")}s?$`)).length;
  // Weapons, plus gear that behaves as a weapon (e.g. a druidic-focus Staff = Quarterstaff via `weaponBehaviors`).
  const weaponItems = inv.filter((i) => i.equipped).flatMap((i) =>
    i.definition?.filterType === "Weapon" ? [{ it: i, d: i.definition }]
      : (i.definition?.weaponBehaviors ?? []).map((wb: any) => ({ it: i, d: { ...wb, name: i.definition.name, grantedModifiers: i.definition.grantedModifiers } })));
  for (const { it, d } of weaponItems) {
    const props = new Set((d.properties ?? []).map((p: any) => p.name));
    const ranged = d.attackType === 2;
    const a: Ability = ranged ? "dex" : props.has("Finesse") ? (mod("dex") > mod("str") ? "dex" : "str") : "str";
    const magic = (d.grantedModifiers ?? []).filter((m: any) => m.type === "bonus" && m.subType === "magic").reduce((s: number, m: any) => s + (m.value ?? m.fixedValue ?? 0), 0);
    const proficient = !!profWeapon(d);
    const hit = mod(a) + (proficient ? pb : 0) + magic;
    const dmgDice = d.damage?.diceString ?? (d.fixedDamage != null ? String(d.fixedDamage) : "1");
    const dmgMod = mod(a) + magic;
    const dmg = dmgMod ? `${dmgDice}${dmgMod > 0 ? "+" : ""}${dmgMod}` : dmgDice;
    const reach = ranged ? `range ${d.range}/${d.longRange} ft.` : `reach ${props.has("Reach") ? 10 : 5} ft.${props.has("Thrown") ? ` or range ${d.range}/${d.longRange} ft.` : ""}`;
    const versatile = props.has("Versatile") && d.properties.find((p: any) => p.name === "Versatile")?.notes;
    const name = d.name ?? it.definition.name;
    if (seen.has(name)) continue;
    seen.add(name);
    actions.push({
      name,
      description: `${ranged ? "Ranged" : props.has("Thrown") ? "Melee or Ranged" : "Melee"} Attack Roll: ${fmtMod(hit)} [1d20${fmtMod(hit)}], ${reach} Hit: ${withChip(dmg)} ${d.damageType ?? ""} damage.` +
        `${versatile ? ` Versatile: ${withChip(`${versatile}${dmgMod ? (dmgMod > 0 ? "+" : "") + dmgMod : ""}`)}.` : ""}${proficient ? "" : " (not proficient)"}` +
        `${(() => { const rest = [...props].filter((p) => !["Finesse", "Thrown", "Reach", "Versatile"].includes(String(p))); return rest.length ? ` Properties: ${rest.join(", ")}.` : ""; })()}`,
    });
  }
  const unarmedHit = mod("str") + pb;
  actions.push({ name: "Unarmed Strike", description: `Melee Attack Roll: ${fmtMod(unarmedHit)} [1d20${fmtMod(unarmedHit)}], reach 5 ft. Hit: ${Math.max(0, 1 + mod("str"))} Bludgeoning damage.` });

  const tpl = (s: string) => renderTemplate(s, { pb, mod, level, score });
  for (const [, list] of Object.entries<any[]>(c.actions ?? {})) {
    for (const a of list ?? []) {
      if (!a?.name || seen.has(a.name)) continue;
      seen.add(a.name);
      const lu = a.limitedUse;
      const uses = lu && (lu.maxUses || lu.useProficiencyBonus) ? (lu.maxUses ?? 0) + (lu.useProficiencyBonus ? pb : 0) : 0;
      const usesText = uses ? ` (${uses}/${RESET[lu.resetType] ?? "rest"}${lu.numberUsed ? `, ${lu.numberUsed} used` : ""})` : "";
      let desc = tpl(a.snippet || htmlToText(a.description));
      if (a.dice?.diceString) desc += ` ${withChip(a.dice.diceString)}`;
      const entry = { name: `${a.name}${usesText}`, description: desc };
      const kind = ACTIVATION[a.activation?.activationType] ?? "other";
      (kind === "action" ? actions : kind === "bonus" ? bonusActions : kind === "reaction" ? reactions : abilities).push(entry);
    }
  }

  // ---- features: class (≤ level), subclass, species, feats
  const SKIP = /^(core .* traits|ability score (improvement|increases?)|\d+: ability score improvement|.* subclass|languages|creature type|size|speed|hit points|proficiencies|equipment|epic boon)$/i;
  const addFeature = (name: string, text: string, source: string) => {
    if (!name || seen.has(name) || SKIP.test(name)) return;
    seen.add(name);
    const t = tpl(text);
    abilities.push({ name, description: `${t.length > 700 ? `${t.slice(0, 700)}…` : t}${source ? ` (${source})` : ""}` });
  };
  for (const k of c.classes ?? []) {
    for (const f of k.classFeatures ?? []) if ((f.definition?.requiredLevel ?? 99) <= k.level) addFeature(f.definition.name, f.definition.snippet || htmlToText(f.definition.description), k.definition?.name);
    for (const f of k.subclassDefinition?.classFeatures ?? []) if ((f.requiredLevel ?? 99) <= k.level) addFeature(f.name, f.snippet || htmlToText(f.description), k.subclassDefinition.name);
  }
  for (const t of c.race?.racialTraits ?? []) addFeature(t.definition?.name, t.definition?.snippet || htmlToText(t.definition?.description), c.race?.baseName ?? "species");
  for (const f of c.feats ?? []) {
    const d = f.definition ?? {};
    if (/ability score (increase|improvement)/i.test(d.name ?? "")) continue;
    addFeature(d.name, d.snippet || htmlToText(d.description), "feat");
  }

  // ---- spells
  const spells = spellEntries(c, { pb, mod, level, score }, flags);

  // ---- inventory
  const inventory: ListEntry[] = inv
    .filter((i) => i.definition?.name)
    .map((i) => ({
      name: `${i.definition.name}${i.quantity > 1 ? ` ×${i.quantity}` : ""}${i.equipped ? " (equipped)" : ""}${i.isAttuned ? " (attuned)" : ""}`,
      description: htmlToText(i.definition.snippet || i.definition.description).slice(0, 300),
    }));

  // ---- flags for things we can't compute
  if (find("set", "unarmored-armor-class").length) flags.push("Unarmored Defense/natural armor detected — verify AC against D&D Beyond.");
  if ((c.conditions ?? []).length) flags.push(`Active conditions on D&D Beyond: ${(c.conditions ?? []).map((x: any) => x.id).join(", ")} (not applied).`);
  if (c.classes?.length > 1) flags.push("Multiclass: spell slots per class shown; multiclass slot table not combined.");

  const savesProf = ABILITIES.filter((a) => find("proficiency", `${ABILITY_NAME[a]}-saving-throws`).length);
  const classes = (c.classes ?? []).map((k: any) => `${k.definition?.name} ${k.level}${k.subclassDefinition ? ` (${k.subclassDefinition.name})` : ""}`).join(" / ");

  const forge: PartyMember["forge"] = {
    Z001: level,
    Z002: SIZE_NAME[size] ?? "Medium",
    Z003: ALIGNMENT[c.alignmentId] ?? "",
    Z004: c.race?.fullName ?? "",
    Z007: ac,
    Z008: walk,
    Z009: innate("swimming", rs.swim),
    Z010: innate("burrowing", rs.burrow),
    Z011: innate("climbing", rs.climb),
    Z012: innate("flying", rs.fly),
    Z013: senses.join(", "),
    Z014: skillText,
    Z015: languages.join(", ") || "—",
    Z017: score.str, Z018: score.dex, Z019: score.con, Z020: score.int, Z021: score.wis, Z022: score.cha,
    Z023: saveVal("str"), Z024: saveVal("dex"), Z025: saveVal("con"), Z026: saveVal("int"), Z027: saveVal("wis"), Z028: saveVal("cha"),
    Z029: level, // Forge's Proficiency roll formula is 1d20 + 1 + ceil(@Z029/4), i.e. it expects the level
    Z030: listOf("vulnerability").join(", "),
    Z031: listOf("resistance").join(", "),
    Z032: immunities.filter((x) => !CONDITIONS.has(x.toLowerCase())).join(", "),
    Z033: immunities.filter((x) => CONDITIONS.has(x.toLowerCase())).join(", "),
    Z034: abilities,
    Z035: actions,
    Z036: bonusActions,
    Z037: reactions,
    Z039: spells,
    Z040: inventory,
  };

  return {
    ddbId: c.id,
    name: c.name,
    player: c.username,
    level,
    classes,
    species: c.race?.fullName ?? "",
    size,
    avatarUrl: c.decorations?.avatarUrl || undefined,
    hp,
    ac,
    initiative,
    forge,
    flags: [
      `AC ${ac} = ${acNotes.length ? acNotes.join(" + ") : "10 + Dex"}${sumBonus("armor-class") ? ` + ${sumBonus("armor-class")} bonus` : ""}.`,
      `Saving throw proficiencies: ${savesProf.map((a) => a.toUpperCase()).join(", ") || "none"}.`,
      ...flags,
    ],
  };
}

function componentName(c: any, m: any): string | undefined {
  const id = m.componentId;
  for (const f of c.feats ?? []) if (f.definition?.id === id || f.componentId === id) return `"${f.definition?.name}"`;
  for (const t of c.race?.racialTraits ?? []) if (t.definition?.id === id) return `"${t.definition.name}"`;
  for (const k of c.classes ?? []) for (const f of k.classFeatures ?? []) if (f.definition?.id === id) return `"${f.definition.name}"`;
  for (const i of c.inventory ?? []) if (i.definition?.id === id) return `"${i.definition.name}"`;
  return undefined;
}

interface TplCtx { pb: number; mod: (a: Ability) => number; level: number; score: Record<Ability, number> }

/** D&D Beyond snippet placeholders: {{proficiency}}, {{modifier:wis@min:1}}, {{savedc:con}}, {{characterlevel}}, {{(classlevel*5)}} … */
export function renderTemplate(s: string, ctx: TplCtx): string {
  return s.replace(/\{\{([^}]+)\}\}/g, (whole, inner: string) => {
    const [exprRaw = "", ...opts] = inner.split("@");
    const expr = exprRaw.replace(/#\w+/g, "").trim();
    const minOpt = opts.join("@").match(/min:(-?\d+)/);
    const sub = (e: string): string => e
      .replace(/proficiency/g, String(ctx.pb))
      .replace(/(characterlevel|classlevel)/g, String(ctx.level))
      .replace(/savedc:(str|dex|con|int|wis|cha)/g, (_w, a: Ability) => String(8 + ctx.pb + ctx.mod(a)))
      .replace(/spellattack:(str|dex|con|int|wis|cha)/g, (_w, a: Ability) => String(ctx.pb + ctx.mod(a)))
      .replace(/modifier:(str|dex|con|int|wis|cha)/g, (_w, a: Ability) => String(ctx.mod(a)));
    const e = sub(expr);
    if (/^[\d+\-*/().\s]+$/.test(e)) {
      try {
        let v = Math.floor(evalMath(e));
        if (minOpt) v = Math.max(v, Number(minOpt[1]));
        return String(v);
      } catch { /* fall through */ }
    }
    if (/scalevalue|limiteduse/.test(expr)) return "(see sheet)";
    return whole;
  });
}

// ------------------------------------------------------------------ spells

const ABBR: Record<number, string> = { 1: "STR", 2: "DEX", 3: "CON", 4: "INT", 5: "WIS", 6: "CHA" };

function spellEntries(c: any, ctx: TplCtx, flags: string[]): ListEntry[] {
  const out: ListEntry[] = [];
  const level = ctx.level;
  const cantripScale = 1 + (level >= 5 ? 1 : 0) + (level >= 11 ? 1 : 0) + (level >= 17 ? 1 : 0);

  const describe = (s: any, abilityId: number | undefined, prefix = "") => {
    const d = s.definition ?? {};
    const a = statAbility(abilityId);
    const atk = a ? ctx.pb + ctx.mod(a) : undefined;
    const dc = a ? 8 + ctx.pb + ctx.mod(a) : undefined;
    const parts: string[] = [];
    if (d.attackType && atk != null) parts.push(`${d.attackType === 1 ? "Melee" : "Ranged"} spell attack ${fmtMod(atk)} [1d20${fmtMod(atk)}]`);
    if (d.saveDcAbilityId && dc != null) parts.push(`${ABBR[d.saveDcAbilityId]} save DC ${dc}`);
    for (const m of d.modifiers ?? []) {
      const ds = m.die?.diceString as string | undefined;
      if (!ds || !(m.type === "damage" || m.subType === "hit-points")) continue;
      let f = ds.replace(/\s+/g, "");
      if (d.level === 0) f = f.replace(/^(\d+)d/, (_w, n) => `${Number(n) * cantripScale}d`);
      const label = m.subType === "hit-points" ? "healing" : `${m.friendlySubtypeName ?? m.subType}`;
      parts.push(`${withChip(f)} ${label}`);
    }
    const range = d.range?.origin === "Self" ? "Self" : d.range?.rangeValue ? `${d.range.rangeValue} ft.` : d.range?.origin ?? "";
    const tags = [d.concentration ? "Concentration" : "", d.ritual ? "Ritual" : "", range].filter(Boolean).join(", ");
    const lvl = d.level === 0 ? "Cantrip" : `Level ${d.level}`;
    return {
      name: `${prefix}${d.name} (${lvl})`,
      description: `${parts.length ? parts.join("; ") + ". " : ""}${tags ? `[${tags}] ` : ""}${htmlToText(d.snippet || d.description).slice(0, 260)}`.trim(),
    };
  };

  for (const cs of c.classSpells ?? []) {
    const k = (c.classes ?? []).find((x: any) => x.id === cs.characterClassId);
    if (!k) continue;
    const abilityId = k.definition?.spellCastingAbilityId ?? k.subclassDefinition?.spellCastingAbilityId;
    const a = statAbility(abilityId);
    const slots: number[] = k.definition?.spellRules?.levelSpellSlots?.[k.level] ?? [];
    const used = new Map<number, number>((c.spellSlots ?? []).map((x: any) => [x.level, x.used]));
    if (a) {
      out.push({
        name: `Spellcasting — ${k.definition.name}`,
        description: `${ABILITY_NAME[a][0]!.toUpperCase()}${ABILITY_NAME[a].slice(1)}; spell save DC ${8 + ctx.pb + ctx.mod(a)}, spell attack ${fmtMod(ctx.pb + ctx.mod(a))} [1d20${fmtMod(ctx.pb + ctx.mod(a))}]. ` +
          `Slots: ${slots.map((n, i) => (n ? `L${i + 1} ${n}${used.get(i + 1) ? ` (${used.get(i + 1)} used)` : ""}` : "")).filter(Boolean).join(", ") || "none"}.`,
      });
    }
    // Prepared casters: include cantrips + prepared/always-prepared; if nothing is marked prepared, treat as a known-spells caster.
    const anyPrepared = cs.spells.some((s: any) => s.prepared || s.alwaysPrepared);
    const list = cs.spells.filter((s: any) => s.definition?.level === 0 || s.prepared || s.alwaysPrepared || !anyPrepared)
      .sort((x: any, y: any) => x.definition.level - y.definition.level || x.definition.name.localeCompare(y.definition.name));
    for (const s of list) out.push(describe(s, abilityId));
    const unprepared = cs.spells.length - list.length;
    if (unprepared > 0) out.push({ name: `${k.definition.name}: other known spells`, description: cs.spells.filter((s: any) => !list.includes(s)).map((s: any) => s.definition.name).join(", ") });
  }
  for (const [src, list] of Object.entries<any[]>(c.spells ?? {})) {
    for (const s of list ?? []) {
      if (!s?.definition) continue;
      const abilityId = s.spellCastingAbilityId ?? (c.classes?.[0]?.definition?.spellCastingAbilityId);
      const lu = s.limitedUse;
      const uses = lu?.maxUses ? ` ${lu.maxUses}/${RESET[lu.resetType] ?? "rest"}${s.usesSpellSlot ? " or with a slot" : ""}` : "";
      const e = describe(s, abilityId);
      const base = `${e.name.replace(/\)$/, "")}, ${src}`;
      // Same spell granted twice by one source (e.g. free cast 1/day + castable with slots): merge.
      const dup = out.find((x) => x.name.startsWith(base));
      if (dup) { if (s.usesSpellSlot && !/with a slot/.test(dup.name)) dup.name = dup.name.replace(/\)$/, " or with a slot)"); continue; }
      e.name = `${base}${uses})`;
      out.push(e);
    }
  }
  if (cantripScale > 1 && out.some((e) => /Cantrip/.test(e.name))) flags.push(`Cantrip damage scaled for character level ${level} (×${cantripScale} dice).`);
  return out;
}
