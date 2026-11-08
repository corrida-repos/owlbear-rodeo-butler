/**
 * Reading and writing Butler units on Owlbear tokens (replaces the old Forge metadata writer).
 * A unit is a CHARACTER-layer image with a `sheet` and a `state` key.
 */
import type { HpRecord, InitiativeRoll } from "./schema";
import { migrateSheet, newState, normalizeState, SHEET_KEY, STATE_KEY, validateSheet, type UnitSheet, type UnitState } from "./sheet";

export interface ItemLike { layer: string; type: string; metadata: Record<string, unknown> }

export const isUnitItem = (i: ItemLike) => i.layer === "CHARACTER" && i.type === "IMAGE" && SHEET_KEY in i.metadata;

/** The token's sheet and state, or null if it isn't a (valid) Butler unit. */
export function readUnit(meta: Record<string, unknown>): { sheet: UnitSheet; state: UnitState } | null {
  if (!(SHEET_KEY in meta)) return null;
  try {
    const sheet = migrateSheet(meta[SHEET_KEY]);
    return { sheet, state: normalizeState(meta[STATE_KEY], sheet) };
  } catch {
    return null;
  }
}

/** State for a freshly added unit: its own HP (average or rolled) and rolled initiative, in the encounter. */
export function unitState(sheet: UnitSheet, hp: Pick<HpRecord, "max" | "current"> & { temp?: number }, initiative: InitiativeRoll | null,
  patch: Partial<UnitState> = {}): UnitState {
  return newState(sheet, {
    hp: hp.current,
    tempHp: hp.temp ?? 0,
    ...(hp.max !== sheet.hp.max ? { maxHpOverride: hp.max } : {}),
    initiative: initiative?.total ?? null,
    ...(initiative ? { initiativeRoll: initiative } : {}),
    inEncounter: true,
    ...patch,
  });
}

/** Metadata keys for a unit token. Throws if the sheet is invalid, so nothing broken is written to the scene. */
export function unitMetadata(sheet: UnitSheet, state: UnitState): Record<string, unknown> {
  const errs = validateSheet(sheet);
  if (errs.length) throw new Error(`${sheet.name}: invalid stat block (${errs.join("; ")})`);
  return { [SHEET_KEY]: sheet, [STATE_KEY]: state };
}

/** Bytes of JSON a token's unit metadata takes (for the preflight report). */
export const metadataBytes = (meta: Record<string, unknown>) => new TextEncoder().encode(JSON.stringify(meta)).length;
