/**
 * Session roll log, per browser and room. The background page (always running) appends every roll this client may
 * see; the popover and card read it. All extension pages share one origin, so localStorage + the "storage" event
 * connect them. Broadcasts aren't stored by Owlbear, so a late joiner starts with an empty log (accepted, ROADMAP).
 */
import OBR from "@owlbear-rodeo/sdk";
import { appendRollLog, isRollMessage, type RollMessage } from "../core/rolls";

const key = () => `butler.rolls.${OBR.room.id}`;
const MAX_AGE_MS = 12 * 3600_000;

export function readRollLog(): RollMessage[] {
  try {
    const raw = JSON.parse(localStorage.getItem(key()) ?? "[]");
    const cutoff = Date.now() - MAX_AGE_MS;
    return Array.isArray(raw) ? raw.filter((m) => isRollMessage(m) && Date.parse(m.at) > cutoff) : [];
  } catch {
    return [];
  }
}

export function pushRollLog(msg: RollMessage) {
  try { localStorage.setItem(key(), JSON.stringify(appendRollLog(readRollLog(), msg))); } catch { /* storage unavailable */ }
}

/** Calls `fn` when another page (the background) changes the log. */
export function onRollLog(fn: (log: RollMessage[]) => void) {
  const handler = (e: StorageEvent) => { if (e.key === key()) fn(readRollLog()); };
  addEventListener("storage", handler);
  return () => removeEventListener("storage", handler);
}
