/**
 * Lair actions happen on initiative count 20, losing ties: after every unit at 20 or higher, before those below.
 * The tracker has no "count 20" turn, so the GM's client reminds the GM when a turn change passes it.
 */
import type { UnitSheet } from "./sheet";

export interface TurnAt { round: number; turnId: string }
type Ordered = { id: string; initiative: number | null };

const init = (order: Ordered[], id: string) => order.find((u) => u.id === id)?.initiative ?? -Infinity;

/** Whether moving forward from `prev` to `next` passes initiative count 20. */
export function passesCount20(prev: TurnAt, next: TurnAt, order: Ordered[]): boolean {
  const n = init(order, next.turnId);
  if (n >= 20) return false;
  if (next.round > prev.round) return true; // a new round, and nobody at 20+ goes first
  return init(order, prev.turnId) >= 20;
}

/** The creature has lair actions (imported from 5etools, or written by hand as "Lair Action…" entries). */
export const hasLairActions = (sheet: Pick<UnitSheet, "legendary">) => sheet.legendary.some((e) => /^Lair Action/i.test(e.name));
