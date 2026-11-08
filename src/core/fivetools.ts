import { MAX_DICE, MAX_DIE_SIDES, SIZE_NAMES } from "./constants";
import { fmtMod } from "./dice";
import { resolveVariables } from "./fivetools-copy";
import { proficiencyBonusForCr, type CatalogEntry } from "./fivetools-shared";
import type { ListEntry, Statblock, StatblockInitiative } from "./schema";
import { ABILITIES, SHEET_SCHEMA, type Ability } from "./sheet";

export { proficiencyBonusForCr };

/**
 * Converts 5etools bestiary JSON (https://github.com/5etools-mirror-3/5etools-src, data/bestiary/*.json)
 * into Butler's native stat block (UnitSheet).
 * Books are discovered from 5etools' own data/bestiary/index.json (see fivetools-shared.ts buildCatalog).
 */

export const FIVETOOLS_DATA_BASE = "https://raw.githubusercontent.com/5etools-mirror-3/5etools-src/main/data";
export const FIVETOOLS_IMG_BASE = "https://raw.githubusercontent.com/5etools-mirror-3/5etools-img/main";

export function fivetoolsTokenUrl(source: string, name: string): string {
  return `${FIVETOOLS_IMG_BASE}/bestiary/tokens/${encodeURIComponent(source)}/${encodeURIComponent(name)}.webp`;
}
export function fivetoolsArtUrl(source: string, name: string): string {
  return `${FIVETOOLS_IMG_BASE}/bestiary/${encodeURIComponent(source)}/${encodeURIComponent(name)}.webp`;
}

// ---------------------------------------------------------------- tag rendering

const ATK: Record<string, string> = {
  m: "Melee Attack Roll:", r: "Ranged Attack Roll:", "m,r": "Melee or Ranged Attack Roll:",
  mw: "Melee Weapon Attack:", rw: "Ranged Weapon Attack:", "mw,rw": "Melee or Ranged Weapon Attack:",
  ms: "Melee Spell Attack:", rs: "Ranged Spell Attack:", "ms,rs": "Melee or Ranged Spell Attack:",
};
const ABIL: Record<string, string> = {
  str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma",
};

/** Returns a dice chip like "[1d6+2]" if the roller can roll the formula, else "". */
export function diceChip(formula: string): string {
  const f = formula.replace(/\s+/g, "");
  if (!/^[\dd+\-*/()]+$/i.test(f) || !/\d+d\d+/i.test(f) || f.length > 500) return "";
  for (const m of f.matchAll(/(\d+)d(\d+)/gi)) {
    const n = Number(m[1]);
    const s = Number(m[2]);
    if (n < 1 || n > MAX_DICE || s < 2 || s > MAX_DIE_SIDES) return "";
  }
  return `[${f}]`;
}

function renderTag(tag: string, body: string): string {
  const parts = body.split("|");
  const first = (parts[0] ?? "").trim();
  switch (tag) {
    case "atk":
    case "atkr":
      return ATK[first] ?? "Attack:";
    case "hit": {
      const n = Number(first);
      return `${fmtMod(n)} [1d20${fmtMod(n)}]`;
    }
    case "d20": {
      const n = Number(first);
      return `${fmtMod(n)} [1d20${fmtMod(n)}]`;
    }
    case "h": return "Hit: ";
    case "m": return "Miss: ";
    case "hom": return "Hit or Miss: ";
    case "damage":
    case "dice": {
      const chip = diceChip(first);
      return chip ? `${first} ${chip}` : first;
    }
    case "dc": return `DC ${first}`;
    case "actSave": return `${first.split(",").map((a) => ABIL[a.trim()] ?? a).join(" or ")} Saving Throw:`;
    case "actSaveFail": return first ? `Failure by ${first} or More:` : "Failure:";
    case "actSaveSuccess": return "Success:";
    case "actSaveSuccessOrFail": return "Failure or Success:";
    case "actTrigger": return "Trigger:";
    case "actResponse": return "Response:";
    case "recharge": return first ? `(Recharge ${first}–6)` : "(Recharge 6)";
    case "chance": return `${first} percent`;
    case "spell": return titleCase(parts[2]?.trim() || first);
    case "filter": return first;
    default:
      // {@tag name|source|display} convention
      return (parts[2]?.trim() || first);
  }
}

const MINOR_WORDS = new Set(["a", "an", "and", "as", "at", "by", "for", "from", "in", "into", "of", "on", "or", "the", "to", "with"]);
function titleCase(s: string): string {
  return s.replace(/[A-Za-z][\w']*/g, (w, offset: number) =>
    offset > 0 && MINOR_WORDS.has(w.toLowerCase()) ? w.toLowerCase() : w[0]!.toUpperCase() + w.slice(1));
}

export function renderTags(text: string): string {
  let out = text;
  // innermost first, repeat until no tags remain
  for (let i = 0; i < 10 && /\{@/.test(out); i++) {
    out = out.replace(/\{@(\w+)\s*([^{}]*)\}/g, (_m, tag: string, body: string) => renderTag(tag, body));
  }
  return out;
}

export function renderEntries(entries: unknown): string {
  if (entries == null) return "";
  if (typeof entries === "string") return renderTags(entries);
  if (typeof entries === "number") return String(entries);
  if (Array.isArray(entries)) return entries.map(renderEntries).filter(Boolean).join("\n");
  if (typeof entries === "object") {
    const e = entries as Record<string, unknown>;
    if (e.type === "list" && Array.isArray(e.items)) return e.items.map((it) => `• ${renderEntries(it)}`).join("\n");
    if ((e.type === "item" || e.type === "itemSub") && e.name) {
      return `${renderTags(String(e.name))} ${renderEntries(e.entries ?? e.entry)}`.trim();
    }
    if (e.entries) return `${e.name ? renderTags(String(e.name)) + ". " : ""}${renderEntries(e.entries)}`;
    if (e.entry) return renderEntries(e.entry);
  }
  return "";
}

// ---------------------------------------------------------------- field helpers

const ALIGN: Record<string, string> = { L: "Lawful", N: "Neutral", C: "Chaotic", G: "Good", E: "Evil", U: "Unaligned", A: "Any alignment" };

function alignmentText(a: unknown): string {
  if (!Array.isArray(a) || a.length === 0) return "";
  if (a.every((x) => typeof x === "string")) {
    const codes = a as string[];
    return codes.map((c) => ALIGN[c] ?? c).join(" ");
  }
  return a.map((x) => (typeof x === "object" && x && "alignment" in x ? alignmentText((x as any).alignment) : String(x))).join(" or ");
}

function typeText(t: unknown): string {
  if (typeof t === "string") return titleCase(t);
  if (t && typeof t === "object") {
    const o = t as Record<string, any>;
    const base = typeof o.type === "string" ? titleCase(o.type) : Array.isArray(o.type?.choose) ? o.type.choose.map(titleCase).join(" or ") : "";
    const tags = Array.isArray(o.tags) ? o.tags.map((x: any) => (typeof x === "string" ? x : x.tag)).filter(Boolean) : [];
    const swarm = o.swarmSize ? `Swarm of ${SIZE_NAMES[o.swarmSize] ?? o.swarmSize} ` : "";
    return `${swarm}${base}${tags.length ? ` (${tags.map(titleCase).join(", ")})` : ""}`;
  }
  return "";
}

function speedValue(v: unknown): number {
  if (typeof v === "number") return v;
  if (v && typeof v === "object" && typeof (v as any).number === "number") return (v as any).number;
  return 0;
}

function crNumber(cr: unknown): { text: string; value: number } {
  const text = typeof cr === "string" ? cr : cr && typeof cr === "object" && typeof (cr as any).cr === "string" ? (cr as any).cr : "";
  if (!text) return { text: "", value: NaN };
  const value = text.includes("/") ? Number(text.split("/")[0]) / Number(text.split("/")[1]) : Number(text);
  return { text, value };
}


const abilityMod = (score: number) => Math.floor((score - 10) / 2);

function damageList(v: unknown, key: string): string {
  if (!Array.isArray(v)) return "";
  return v
    .map((x) => {
      if (typeof x === "string") return titleCase(x);
      if (x && typeof x === "object") {
        const o = x as Record<string, any>;
        if (o.special) return renderTags(o.special);
        const inner = damageList(o[key], key);
        return [o.preNote, inner, o.note].filter(Boolean).map((s) => renderTags(String(s))).join(" ");
      }
      return "";
    })
    .filter(Boolean)
    .join(", ");
}

function entryList(arr: unknown): ListEntry[] {
  if (!Array.isArray(arr)) return [];
  return arr.map((a: any) => ({ name: renderTags(String(a.name ?? "")), text: renderEntries(a.entries) }));
}

function spellcastingEntries(sc: any): ListEntry[] {
  const out: ListEntry[] = [];
  const header = renderEntries(sc.headerEntries);
  out.push({ name: renderTags(String(sc.name ?? "Spellcasting")), text: header });
  const hidden: string[] = Array.isArray(sc.hidden) ? sc.hidden : [];
  const names = (arr: unknown) => (Array.isArray(arr) ? arr.map((s) => renderEntries(s)).join(", ") : "");
  if (Array.isArray(sc.will) && !hidden.includes("will")) out.push({ name: "At Will", text: names(sc.will) });
  if (sc.daily && !hidden.includes("daily")) {
    for (const [k, v] of Object.entries(sc.daily)) {
      const n = k.replace("e", "");
      out.push({ name: `${n}/Day${k.endsWith("e") ? " Each" : ""}`, text: names(v) });
    }
  }
  if (sc.spells) {
    for (const [lvl, v] of Object.entries<any>(sc.spells)) {
      const slots = v.slots ? ` (${v.slots} slot${v.slots > 1 ? "s" : ""})` : "";
      out.push({ name: lvl === "0" ? "Cantrips" : `Level ${lvl}${slots}`, text: names(v.spells) });
    }
  }
  if (sc.footerEntries) out.push({ name: "Note", text: renderEntries(sc.footerEntries) });
  return out;
}

// ---------------------------------------------------------------- initiative

export function deriveInitiative(m: any, dexScore: number, pb: number): StatblockInitiative {
  const reasons: string[] = [];
  let modifier = abilityMod(dexScore);
  let advantage = false;
  let disadvantage = false;
  const init = m.initiative;
  if (typeof init === "number") {
    modifier = init;
    reasons.push(`explicit initiative ${fmtMod(init)}`);
  } else if (init && typeof init === "object") {
    if (typeof init.initiative === "number") {
      modifier = init.initiative;
      reasons.push(`explicit initiative ${fmtMod(modifier)}`);
    } else {
      const prof = typeof init.proficiency === "number" ? init.proficiency : 0;
      modifier = abilityMod(dexScore) + prof * pb;
      reasons.push(`Dex ${fmtMod(abilityMod(dexScore))}${prof ? ` + ${prof}×PB(${pb})` : ""}`);
    }
    if (init.advantageMode === "adv") { advantage = true; reasons.push("initiative advantage (stat block)"); }
    if (init.advantageMode === "dis") { disadvantage = true; reasons.push("initiative disadvantage (stat block)"); }
  } else {
    reasons.push(`Dex ${fmtMod(modifier)} (no separate initiative listed)`);
  }

  // Trait/feature text (feats like Alert, class features, "False Appearance" etc.).
  // Unconditional effects are applied; conditional ones ("If ... at the start of combat") are listed for the
  // encounter author to switch on when the situation applies (encounter spec `initiative.advantage`).
  const conditional: string[] = [];
  const COND = /\b(if|while|when|whenever|unless|as long as|until)\b/i;
  for (const t of [...(m.trait ?? []), ...(m.action ?? []), ...(m.bonus ?? []), ...(m.reaction ?? [])]) {
    const tname = renderTags(String(t.name ?? ""));
    const text = renderEntries(t.entries).replace(/\[[^\]]*\]/g, "").replace(/[ \t]+/g, " ");
    for (const sentence of text.split(/(?<=[.!?])\s+/)) {
      const adv = /(?<!dis)advantage on (?:its |their |his |her )?initiative/i.exec(sentence);
      const dis = /disadvantage on (?:its |their |his |her )?initiative/i.exec(sentence);
      const flat = /\+(\d+) bonus to (?:its |their )?initiative/i.exec(sentence) ?? /add(?:s)? (\d+) to (?:its |their )?initiative/i.exec(sentence);
      const dice = /add(?:s)? (\d+d\d+) to (?:its |their )?initiative/i.exec(sentence);
      const pbAdd = /add(?:s)? (?:its |their )?proficiency bonus to (?:its |their )?initiative/i.exec(sentence);
      const hit = adv ?? dis ?? flat ?? dice ?? pbAdd;
      if (!hit) continue;
      const isCond = COND.test(sentence.slice(0, hit.index));
      const label = `"${tname}": ${sentence.trim()}`;
      if (isCond || dice) { conditional.push(label); continue; }
      if (adv) { advantage = true; reasons.push(`advantage from "${tname}"`); }
      if (dis) { disadvantage = true; reasons.push(`disadvantage from "${tname}"`); }
      if (flat && typeof init !== "number") { modifier += Number(flat[1]); reasons.push(`+${flat[1]} from "${tname}"`); }
      if (pbAdd && !(init && typeof init === "object" && init.proficiency)) { modifier += pb; reasons.push(`+PB(${pb}) from "${tname}"`); }
    }
  }
  return { modifier, advantage, disadvantage, reasons, ...(conditional.length ? { conditional } : {}) };
}

// ---------------------------------------------------------------- lookup

/** Exact (case-insensitive) name match within one bestiary file's data; returns the RAW entry (may be a `_copy`). */
export function findMonster(data: { monster?: any[] }, name: string, source: string): any {
  const list = data?.monster ?? [];
  const m = list.find((x) => x.name?.toLowerCase() === name.toLowerCase() && x.source?.toLowerCase() === source.toLowerCase());
  if (!m) {
    const near = list.filter((x) => x.name?.toLowerCase().includes(name.toLowerCase())).slice(0, 5).map((x) => `${x.name} (${x.source})`);
    throw new Error(`Monster "${name}" not found in ${source}.${near.length ? ` Did you mean: ${near.join(", ")}?` : ""}`);
  }
  return m;
}

export interface ConvertOptions {
  catalogEntry?: CatalogEntry;
  /** From resolveCopy: how this creature was derived (copy chain/templates) and any notes. */
  copyChain?: string[];
  copyNotes?: string[];
  /** Extra provenance notes (e.g. how the source was chosen). */
  notes?: string[];
}

export function convertMonster(input: any, opts: ConvertOptions = {}): Statblock {
  if (input._copy) throw new Error(`"${input.name}" (${input.source}) is an unresolved _copy entry; run resolveCopy first.`);
  const m = resolveVariables(input, input); // leftover <$name$>-style placeholders
  const flags: string[] = [];
  const src = opts.catalogEntry;
  // "Medium or Small" humanoids: default to Medium when it's an option.
  const sizeCode: string = Array.isArray(m.size) ? (m.size.includes("M") ? "M" : m.size[0]) : "M";
  if (Array.isArray(m.size) && m.size.length > 1) flags.push(`Multiple sizes listed (${m.size.join("/")}); using ${sizeCode}.`);

  const scores = { str: m.str, dex: m.dex, con: m.con, int: m.int, wis: m.wis, cha: m.cha } as Record<string, number>;
  for (const [k, v] of Object.entries(scores)) if (typeof v !== "number") { flags.push(`Missing ${k.toUpperCase()} score; defaulted to 10.`); scores[k] = 10; }

  const cr = crNumber(m.cr);
  if (!cr.text) flags.push("No challenge rating listed.");
  const pb = proficiencyBonusForCr(cr.value);

  const acRaw = Array.isArray(m.ac) ? m.ac[0] : undefined;
  const ac = typeof acRaw === "number" ? acRaw : typeof acRaw?.ac === "number" ? acRaw.ac : NaN;
  if (!Number.isFinite(ac)) flags.push("Armor class could not be parsed.");
  if (Array.isArray(m.ac) && m.ac.length > 1) flags.push(`Multiple AC values listed; using ${ac}.`);

  const hpAvg = typeof m.hp?.average === "number" ? m.hp.average : NaN;
  if (!Number.isFinite(hpAvg)) flags.push(`Hit points not numeric (${JSON.stringify(m.hp)}).`);

  // Only saves the stat block lists (proficient ones); the card computes the rest from the ability modifier.
  const saves: Partial<Record<Ability, number>> = {};
  for (const k of ABILITIES) {
    const listed = m.save?.[k];
    if (listed == null) continue;
    const num = /^\s*([+-]?\d+)\s*$/.exec(String(listed));
    if (num) saves[k] = Number(num[1]);
    else flags.push(`${k.toUpperCase()} save listed as "${renderTags(String(listed))}"; the card shows the plain ability modifier.`);
  }

  const skills = m.skill
    ? Object.entries(m.skill).filter(([k]) => k !== "other").flatMap(([k, v]) => {
      const n = /^\s*([+-]?\d+)/.exec(renderTags(String(v)));
      if (!n) { flags.push(`Skill ${titleCase(k)} listed as "${renderTags(String(v))}"; not included.`); return []; }
      return [{ name: titleCase(k), bonus: Number(n[1]) }];
    })
    : [];
  const passiveNum = typeof m.passive === "number" ? m.passive : /^\d+$/.test(String(m.passive ?? "")) ? Number(m.passive) : undefined;
  const senses = [...(m.senses ?? []).map((s: string) => renderTags(s)),
    m.passive != null && passiveNum === undefined ? `Passive Perception ${renderTags(String(m.passive))}` : ""].filter(Boolean).join(", ");

  const sp = m.speed ?? {};
  const actions = entryList(m.action);
  const bonus = entryList(m.bonus);
  const reactions = entryList(m.reaction);
  const legendary = entryList(m.legendary);
  if (m.legendaryHeader) legendary.unshift({ name: "Legendary Actions", text: renderEntries(m.legendaryHeader) });
  if (m.mythic) legendary.push({ name: "Mythic Actions", text: renderEntries(m.mythicHeader) || "Mythic actions (see the stat block's mythic trait)." }, ...entryList(m.mythic));
  const traits = entryList(m.trait);
  const spells: ListEntry[] = [];
  for (const sc of m.spellcasting ?? []) spells.push(...spellcastingEntries(sc));
  if (m.lairActions || m.legendaryGroup) flags.push("Lair actions/regional effects are not included.");

  const initiative = deriveInitiative(m, scores.dex!, pb);
  const typeStr = typeText(m.type);

  const speedOrUndef = (v: unknown) => speedValue(v) || undefined;
  const defenses = {
    vulnerable: damageList(m.vulnerable, "vulnerable") || undefined,
    resist: damageList(m.resist, "resist") || undefined,
    immune: damageList(m.immune, "immune") || undefined,
    conditionImmune: damageList(m.conditionImmune, "conditionImmune") || undefined,
  };
  if (sp.fly && typeof sp.fly === "object" && sp.fly.condition) flags.push(`Fly speed note: ${renderTags(sp.fly.condition)}.`);
  if (m.speed?.alternate || m.speed?.choose) flags.push("Alternate speeds not represented.");
  if (Array.isArray(m.ac) && typeof acRaw === "object" && acRaw.from) flags.push(`AC source: ${acRaw.from.map(renderTags).join(", ")}.`);
  for (const c of initiative.conditional ?? []) flags.push(`Conditional initiative effect NOT applied automatically — ${c}`);
  if (Array.isArray(m.reprintedAs) && m.reprintedAs.length) {
    const [n, s] = String(m.reprintedAs[0]).split("|");
    flags.push(`A newer version exists: ${n} (${s}). Using ${m.source} because it was requested.`);
  }
  if (src?.rules === "2014") flags.push(`2014-rules stat block (${src.title}).`);
  for (const n of opts.copyNotes ?? []) flags.push(`Copy resolution: ${n}`);

  const notes = ["Transcribed from 5etools data (fallback source); verify against your book if anything looks off."];
  if (opts.copyChain?.length) notes.push(`5etools derives this creature from: ${opts.copyChain.join(" → ")}.`);
  if (src) notes.push(`Rules edition ${src.rules} inferred from publication date ${src.published ?? "unknown"}.`);
  notes.push(...(opts.notes ?? []));

  return {
    schema: SHEET_SCHEMA,
    name: m.name,
    kind: "creature",
    size: sizeCode as Statblock["size"],
    type: typeStr || undefined,
    alignment: alignmentText(m.alignment) || undefined,
    ac: Number.isFinite(ac) ? ac : 10,
    hp: { max: Number.isFinite(hpAvg) ? hpAvg : 1, formula: m.hp?.formula },
    speed: {
      walk: speedValue(sp.walk), swim: speedOrUndef(sp.swim), fly: speedOrUndef(sp.fly), climb: speedOrUndef(sp.climb),
      burrow: speedOrUndef(sp.burrow), ...(sp.canHover ? { hover: true } : {}),
    },
    abilities: scores as Record<Ability, number>,
    saves,
    skills,
    senses: senses || undefined,
    passivePerception: passiveNum,
    languages: Array.isArray(m.languages) && m.languages.length ? m.languages.map(renderTags).join(", ") : undefined,
    defenses,
    cr: Number.isFinite(cr.value) ? cr.value : undefined,
    proficiencyBonus: pb,
    initiative,
    traits,
    actions,
    bonusActions: bonus,
    reactions,
    legendary,
    spells,
    inventory: [],
    source: {
      provenance: "official",
      book: m.source,
      bookTitle: src?.title,
      page: m.page,
      url: `https://5e.tools/bestiary.html#${encodeURIComponent(m.name.toLowerCase())}_${m.source.toLowerCase()}`,
      notes,
    },
    flags,
  };
}
