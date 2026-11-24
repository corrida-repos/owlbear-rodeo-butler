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
  /** Spells and attacks cast from the action bar apply their damage and conditions as soon as they're resolved
   *  (otherwise they wait in the Tracker for the GM). Off by default. */
  autoApplyCasts: boolean;
  /** Players see whether their attacks from the action bar hit (it tells them roughly the target's AC). On by default. */
  revealHits: boolean;
  /** Mass combat (Unearthed Arcana 2017, playtest): the DM Tools panel, unit badges and the players' Battle view. Off by default. */
  massCombat: boolean;
  /** Naval and aerial combat (GoS, AAG, DMG, XGE): the Ships and sky panel in DM Tools, ship turns in initiative, and
   *  falls of creatures in the air. Off by default. */
  naval: boolean;
}

export const DEFAULT_SETTINGS: RoomSettings = { system: DEFAULT_SYSTEM, playerEdits: true, autoDeadAtZero: false, dmgOptions: true, handheld: false, autoApplyCasts: false, revealHits: true, massCombat: false, naval: false };

export function readSettings(roomMetadata: Record<string, unknown>): RoomSettings {
  const raw = roomMetadata[SETTINGS_KEY];
  const s = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  return {
    system: typeof s.system === "string" && s.system in SYSTEMS ? (s.system as SystemId) : DEFAULT_SETTINGS.system,
    playerEdits: typeof s.playerEdits === "boolean" ? s.playerEdits : DEFAULT_SETTINGS.playerEdits,
    autoDeadAtZero: typeof s.autoDeadAtZero === "boolean" ? s.autoDeadAtZero : DEFAULT_SETTINGS.autoDeadAtZero,
    dmgOptions: typeof s.dmgOptions === "boolean" ? s.dmgOptions : DEFAULT_SETTINGS.dmgOptions,
    handheld: typeof s.handheld === "boolean" ? s.handheld : DEFAULT_SETTINGS.handheld,
    autoApplyCasts: typeof s.autoApplyCasts === "boolean" ? s.autoApplyCasts : DEFAULT_SETTINGS.autoApplyCasts,
    revealHits: typeof s.revealHits === "boolean" ? s.revealHits : DEFAULT_SETTINGS.revealHits,
    massCombat: typeof s.massCombat === "boolean" ? s.massCombat : DEFAULT_SETTINGS.massCombat,
    naval: typeof s.naval === "boolean" ? s.naval : DEFAULT_SETTINGS.naval,
  };
}

/** The metadata update that stores `patch` merged over the current settings. */
export function settingsUpdate(roomMetadata: Record<string, unknown>, patch: Partial<RoomSettings>): Record<string, unknown> {
  return { [SETTINGS_KEY]: { ...readSettings(roomMetadata), ...patch } };
}
