/** Live room settings for any extension page: loaded once, kept in sync with room metadata, written by the GM. */
import OBR from "@owlbear-rodeo/sdk";
import { DEFAULT_SETTINGS, readSettings, settingsUpdate, type RoomSettings } from "../core/settings";
import { getSystem, type GameSystem } from "../core/systems";

let current: RoomSettings = { ...DEFAULT_SETTINGS };
const listeners = new Set<(s: RoomSettings) => void>();

export const roomSettings = () => current;
export const roomSystem = (): GameSystem => getSystem(current.system);
export function onRoomSettings(fn: (s: RoomSettings) => void) { listeners.add(fn); return () => listeners.delete(fn); }

function apply(meta: Record<string, unknown>) {
  const next = readSettings(meta);
  if (JSON.stringify(next) === JSON.stringify(current)) return;
  current = next;
  for (const f of listeners) f(current);
}

/** Call once after OBR.onReady. */
export async function initRoomSettings() {
  apply(await OBR.room.getMetadata());
  OBR.room.onMetadataChange(apply);
}

export async function setRoomSettings(patch: Partial<RoomSettings>) {
  if ((await OBR.player.getRole()) !== "GM") throw new Error("Only the GM can change room settings.");
  await OBR.room.setMetadata(settingsUpdate(await OBR.room.getMetadata(), patch));
}
