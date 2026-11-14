/**
 * Room-wide settings, set by the GM. Stored in room metadata, which Owlbear caps at 16 kB for ALL extensions
 * together, so only small values belong here.
 */
import { BUTLER_NS } from "./constants";
import { DEFAULT_SYSTEM, SYSTEMS, type SystemId } from "./systems";

export const SETTINGS_KEY = `${BUTLER_NS}/settings`;

export interface RoomSettings {
  system: SystemId;
  /** Players may change their own units' HP, conditions and initiative, and end their own turn. */
  playerEdits: boolean;
  /** Creatures reaching 0 HP are marked dead automatically (otherwise Butler offers it). */
  autoDeadAtZero: boolean;
  /** The Dungeon Master's Guide optional action options (Disarm, Overrun, Tumble…) show on action bars. */
  dmgOptions: boolean;
  /** Handheld management (off by default) shows on action bars: Don or Doff a Shield, Equip or Unequip a Weapon (5.5E), and the notes on
   *  drawing weapons and spellcasting foci in Attack, Magic and Interact with an Object. */
  handheld: boolean;
}

export const DEFAULT_SETTINGS: RoomSettings = { system: DEFAULT_SYSTEM, playerEdits: true, autoDeadAtZero: false, dmgOptions: true, handheld: false };

export function readSettings(roomMetadata: Record<string, unknown>): RoomSettings {
  const raw = roomMetadata[SETTINGS_KEY];
  const s = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  return {
    system: typeof s.system === "string" && s.system in SYSTEMS ? (s.system as SystemId) : DEFAULT_SETTINGS.system,
    playerEdits: typeof s.playerEdits === "boolean" ? s.playerEdits : DEFAULT_SETTINGS.playerEdits,
    autoDeadAtZero: typeof s.autoDeadAtZero === "boolean" ? s.autoDeadAtZero : DEFAULT_SETTINGS.autoDeadAtZero,
    dmgOptions: typeof s.dmgOptions === "boolean" ? s.dmgOptions : DEFAULT_SETTINGS.dmgOptions,
    handheld: typeof s.handheld === "boolean" ? s.handheld : DEFAULT_SETTINGS.handheld,
  };
}

/** The metadata update that stores `patch` merged over the current settings. */
export function settingsUpdate(roomMetadata: Record<string, unknown>, patch: Partial<RoomSettings>): Record<string, unknown> {
  return { [SETTINGS_KEY]: { ...readSettings(roomMetadata), ...patch } };
}
