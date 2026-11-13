/**
 * The GM's "Players" tab: the numbers a GM keeps asking players for (HP, AC, passives, save DC, saves, senses,
 * defences…), worked out from each party member's sheet and live state. Pure, so it's tested without Owlbear.
 */
import { skillBonus } from "./combatOptions";
import { exhaustionLevel, isConcentrating } from "./conditions";
import { ABILITIES, saveBonus, type Ability, type UnitSheet, type UnitState } from "./sheet";
import { sensesOf } from "./vision";

export interface PlayerStats {
  hp: number;
  maxHp: number;
  tempHp: number;
  ac: number;
  /** "Lvl 5 · Human Fighter" */
  subtitle: string;
  initiative: number;
  speed: string;
  passives: { perception: number; insight: number; investigation: number };
  /** Highest spell save DC on the sheet, if it casts. */
  spellDc?: number;
  saves: { ability: Ability; bonus: number; proficient: boolean }[];
  /** "Darkvision 60 ft." etc., without the passive Perception the sheet repeats. */
  senses: string[];
  defenses: { label: string; text: string }[];
  concentrating: boolean;
  exhaustion: number;
  deathSaves?: { successes: number; failures: number };
}

const abilityMod = (n: number) => Math.floor((n - 10) / 2);

/** The highest "spell save DC N" written in the sheet's spells, traits or actions (a D&D Beyond sync writes one per
 *  spellcasting class; a creature's Spellcasting trait states its own). */
export function spellSaveDc(sheet: Pick<UnitSheet, "spells" | "traits" | "actions">): number | undefined {
  let best: number | undefined;
  for (const e of [...sheet.spells, ...sheet.traits, ...sheet.actions]) {
    for (const m of `${e.name} ${e.text}`.matchAll(/spell save DC\s*(\d+)/gi)) best = Math.max(best ?? 0, Number(m[1]));
  }
  return best;
}

export function playerStats(sheet: UnitSheet, state: UnitState, hp: { hp: number; maxHp: number; tempHp: number; ac: number }): PlayerStats {
  const s = sensesOf(sheet);
  const senses = [
    s.darkvision ? `Darkvision ${s.darkvision} ft.` : "",
    s.devilsSight ? `Devil's Sight ${s.devilsSight} ft.` : "",
    s.blindsight ? `Blindsight ${s.blindsight} ft.` : "",
    s.tremorsense ? `Tremorsense ${s.tremorsense} ft.` : "",
    s.truesight ? `Truesight ${s.truesight} ft.` : "",
  ].filter(Boolean);
  const sp = sheet.speed;
  const speed = [`${sp.walk} ft.`, sp.fly ? `fly ${sp.fly}${sp.hover ? " (hover)" : ""}` : "", sp.swim ? `swim ${sp.swim}` : "",
    sp.climb ? `climb ${sp.climb}` : "", sp.burrow ? `burrow ${sp.burrow}` : ""].filter(Boolean).join(", ");
  const d = sheet.defenses;
  const defenses = ([["Resist", d.resist], ["Immune", d.immune], ["Vulnerable", d.vulnerable], ["Condition immune", d.conditionImmune]] as [string, string | undefined][])
    .flatMap(([label, text]) => text ? [{ label, text }] : []);
  const spellDc = spellSaveDc(sheet);
  return {
    ...hp,
    subtitle: [sheet.level ? `Lvl ${sheet.level}` : "", sheet.type ?? ""].filter(Boolean).join(" · "),
    initiative: sheet.initiative.modifier,
    speed,
    passives: {
      perception: sheet.passivePerception ?? 10 + skillBonus(sheet, "Perception", "wis"),
      insight: 10 + skillBonus(sheet, "Insight", "wis"),
      investigation: 10 + skillBonus(sheet, "Investigation", "int"),
    },
    ...(spellDc !== undefined ? { spellDc } : {}),
    saves: ABILITIES.map((a) => ({ ability: a, bonus: saveBonus(sheet, a), proficient: saveBonus(sheet, a) > abilityMod(sheet.abilities[a]) })),
    senses,
    defenses,
    concentrating: isConcentrating(state),
    exhaustion: exhaustionLevel(state),
    ...(state.deathSaves && hp.hp <= 0 ? { deathSaves: state.deathSaves } : {}),
  };
}
