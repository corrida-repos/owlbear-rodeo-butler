/**
 * Wild Shape (druid): Known Shapes, turning into a beast and turning back.
 *
 * Stored on the unit token under `dev.owlbear-butler/wildshape` (WildShapeData): the druid level and circle, the
 * Known Shapes (5etools references), uses spent, and while transformed the form plus everything needed to restore
 * the character (sheet, HP, picture).
 *
 * Rules, by the room's edition:
 *  - 5E (2014): beasts the druid has seen (no cap). Max CR 1/4 (no swim/fly) at 2, 1/2 (no fly) at 4, 1 at 8.
 *    Circle of the Moon: CR 1 from level 2, druid level ÷ 3 from level 6. The form has the BEAST'S hit points;
 *    at 0 the druid reverts and excess damage carries over to their own HP. Two uses per short rest.
 *  - 5.5E (2024): Known Forms 4 / 6 / 8 at levels 2 / 4 / 8, max CR 1/4 / 1/2 / 1, no fly speed before 8.
 *    Circle of the Moon (level 3+): CR druid level ÷ 3, AC at least 13 + Wis, temp HP 3 × druid level, Circle Spells
 *    castable in beast form; from level 6 (Improved Circle Forms) Wis is added to Con saves. The druid keeps their OWN
 *    hit points and creature type and gains temporary HP equal to the druid level (each use); they revert at 0 HP,
 *    when Incapacitated, or on death. Uses 2 / 3 / 4 at levels 2 / 6 / 17: one back on a Short Rest, all on a Long
 *    Rest. One Known Form can be swapped on a Long Rest.
 *  In both editions the druid keeps Int, Wis and Cha, their skill and save proficiencies (the higher bonus wins)
 *  and can't cast spells in beast form.
 */
import { BUTLER_NS, SIZE_CELLS } from "./constants";
import { applyHp, type HpChange, type HpEvent } from "./hp";
import { checkAssetUrl, type ResolvedImage, type SceneGateway, type SceneItemLite } from "./importer";
import { tokenImageGrid, type Vec2 } from "./layout";
import { crValue } from "./search";
import { abilityMod, ABILITIES, SHEET_KEY, STATE_KEY, type Ability, type UnitSheet, type UnitState } from "./sheet";
import { DND5E_2024, type GameSystem } from "./systems";
import { readUnit } from "./unit";

export const WILD_KEY = `${BUTLER_NS}/wildshape`;

export type Rules = "2024" | "2014";

/** A beast the druid can turn into (a 5etools reference; its stat block is loaded when transforming). */
export interface KnownShape {
  name: string;
  source: string;
  /** "1/4", "1"… */
  cr: string;
  size: string;
  book?: string;
  swim?: boolean;
  fly?: boolean;
}

export interface WildShapeOriginal {
  sheet: UnitSheet;
  hp: number;
  maxHpOverride?: number;
  portraitUrl?: string;
  image?: ResolvedImage;
  grid?: { dpi: number; offset: Vec2 };
}

export interface ActiveShape {
  form: { name: string; source: string };
  rules: Rules;
  since: string;
  /** The form's sheet name, to tell whether the sheet was replaced (e.g. a D&D Beyond re-sync) while transformed. */
  sheetName: string;
  original: WildShapeOriginal;
}

export interface WildShapeData {
  v: 1;
  druidLevel: number;
  moon: boolean;
  /** Set from the sheet (D&D Beyond class line); follows level-ups until the GM sets the level by hand. */
  auto?: boolean;
  known: KnownShape[];
  usesSpent?: number;
  active?: ActiveShape;
}

// ------------------------------------------------------------------ reading + rules

const isObj = (v: unknown): v is Record<string, any> => typeof v === "object" && v !== null && !Array.isArray(v);

export function readWildShape(meta: Record<string, unknown>): WildShapeData | null {
  const x = meta[WILD_KEY];
  if (!isObj(x) || x.v !== 1 || typeof x.druidLevel !== "number") return null;
  return { ...x, known: Array.isArray(x.known) ? x.known.filter(isKnownShape) : [] } as WildShapeData;
}

export function isKnownShape(x: unknown): x is KnownShape {
  return isObj(x) && typeof x.name === "string" && typeof x.source === "string" && typeof x.cr === "string" && typeof x.size === "string"
    && x.name.length < 120 && x.source.length < 40;
}

export const sameShape = (a: { name: string; source: string }, b: { name: string; source: string }) =>
  a.name.toLowerCase() === b.name.toLowerCase() && a.source.toLowerCase() === b.source.toLowerCase();

/**
 * Druid level and Circle of the Moon from a sheet: the D&D Beyond class line ("Wood Elf · Druid 5 (Circle of the
 * Moon)", also in a multiclass), else a "Wild Shape" trait with the character level. Null if the unit has no Wild Shape.
 */
export function detectWildShape(sheet: Pick<UnitSheet, "type" | "traits" | "level" | "kind">): { druidLevel: number; moon: boolean } | null {
  const m = /\bDruid (\d{1,2})(?: \(([^)]*)\))?/i.exec(sheet.type ?? "");
  const hasTrait = sheet.traits.some((t) => /^wild shape\b/i.test(t.name.trim()));
  const moonTrait = sheet.traits.some((t) => /^circle forms\b|^combat wild shape\b/i.test(t.name.trim()));
  if (m) {
    const level = Number(m[1]);
    if (level < 2) return null;
    return { druidLevel: level, moon: /moon/i.test(m[2] ?? "") || moonTrait };
  }
  if (hasTrait && sheet.kind === "character") return { druidLevel: Math.max(2, sheet.level ?? 2), moon: moonTrait };
  return null;
}

export interface WildShapeLimits {
  available: boolean;
  maxCr: number;
  /** Max Known Shapes; null = no limit (2014: any beast the druid has seen). */
  maxKnown: number | null;
  swim: boolean;
  fly: boolean;
  uses: number;
  /** 2024: temporary HP gained on transforming. */
  tempHp: number;
  hours: number;
  /** One line per rule, for the popover. */
  summary: string[];
}

export const crText = (v: number) => (v === 0.125 ? "1/8" : v === 0.25 ? "1/4" : v === 0.5 ? "1/2" : String(v));

export function wildShapeLimits(rules: Rules, druidLevel: number, moon: boolean): WildShapeLimits {
  const L = Math.max(0, Math.floor(druidLevel));
  const base = L >= 8 ? 1 : L >= 4 ? 0.5 : 0.25;
  const hours = Math.max(1, Math.floor(L / 2));
  if (rules === "2014") {
    const maxCr = moon ? (L >= 6 ? Math.max(1, Math.floor(L / 3)) : 1) : base;
    const swim = L >= 4, fly = L >= 8;
    const uses = L >= 20 ? Infinity : 2;
    return {
      available: L >= 2, maxCr, maxKnown: null, swim, fly, uses, tempHp: 0, hours,
      summary: [
        `Max CR ${crText(maxCr)}${moon ? " (Circle of the Moon)" : ""}${!swim ? ", no swimming speed" : ""}${!fly ? ", no flying speed" : ""}.`,
        "Any beast you have seen (no limit on Known Shapes).",
        "You take the beast's hit points. At 0 you revert, and leftover damage carries over to your normal form.",
        `${uses === Infinity ? "Unlimited uses" : "2 uses per short or long rest"}; lasts up to ${hours} hour${hours === 1 ? "" : "s"}.`,
      ],
    };
  }
  const moon24 = moon && L >= 3;
  const maxCr = moon24 ? Math.max(base, Math.floor(L / 3)) : base;
  const maxKnown = L >= 8 ? 8 : L >= 4 ? 6 : 4;
  const fly = L >= 8;
  const uses = L >= 17 ? 4 : L >= 6 ? 3 : 2;
  const tempHp = L * (moon24 ? 3 : 1);
  return {
    available: L >= 2, maxCr, maxKnown, swim: true, fly, uses, tempHp, hours,
    summary: [
      `Max CR ${crText(maxCr)}${moon24 ? " (Circle Forms)" : ""}${!fly ? ", no flying speed" : ""}.`,
      `Up to ${maxKnown} Known Forms; swap one for another eligible beast when you finish a Long Rest.`,
      `You keep your own hit points and gain ${tempHp} temporary HP${moon24 ? " (3 × druid level)" : " (druid level)"} each time${moon24 ? "; AC is at least 13 + your Wisdom modifier" : ""}${moon24 && L >= 6 ? "; add your Wisdom modifier to Constitution saves" : ""}.`,
      `No spellcasting${moon24 ? " except your Circle of the Moon spells" : ""}. You revert at 0 HP, when Incapacitated, if you die, or with a bonus action.`,
      `${uses} uses: one back on a Short Rest, all on a Long Rest. A form lasts up to ${hours} hour${hours === 1 ? "" : "s"}.`,
    ],
  };
}

/** Why a shape isn't allowed right now (or null if it is). */
export function shapeProblem(shape: Pick<KnownShape, "cr" | "swim" | "fly">, limits: WildShapeLimits): string | null {
  if (!limits.available) return "Wild Shape starts at druid level 2.";
  const cr = crValue(shape.cr);
  if (cr === null) return "no challenge rating";
  if (cr > limits.maxCr) return `CR ${shape.cr} is above your max CR ${crText(limits.maxCr)}`;
  if (shape.fly && !limits.fly) return "has a flying speed (allowed from druid level 8)";
  if (shape.swim && !limits.swim) return "has a swimming speed (allowed from druid level 4)";
  return null;
}

export const isBeast = (type: string | undefined) => /\bbeast\b/i.test(type ?? "");

/** A Known Shape from a converted 5etools stat block. */
export function knownShapeFrom(sheet: UnitSheet, source: string, book?: string): KnownShape {
  return {
    name: sheet.name, source, cr: sheet.cr !== undefined ? crText(sheet.cr) : "", size: sheet.size, ...(book ? { book } : {}),
    ...(sheet.speed.swim ? { swim: true } : {}), ...(sheet.speed.fly ? { fly: true } : {}),
  };
}

// ------------------------------------------------------------------ the form's sheet

const SKILL_ABILITY: Record<string, Ability> = {
  acrobatics: "dex", "animal handling": "wis", arcana: "int", athletics: "str", deception: "cha", history: "int", insight: "wis",
  intimidation: "cha", investigation: "int", medicine: "wis", nature: "int", perception: "wis", performance: "cha", persuasion: "cha",
  religion: "int", "sleight of hand": "dex", stealth: "dex", survival: "wis",
};
const MENTAL: Ability[] = ["int", "wis", "cha"];

/**
 * The druid in beast form: the beast's body (size, AC, speed, Str/Dex/Con, senses, attacks) with the druid's mind
 * (Int/Wis/Cha, languages, proficiencies). HP: the beast's in 2014, the druid's own in 2024.
 */
export function formSheet(orig: UnitSheet, beast: UnitSheet, rules: Rules, ws: Pick<WildShapeData, "druidLevel" | "moon">): UnitSheet {
  const abilities = { ...beast.abilities };
  for (const a of MENTAL) abilities[a] = orig.abilities[a];
  const pb = orig.proficiencyBonus;
  const origProfSave = (a: Ability) => orig.saves[a] !== undefined && orig.saves[a]! > abilityMod(orig.abilities[a]);
  const saves: UnitSheet["saves"] = {};
  for (const a of ABILITIES) {
    const plain = abilityMod(abilities[a]);
    const beastSave = MENTAL.includes(a) ? undefined : beast.saves[a];
    const mine = origProfSave(a) ? (MENTAL.includes(a) ? orig.saves[a]! : plain + pb) : undefined;
    const best = Math.max(beastSave ?? plain, mine ?? plain);
    if (best !== plain || beastSave !== undefined || mine !== undefined) saves[a] = best;
  }
  const skills = new Map<string, number>();
  for (const s of beast.skills) skills.set(s.name.toLowerCase(), s.bonus);
  const display = new Map<string, string>([...beast.skills, ...orig.skills].map((s) => [s.name.toLowerCase(), s.name]));
  for (const s of orig.skills) {
    const key = s.name.toLowerCase();
    const ab = SKILL_ABILITY[key];
    if (!ab) continue;
    const prof = s.bonus - abilityMod(orig.abilities[ab]);
    const mine = abilityMod(abilities[ab]) + prof;
    skills.set(key, Math.max(skills.get(key) ?? -99, mine));
  }
  const skillList = [...skills].map(([k, bonus]) => ({ name: display.get(k) ?? k, bonus })).sort((a, b) => a.name.localeCompare(b.name));
  const perception = skills.get("perception") ?? abilityMod(abilities.wis);

  const moon24 = rules === "2024" && ws.moon && ws.druidLevel >= 3;
  // Improved Circle Forms (Moon 6): add the Wisdom modifier to Constitution saving throws.
  if (moon24 && ws.druidLevel >= 6) saves.con = (saves.con ?? abilityMod(abilities.con)) + abilityMod(abilities.wis);
  const moonAc = 13 + abilityMod(abilities.wis);
  const ac = moon24 ? Math.max(beast.ac, moonAc) : beast.ac;
  const retained = orig.traits.map((t) => t.name).filter((n) => n && !/^wild shape$/i.test(n));
  const rulesText = rules === "2014"
    ? `${orig.name} in the shape of a ${beast.name}. You have the beast's hit points; when they drop to 0 you revert and leftover damage carries over. You keep your Intelligence, Wisdom and Charisma and your skill and save proficiencies, and can't cast spells. Revert early with a bonus action.`
    : `${orig.name} in the shape of a ${beast.name}. You keep your creature type, hit points and Hit Point Dice, Intelligence, Wisdom and Charisma, class features, languages and feats, and your skill and save proficiencies (with your Proficiency Bonus). ${moon24 ? "You can't cast spells except your Circle of the Moon spells." : "You can't cast spells."}${moon24 && ws.druidLevel >= 6 ? " Improved Circle Forms: your Wisdom modifier is added to Constitution saves (included above)." : ""} You revert at 0 HP, when Incapacitated, if you die, or with a bonus action.`;

  return {
    ...beast,
    name: `${orig.name} (${beast.name})`,
    kind: orig.kind,
    // 2024: the druid keeps their own creature type.
    type: rules === "2024" ? `${beast.name} form (Wild Shape) · ${orig.type ?? "Humanoid"}` : `${beast.type ?? "Beast"} · Wild Shape of ${orig.name}`,
    alignment: orig.alignment,
    ac,
    acNote: moon24 && moonAc > beast.ac ? `Circle Forms: 13 + Wis` : beast.acNote,
    hp: rules === "2014" ? { ...beast.hp } : { ...orig.hp },
    abilities,
    saves,
    skills: skillList,
    passivePerception: 10 + perception,
    languages: orig.languages ? `${orig.languages} (can't speak in beast form)` : beast.languages,
    level: orig.level,
    proficiencyBonus: pb,
    initiative: { ...beast.initiative, modifier: abilityMod(abilities.dex) + (orig.initiative.modifier - abilityMod(orig.abilities.dex)),
      reasons: [...beast.initiative.reasons, "Wild Shape: beast Dexterity, your own initiative bonuses"] },
    traits: [
      { name: "Wild Shape", text: rulesText },
      ...beast.traits,
      ...(retained.length ? [{ name: "Retained features", text: retained.join(", ") }] : []),
    ],
    spells: [],
    inventory: [],
    legendary: [],
    flags: [`Wild Shape form of ${orig.name} (${rules === "2014" ? "5E" : "5.5E"} rules).`, ...beast.flags],
  };
}

// ------------------------------------------------------------------ HP while transformed

export interface WildHpResult { patch: Partial<UnitState>; events: HpEvent[]; revert: boolean }

/**
 * An HP change on a unit in beast form. 2014: the beast's HP absorb damage; at 0 the druid reverts to their own HP
 * and the rest of the damage carries over. 2024: ordinary HP rules (own HP + temp HP); dropping to 0 reverts.
 */
export function wildShapeHp(sheet: Pick<UnitSheet, "hp">, state: UnitState, active: ActiveShape, change: HpChange,
  system: Pick<GameSystem, "concentrationDc"> = DND5E_2024): WildHpResult {
  if (active.rules === "2024") {
    const r = applyHp(sheet, state, change, system);
    const revert = state.hp > 0 && r.patch.hp === 0;
    return { ...r, events: revert ? ["wild-shape-ended", ...r.events] : r.events, revert };
  }
  const n = Math.max(0, Math.floor(change.amount));
  let overflow: number | null = null;
  let tempLeft = state.tempHp;
  if (change.kind === "damage" && n > 0) {
    const absorbed = Math.min(state.tempHp, n);
    tempLeft = state.tempHp - absorbed;
    const rest = n - absorbed;
    if (rest >= state.hp) overflow = rest - state.hp;
  } else if (change.kind === "set" && n === 0) overflow = 0;
  if (overflow === null) return { ...applyHp(sheet, state, change, system), revert: false };

  const o = active.original;
  const restored: UnitState = { ...state, hp: o.hp, maxHpOverride: o.maxHpOverride, tempHp: tempLeft, deathSaves: undefined };
  const r = overflow > 0 ? applyHp(o.sheet, restored, { kind: "damage", amount: overflow, critical: change.kind === "damage" ? change.critical : undefined }, system) : { patch: {}, events: [] as HpEvent[] };
  const patch: Partial<UnitState> = { hp: o.hp, maxHpOverride: o.maxHpOverride, tempHp: tempLeft, deathSaves: undefined, portraitUrl: o.portraitUrl, ...r.patch };
  // The Concentration save is against the whole hit, not just the part that carried over.
  const concentrating = (patch.conditions ?? state.conditions).some((c) => c.key === "concentration");
  if (change.kind === "damage" && n > 0 && concentrating) {
    patch.concentrationCheck = { dc: system.concentrationDc(n), damage: n };
    if (!r.events.includes("concentration-check")) r.events.push("concentration-check");
  }
  return { patch, events: ["wild-shape-ended", ...r.events], revert: true };
}

/** 2024: Wild Shape ends when the druid has the Incapacitated condition (also through these) or dies. */
export const ENDS_WILD_SHAPE = ["incapacitated", "paralyzed", "petrified", "stunned", "unconscious", "dead"];
export const endsWildShape = (state: Pick<UnitState, "conditions">) => state.conditions.some((c) => ENDS_WILD_SHAPE.includes(c.key));

// ------------------------------------------------------------------ scene operations

async function unitWithWild(gw: SceneGateway, id: string) {
  const item = (await gw.getItems()).find((i) => i.id === id);
  if (!item) throw new Error("That token is no longer in the scene.");
  const u = readUnit(item.metadata);
  if (!u) throw new Error("That token isn't an Encounter Butler unit.");
  return { item, ...u, ws: readWildShape(item.metadata) };
}

const tokenName = (item: SceneItemLite, sheet: UnitSheet) => item.label || item.name || sheet.name;

/** Sets the druid level and circle (GM). Keeps Known Shapes. `auto` marks values read from the sheet. */
export async function setupWildShape(gw: SceneGateway, id: string, opts: { druidLevel: number; moon: boolean; auto?: boolean }) {
  const { ws } = await unitWithWild(gw, id);
  const level = Math.floor(opts.druidLevel);
  if (!(level >= 1 && level <= 20)) throw new Error("Druid level must be 1 to 20.");
  const next: WildShapeData = { ...(ws ?? { v: 1, known: [] }), v: 1, druidLevel: level, moon: !!opts.moon, auto: !!opts.auto };
  if (!opts.auto) delete next.auto;
  await gw.updateMetadata([{ id, metadata: { [WILD_KEY]: next } }]);
}

/** Removes Wild Shape from a unit (reverting first if needed). */
export async function removeWildShape(gw: SceneGateway, id: string) {
  const { ws } = await unitWithWild(gw, id);
  if (ws?.active) await revertWildShape(gw, id);
  await gw.updateMetadata([{ id, metadata: { [WILD_KEY]: null } }]);
}

/** Adds a Known Shape (checked against the druid's limits for the edition). */
export async function addKnownShape(gw: SceneGateway, id: string, shape: KnownShape, rules: Rules) {
  const { ws } = await unitWithWild(gw, id);
  if (!ws) throw new Error("This unit doesn't have Wild Shape set up.");
  if (!isKnownShape(shape)) throw new Error("That isn't a beast reference.");
  if (ws.known.some((k) => sameShape(k, shape))) return;
  const limits = wildShapeLimits(rules, ws.druidLevel, ws.moon);
  const problem = shapeProblem(shape, limits);
  if (problem) throw new Error(`${shape.name}: ${problem}.`);
  if (limits.maxKnown !== null && ws.known.length >= limits.maxKnown) throw new Error(`You already know ${limits.maxKnown} forms, the most at druid level ${ws.druidLevel}. Remove one first.`);
  await gw.updateMetadata([{ id, metadata: { [WILD_KEY]: { ...ws, known: [...ws.known, shape] } } }]);
}

export async function removeKnownShape(gw: SceneGateway, id: string, shape: { name: string; source: string }) {
  const { ws } = await unitWithWild(gw, id);
  if (!ws) return;
  await gw.updateMetadata([{ id, metadata: { [WILD_KEY]: { ...ws, known: ws.known.filter((k) => !sameShape(k, shape)) } } }]);
}

/** A rest: a Long Rest restores every use; a Short Rest one (2024) or every use (2014). */
export async function resetWildShapeUses(gw: SceneGateway, id: string, rest: "short" | "long" = "long", rules: Rules = "2024") {
  const { ws } = await unitWithWild(gw, id);
  if (!ws) return;
  const { usesSpent, ...others } = ws;
  const left = rest === "short" && rules === "2024" ? Math.max(0, (usesSpent ?? 0) - 1) : 0;
  await gw.updateMetadata([{ id, metadata: { [WILD_KEY]: left ? { ...others, usesSpent: left } : others } }]);
}

export interface TransformResult { name: string; form: string; warnings: string[] }

/**
 * Turns the unit into a Known Shape: the form's sheet, the beast's picture (sized for the beast), and the HP rules of
 * the edition. Switching from one form to another keeps the original character for reverting.
 */
export async function transformUnit(gw: SceneGateway, id: string, beast: UnitSheet, image: ResolvedImage | null,
  opts: { rules: Rules; form: { name: string; source: string }; now?: () => Date }): Promise<TransformResult> {
  const { item, sheet, state, ws } = await unitWithWild(gw, id);
  if (!ws) throw new Error("This unit doesn't have Wild Shape set up.");
  if (!isBeast(beast.type)) throw new Error(`${beast.name} isn't a beast.`);
  const known = ws.known.find((k) => sameShape(k, opts.form));
  if (!known) throw new Error(`${opts.form.name} isn't one of ${tokenName(item, sheet)}'s Known Shapes.`);
  const limits = wildShapeLimits(opts.rules, ws.druidLevel, ws.moon);
  const problem = shapeProblem(knownShapeFrom(beast, opts.form.source), limits);
  if (problem) throw new Error(`${beast.name}: ${problem}.`);
  if (!ws.active && state.hp <= 0) throw new Error("A unit at 0 HP can't use Wild Shape.");
  if (image) {
    const bad = checkAssetUrl(image.url);
    if (bad) throw new Error(`${beast.name}: image ${bad}`);
  }
  const warnings: string[] = [];
  // 2024: changing form is another use of Wild Shape (with its temp HP). 2014: switching keeps the current use.
  const newUse = !ws.active || opts.rules === "2024";
  const spent = (ws.usesSpent ?? 0) + (newUse ? 1 : 0);
  if (newUse && spent > limits.uses) warnings.push(`No Wild Shape uses left (${limits.uses}); transformed anyway.`);

  const original: WildShapeOriginal = ws.active?.original ?? {
    sheet, hp: state.hp,
    ...(state.maxHpOverride !== undefined ? { maxHpOverride: state.maxHpOverride } : {}),
    ...(state.portraitUrl ? { portraitUrl: state.portraitUrl } : {}),
    ...(item.image ? { image: { ...item.image } } : {}),
    ...(item.grid ? { grid: item.grid } : {}),
  };
  const form = formSheet(original.sheet, beast, opts.rules, ws);
  const active: ActiveShape = { form: { name: opts.form.name, source: opts.form.source }, rules: opts.rules, since: (opts.now ?? (() => new Date()))().toISOString(), sheetName: form.name, original };
  const statePatch: Record<string, unknown> = opts.rules === "2014"
    ? { hp: form.hp.max, maxHpOverride: undefined, deathSaves: undefined, portraitUrl: undefined }
    : { tempHp: Math.max(state.tempHp, limits.tempHp), portraitUrl: undefined };
  await gw.updateMetadata([{ id, metadata: { [SHEET_KEY]: form, [WILD_KEY]: { ...ws, usesSpent: spent, active } } }]);
  await gw.patchMetadata([{ id, key: STATE_KEY, patch: statePatch }]);
  if (image) await gw.updateImages([{ id, image, grid: tokenImageGrid(image.width, image.height, SIZE_CELLS[form.size] ?? 1) }]);
  else warnings.push(`${beast.name} has no 5etools picture; the token keeps its image.`);
  return { name: tokenName(item, sheet), form: beast.name, warnings };
}

/** Metadata, image and (unless `skipState`) the state patch that turn the unit back into the character. */
function revertWrites(item: SceneItemLite, sheet: UnitSheet, ws: WildShapeData) {
  const active = ws.active!;
  const { active: _, ...rest } = ws;
  // If the sheet was replaced while transformed (e.g. re-synced from D&D Beyond), keep the new one.
  const restoreSheet = sheet.name === active.sheetName;
  const metadata: Record<string, unknown> = { [WILD_KEY]: rest, ...(restoreSheet ? { [SHEET_KEY]: active.original.sheet } : {}) };
  const o = active.original;
  const image = o.image ? { id: item.id, image: o.image, grid: o.grid ?? tokenImageGrid(o.image.width, o.image.height, SIZE_CELLS[o.sheet.size] ?? 1) } : null;
  const statePatch: Record<string, unknown> = active.rules === "2014"
    ? { hp: o.hp, maxHpOverride: o.maxHpOverride, portraitUrl: o.portraitUrl }
    : { portraitUrl: o.portraitUrl };
  return { metadata, image, statePatch };
}

async function writeRevert(gw: SceneGateway, item: SceneItemLite, sheet: UnitSheet, ws: WildShapeData, statePatch: Record<string, unknown> | null) {
  const w = revertWrites(item, sheet, ws);
  await gw.updateMetadata([{ id: item.id, metadata: w.metadata }]);
  await gw.patchMetadata([{ id: item.id, key: STATE_KEY, patch: statePatch ?? w.statePatch }]);
  if (w.image) await gw.updateImages([w.image]);
}

/** Ends Wild Shape by choice (bonus action) or by the GM. 2014: back to the HP the druid had; 2024: HP unchanged. */
export async function revertWildShape(gw: SceneGateway, id: string): Promise<string | null> {
  const { item, sheet, ws } = await unitWithWild(gw, id);
  if (!ws?.active) return null;
  await writeRevert(gw, item, sheet, ws, null);
  return tokenName(item, sheet);
}

/** 2024: reverts the given units whose new conditions end Wild Shape (Incapacitated, Stunned… or Dead). Returns their names. */
export async function revertIfIncapacitated(gw: SceneGateway, ids: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const item of (await gw.getItems()).filter((i) => ids.includes(i.id))) {
    const ws = readWildShape(item.metadata);
    const u = readUnit(item.metadata);
    if (!u || ws?.active?.rules !== "2024" || !endsWildShape(u.state)) continue;
    await writeRevert(gw, item, u.sheet, ws, null);
    out.push(tokenName(item, u.sheet));
  }
  return out;
}

/** Used by changeHp after an HP change ended the form: restores sheet and picture; `statePatch` is the HP result. */
export async function finishRevert(gw: SceneGateway, item: SceneItemLite, statePatch: Record<string, unknown>) {
  const u = readUnit(item.metadata);
  const ws = readWildShape(item.metadata);
  if (!u || !ws?.active) return;
  await writeRevert(gw, item, u.sheet, ws, { portraitUrl: ws.active.original.portraitUrl, ...statePatch });
}
