/**
 * Encounter flow (F4, F5): turn order, start / next / previous / end, round counter, ties, and passing the turn
 * when units leave (Mark as dead). Pure functions over the scene's encounter record and the units' state.
 * The encounter record lives in scene metadata and is written by the GM only.
 */
import { BUTLER_NS } from "./constants";

export const ENCOUNTER_KEY = `${BUTLER_NS}/encounter`;

export interface TurnRef { round: number; turnId: string; turnIndex: number }

export interface EncounterState {
  v: 1;
  started: boolean;
  round: number;
  /** The unit whose turn it is. */
  turnId: string | null;
  /** Its position in the order when the turn started (to find "the next one" if it leaves the order). */
  turnIndex: number;
  /** Earlier turns, newest last, for Previous turn. */
  history: TurnRef[];
}

export const EMPTY_ENCOUNTER: EncounterState = { v: 1, started: false, round: 0, turnId: null, turnIndex: 0, history: [] };
const HISTORY_MAX = 200;

export function readEncounter(sceneMeta: Record<string, unknown>): EncounterState {
  const e = sceneMeta[ENCOUNTER_KEY] as Partial<EncounterState> | undefined;
  if (!e || typeof e !== "object" || e.v !== 1) return { ...EMPTY_ENCOUNTER };
  return {
    v: 1,
    started: e.started === true,
    round: typeof e.round === "number" ? e.round : 0,
    turnId: typeof e.turnId === "string" ? e.turnId : null,
    turnIndex: typeof e.turnIndex === "number" ? e.turnIndex : 0,
    history: Array.isArray(e.history) ? e.history.filter((t) => t && typeof t.turnId === "string") : [],
  };
}

export interface OrderUnit {
  id: string;
  name: string;
  initiative: number | null;
  /** Tie-breakers: initiative modifier, then Dexterity score, then the GM's manual order, then name. */
  initMod: number;
  dex: number;
  tiebreak?: number;
  inEncounter: boolean;
}

/** Sort key: higher initiative first; ties by GM order (if set), higher initiative modifier, higher Dex, name. */
export function compareOrder(a: OrderUnit, b: OrderUnit): number {
  return (b.initiative ?? -Infinity) - (a.initiative ?? -Infinity)
    || (b.tiebreak ?? 0) - (a.tiebreak ?? 0)
    || b.initMod - a.initMod
    || b.dex - a.dex
    || a.name.localeCompare(b.name, undefined, { numeric: true })
    || a.id.localeCompare(b.id);
}

/** Units that take turns: in the encounter, with an initiative. */
export const turnOrder = <T extends OrderUnit>(units: T[]): T[] =>
  units.filter((u) => u.inEncounter && u.initiative !== null).sort(compareOrder);

/** In the encounter but without an initiative yet (players who haven't told the GM their roll). */
export const waitingForInitiative = <T extends OrderUnit>(units: T[]): T[] =>
  units.filter((u) => u.inEncounter && u.initiative === null).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

export function startCombat(enc: EncounterState, order: OrderUnit[]): EncounterState {
  if (!order.length) throw new Error("Nobody in the initiative order yet: add units and roll initiative first.");
  return { v: 1, started: true, round: 1, turnId: order[0]!.id, turnIndex: 0, history: [] };
}

/** Index in `order` of the current turn, or where the current unit was if it has left the order. */
function currentIndex(enc: EncounterState, order: OrderUnit[]): { index: number; present: boolean } {
  const i = order.findIndex((u) => u.id === enc.turnId);
  if (i >= 0) return { index: i, present: true };
  return { index: Math.min(enc.turnIndex, order.length), present: false };
}

export function nextTurn(enc: EncounterState, order: OrderUnit[]): EncounterState {
  if (!enc.started) return startCombat(enc, order);
  if (!order.length) throw new Error("Nobody left in the initiative order.");
  const { index, present } = currentIndex(enc, order);
  // If the active unit left, the unit that slid into its place goes next.
  let next = present ? index + 1 : index;
  let round = enc.round;
  if (next >= order.length) { next = 0; round++; }
  const history = enc.turnId ? [...enc.history, { round: enc.round, turnId: enc.turnId, turnIndex: enc.turnIndex }].slice(-HISTORY_MAX) : enc.history;
  return { ...enc, round, turnId: order[next]!.id, turnIndex: next, history };
}

/** Back to the previous turn (skipping units no longer in the order); round goes back with it. */
export function previousTurn(enc: EncounterState, order: OrderUnit[]): EncounterState {
  const history = [...enc.history];
  while (history.length) {
    const prev = history.pop()!;
    const i = order.findIndex((u) => u.id === prev.turnId);
    if (i >= 0) return { ...enc, round: prev.round, turnId: prev.turnId, turnIndex: i, history };
  }
  throw new Error("No earlier turn to go back to.");
}

export const endCombat = (): EncounterState => ({ ...EMPTY_ENCOUNTER });

/** The active unit and the one after it (wrapping), for highlights and "you're up next". */
export function activeAndNext(enc: EncounterState, order: OrderUnit[]): { active?: string; next?: string } {
  if (!enc.started || !order.length) return {};
  const { index, present } = currentIndex(enc, order);
  if (!present) return { next: order[index % order.length]?.id };
  return { active: order[index]!.id, next: order.length > 1 ? order[(index + 1) % order.length]!.id : undefined };
}

/**
 * Before removing `ids` from the order (Mark as dead, Remove from initiative): if the active unit is among them,
 * the turn passes to the next unit that stays. Everyone else's order is unchanged; the round only advances if the
 * turn wraps past the end, as any next turn would.
 */
export function passTurnFrom(enc: EncounterState, order: OrderUnit[], ids: string[]): EncounterState {
  if (!enc.started || !enc.turnId || !ids.includes(enc.turnId)) return enc;
  const remaining = order.filter((u) => !ids.includes(u.id));
  if (!remaining.length) return endCombat();
  const i = order.findIndex((u) => u.id === enc.turnId);
  let round = enc.round;
  let nextUnit: OrderUnit | undefined;
  for (let k = 1; k <= order.length; k++) {
    const u = order[(i + k) % order.length]!;
    if (!ids.includes(u.id)) { nextUnit = u; if (i + k >= order.length) round++; break; }
  }
  const turnIndex = remaining.findIndex((u) => u.id === nextUnit!.id);
  const history = [...enc.history, { round: enc.round, turnId: enc.turnId, turnIndex: enc.turnIndex }].slice(-HISTORY_MAX);
  return { ...enc, round, turnId: nextUnit!.id, turnIndex, history };
}

/**
 * Moves a unit up or down among the units tied with it on initiative. Returns the `tiebreak` value to store for
 * every unit in the tie (higher goes first), or [] if it can't move that way.
 */
export function moveInTie(order: OrderUnit[], id: string, dir: "up" | "down"): { id: string; tiebreak: number }[] {
  const me = order.find((u) => u.id === id);
  if (!me || me.initiative === null) return [];
  const tie = order.filter((u) => u.initiative === me.initiative);
  const i = tie.findIndex((u) => u.id === id);
  const j = dir === "up" ? i - 1 : i + 1;
  if (j < 0 || j >= tie.length) return [];
  const moved = [...tie];
  [moved[i], moved[j]] = [moved[j]!, moved[i]!];
  return moved.map((u, k) => ({ id: u.id, tiebreak: moved.length - k }));
}
