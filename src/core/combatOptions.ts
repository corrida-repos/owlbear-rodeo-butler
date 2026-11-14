/**
 * Combat options every creature has by the rules, beyond what its sheet lists: the Player's Handbook actions
 * (Dash, Dodge, Help…), Unarmed Strike with Grapple and Shove, movement (jumping, climbing, standing up…), and the
 * Dungeon Master's Guide optional action options (Disarm, Overrun, Tumble…), listed alongside the rest unless the GM
 * turns them off. Worded for the room's edition, with the
 * numbers worked out from the unit's sheet (to-hit, DCs, skill bonuses, jump distances). Reference only.
 */
import { fmtMod } from "./dice";
import { abilityMod, type UnitSheet } from "./sheet";

export type OptionCost = "action" | "bonus" | "reaction" | "free" | "move" | "attack";
export type OptionGroup = "Actions" | "Attack options" | "Movement" | "Other";

export interface CombatOption {
  name: string;
  cost: OptionCost;
  /** Shown with the cost ("Action or Bonus Action", "Replaces one attack"). */
  costNote?: string;
  group: OptionGroup;
  source: "PHB" | "DMG";
  /** How it works, with this unit's numbers. */
  text: string;
  /** The key number for the tile ("DC 13 Str/Dex", "+5 · 3 Bludgeoning"). */
  summary?: string;
  /** Done along with an attack of the Attack action without replacing it (2024 Equip or Unequip a Weapon). */
  withAttack?: boolean;
  /** Done with another action (2024 Stabilize: the Help action), so shown under that action's tile. */
  under?: "Help";
  /** Only while the creature has this condition (Escape a Grapple: Grappled; Stand Up: Prone; Dismount: Mounted). */
  ifCondition?: string;
  /** Only while it doesn't (Drop Prone, Mount). */
  unlessCondition?: string;
}

/** A d20 roll written the way sheet text carries one: "+5 [1d20+5]", or "+5 dis [2d20kl1+5]" with Disadvantage.
 *  The action bar and card turn it into a button that rolls. */
export const d20Chip = (bonus: number, mode?: "dis" | "adv") =>
  `${fmtMod(bonus)}${mode ? ` ${mode}` : ""} [${mode === "dis" ? "2d20kl1" : mode === "adv" ? "2d20kh1" : "1d20"}${fmtMod(bonus)}]`;

/** The best of several skills: "Persuasion", its bonus. */
function bestSkill(sheet: Pick<UnitSheet, "skills" | "abilities">, list: [string, keyof UnitSheet["abilities"]][]) {
  return list.map(([n, a]) => ({ name: n, bonus: skillBonus(sheet, n, a) })).sort((a, b) => b.bonus - a.bonus)[0]!;
}
/** "Persuasion +5 [1d20+5], Deception +3 [1d20+3]…", best first. */
function skillChips(sheet: Pick<UnitSheet, "skills" | "abilities">, list: [string, keyof UnitSheet["abilities"]][]) {
  return list.map(([n, a]) => ({ name: n, bonus: skillBonus(sheet, n, a) })).sort((a, b) => b.bonus - a.bonus).map((x) => `${x.name} ${d20Chip(x.bonus)}`).join(", ");
}

/** A skill's bonus from the sheet ("Athletics" or "Athletics (expertise)"), else the plain ability modifier. */
export function skillBonus(sheet: Pick<UnitSheet, "skills" | "abilities">, skill: string, ability: keyof UnitSheet["abilities"]): number {
  const s = sheet.skills.find((x) => x.name.replace(/\s*\(.*\)$/, "").toLowerCase() === skill.toLowerCase());
  return s ? s.bonus : abilityMod(sheet.abilities[ability]);
}

export function combatOptions(sheet: UnitSheet, rules: "2024" | "2014" = "2024", opts: { dmg?: boolean; handheld?: boolean } = {}): CombatOption[] {
  const str = abilityMod(sheet.abilities.str);
  const pb = sheet.proficiencyBonus;
  const ath = skillBonus(sheet, "Athletics", "str");
  const acro = skillBonus(sheet, "Acrobatics", "dex");
  const stealth = skillBonus(sheet, "Stealth", "dex");
  const medicine = skillBonus(sheet, "Medicine", "wis");
  const best = `Athletics ${d20Chip(ath)} or Acrobatics ${d20Chip(acro)}`;
  const strMod = str;
  // Disarm uses a weapon attack: the sheet's best to-hit, else an Unarmed Strike's.
  const weaponHit = Math.max(...[...sheet.actions].flatMap((a) => [...a.text.matchAll(/\[1d20([+-]\d+)\]/g)].map((m) => Number(m[1]))), str + pb);
  const influence: [string, keyof UnitSheet["abilities"]][] = [["Persuasion", "cha"], ["Deception", "cha"], ["Intimidation", "cha"], ["Performance", "cha"], ["Animal Handling", "wis"]];
  const search: [string, keyof UnitSheet["abilities"]][] = rules === "2024"
    ? [["Perception", "wis"], ["Insight", "wis"], ["Medicine", "wis"], ["Survival", "wis"]] : [["Perception", "wis"], ["Investigation", "int"]];
  const study: [string, keyof UnitSheet["abilities"]][] = [["Arcana", "int"], ["History", "int"], ["Investigation", "int"], ["Nature", "int"], ["Religion", "int"]];
  const top = (list: [string, keyof UnitSheet["abilities"]][]) => { const b = bestSkill(sheet, list); return `${b.name} ${d20Chip(b.bonus)}`; };
  const unarmedHit = str + pb;
  const unarmedDmg = Math.max(1, 1 + str);
  const dc = 8 + str + pb;
  const speed = sheet.speed.walk;
  const longJump = sheet.abilities.str;
  const highJump = Math.max(0, 3 + str);
  const climb = sheet.speed.climb ? `You have a Climb speed (${sheet.speed.climb} ft.), so climbing costs no extra movement.` : `Each foot climbed costs 1 extra foot of movement (2 extra in difficult terrain).`;
  const swim = sheet.speed.swim ? `You have a Swim speed (${sheet.speed.swim} ft.), so swimming costs no extra movement.` : `Each foot swum costs 1 extra foot of movement (2 extra in difficult terrain).`;
  const hasUnarmed = sheet.actions.some((a) => /^Unarmed Strike\b/i.test(a.name));
  const o2024 = rules === "2024";
  // Handheld management (room setting): shields, weapon swaps and what drawing a weapon or focus costs.
  const hh = opts.handheld !== false;
  const impDmg = `${str ? `1d4 ${str > 0 ? "+" : "-"} ${Math.abs(str)}` : "1d4"} [1d4${str ? fmtMod(str) : ""}]`;

  const list: CombatOption[] = [
    // ---- actions (PHB)
    { name: "Attack", cost: "action", group: "Actions", source: "PHB", text: o2024
      ? `Make one attack with a weapon or an Unarmed Strike. With Extra Attack you make more than one attack with this same action, and you can move between them. Each attack can be swapped for a Grapple or a Shove.${hh ? " Each time you attack, you can also equip or unequip one weapon, before or after that attack (see Equip or Unequip a Weapon)." : ""}`
      : `Make one attack with a weapon or an Unarmed Strike. With Extra Attack you make more than one attack with this same action, and you can move between them. Each attack can be swapped for a Grapple or a Shove.${hh ? " Drawing or sheathing a weapon uses your free object interaction (see Interact with an Object)." : ""}` },
    ...(o2024 ? [] : [{ name: "Cast a Spell", cost: "action" as const, group: "Actions" as const, source: "PHB" as const, text: "Cast a spell with a casting time of 1 action. If you cast a spell with a Bonus Action, the only other spell you can cast that turn is a cantrip with a casting time of 1 action." }]),
    { name: "Dash", cost: "action", group: "Actions", source: "PHB", summary: `+${speed} ft.`, text: `Gain extra movement equal to your Speed for this turn: +${speed} ft., for ${speed * 2} ft. in total.` },
    { name: "Disengage", cost: "action", group: "Actions", source: "PHB", text: `Your movement doesn't provoke ${o2024 ? "Opportunity Attacks" : "opportunity attacks"} for the rest of this turn.` },
    { name: "Dodge", cost: "action", group: "Actions", source: "PHB", text: o2024
      ? "Until the start of your next turn, attack rolls against you have Disadvantage (if you can see the attacker) and you make Dexterity saving throws with Advantage. You lose this if you have the Incapacitated condition or your Speed is 0."
      : "Until the start of your next turn, attack rolls against you have disadvantage if you can see the attacker, and you make Dexterity saving throws with advantage. You lose this if you're incapacitated or your speed drops to 0." },
    { name: "Help", cost: "action", group: "Actions", source: "PHB", text: o2024
      ? "Help an ally with an ability check you could make: their next check for that task has Advantage. Or distract an enemy within 5 ft. of you: the next attack roll an ally makes against it has Advantage. You can also use Help to stabilize a creature at 0 Hit Points (see Stabilize)."
      : "Give an ally advantage on their next ability check for a task you're helping with, or distract a creature within 5 ft. of you so an ally's next attack roll against it has advantage." },
    { name: "Hide", cost: "action", group: "Actions", source: "PHB", summary: `Stealth ${d20Chip(stealth)}`, text: o2024
      ? `While Heavily Obscured or behind Three-Quarters or Total Cover, out of any enemy's line of sight, make a DC 15 Dexterity (Stealth) check (you: ${d20Chip(stealth)}). On a success you have the Invisible condition until you make noise louder than a whisper, attack, cast a spell with a Verbal component, or an enemy finds you.`
      : `Make a Dexterity (Stealth) check (you: ${d20Chip(stealth)}) while creatures can't clearly see you. Creatures searching for you compare it with their Wisdom (Perception). You're found if you attack or make noise.` },
    ...(o2024 ? [
      { name: "Influence", cost: "action" as const, group: "Actions" as const, source: "PHB" as const, summary: top(influence), text: `Urge a creature to do something: a Charisma (Deception, Intimidation, Performance or Persuasion) or Wisdom (Animal Handling) check, usually against DC 15 or the creature's Intelligence score, whichever is higher. You: ${skillChips(sheet, influence)}.` },
      { name: "Magic", cost: "action" as const, group: "Actions" as const, source: "PHB" as const, text: `Cast a spell with a casting time of an action, or use a magic item or magical feature that takes an action. If you cast a spell with a Bonus Action, you can't cast another spell with a spell slot that turn.${hh ? " Somatic and Material components need a free hand (the same hand can do both, or hold the focus). Without the Attack action there's no free weapon swap, so sheathing a weapon to free a hand uses your free object interaction. A holy symbol on your shield, or the War Caster feat, means you don't need to free a hand." : ""}` },
    ] : []),
    { name: "Ready", cost: "action", group: "Actions", source: "PHB", text: "Choose a trigger you can see (\"if the orc steps through the door\") and an action, or movement up to your Speed. When it happens, you can use your Reaction to do it, or ignore it. A readied spell is cast now and held with Concentration until it's released; it's lost if you don't use it before your next turn." },
    { name: "Search", cost: "action", group: "Actions", source: "PHB", summary: top(search), text: `${o2024 ? "Look for something: a Wisdom check (Insight, Medicine, Perception or Survival)." : "Look for something: a Wisdom (Perception) or Intelligence (Investigation) check."} You: ${skillChips(sheet, search)}.` },
    ...(o2024 ? [{ name: "Study", cost: "action" as const, group: "Actions" as const, source: "PHB" as const, summary: top(study), text: `Recall or work something out: an Intelligence check (Arcana, History, Investigation, Nature or Religion). You: ${skillChips(sheet, study)}.` }] : []),
    { name: o2024 ? "Utilize" : "Use an Object", cost: "action", group: "Actions", source: "PHB", text: o2024
      ? "Use a nonmagical object that needs your action (pull a stuck lever, light a lantern, pick up a fallen ally's weapon if it's a second object this turn)."
      : "Use an object that needs your action, or interact with a second object this turn." },
    ...(hh ? [{ name: "Don or Doff a Shield", cost: "action" as const, ...(o2024 ? { costNote: "Utilize action" } : {}), group: "Actions" as const, source: "PHB" as const, text: o2024
      ? "Putting on or taking off a shield takes the Utilize action (it isn't a weapon, so the Attack action's free swap doesn't cover it, nor does your free object interaction). You get its Armor Class bonus only while it's strapped to your arm, and that hand can't hold a weapon or a spellcasting focus, though a holy symbol can be emblazoned on the shield and used as one."
      : "Donning or doffing a shield takes an action (your free object interaction doesn't cover it). You get its Armor Class bonus only while it's strapped to your arm, and that hand can't hold a weapon or a spellcasting focus, though a holy symbol can be emblazoned on the shield and used as one." }] : []),
    { name: "Escape a Grapple", cost: "action", ifCondition: "grappled", group: "Actions", source: "PHB", summary: best, text: o2024
      ? `While Grappled, make a Strength (Athletics) or Dexterity (Acrobatics) check (you: ${best}) against the grapple's escape DC. On a success you're no longer Grappled.`
      : `While grappled, make a Strength (Athletics) or Dexterity (Acrobatics) check (you: ${best}) contested by the grappler's Strength (Athletics). On a success you escape.` },
    { name: "Stabilize", cost: "action", costNote: o2024 ? "Help action" : undefined, ...(o2024 ? { under: "Help" as const } : {}), group: "Actions", source: "PHB", summary: `DC 10 · Medicine ${d20Chip(medicine)}`, text: `Give first aid to a creature at 0 Hit Points: a DC 10 Wisdom (Medicine) check (you: ${d20Chip(medicine)}). On a success it's Stable: no more death saves, and it regains 1 HP after 1d4 hours. A Healer's Kit does it without a check.` },

    // ---- attack options
    ...(hasUnarmed ? [] : [{ name: "Unarmed Strike", cost: "attack" as const, costNote: "One attack of the Attack action", group: "Attack options" as const, source: "PHB" as const, summary: `${d20Chip(unarmedHit)} · ${unarmedDmg} Bludgeoning`,
      text: `A punch, kick or headbutt: attack roll ${d20Chip(unarmedHit)} (Strength + proficiency). On a hit, ${unarmedDmg} Bludgeoning damage (1 + Strength modifier).${o2024 ? " An Unarmed Strike can instead Grapple or Shove." : ""}` }]),
    { name: "Grapple", cost: "attack", costNote: "Replaces one attack", group: "Attack options", source: "PHB", summary: o2024 ? `DC ${dc} Str/Dex` : `Athletics ${d20Chip(ath)}`, text: o2024
      ? `Grab a creature no more than one size larger than you, with a hand free and within reach. It makes a Strength or Dexterity saving throw (its choice) against DC ${dc} (8 + Strength + proficiency). On a failure it's Grappled: Speed 0, Disadvantage on attacks against anyone but you. You can move it with you, but each foot costs 1 extra unless it's Tiny or two sizes smaller. It escapes with an action (DC ${dc}), or if you're Incapacitated or it ends up out of reach. You can let go any time.`
      : `Grab a creature no more than one size larger than you, with a hand free. Make a Strength (Athletics) check (you: ${d20Chip(ath)}) contested by its Strength (Athletics) or Dexterity (Acrobatics). On a success it's grappled: speed 0. You can drag or carry it at half speed. It escapes with an action, or if you're incapacitated.` },
    { name: "Shove", cost: "attack", costNote: "Replaces one attack", group: "Attack options", source: "PHB", summary: o2024 ? `DC ${dc} Str/Dex` : `Athletics ${d20Chip(ath)}`, text: o2024
      ? `Push a creature no more than one size larger than you, within reach. It makes a Strength or Dexterity saving throw (its choice) against DC ${dc}. On a failure you either push it 5 ft. away or knock it Prone (attacks against a Prone creature within 5 ft. have Advantage; from farther, Disadvantage).`
      : `Push a creature no more than one size larger than you, within reach. Make a Strength (Athletics) check (you: ${d20Chip(ath)}) contested by its Strength (Athletics) or Dexterity (Acrobatics). On a success you knock it prone or push it 5 ft. away.` },
    { name: "Two-Weapon Fighting", cost: "bonus", group: "Attack options", source: "PHB", text: o2024
      ? "After you attack with a Light weapon as part of the Attack action, you can make one extra attack as a Bonus Action with a different Light weapon. Don't add your ability modifier to that attack's damage unless it's negative."
      : "When you attack with a light melee weapon in one hand, you can use your bonus action to attack with a different light melee weapon in the other. Don't add your ability modifier to that attack's damage unless it's negative." },
    { name: "Opportunity Attack", cost: "reaction", group: "Attack options", source: "PHB", text: "When a creature you can see leaves your reach (by its own movement), you can make one melee attack against it just before it leaves. Disengage, teleporting, or being moved by someone else don't provoke it." },
    ...(o2024 && hh ? [{ name: "Equip or Unequip a Weapon", cost: "free" as const, costNote: "One per attack of the Attack action", group: "Other" as const, source: "PHB" as const,
      text: "Free, but only during the Attack action: you get one per attack. When you make an attack as part of the Attack action, you can equip or unequip one weapon, before or after that attack. Equipping means drawing it from a sheath, picking it up or taking it from someone; unequipping means sheathing, stowing or dropping it. It's one swap per attack, so with Extra Attack you can swap before or after each of them. An attack replaced by something else still gets its swap: the Eldritch Knight's War Magic cantrip, a Grapple or a Shove. Weapons only: a spellcasting focus isn't one, unless it's a staff that also counts as a Quarterstaff. If you equip a weapon before an attack, you don't have to attack with it. This doesn't use your free object interaction." }] : []),
    { name: "Improvised Weapon", cost: "attack", costNote: "One attack of the Attack action", group: "Attack options", source: "PHB", summary: `${d20Chip(strMod)} · ${impDmg}`, text: `Swing or throw something that isn't a weapon (a chair, a bottle, a torch): attack roll ${d20Chip(strMod)} (Strength, without proficiency; if it's like a weapon you're proficient with, such as a table leg as a club, attack roll ${d20Chip(strMod + pb)}). On a hit, ${impDmg} damage. Thrown: range 20/60 ft.` },

    // ---- movement
    { name: "Move", cost: "move", group: "Movement", source: "PHB", summary: `${speed} ft.`, text: `Move up to your Speed (${speed} ft.) on your turn, before, after or between your actions and attacks. Difficult terrain costs 1 extra foot per foot. You can move through an ally's space, but not end there; an enemy's space only if it's two sizes bigger or smaller than you.` },
    { name: "Drop Prone", cost: "free", unlessCondition: "prone", group: "Movement", source: "PHB", text: "Drop to the ground without using movement. While Prone you crawl (1 extra foot per foot), have Disadvantage on attacks, attacks against you within 5 ft. have Advantage, and attacks from farther away have Disadvantage." },
    { name: "Stand Up", cost: "move", ifCondition: "prone", costNote: "Half your Speed", group: "Movement", source: "PHB", summary: `${Math.floor(speed / 2)} ft.`, text: `Getting up from Prone costs half your Speed (${Math.floor(speed / 2)} ft.). You can't if your Speed is 0.` },
    { name: "Jump", cost: "move", group: "Movement", source: "PHB", summary: `${longJump} ft. / ${highJump} ft.`, text: `Long jump: up to ${longJump} ft. (your Strength score) after a 10 ft. run-up, half that from standing. High jump: ${highJump} ft. (3 + Strength modifier) after a run-up, half from standing. Jumped distance costs movement as usual.` },
    { name: "Climb", cost: "move", group: "Movement", source: "PHB", summary: `Athletics ${d20Chip(ath)}`, text: `${climb} A slippery or sheer surface may need a Strength (Athletics) check (you: ${d20Chip(ath)}).` },
    { name: "Swim", cost: "move", group: "Movement", source: "PHB", summary: `Athletics ${d20Chip(ath)}`, text: `${swim} Rough water may need a Strength (Athletics) check (you: ${d20Chip(ath)}).` },
    { name: "Mount", cost: "move", costNote: "Half your Speed", unlessCondition: "mounted", group: "Movement", source: "PHB", summary: `${Math.floor(speed / 2)} ft.`, text: `Climbing onto a willing creature at least one size larger than you, within 5 ft., costs half your Speed (${Math.floor(speed / 2)} ft.). A controlled mount moves on your turn and can only Dash, Disengage or Dodge. Mark the rider Mounted (Change status) to see Dismount here instead.` },
    { name: "Dismount", cost: "move", costNote: "Half your Speed", ifCondition: "mounted", group: "Movement", source: "PHB", summary: `${Math.floor(speed / 2)} ft. · DC 10 Dex save`, text: `Getting off your mount costs half your Speed (${Math.floor(speed / 2)} ft.). If the mount is moved against its will while you're on it, or you're knocked Prone, you make a DC 10 Dexterity saving throw or fall off, landing Prone within 5 ft. of it.` },

    // ---- other
    { name: "Interact with an Object", cost: "free", costNote: "One per turn", group: "Other", source: "PHB", text: o2024
      ? `Once on your turn, during your move or an action, interact with one object or feature of the environment for free. For example: open or close a door, pick up a dropped item, take an item out of your pack (a potion, a rope, a scroll), hand an item to an ally, pull a lever or flip a switch, turn a key in a lock, pull a torch from a sconce, put out a small flame, pull your hood up or put on a mask, or kick a small stone. A second object needs the Utilize action.${hh ? " Drawing or stowing a spellcasting focus or component pouch uses this. Drawing or stowing a weapon doesn't: it's part of an attack (see Equip or Unequip a Weapon)." : ""}`
      : `Once on your turn, with your move or action, interact with one object for free. For example: ${hh ? "draw or sheathe a weapon, " : ""}open or close a door, pick up a dropped item, take an item out of your pack (a potion, a rope, a scroll), hand an item to an ally, pull a lever or flip a switch, turn a key in a lock, pull a torch from a sconce, put out a small flame, or pull your hood up or put on a mask. A second object needs your action (Use an Object).` },
    { name: o2024 ? "Drink or Administer a Potion" : "Drink a Potion", cost: o2024 ? "bonus" : "action", group: "Other", source: "PHB", text: o2024 ? "Drinking a potion, or giving one to another creature within 5 ft., takes a Bonus Action." : "Drinking a potion, or giving one to another creature, takes an action." },
    { name: "Speak", cost: "free", group: "Other", source: "PHB", text: "Short sentences, a shout or a gesture are free during your turn (and on others' turns, within reason). A long speech is up to the GM." },

    // ---- DMG optional action options (with the rest; the room setting can leave them out)
    { name: "Disarm", cost: "attack", costNote: "Replaces one attack", group: "Attack options", source: "DMG", summary: `Attack ${d20Chip(weaponHit)}`, text: `Knock a weapon or item out of a creature's grasp: make a weapon attack roll (your best: ${d20Chip(weaponHit)}) contested by its Strength (Athletics) or Dexterity (Acrobatics) check. If you win, it drops the item. You have Disadvantage if it holds the item with two or more hands. It has Advantage if it's larger than you, Disadvantage if smaller.` },
    { name: "Mark", cost: "free", costNote: "With a melee attack", group: "Attack options", source: "DMG", text: "When you make a melee attack, mark the target. Until the end of your next turn, your Opportunity Attacks against it have Advantage and don't use your Reaction (still only one per turn, and not while something stops you taking reactions)." },
    { name: "Overrun", cost: "action", costNote: "Action or Bonus Action", group: "Movement", source: "DMG", summary: `Athletics ${d20Chip(ath)}`, text: `Force your way through a hostile creature's space: a Strength (Athletics) check (you: ${d20Chip(ath)}) contested by its Strength (Athletics). You have Advantage if you're larger, Disadvantage if smaller. If you win, you can move through its space once this turn.` },
    { name: "Shove Aside", cost: "attack", costNote: "Replaces one attack", group: "Attack options", source: "DMG", summary: `Athletics ${d20Chip(ath, "dis")}`, text: `A Shove that moves the target 5 ft. sideways to another space within your reach instead of away: a Strength (Athletics) check with Disadvantage (you: ${d20Chip(ath, "dis")}) contested by its Strength (Athletics) or Dexterity (Acrobatics).` },
    { name: "Tumble", cost: "action", costNote: "Action or Bonus Action", group: "Movement", source: "DMG", summary: `Acrobatics ${d20Chip(acro)}`, text: `Duck and weave through a hostile creature's space: a Dexterity (Acrobatics) check (you: ${d20Chip(acro)}) contested by its Dexterity (Acrobatics). If you win, you can move through its space once this turn.` },
    { name: "Climb onto a Bigger Creature", cost: "action", group: "Other", source: "DMG", summary: best, text: `Leap onto a creature much larger than you: a Strength (Athletics) or Dexterity (Acrobatics) check (you: ${best}) contested by its Dexterity (Acrobatics). If you win, you move into its space and cling on: you move with it and have Advantage on attacks against it. It can try to shake you off with an action (its Athletics against your Athletics or Acrobatics).` },
  ];
  return opts.dmg === false ? list.filter((o) => o.source !== "DMG") : list;
}
