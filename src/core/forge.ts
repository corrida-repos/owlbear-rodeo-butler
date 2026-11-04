import {
  FORGE_DEFAULT_DND5E,
  FORGE_DEFAULT_SYSTEM_NAME,
  FORGE_KEYS,
  FORGE_NS,
  FORGE_ROOM_KEYS,
  type ForgeAttribute,
} from "./constants";
import type { Creature, InitiativeRoll, ListEntry, Statblock } from "./schema";

export type ForgeSystemStatus =
  | { kind: "default"; name: string }
  | { kind: "custom"; name: string; snapshotId: string };

/** Forge stores the imported system's snapshot id in room metadata; absent/empty => built-in default. */
export function detectForgeSystem(roomMetadata: Record<string, unknown>): ForgeSystemStatus {
  const snap = roomMetadata[FORGE_ROOM_KEYS.SNAPSHOT_PUBLIC_ID];
  const name = roomMetadata[FORGE_ROOM_KEYS.SYSTEM_NAME];
  if (typeof snap === "string" && snap.trim()) {
    return { kind: "custom", name: typeof name === "string" ? name : "(unnamed)", snapshotId: snap.trim() };
  }
  return { kind: "default", name: typeof name === "string" && name ? name : FORGE_DEFAULT_SYSTEM_NAME };
}

export const forgeKey = (bid: string) => `${FORGE_NS}/${bid}`;

/**
 * Builds the complete Forge metadata for one creature token.
 * Everything Forge needs is written directly (no partial-card import, which was observed to clear fields).
 */
export function buildForgeMetadata(
  creature: Creature,
  statblock: Statblock,
  initiative: InitiativeRoll,
  newId: () => string,
  portraitUrl?: string,
): Record<string, unknown> {
  const meta: Record<string, unknown> = {};
  for (const [bid, value] of Object.entries(statblock.forge)) {
    meta[forgeKey(bid)] = Array.isArray(value)
      ? (value as ListEntry[]).map((e) => ({ id: newId(), name: e.name, description: e.description }))
      : value;
  }
  meta[forgeKey("Z005")] = creature.hp.current;
  meta[forgeKey("Z006")] = creature.hp.max;
  meta[forgeKey("Z042")] = creature.hp.temp ?? 0;
  meta[FORGE_KEYS.UNIT_NAME] = creature.name;
  meta[FORGE_KEYS.FABRICATED] = true; // required: non-fabricated units get re-fetched by name from Forge's collection
  meta[FORGE_KEYS.ON_LIST] = true;
  meta[FORGE_KEYS.IN_PARTY] = false;
  meta[FORGE_KEYS.INITIATIVE] = initiative.total;
  if (portraitUrl) meta[FORGE_KEYS.PORTRAIT_URL] = portraitUrl;
  return meta;
}

const UNIT_KEYS = new Set<string>(Object.values(FORGE_KEYS));

/** Verifies every Forge key is either a known unit key or a BID of the dictionary with the right value type. */
export function validateForgeMetadata(meta: Record<string, unknown>, dictionary: ForgeAttribute[] = FORGE_DEFAULT_DND5E): string[] {
  const byBid = new Map(dictionary.map((a) => [a.bid, a]));
  const errors: string[] = [];
  for (const [key, value] of Object.entries(meta)) {
    if (!key.startsWith(`${FORGE_NS}/`)) continue;
    if (UNIT_KEYS.has(key)) continue;
    const bid = key.slice(FORGE_NS.length + 1);
    const attr = byBid.get(bid);
    if (!attr) { errors.push(`${bid}: not in the loaded Forge system dictionary`); continue; }
    if (attr.type === "numb" && (typeof value !== "number" || !Number.isFinite(value))) errors.push(`${bid} (${attr.name}): expected number, got ${JSON.stringify(value)}`);
    if (attr.type === "text" && typeof value !== "string") errors.push(`${bid} (${attr.name}): expected text`);
    if (attr.type === "list") {
      if (!Array.isArray(value) || !value.every((e) => e && typeof e.id === "string" && typeof e.name === "string" && typeof e.description === "string"))
        errors.push(`${bid} (${attr.name}): expected list of {id,name,description}`);
    }
  }
  return errors;
}
