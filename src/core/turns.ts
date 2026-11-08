/**
 * Requests a player's client sends to the GM's client, which checks and applies them. Players can't write the
 * encounter record, and Owlbear only lets them change tokens they own, so these go through the GM.
 */
import { BUTLER_NS } from "./constants";

export const REQUEST_CHANNEL = `${BUTLER_NS}/request`;

interface Base { v: 1; unitId: string; playerId: string; playerName: string }
export interface EndTurnRequest extends Base { type: "end-turn"; round: number }
/** A death saving throw the player rolled from their card (the natural d20). */
export interface DeathSaveRequest extends Base { type: "death-save"; natural: number }
/** A Concentration save the player rolled for a pending check (the total). */
export interface ConcentrationRequest extends Base { type: "concentration"; total: number }
/** Movement tracker: rewind to the last 5 ft point, or toggle Dash, for the player's active unit. */
export interface RewindRequest extends Base { type: "rewind" }
export interface DashRequest extends Base { type: "dash"; on: boolean }
export type PlayerRequest = EndTurnRequest | DeathSaveRequest | ConcentrationRequest | RewindRequest | DashRequest;

export function isPlayerRequest(x: unknown): x is PlayerRequest {
  const r = x as PlayerRequest;
  if (!r || r.v !== 1 || typeof r.unitId !== "string" || typeof r.playerId !== "string" || typeof r.playerName !== "string") return false;
  if (r.type === "end-turn") return typeof r.round === "number";
  if (r.type === "death-save") return Number.isInteger(r.natural) && r.natural >= 1 && r.natural <= 20;
  if (r.type === "concentration") return typeof r.total === "number" && Number.isFinite(r.total);
  if (r.type === "rewind") return true;
  if (r.type === "dash") return typeof r.on === "boolean";
  return false;
}
