/**
 * Material components a spellcasting focus or a component pouch can't stand in for (PHB 2024 and 2014): ones with a
 * cost, and ones the spell consumes. Read from the spell's own text when it says ("Material: a diamond worth 300+ GP,
 * which the spell consumes", written by the D&D Beyond sync), else from the books (costlyComponents.ts).
 */
import { COSTLY_COMPONENTS } from "./costlyComponents";

const COSTLY = /\b\d[\d,]*\+?\s*gp\b|\bworth\b|\bconsume/i;

/** The spell's name without D&D Beyond's notes: "Revivify (Level 3, 1/Long Rest)" → "revivify". */
export const spellKey = (name: string) => name.replace(/\s*\(.*$/, "").trim().toLowerCase();

/** The component that must be on hand, or null when a focus or pouch covers it (or the spell is unknown). */
export function costlyMaterial(name: string, text: string, rules: "2024" | "2014" = "2024"): string | null {
  const own = /\bMaterial:\s*([^\n]*?)(?:\.\s|\.$|$)/.exec(text)?.[1]?.trim();
  if (own) return COSTLY.test(own) ? own : null;
  const book = COSTLY_COMPONENTS[spellKey(name)];
  return book ? book[rules] ?? book[rules === "2024" ? "2014" : "2024"] ?? null : null;
}

/** The warning shown with the spell. */
export function materialWarning(name: string, text: string, rules: "2024" | "2014" = "2024"): string | null {
  const m = costlyMaterial(name, text, rules);
  if (!m) return null;
  const consumed = /consume/i.test(m);
  return `Material component: ${m}. A spellcasting focus or component pouch can't replace it${consumed ? ", and the spell uses it up: you need a new one for each casting" : ": you need the actual item"}.`;
}
