/** The room's homebrew actions for any extension page: loaded once, kept in sync with room metadata, written by the GM. */
import OBR from "@owlbear-rodeo/sdk";
import { HOMEBREW_KEY, readHomebrew, removeHomebrew, upsertHomebrew, type HomebrewAction } from "../core/homebrew";

let current: HomebrewAction[] = [];
const listeners = new Set<(list: HomebrewAction[]) => void>();

export const homebrewActions = () => current;
export function onHomebrew(fn: (list: HomebrewAction[]) => void) { listeners.add(fn); return () => listeners.delete(fn); }

function apply(meta: Record<string, unknown>) {
  const next = readHomebrew(meta);
  if (JSON.stringify(next) === JSON.stringify(current)) return;
  current = next;
  for (const f of listeners) f(current);
}

/** Call once after OBR.onReady. */
export async function initHomebrew() {
  apply(await OBR.room.getMetadata());
  OBR.room.onMetadataChange(apply);
}

async function write(change: (list: HomebrewAction[]) => HomebrewAction[]) {
  if ((await OBR.player.getRole()) !== "GM") throw new Error("Only the GM can change homebrew actions.");
  const next = change(readHomebrew(await OBR.room.getMetadata()));
  await OBR.room.setMetadata({ [HOMEBREW_KEY]: next.length ? next : undefined });
  apply({ [HOMEBREW_KEY]: next });
}

export const saveHomebrew = (a: Omit<HomebrewAction, "id"> & { id?: string }) => write((list) => upsertHomebrew(list, a));
export const deleteHomebrew = (id: string) => write((list) => removeHomebrew(list, id));
