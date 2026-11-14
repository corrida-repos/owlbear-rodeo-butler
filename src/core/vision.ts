/**
 * Light and vision: the scene's light level (bright by default, or dim / dark, set by the GM per scene), each unit's
 * senses (from its stat block) and the light it carries (a torch, the Light cantrip…), and what that means for what a
 * creature can see: bright = clear, dim = lightly obscured, darkness = heavily obscured (PHB "Vision and Light").
 * The background page draws these as auras on the map (background/vision.ts); the card explains them in words.
 */
import { BUTLER_NS } from "./constants";
import type { SceneGateway } from "./importer";
import { STATE_KEY, type UnitSheet, type UnitState } from "./sheet";

// ------------------------------------------------------------------ scene light

export type SceneLight = "bright" | "dim" | "dark";
/** Scene metadata: absent = bright light (Owlbear's default look). */
export const LIGHTING_KEY = `${BUTLER_NS}/lighting`;

export function readSceneLight(sceneMeta: Record<string, unknown>): SceneLight {
  const raw = sceneMeta[LIGHTING_KEY] as { level?: unknown } | undefined;
  return raw?.level === "dim" || raw?.level === "dark" ? raw.level : "bright";
}

/** The GM forces the darkness fog on players in this scene, even when their Vision HUD is off (off by default). */
export function readForcedFog(sceneMeta: Record<string, unknown>): boolean {
  return (sceneMeta[LIGHTING_KEY] as { forceFog?: unknown } | undefined)?.forceFog === true;
}

/** The scene metadata update that sets the light level and/or the forced fog (bright and not forced removes the key). */
export function lightingUpdate(sceneMeta: Record<string, unknown>, patch: { level?: SceneLight; forceFog?: boolean }): Record<string, unknown> {
  const level = patch.level ?? readSceneLight(sceneMeta);
  const forceFog = patch.forceFog ?? readForcedFog(sceneMeta);
  return { [LIGHTING_KEY]: level === "bright" && !forceFog ? undefined : { level, ...(forceFog ? { forceFog: true } : {}) } };
}

export const SCENE_LIGHT_TEXT: Record<SceneLight, string> = {
  bright: "Bright light: everyone sees normally.",
  dim: "Dim light (twilight, a dim room): everything is lightly obscured unless it's in bright light.",
  dark: "Darkness (night, an unlit cave): everything is heavily obscured unless something lights it.",
};

// ------------------------------------------------------------------ senses

export interface Senses {
  darkvision: number;
  blindsight: number;
  truesight: number;
  tremorsense: number;
  /** Warlock's Devil's Sight: sees normally in magical and nonmagical darkness. */
  devilsSight: number;
  /** "Blindsight 10 ft. (blind beyond this radius)": sees nothing farther away. */
  blindBeyond: boolean;
}

const SENSE_RE = /\b(darkvision|blindsight|tremorsense|truesight)\s*(\d+)\s*(?:ft|feet|')/gi;

/** Senses from the stat block's text ("Darkvision 60 ft., Passive Perception 12") and traits (Devil's Sight). */
export function sensesOf(sheet: Pick<UnitSheet, "senses" | "traits">): Senses {
  const s: Senses = { darkvision: 0, blindsight: 0, truesight: 0, tremorsense: 0, devilsSight: 0, blindBeyond: false };
  const text = sheet.senses ?? "";
  for (const m of text.matchAll(SENSE_RE)) {
    const k = m[1]!.toLowerCase() as "darkvision" | "blindsight" | "tremorsense" | "truesight";
    s[k] = Math.max(s[k], Number(m[2]));
  }
  if (/blind beyond/i.test(text)) s.blindBeyond = true;
  const ds = sheet.traits.find((t) => /^devil'?s sight\b/i.test(t.name.trim()) || /^eldritch invocations?:.*devil'?s sight/i.test(t.name));
  if (ds) s.devilsSight = Number(/(\d+)\s*(?:ft|feet)/i.exec(ds.text)?.[1] ?? 120);
  return s;
}

// ------------------------------------------------------------------ light sources

export interface LightSource {
  key: string;
  label: string;
  /** Radius of bright light, then dim light for this many feet beyond it. */
  bright: number;
  dim: number;
  /** 2014 values where they differ. */
  bright2014?: number;
  dim2014?: number;
  note?: string;
  /** Matches an inventory item, spell or trait name on the sheet. */
  match: RegExp;
}

/** Player's Handbook / Dungeon Master's Guide light sources (2024 values; 2014 where different). */
export const LIGHT_SOURCES: LightSource[] = [
  { key: "torch", label: "Torch", bright: 20, dim: 20, match: /^torch(es)?\b/i },
  { key: "candle", label: "Candle", bright: 5, dim: 5, match: /^candles?\b/i },
  { key: "lamp", label: "Lamp", bright: 15, dim: 30, match: /^(oil )?lamp\b/i },
  { key: "lantern-hooded", label: "Hooded Lantern", bright: 30, dim: 30, match: /^(lantern,? hooded|hooded lantern)\b/i },
  { key: "lantern-hooded-low", label: "Hooded Lantern (hood lowered)", bright: 0, dim: 5, match: /(?!)/ },
  { key: "lantern-bullseye", label: "Bullseye Lantern", bright: 60, dim: 60, note: "a 60-ft cone the way it's pointed (drawn as a circle)", match: /^(lantern,? bullseye|bullseye lantern)\b/i },
  { key: "light", label: "Light (cantrip)", bright: 20, dim: 20, match: /^light$/i },
  { key: "dancing-lights", label: "Dancing Lights", bright: 0, dim: 10, note: "each of up to four lights sheds dim light; drawn on the caster", match: /^dancing lights\b/i },
  { key: "produce-flame", label: "Produce Flame", bright: 20, dim: 20, bright2014: 10, dim2014: 10, match: /^produce flame\b/i },
  { key: "flame-blade", label: "Flame Blade", bright: 10, dim: 10, match: /^flame blade\b/i },
  { key: "continual-flame", label: "Continual Flame", bright: 20, dim: 20, match: /^continual flame\b/i },
  { key: "daylight", label: "Daylight", bright: 60, dim: 60, note: "sunlight; dispels magical darkness of 3rd level or lower", match: /^daylight\b/i },
  { key: "faerie-fire", label: "Outlined by Faerie Fire", bright: 0, dim: 10, match: /(?!)/ },
  { key: "sun-blade", label: "Sun Blade", bright: 15, dim: 15, note: "sunlight", match: /^sun blade\b/i },
  { key: "flame-tongue", label: "Flame Tongue (ablaze)", bright: 40, dim: 40, match: /^flame tongue\b/i },
];

/** The light a unit sheds, stored on its state: a catalogue key, or "custom" with its own radii. */
export interface UnitLight { key: string; bright?: number; dim?: number }

export interface ResolvedLight { key: string; label: string; bright: number; dim: number; note?: string }

const ft = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(1000, Math.round(v))) : 0);

export function isUnitLight(x: unknown): x is UnitLight {
  const l = x as UnitLight;
  if (!l || typeof l !== "object" || typeof l.key !== "string") return false;
  if (l.key === "custom") return ft(l.bright) + ft(l.dim) > 0;
  return LIGHT_SOURCES.some((s) => s.key === l.key);
}

export function resolveLight(light: UnitLight | undefined | null, rules: "2024" | "2014" = "2024"): ResolvedLight | null {
  if (!light) return null;
  if (light.key === "custom") {
    const bright = ft(light.bright), dim = ft(light.dim);
    return bright + dim > 0 ? { key: "custom", label: "Light", bright, dim } : null;
  }
  const s = LIGHT_SOURCES.find((x) => x.key === light.key);
  if (!s) return null;
  return { key: s.key, label: s.label, bright: rules === "2014" ? s.bright2014 ?? s.bright : s.bright, dim: rules === "2014" ? s.dim2014 ?? s.dim : s.dim, note: s.note };
}

/** "bright 20 ft, dim 20 ft more" */
export const lightRadiiText = (l: Pick<ResolvedLight, "bright" | "dim">) =>
  [l.bright ? `bright ${l.bright} ft` : "", l.dim ? `dim ${l.dim} ft${l.bright ? " more" : ""}` : ""].filter(Boolean).join(", ");

/** Light sources the sheet has: inventory items, spells (a D&D Beyond spell, or a monster's "At will: light, …") and traits. */
export function lightsOnSheet(sheet: Pick<UnitSheet, "inventory" | "spells" | "traits" | "actions">): string[] {
  const names = [...sheet.inventory, ...sheet.spells, ...sheet.traits, ...sheet.actions].map((e) => e.name.trim().replace(/\s*\(.*\)\s*$/, ""));
  const spellText = sheet.spells.map((e) => e.text).join("\n").toLowerCase();
  const found = new Set<string>();
  for (const s of LIGHT_SOURCES) {
    if (names.some((n) => s.match.test(n))) found.add(s.key);
    else if (["light", "dancing-lights", "produce-flame", "flame-blade", "continual-flame", "daylight"].includes(s.key)) {
      // A monster's spellcasting lists spells in one text: "At will: dancing lights, light, mage hand".
      const name = s.label.replace(/ \(cantrip\)$/, "").toLowerCase();
      if (new RegExp(`(^|[:,;]\\s*)${name}(?=\\s*(\\*|,|;|$|\\n|\\())`, "m").test(spellText)) found.add(s.key);
    }
  }
  return LIGHT_SOURCES.filter((s) => found.has(s.key)).map((s) => s.key);
}

/** Lights the unit (or the GM) switches on and off. */
export async function setUnitLight(gw: SceneGateway, id: string, light: UnitLight | null) {
  if (light && !isUnitLight(light)) throw new Error("Unknown light source.");
  const clean = light ? (light.key === "custom" ? { key: "custom", bright: ft(light.bright), dim: ft(light.dim) } : { key: light.key }) : undefined;
  await gw.patchMetadata([{ id, key: STATE_KEY, patch: { light: clean } }]);
}

// ------------------------------------------------------------------ auras

export type RingKind = "bright" | "dim" | "darkvision" | "blindsight" | "truesight" | "tremorsense" | "devilsSight";
/** A circle around a unit, `feet` out from the edge of its space. */
export interface Ring { kind: RingKind; feet: number; label: string }

export const RING_STYLE: Record<RingKind, { color: string; fill: number; dash: boolean; name: string; meaning: string }> = {
  bright: { color: "#ffb300", fill: 0.22, dash: false, name: "Bright light", meaning: "lit: anyone sees clearly here" },
  dim: { color: "#ffd54f", fill: 0.1, dash: true, name: "Dim light", meaning: "lightly obscured: disadvantage on Wisdom (Perception) checks that rely on sight" },
  darkvision: { color: "#43a047", fill: 0, dash: true, name: "Darkvision", meaning: "for this creature, dim light counts as bright and darkness as dim (shades of gray)" },
  blindsight: { color: "#1e88e5", fill: 0, dash: true, name: "Blindsight", meaning: "perceives everything here without sight, whatever the light" },
  truesight: { color: "#8e24aa", fill: 0, dash: true, name: "Truesight", meaning: "sees everything here, even in magical darkness, and sees the invisible" },
  devilsSight: { color: "#d81b60", fill: 0, dash: true, name: "Devil's Sight", meaning: "sees normally here in darkness, magical or not" },
  tremorsense: { color: "#8d6e63", fill: 0, dash: true, name: "Tremorsense", meaning: "pinpoints creatures touching the same ground here, without seeing them" },
};

/** Light a unit sheds, as it matters in this scene: in darkness bright + dim; in dim light only bright adds anything. */
export function lightRings(light: ResolvedLight | null, scene: SceneLight): Ring[] {
  if (!light || scene === "bright") return [];
  const out: Ring[] = [];
  if (scene === "dark" && light.dim) out.push({ kind: "dim", feet: light.bright + light.dim, label: `${light.label}: dim ${light.bright + light.dim} ft` });
  if (light.bright) out.push({ kind: "bright", feet: light.bright, label: `${light.label}: bright ${light.bright} ft` });
  return out;
}

/** A unit's senses that matter in this scene (none in bright light: everyone sees). */
export function senseRings(s: Senses, scene: SceneLight): Ring[] {
  if (scene === "bright") return [];
  const out: Ring[] = [];
  const add = (kind: RingKind, feet: number) => { if (feet > 0) out.push({ kind, feet, label: `${RING_STYLE[kind].name} ${feet} ft` }); };
  if (!s.blindBeyond) add("darkvision", s.darkvision);
  add("devilsSight", s.devilsSight);
  add("truesight", s.truesight);
  add("blindsight", s.blindsight);
  add("tremorsense", s.tremorsense);
  return out.sort((a, b) => b.feet - a.feet);
}

// ------------------------------------------------------------------ what a creature sees

export type LightLevel = "bright" | "dim" | "dark";
export type Seen = "clear" | "lightly obscured" | "heavily obscured";

/** Light at a point: the scene's level, raised by any light source within reach (`distance` from each source). */
export function lightAt(scene: SceneLight, sources: { distance: number; bright: number; dim: number }[]): LightLevel {
  let level: LightLevel = scene;
  for (const s of sources) {
    if (s.distance <= s.bright) return "bright";
    if (s.distance <= s.bright + s.dim) level = "dim";
  }
  return level;
}

/** How a creature with these senses sees a spot `distance` feet away lit at `light`. */
export function seenAs(light: LightLevel, s: Senses, distance: number, opts: { magicalDarkness?: boolean } = {}): { seen: Seen; by?: string } {
  if (s.truesight >= distance && s.truesight > 0) return { seen: "clear", by: "truesight" };
  if (s.blindsight >= distance && s.blindsight > 0) return { seen: "clear", by: "blindsight" };
  if (s.blindBeyond) return { seen: "heavily obscured", by: "blind beyond its blindsight" };
  if (opts.magicalDarkness) return s.devilsSight >= distance ? { seen: "clear", by: "Devil's Sight" } : { seen: "heavily obscured" };
  if (light === "bright") return { seen: "clear" };
  if (light === "dark" && s.devilsSight >= distance) return { seen: "clear", by: "Devil's Sight" };
  const dv = s.darkvision >= distance && s.darkvision > 0;
  if (light === "dim") return dv ? { seen: "clear", by: "darkvision" } : { seen: "lightly obscured" };
  return dv ? { seen: "lightly obscured", by: "darkvision" } : { seen: "heavily obscured" };
}

/** Plain-words lines for the card: what this unit sees in this scene, and the light it carries. */
export function visionSummary(sheet: Pick<UnitSheet, "senses" | "traits">, state: Pick<UnitState, "light">, scene: SceneLight, rules: "2024" | "2014" = "2024"): string[] {
  const s = sensesOf(sheet);
  const light = resolveLight(state.light, rules);
  const out: string[] = [];
  if (light) out.push(`Carrying ${light.label}: ${lightRadiiText(light)}${light.note ? ` (${light.note})` : ""}.`);
  if (scene === "bright") return out;
  if (s.blindBeyond) out.push(`Blind beyond ${s.blindsight} ft: perceives only what its blindsight reaches, whatever the light.`);
  else if (scene === "dark") {
    out.push(s.darkvision
      ? `Darkvision ${s.darkvision} ft: within it, darkness is only lightly obscured (disadvantage on sight-based Perception) and dim light is clear. Unlit areas beyond ${s.darkvision} ft are heavily obscured (as if Blinded).`
      : "No darkvision: unlit areas are heavily obscured (as if Blinded for anything there); dim light is lightly obscured. It needs a light to see.");
  } else {
    out.push(s.darkvision
      ? `Darkvision ${s.darkvision} ft: sees clearly within it. Beyond, anything not in bright light is lightly obscured (disadvantage on sight-based Perception).`
      : "No darkvision: anything not in bright light is lightly obscured (disadvantage on sight-based Perception).");
  }
  if (s.devilsSight) out.push(`Devil's Sight ${s.devilsSight} ft: sees normally in darkness, magical or not.`);
  if (s.truesight) out.push(`Truesight ${s.truesight} ft: sees through any darkness and sees invisible creatures.`);
  if (s.blindsight && !s.blindBeyond) out.push(`Blindsight ${s.blindsight} ft: perceives its surroundings there without sight.`);
  if (s.tremorsense) out.push(`Tremorsense ${s.tremorsense} ft: pinpoints creatures touching the same surface, without seeing them.`);
  return out;
}

// ------------------------------------------------------------------ who sees which auras (per browser)

/** Whose senses the HUD draws: the selected tokens, the party, every unit, or units picked by hand. */
export type AuraScope = "selected" | "party" | "all" | "chosen";
/** Per browser: the Vision HUD (vision circles + darkness fog). Nothing is drawn while it's off. */
export const HUD_KEY = "butler.visionHud";
export const hudOn = (v: string | null) => v === "1";
export const AURA_SCOPE_KEY = "butler.visionScope";
/** Local broadcast (this browser only) telling the background page the aura choice changed. */
export const AURA_CHANNEL = `${BUTLER_NS}/vision-prefs`;
export const readAuraScope = (v: string | null): AuraScope => (v === "party" || v === "all" || v === "chosen" ? v : "selected");
/** Per browser: the units picked by hand (scope "chosen"), as a JSON list of item ids. */
export const AURA_CHOSEN_KEY = "butler.visionChosen";

export function readChosen(v: string | null): string[] {
  try {
    const x = JSON.parse(v ?? "[]");
    return Array.isArray(x) ? x.filter((i): i is string => typeof i === "string") : [];
  } catch { return []; }
}

/** Adds the ids, or removes them when every one is already picked (one right-click toggles a group). */
export function toggleChosen(chosen: string[], ids: string[]): string[] {
  return ids.every((id) => chosen.includes(id)) ? chosen.filter((id) => !ids.includes(id)) : [...chosen, ...ids.filter((id) => !chosen.includes(id))];
}

/**
 * Whether the HUD draws this unit's senses. `mine`: the viewer controls it. Players only ever get their own units and
 * party members (a monster's darkvision is the GM's business); dead units see nothing.
 */
export function showsSenses(scope: AuraScope, u: { id: string; party: boolean; mine: boolean; dead: boolean },
  viewer: { role: "GM" | "PLAYER"; selection: string[]; chosen: string[] }): boolean {
  if (u.dead) return false;
  if (viewer.role !== "GM" && !u.party && !u.mine) return false;
  if (scope === "all") return true;
  if (scope === "party") return u.party || (viewer.role !== "GM" && u.mine);
  if (scope === "chosen") return viewer.chosen.includes(u.id);
  return viewer.selection.includes(u.id);
}
