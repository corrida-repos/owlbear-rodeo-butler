/**
 * Homebrew actions: options the GM adds for everyone in the room ("Called Shot", "Flourish"…), shown on every unit's
 * action bar next to the PHB and DMG options. Stored in room metadata, which Owlbear caps at 16 kB for ALL extensions
 * together, so the list is kept small: a few short entries, checked against a byte budget before saving.
 */
import { BUTLER_NS } from "./constants";

export const HOMEBREW_KEY = `${BUTLER_NS}/homebrew`;

export type HomebrewCost = "action" | "bonus" | "reaction" | "free" | "move" | "attack";
export const HOMEBREW_COSTS: { cost: HomebrewCost; label: string }[] = [
  { cost: "action", label: "Action" },
  { cost: "attack", label: "One attack of the Attack action" },
  { cost: "bonus", label: "Bonus Action" },
  { cost: "reaction", label: "Reaction" },
  { cost: "free", label: "Free (no action)" },
  { cost: "move", label: "Movement" },
];

export interface HomebrewAction {
  id: string;
  name: string;
  cost: HomebrewCost;
  /** Short key number for the tile ("DC 13 Con", "+2 AC"). */
  summary?: string;
  /** How it works. */
  text: string;
}

export const HOMEBREW_LIMITS = { name: 40, summary: 40, text: 600, count: 20, bytes: 6000 };

const COSTS = new Set(HOMEBREW_COSTS.map((c) => c.cost));

function clean(raw: unknown): HomebrewAction | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const name = typeof r.name === "string" ? r.name.trim().slice(0, HOMEBREW_LIMITS.name) : "";
  const cost = typeof r.cost === "string" && COSTS.has(r.cost as HomebrewCost) ? (r.cost as HomebrewCost) : null;
  if (!name || !cost) return null;
  const summary = typeof r.summary === "string" ? r.summary.trim().slice(0, HOMEBREW_LIMITS.summary) : "";
  return {
    id: typeof r.id === "string" && r.id ? r.id : name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    name, cost,
    ...(summary ? { summary } : {}),
    text: typeof r.text === "string" ? r.text.trim().slice(0, HOMEBREW_LIMITS.text) : "",
  };
}

export function readHomebrew(roomMetadata: Record<string, unknown>): HomebrewAction[] {
  const raw = roomMetadata[HOMEBREW_KEY];
  return Array.isArray(raw) ? raw.map(clean).filter((x): x is HomebrewAction => !!x) : [];
}

/** Checks one entry from the form; returns the problem in plain words, or null. */
export function homebrewProblem(a: Pick<HomebrewAction, "name" | "text" | "summary">, others: HomebrewAction[], id?: string): string | null {
  const name = a.name.trim();
  if (!name) return "Give it a name.";
  if (name.length > HOMEBREW_LIMITS.name) return `Keep the name under ${HOMEBREW_LIMITS.name} characters.`;
  if ((a.summary ?? "").trim().length > HOMEBREW_LIMITS.summary) return `Keep the short line under ${HOMEBREW_LIMITS.summary} characters.`;
  if (a.text.trim().length > HOMEBREW_LIMITS.text) return `Keep the description under ${HOMEBREW_LIMITS.text} characters (room storage is small).`;
  if (others.some((o) => o.id !== id && o.name.toLowerCase() === name.toLowerCase())) return `There's already a homebrew action called ${name}.`;
  return null;
}

/** The new list with `a` added (no id) or replacing the entry with its id. Throws if it doesn't fit. */
export function upsertHomebrew(list: HomebrewAction[], a: Omit<HomebrewAction, "id"> & { id?: string }): HomebrewAction[] {
  const problem = homebrewProblem(a, list, a.id);
  if (problem) throw new Error(problem);
  const entry = clean({ ...a, id: a.id ?? `hb-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}` })!;
  const next = a.id && list.some((o) => o.id === a.id) ? list.map((o) => (o.id === a.id ? entry : o)) : [...list, entry];
  if (next.length > HOMEBREW_LIMITS.count) throw new Error(`Up to ${HOMEBREW_LIMITS.count} homebrew actions fit in the room.`);
  if (new TextEncoder().encode(JSON.stringify(next)).length > HOMEBREW_LIMITS.bytes) throw new Error("That's more than the room's storage holds: shorten some descriptions or remove an action.");
  return next;
}

export const removeHomebrew = (list: HomebrewAction[], id: string) => list.filter((o) => o.id !== id);
