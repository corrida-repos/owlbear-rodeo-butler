/**
 * Requests a player's client sends to the GM's client, which checks and applies them. Players can't write the
 * encounter record, and Owlbear only lets them change tokens they own, so these go through the GM.
 */
import { BUTLER_NS } from "./constants";
import type { Duration } from "./conditions";
import type { PartyMember } from "./ddb";
import type { HpChange } from "./hp";

export const REQUEST_CHANNEL = `${BUTLER_NS}/request`;
/** Requests too big for one broadcast (a synced sheet) arrive in chunks here (see chunks.ts). */
export const REQUEST_CHUNK_CHANNEL = `${BUTLER_NS}/request-chunk`;

interface Base { v: 1; unitId: string; playerId: string; playerName: string }
export interface EndTurnRequest extends Base { type: "end-turn"; round: number }
/** A death saving throw the player rolled from their card (the natural d20). */
export interface DeathSaveRequest extends Base { type: "death-save"; natural: number }
/** A Concentration save the player rolled for a pending check (the total). */
export interface ConcentrationRequest extends Base { type: "concentration"; total: number }
/** Movement tracker: rewind to the last 5 ft point, or toggle Dash, for the player's active unit. */
export interface RewindRequest extends Base { type: "rewind" }
export interface DashRequest extends Base { type: "dash"; on: boolean }
/** Player edits on their own units (D5), applied when the GM allows player edits. */
export interface HpRequest extends Base { type: "hp"; change: HpChange }
export interface InitiativeRequest extends Base { type: "initiative"; value: number | null }
export interface ConditionAddRequest extends Base { type: "condition-add"; key: string; label?: string; note?: string; level?: number; duration?: Duration }
export interface ConditionRemoveRequest extends Base { type: "condition-remove"; conditionId: string }
/** F15: the player's character re-synced from D&D Beyond (converted in the player's browser). */
export interface SheetSyncRequest extends Base { type: "sheet-sync"; member: PartyMember; hp: "ddb" | "keep" }
export type PlayerRequest = EndTurnRequest | DeathSaveRequest | ConcentrationRequest | RewindRequest | DashRequest
  | HpRequest | InitiativeRequest | ConditionAddRequest | ConditionRemoveRequest | SheetSyncRequest;

/** Requests that edit a unit's state or sheet: only applied while the room allows player edits. */
export const EDIT_REQUESTS: PlayerRequest["type"][] = ["hp", "initiative", "condition-add", "condition-remove", "sheet-sync", "end-turn"];

export function isPlayerRequest(x: unknown): x is PlayerRequest {
  const r = x as PlayerRequest;
  if (!r || r.v !== 1 || typeof r.unitId !== "string" || typeof r.playerId !== "string" || typeof r.playerName !== "string") return false;
  if (r.type === "end-turn") return typeof r.round === "number";
  if (r.type === "death-save") return Number.isInteger(r.natural) && r.natural >= 1 && r.natural <= 20;
  if (r.type === "concentration") return typeof r.total === "number" && Number.isFinite(r.total);
  if (r.type === "rewind") return true;
  if (r.type === "dash") return typeof r.on === "boolean";
  if (r.type === "hp") return !!r.change && ["damage", "heal", "set", "temp"].includes(r.change.kind) && Number.isFinite(r.change.amount);
  if (r.type === "initiative") return r.value === null || Number.isFinite(r.value);
  if (r.type === "condition-add") return typeof r.key === "string" && r.key.length < 40;
  if (r.type === "condition-remove") return typeof r.conditionId === "string";
  if (r.type === "sheet-sync") return !!r.member && typeof r.member === "object" && (r.hp === "ddb" || r.hp === "keep");
  return false;
}
