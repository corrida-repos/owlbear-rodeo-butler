/**
 * Resolves 5etools `_copy` creatures (variants defined as "base creature + modifications").
 * Mirrors DataUtil.generic.copyApplier in 5etools-src js/utils.js (read 2026-11-04):
 *  1. inherit every base property the copy doesn't set (some only when `_preserve`d),
 *  2. add template `_root` props, 3. apply `_mod` operations (template mods appended), "_" and "*" last.
 */
import { proficiencyBonusForCr } from "./fivetools-shared";

export interface CopyContext {
  /** Returns the RAW (possibly itself `_copy`) monster, or undefined. */
  getMonster: (name: string, source: string) => any | undefined;
  templates?: any[];
}

export interface ResolvedCopy {
  monster: any;
  /** Human-readable trail, e.g. ["copy of Mage (MM)", "template Tiefling (PHB)"]. */
  chain: string[];
  notes: string[];
}

// Never inherited unless the copy's `_preserve` names them (generic + monster-specific lists).
const REQUIRES_PRESERVE = new Set([
  "page", "otherSources", "referenceSources", "srd", "srd52", "basicRules", "basicRules2024", "reprintedAs",
  "hasFluff", "hasFluffImages", "hasToken", "tokenCredit", "tokenCustom", "foundryTokenScale", "altArt", "_versions",
  "legendaryGroup", "environment", "soundClip", "variant", "dragonCastingColor", "familiar",
]);

const COPY_ENTRY_PROPS = [
  "action", "bonus", "reaction", "trait", "legendary", "mythic", "variant", "spellcasting",
  "actionHeader", "bonusHeader", "reactionHeader", "legendaryHeader", "mythicHeader",
];

const SKILL_ABILITY: Record<string, string> = {
  athletics: "str", acrobatics: "dex", "sleight of hand": "dex", stealth: "dex", arcana: "int", history: "int",
  investigation: "int", nature: "int", religion: "int", "animal handling": "wis", insight: "wis", medicine: "wis",
  perception: "wis", survival: "wis", deception: "cha", intimidation: "cha", performance: "cha", persuasion: "cha",
};
const SIZES = ["F", "D", "T", "S", "M", "L", "H", "G", "C", "V"];

const mod = (score: unknown) => Math.floor((Number(score) - 10) / 2);
const crValue = (cr: unknown): number => {
  const t = typeof cr === "string" ? cr : (cr as any)?.cr;
  if (typeof t !== "string") return NaN;
  return t.includes("/") ? Number(t.split("/")[0]) / Number(t.split("/")[1]) : Number(t);
};
const pb = (m: any) => proficiencyBonusForCr(crValue(m.cr));
const fmt = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
const arr = <T>(v: T | T[]): T[] => (Array.isArray(v) ? v : [v]);
const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

/** Applies `fn` to every string inside `v` (deep), returning a new value. */
function walkStrings(v: any, fn: (s: string) => string): any {
  if (typeof v === "string") return fn(v);
  if (Array.isArray(v)) return v.map((x) => walkStrings(x, fn));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walkStrings(x, fn)]));
  return v;
}

function getPath(obj: any, path: string[]): any {
  return path.reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function setPath(obj: any, path: string[], value: any) {
  let o = obj;
  for (let i = 0; i < path.length - 1; i++) o = o[path[i]!] ??= {};
  o[path.at(-1)!] = value;
}
function deletePath(obj: any, path: string[]) {
  const parent = getPath(obj, path.slice(0, -1));
  if (parent) delete parent[path.at(-1)!];
}

// ------------------------------------------------------------------ variables: <$name$>, <$to_hit__str$> ...

export function shortName(m: any, titleCase = false): string {
  const prefix = m.isNamedCreature ? "" : titleCase ? "The " : "the ";
  if (m.shortName === true) return `${prefix}${m.name}`;
  if (typeof m.shortName === "string") return `${prefix}${!prefix && titleCase ? m.shortName : m.shortName.toLowerCase()}`;
  let out = String(m.name).split(",")[0]!.replace(/(?:adult|ancient|young) \w+ (dragon|dracolich)/gi, "$1");
  out = m.isNamedCreature ? out.split(" ")[0]! : out.toLowerCase();
  return `${prefix}${out}`;
}

const SIZE_MULT: Record<string, number> = { L: 2, H: 3, G: 4 };

/** Safe arithmetic evaluator for + - * / ( ) and numbers (no eval). */
function evalMath(expr: string): number {
  const s = expr.replace(/\s+/g, "");
  let i = 0;
  const num = (): number => {
    if (s[i] === "(") { i++; const v = add(); i++; return v; }
    if (s[i] === "-") { i++; return -num(); }
    const m = /^\d+(\.\d+)?/.exec(s.slice(i));
    if (!m) throw new Error(`bad expression "${expr}"`);
    i += m[0].length;
    return Number(m[0]);
  };
  const mul = (): number => { let v = num(); while (s[i] === "*" || s[i] === "/") { const op = s[i++]; const r = num(); v = op === "*" ? v * r : v / r; } return v; };
  const add = (): number => { let v = mul(); while (s[i] === "+" || s[i] === "-") { const op = s[i++]; const r = mul(); v = op === "+" ? v + r : v - r; } return v; };
  return add();
}

export function resolveVariables<T>(obj: T, ent: any): T {
  return walkStrings(obj, (str) =>
    str.replace(/<\$([^$]+)\$>/g, (whole, variable: string) => {
      const [mode, detail = ""] = variable.split("__");
      switch (mode) {
        case "name": return ent.name;
        case "short_name": return shortName(ent);
        case "title_short_name": return shortName(ent, true);
        case "dc":
        case "spell_dc": return String(8 + mod(ent[detail]) + pb(ent));
        case "to_hit": return fmt(pb(ent) + mod(ent[detail]));
        case "damage_mod": { const t = mod(ent[detail]); return t === 0 ? "" : t > 0 ? ` + ${t}` : ` - ${Math.abs(t)}`; }
        case "damage_avg": {
          const e = detail.replace(/\b(str|dex|con|int|wis|cha)\b/gi, (a) => String(mod(ent[a.toLowerCase()])))
            .replace(/\bsize_mult\b/g, String(SIZE_MULT[ent.size?.[0]] ?? 1));
          return String(Math.floor(evalMath(e)));
        }
        case "size_mult": { const k = SIZE_MULT[ent.size?.[0]] ?? 1; return detail ? String(Math.floor(k * evalMath(detail))) : String(k); }
        default: return whole;
      }
    }),
  );
}

// ------------------------------------------------------------------ _mod operations

function replaceOutsideTags(str: string, re: RegExp, withStr: string, tagInsensitive: boolean): string {
  if (tagInsensitive) return str.replace(re, withStr);
  return str.split(/(\{@[^}]*\})/g).map((part) => (part.startsWith("{@") ? part : part.replace(re, withStr))).join("");
}

function applyOp(copyTo: any, op: any, propPath: string[] | null, notes: string[]) {
  const fail = (msg: string) => { throw new Error(`Could not apply ${typeof op === "string" ? op : op.mode} to "${propPath?.join(".") ?? "(root)"}": ${msg}`); };
  if (typeof op === "string") {
    if (op === "remove" && propPath) return deletePath(copyTo, propPath);
    return fail("unhandled mode");
  }
  const get = () => (propPath ? getPath(copyTo, propPath) : undefined);
  const set = (v: any) => propPath && setPath(copyTo, propPath, v);
  const items = op.items !== undefined ? clone(arr(op.items)) : [];

  switch (op.mode) {
    case "appendStr": { const cur = get(); return set(cur ? `${cur}${op.joiner ?? ""}${op.str}` : op.str); }
    case "replaceName":
    case "replaceTxt": {
      const ents = get();
      if (!ents) return;
      const re = new RegExp(op.replace, `g${op.flags ?? ""}`);
      const fn = (s: string) => replaceOutsideTags(s, re, op.with, !!op.tagInsensitive);
      if (op.mode === "replaceName") { for (const e of arr(ents)) if (e?.name) e.name = fn(e.name); return; }
      const props: (string | null)[] = op.props ?? [null, "entries", "headerEntries", "footerEntries"];
      if (!Array.isArray(ents)) { if (typeof ents === "string" && props.includes(null)) set(fn(ents)); return; }
      if (props.includes(null)) set(ents.map((e: any) => (typeof e === "string" ? walkStrings(e, fn) : e)));
      for (const e of get() as any[]) for (const p of props) if (p && e && typeof e === "object" && e[p]) e[p] = walkStrings(e[p], fn);
      return;
    }
    case "prependArr": { const cur = get(); return set(cur ? items.concat(cur) : items); }
    case "appendArr": { const cur = get(); return set(cur ? arr(cur).concat(items) : items); }
    case "appendIfNotExistsArr": {
      const cur = get();
      if (!cur) return set(items);
      const s = new Set(cur.map((x: any) => JSON.stringify(x)));
      return set(cur.concat(items.filter((x: any) => !s.has(JSON.stringify(x)))));
    }
    case "replaceArr":
    case "replaceOrAppendArr": {
      const cur = get();
      if (!cur) { if (op.mode === "replaceOrAppendArr") return set(items); return fail("array not found"); }
      let ix: number;
      if (op.replace?.regex) { const re = new RegExp(op.replace.regex, op.replace.flags ?? ""); ix = cur.findIndex((x: any) => (x?.name ? re.test(x.name) : typeof x === "string" && re.test(x))); }
      else if (op.replace?.index != null) ix = op.replace.index;
      else ix = cur.findIndex((x: any) => (x?.name ? x.name === op.replace : x === op.replace));
      if (ix >= 0) cur.splice(ix, 1, ...items);
      else if (op.mode === "replaceOrAppendArr") cur.push(...items);
      else fail(`item "${op.replace?.regex ?? op.replace}" not found`);
      return;
    }
    case "insertArr": { const cur = get(); if (!cur) return fail("array not found"); cur.splice(op.index >= 0 ? op.index : cur.length, 0, ...items); return; }
    case "removeArr": {
      const cur = get();
      if (!cur) return fail("array not found");
      if (op.names) for (const n of arr(op.names)) { const ix = cur.findIndex((x: any) => x?.name === n); if (ix >= 0) cur.splice(ix, 1); else if (!op.force) notes.push(`removeArr: "${n}" not present`); }
      else for (const it of items) { const ix = cur.indexOf(it); if (ix >= 0) cur.splice(ix, 1); }
      return;
    }
    case "renameArr": {
      const cur = get();
      for (const r of arr(op.renames)) { const e = cur?.find((x: any) => x?.name === r.rename); if (e) e.name = r.with; }
      return;
    }
    case "scalarAddProp":
    case "scalarMultProp": {
      const tgt = get();
      if (!tgt) return;
      const apply = (k: string) => {
        let out = op.mode === "scalarAddProp" ? Number(tgt[k]) + op.scalar : Number(tgt[k]) * op.scalar;
        if (op.floor) out = Math.floor(out);
        tgt[k] = typeof tgt[k] === "string" ? fmt(out) : out;
      };
      if (op.prop === "*") Object.keys(tgt).forEach(apply); else apply(op.prop);
      return;
    }
    case "setProp":
    case "prefixSuffixStringProp": {
      const path = op.prop ? String(op.prop).split(".") : [];
      if (propPath && !(propPath.length === 1 && propPath[0] === "*")) path.unshift(...propPath);
      if (op.mode === "setProp") {
        if (op.value === null) return deletePath(copyTo, path); // null = "no value" (e.g. drop vulnerabilities)
        return setPath(copyTo, path, clone(op.value));
      }
      const s = getPath(copyTo, path);
      if (typeof s === "string") setPath(copyTo, path, `${op.prefix ?? ""}${s}${op.suffix ?? ""}`);
      return;
    }
    case "calculateProp": {
      const tgt = propPath ? (getPath(copyTo, propPath) ?? (setPath(copyTo, propPath, {}), getPath(copyTo, propPath))) : copyTo;
      const expr = String(op.formula).replace(/<\$([^$]+)\$>/g, (_w, v: string) => (v === "prof_bonus" ? String(pb(copyTo)) : v === "dex_mod" ? String(mod(copyTo.dex)) : fail(`unknown variable ${v}`)));
      tgt[op.prop] = evalMath(expr);
      return;
    }
    case "addSenses": {
      copyTo.senses ||= [];
      for (const s of arr(op.senses)) {
        const ix = copyTo.senses.findIndex((x: string) => new RegExp(`${s.type} (\\d+)`, "i").test(x));
        if (ix >= 0) { const cur = Number(new RegExp(`${s.type} (\\d+)`, "i").exec(copyTo.senses[ix])![1]); if (cur < s.range) copyTo.senses[ix] = `${s.type} ${s.range} ft.`; }
        else copyTo.senses.push(`${s.type} ${s.range} ft.`);
      }
      return;
    }
    case "addSaves":
    case "addAllSaves": {
      copyTo.save ||= {};
      const saves = op.mode === "addAllSaves" ? Object.fromEntries(["str", "dex", "con", "int", "wis", "cha"].map((a) => [a, op.saves])) : op.saves;
      for (const [a, lvl] of Object.entries<number>(saves)) {
        const total = lvl * pb(copyTo) + mod(copyTo[a]);
        if (!copyTo.save[a] || Number(copyTo.save[a]) < total) copyTo.save[a] = fmt(total);
      }
      return;
    }
    case "addSkills":
    case "addAllSkills": {
      copyTo.skill ||= {};
      const skills = op.mode === "addAllSkills" ? Object.fromEntries(Object.keys(SKILL_ABILITY).map((s) => [s, op.skills])) : op.skills;
      for (const [s, lvl] of Object.entries<number>(skills)) {
        const total = lvl * pb(copyTo) + mod(copyTo[SKILL_ABILITY[s] ?? "wis"]);
        if (!copyTo.skill[s] || Number(copyTo.skill[s]) < total) copyTo.skill[s] = fmt(total);
      }
      return;
    }
    case "addSpells":
    case "replaceSpells":
    case "removeSpells": {
      if (!copyTo.spellcasting) return fail("creature has no spellcasting");
      const sc = op.mode === "addSpells" && op.name ? copyTo.spellcasting.find((x: any) => x.name === op.name) : copyTo.spellcasting[0];
      if (!sc) return fail(`no spellcasting trait named "${op.name}"`);
      const freq = ["recharge", "legendary", "charges", "rest", "restLong", "daily", "weekly", "monthly", "yearly"];
      if (op.mode === "addSpells") {
        if (op.spells) {
          sc.spells ||= {};
          for (const [lvl, cat] of Object.entries<any>(op.spells)) {
            if (!sc.spells[lvl]) sc.spells[lvl] = clone(cat);
            else for (const [k, v] of Object.entries<any>(cat)) sc.spells[lvl][k] = Array.isArray(sc.spells[lvl][k]) ? sc.spells[lvl][k].concat(v) : v;
          }
        }
        for (const p of ["constant", "will", "ritual"]) if (op[p]) (sc[p] ||= []).push(...op[p]);
        for (const p of freq) if (op[p]) for (const [k, sp] of Object.entries<any>(op[p])) ((sc[p] ||= {})[k] ||= []).push(...sp);
        return;
      }
      if (op.mode === "replaceSpells") {
        const rep = (list: string[], r: any) => { const ix = list.indexOf(r.replace); if (ix < 0) fail(`spell "${r.replace}" not found`); list.splice(ix, 1, ...arr(r.with)); };
        if (op.spells) for (const [lvl, rs] of Object.entries<any>(op.spells)) if (sc.spells?.[lvl]) for (const r of rs) rep(sc.spells[lvl].spells, r);
        if (op.daily) for (const [k, rs] of Object.entries<any>(op.daily)) for (const r of rs) rep(sc.daily[k], r);
        return;
      }
      if (op.spells) for (const [lvl, rm] of Object.entries<any>(op.spells)) if (sc.spells?.[lvl]?.spells) sc.spells[lvl].spells = sc.spells[lvl].spells.filter((s: string) => !rm.includes(s));
      for (const p of ["constant", "will", "ritual"]) if (op[p] && sc[p]) sc[p] = sc[p].filter((s: string) => !op[p].includes(s));
      for (const p of freq) if (op[p]) for (const [k, rm] of Object.entries<any>(op[p])) if (sc[p]?.[k]) sc[p][k] = sc[p][k].filter((s: string) => !rm.includes(s));
      return;
    }
    case "scalarAddHit":
    case "scalarAddDc": {
      const cur = get();
      if (!cur) return;
      const re = op.mode === "scalarAddHit" ? /\{@hit ([-+]?\d+)\}/g : /\{@dc (\d+)(?:\|[^}]+)?\}/g;
      return set(walkStrings(cur, (s) => s.replace(re, (_w, n) => (op.mode === "scalarAddHit" ? `{@hit ${Number(n) + op.scalar}}` : `{@dc ${Number(n) + op.scalar}}`))));
    }
    case "maxSize": {
      const ixMax = SIZES.indexOf(op.max);
      const next = (copyTo.size as string[]).map((s) => SIZES.indexOf(s)).filter((ix) => ix <= ixMax);
      copyTo.size = (next.length ? next : [ixMax]).map((ix) => SIZES[ix]);
      return;
    }
    case "scalarMultXp": return; // XP isn't used by the importer
    default: return fail("unhandled mode");
  }
}

// ------------------------------------------------------------------ main

export function resolveCopy(raw: any, ctx: CopyContext, depth = 0): ResolvedCopy {
  if (!raw._copy) return { monster: clone(raw), chain: [], notes: [] };
  if (depth > 10) throw new Error(`_copy chain too deep at "${raw.name}"`);
  const meta = clone(raw._copy);
  const baseRaw = ctx.getMonster(meta.name, meta.source);
  if (!baseRaw) throw new Error(`"${raw.name}" (${raw.source}) copies "${meta.name}" (${meta.source}), which isn't loaded`);
  const base = resolveCopy(baseRaw, ctx, depth + 1);
  const copyFrom = base.monster;
  const copyTo: any = clone(raw);
  const chain = [`copy of ${meta.name} (${meta.source})`, ...base.chain];
  const notes = [...base.notes];

  // normalise mods to arrays; merge template mods
  const mods: Record<string, any[]> = Object.fromEntries(Object.entries(meta._mod ?? {}).map(([k, v]) => [k, arr(v)]));
  const templates: any[] = [];
  for (const t of meta._templates ?? []) {
    const tpl = (ctx.templates ?? []).find((x) => x.name.toLowerCase() === t.name.toLowerCase() && x.source.toLowerCase() === t.source.toLowerCase());
    if (!tpl) throw new Error(`"${raw.name}": template "${t.name}" (${t.source}) not found`);
    templates.push(clone(tpl));
    chain.push(`template ${t.name} (${t.source})`);
    for (const [k, v] of Object.entries(tpl.apply?._mod ?? {})) mods[k] = (mods[k] ?? []).concat(arr(v));
  }

  const ownProps = new Set(Object.keys(copyTo));
  for (const k of Object.keys(copyFrom)) {
    if (copyTo[k] === null) { delete copyTo[k]; continue; }
    if (copyTo[k] == null) {
      if (REQUIRES_PRESERVE.has(k)) { if (meta._preserve?.["*"] || meta._preserve?.[k]) copyTo[k] = copyFrom[k]; }
      else copyTo[k] = copyFrom[k];
    }
  }
  for (const tpl of templates) for (const [k, v] of Object.entries(tpl.apply?._root ?? {})) if (!ownProps.has(k)) copyTo[k] = v;

  const order = (k: string) => (k === "_" ? 1 : k === "*" ? 2 : 0);
  for (const [prop, ops] of Object.entries(mods).sort(([a], [b]) => order(a) - order(b))) {
    const resolvedOps = resolveVariables(ops, copyTo);
    for (const op of resolvedOps) {
      if (prop === "*") for (const p of COPY_ENTRY_PROPS) applyOp(copyTo, op, [p], notes);
      else if (prop === "_") applyOp(copyTo, op, null, notes);
      else applyOp(copyTo, op, prop.split("."), notes);
    }
  }
  delete copyTo._copy;
  copyTo._copiedFrom = { name: meta.name, source: meta.source, hasToken: !!copyFrom.hasToken || !!copyFrom._copiedFrom?.hasToken };
  return { monster: copyTo, chain, notes };
}

/** All `{name, source}` the creature depends on through its `_copy` chain (first hop only; call repeatedly). */
export function copyBaseRef(raw: any): { name: string; source: string } | null {
  return raw?._copy ? { name: raw._copy.name, source: raw._copy.source } : null;
}
export const usesTemplates = (raw: any) => !!raw?._copy?._templates?.length;
