/**
 * Action economy markers for the combat HUD: has the unit spent its Action, Bonus Action and Reaction?
 * Stored on the token (`UnitState.turn`) against the round of the unit's own latest turn, so all three come back when
 * its next turn starts (the Reaction too, as in the rules). Also the option held with Ready (`UnitState.readied`): it
 * spends the Action when readied and the Reaction when triggered, and lapses when the next turn starts.
 * Nothing else is counted: no uses, slots or rests.
 */
import type { EncounterState, OrderUnit } from "./encounter";
import type { SceneGateway } from "./importer";
import { STATE_KEY, type Readied, type UnitState } from "./sheet";
import { trackerView } from "./tracker";

export type Economy = "action" | "bonus" | "reaction";
export const ECONOMY: Economy[] = ["action", "bonus", "reaction"];
export const ECONOMY_LABEL: Record<Economy, string> = { action: "Action", bonus: "Bonus Action", reaction: "Reaction" };
export const ECONOMY_GLYPH: Record<Economy, string> = { action: "●", bonus: "▲", reaction: "◆" };

export interface TurnEconomy { round: number; action?: boolean; bonus?: boolean; reaction?: boolean }

/**
 * The round of the unit's latest turn start: this round if its turn has come (or is now), else last round. Outside
 * combat or out of the order: 0.
 */
export function ownTurnRound(enc: EncounterState, order: Pick<OrderUnit, "id">[], unitId: string): number {
  if (!enc.started) return 0;
  const me = order.findIndex((u) => u.id === unitId);
  if (me < 0) return 0;
  const cur = order.findIndex((u) => u.id === enc.turnId);
  const at = cur >= 0 ? cur : Math.min(enc.turnIndex, order.length);
  return me <= at ? enc.round : enc.round - 1;
}

/** What's spent in the unit's current turn; a record from an earlier turn counts as nothing spent. */
export function currentEconomy(state: Pick<UnitState, "turn">, turnRound: number): TurnEconomy {
  const t = state.turn;
  return t && t.round === turnRound ? { ...t } : { round: turnRound };
}

/** The option held with Ready, while it's still good (until the unit's next turn starts). */
export function currentReadied(state: Pick<UnitState, "readied">, turnRound: number): Readied | null {
  return state.readied && state.readied.round === turnRound ? state.readied : null;
}

/**
 * Marks spent (true) or available (false); `ready` holds an option with the Ready action (spends the Action now);
 * `fireReady` takes the readied option when its trigger happens (spends the Reaction); `dropReady` lets it go.
 */
export interface EconomyChange {
  action?: boolean;
  bonus?: boolean;
  reaction?: boolean;
  ready?: { name: string; cost: "action" | "bonus" | "move"; trigger?: string };
  fireReady?: true;
  dropReady?: true;
}

export function isEconomyChange(x: unknown): x is EconomyChange {
  if (!x || typeof x !== "object" || Array.isArray(x)) return false;
  const c = x as Record<string, unknown>;
  const keys = Object.keys(c);
  if (!keys.length || !keys.every((k) => ["action", "bonus", "reaction", "ready", "fireReady", "dropReady"].includes(k))) return false;
  if (!ECONOMY.every((k) => c[k] === undefined || typeof c[k] === "boolean")) return false;
  if (c.fireReady !== undefined && c.fireReady !== true) return false;
  if (c.dropReady !== undefined && c.dropReady !== true) return false;
  if (c.ready !== undefined) {
    const r = c.ready as Record<string, unknown> | null;
    if (!r || typeof r.name !== "string" || !r.name.trim() || r.name.length > 80 || !["action", "bonus", "move"].includes(r.cost as string)) return false;
    if (r.trigger !== undefined && (typeof r.trigger !== "string" || r.trigger.length > 160)) return false;
  }
  return true;
}

/** The state patch for `change` in the unit's current turn. Firing needs a readied option and an unspent Reaction. */
export function applyEconomy(state: Pick<UnitState, "turn" | "readied">, change: EconomyChange, turnRound: number): Pick<UnitState, "turn" | "readied"> {
  const t = currentEconomy(state, turnRound);
  for (const k of ECONOMY) { if (change[k] === true) t[k] = true; else if (change[k] === false) delete t[k]; }
  const patch: Pick<UnitState, "turn" | "readied"> = { turn: t };
  if (change.ready) {
    t.action = true; // Ready itself takes the Action
    const trigger = change.ready.trigger?.trim();
    patch.readied = { name: change.ready.name.trim(), cost: change.ready.cost, ...(trigger ? { trigger } : {}), round: turnRound };
  }
  if (change.fireReady) {
    if (!currentReadied(state, turnRound)) throw new Error("Nothing is readied (it ends when your next turn starts).");
    if (t.reaction) throw new Error("Your Reaction is already used this round.");
    t.reaction = true;
    patch.readied = undefined;
  }
  if (change.dropReady) patch.readied = undefined;
  return patch;
}

/** Applies a change on the scene (the GM's client, directly or for a player's request). */
export async function setEconomy(gw: SceneGateway, unitId: string, change: EconomyChange): Promise<void> {
  const [items, meta] = await Promise.all([gw.getItems(), gw.getSceneMetadata()]);
  const v = trackerView(items, meta);
  const u = [...v.order, ...v.waiting, ...v.outside].find((x) => x.id === unitId);
  if (!u) throw new Error("That token is no longer in the scene.");
  await gw.patchMetadata([{ id: unitId, key: STATE_KEY, patch: applyEconomy(u.state, change, ownTurnRound(v.encounter, v.order, unitId)) }]);
}
