/**
 * Custom creatures: either pasted 5etools-format JSON (from 5etools "View JSON", homebrew files, or an AI),
 * or a quick form for simple NPCs. Never labelled official.
 */
import { SIZE_NAMES } from "./constants";
import { fmtMod } from "./dice";
import { convertMonster, diceChip } from "./fivetools";
import type { ListEntry, Provenance, Statblock } from "./schema";

/** Accepts one monster object, `{monster: [...]}` (homebrew file) or an array; returns the raw monsters. */
export function parseFivetoolsJson(text: string): any[] {
  let j: any;
  try { j = JSON.parse(text); } catch (e) { throw new Error(`Not valid JSON: ${e instanceof Error ? e.message : e}`); }
  const list = Array.isArray(j) ? j : Array.isArray(j?.monster) ? j.monster : [j];
  const ok = list.filter((m: any) => m && typeof m.name === "string" && (m.ac || m.hp || m.str || m._copy));
  if (!ok.length) throw new Error("No creature found (expected a 5etools monster object with name, ac, hp…).");
  return ok;
}

export function customFromFivetools(raw: any, provenance: Provenance = "user-provided"): Statblock {
  const sb = convertMonster({ source: raw.source ?? "Custom", ...raw });
  sb.source = { provenance, book: undefined, notes: [provenance === "homebrew" ? "Homebrew stat block (not official)." : "Stat block supplied by the GM."] };
  return sb;
}

export interface QuickForm {
  name: string;
  size?: string; // T/S/M/L/H/G
  type?: string;
  ac: number;
  hp: number;
  hpFormula?: string;
  initiative: number;
  speed?: number;
  cr?: number;
  /** One attack per line: "Scimitar: +4, 1d6+2 slashing" (to-hit and damage become dice chips). */
  attacks?: string;
  notes?: string;
}

export function quickStatblock(f: QuickForm, provenance: Provenance = "homebrew"): Statblock {
  if (!f.name.trim()) throw new Error("Name is required.");
  const size = f.size && f.size in SIZE_NAMES ? f.size : "M";
  const actions: ListEntry[] = (f.attacks ?? "").split("\n").map((l) => l.trim()).filter(Boolean).map((line) => {
    const [name, rest = ""] = line.split(/:\s*/, 2);
    const hit = /([+-]\d+)/.exec(rest);
    const dmg = /(\d+d\d+(?:\s*[+-]\s*\d+)?)/i.exec(rest);
    let desc = rest;
    if (hit) desc = desc.replace(hit[1]!, `${hit[1]} [1d20${fmtMod(Number(hit[1]))}]`);
    if (dmg && diceChip(dmg[1]!)) desc = desc.replace(dmg[1]!, `${dmg[1]} ${diceChip(dmg[1]!)}`);
    return { name: name!.trim(), description: desc };
  });
  return {
    name: f.name.trim(),
    size: size as Statblock["size"],
    source: { provenance, notes: [provenance === "homebrew" ? "Quick custom stat block (not official)." : "Stat block supplied by the GM."] },
    hp: { average: f.hp, formula: f.hpFormula },
    initiative: { modifier: f.initiative, advantage: false, disadvantage: false, reasons: [`entered ${fmtMod(f.initiative)}`] },
    forge: {
      Z002: SIZE_NAMES[size]!, Z004: f.type ?? "", Z007: f.ac, Z008: f.speed ?? 30, Z016: f.cr ?? 0,
      Z034: f.notes ? [{ name: "Notes", description: f.notes }] : [], Z035: actions,
    },
    flags: ["Quick custom creature: only the entered fields are set."],
  };
}
