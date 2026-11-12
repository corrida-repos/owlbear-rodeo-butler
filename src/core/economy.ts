/**
 * Action economy markers for the combat HUD: has the unit spent its Action, Bonus Action and Reaction?
 * Stored on the token (`UnitState.turn`) against the round of the unit's own latest turn, so all three come back when
 * its next turn starts (the Reaction too, as in the rules). Nothing else is counted: no uses, slots or rests.
 */
import type { EncounterState, OrderUnit } from "./encounter";
import type { SceneGateway } from "./importer";
import { STATE_KEY, type UnitState } from "./sheet";
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

export type EconomyChange = Partial<Record<Economy, boolean>>;

export function isEconomyChange(x: unknown): x is EconomyChange {
  if (!x || typeof x !== "object" || Array.isArray(x)) return false;
  const e = Object.entries(x);
  return e.length > 0 && e.every(([k, v]) => (ECONOMY as string[]).includes(k) && typeof v === "boolean");
}

/** The state patch marking `change` spent (true) or available again (false) in the unit's current turn. */
export function applyEconomy(state: Pick<UnitState, "turn">, change: EconomyChange, turnRound: number): Pick<UnitState, "turn"> {
  const t = currentEconomy(state, turnRound);
  for (const [k, v] of Object.entries(change)) { if (v) t[k as Economy] = true; else delete t[k as Economy]; }
  return { turn: t };
}

/** Applies a change on the scene (the GM's client, directly or for a player's request). */
export async function setEconomy(gw: SceneGateway, unitId: string, change: EconomyChange): Promise<void> {
  const [items, meta] = await Promise.all([gw.getItems(), gw.getSceneMetadata()]);
  const v = trackerView(items, meta);
  const u = [...v.order, ...v.waiting, ...v.outside].find((x) => x.id === unitId);
  if (!u) throw new Error("That token is no longer in the scene.");
  await gw.patchMetadata([{ id: unitId, key: STATE_KEY, patch: applyEconomy(u.state, change, ownTurnRound(v.encounter, v.order, unitId)) }]);
}
