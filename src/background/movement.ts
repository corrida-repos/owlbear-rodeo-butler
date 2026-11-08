/**
 * Movement tracker (F14), run by the primary GM client: records the active unit's moves since its turn started
 * (each segment measured with the scene grid's own distance rules) and applies Rewind / Dash.
 * The record is kept in memory here and only mirrored to scene metadata, so a Rewind (record first, then the token
 * move) can't race with the change events it causes. All Rewind / Dash requests, the GM's included, come here.
 */
import OBR from "@owlbear-rodeo/sdk";
import { addStep, MOVEMENT_KEY, readMovement, rewind, startMovement, type MovementState } from "../core/movement";

let mem: MovementState | null = null;
let queue: Promise<unknown> = Promise.resolve();
/** Runs movement operations one at a time (tracking, rewind and dash all read-modify-write the record). */
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

/** Feet between two scene points, by the grid's measurement setting and scale (e.g. 1 cell = 5 ft). */
async function feet(a: { x: number; y: number }, b: { x: number; y: number }): Promise<number> {
  const [cells, scale] = await Promise.all([OBR.scene.grid.getDistance(a, b), OBR.scene.grid.getScale()]);
  return cells * (scale.parsed?.multiplier ?? 5);
}

async function save(m: MovementState | null) {
  mem = m;
  await OBR.scene.setMetadata({ [MOVEMENT_KEY]: m ?? undefined });
}

/** The record for this unit and round: memory first, else what's stored (e.g. after a reload). */
function current(meta: Record<string, unknown>, unitId: string, round?: number): MovementState | null {
  const ok = (m: MovementState | null) => !!m && m.unitId === unitId && (round === undefined || m.round === round);
  if (ok(mem)) return mem;
  const stored = readMovement(meta);
  return ok(stored) ? stored : null;
}

/** Keeps the record in step with the turn and the active token's position. Returns the current record. */
export const trackMovement = (meta: Record<string, unknown>, active: { id: string; round: number } | null) => serial(() => trackNow(meta, active));
async function trackNow(meta: Record<string, unknown>, active: { id: string; round: number } | null): Promise<MovementState | null> {
  if (!active) { if (mem || readMovement(meta)) await save(null); return null; }
  // Read the position now (inside the queue), not from an item list fetched before a Rewind ran.
  const [token] = await OBR.scene.items.getItems([active.id]);
  if (!token) return mem;
  let m = current(meta, active.id, active.round);
  if (!m) { m = startMovement(active.id, active.round, token.position); await save(m); return m; }
  const last = m.path[m.path.length - 1]!;
  if (last.x === token.position.x && last.y === token.position.y) { mem = m; return m; }
  m = addStep(m, token.position, await feet(last, token.position));
  await save(m);
  return m;
}

/** Rewind to the last 5 ft point: the record is updated first, so the token move that follows isn't counted. */
export const rewindActive = (meta: Record<string, unknown>, unitId: string) => serial(() => rewindNow(meta, unitId));
async function rewindNow(meta: Record<string, unknown>, unitId: string): Promise<boolean> {
  const m = current(meta, unitId);
  if (!m || !m.segments.length) return false;
  const r = rewind(m);
  await save(r.state);
  await OBR.scene.items.updateItems([unitId], (ds) => { for (const d of ds) d.position = r.position; });
  return true;
}

export const setDash = (meta: Record<string, unknown>, unitId: string, on: boolean) => serial(() => dashNow(meta, unitId, on));
async function dashNow(meta: Record<string, unknown>, unitId: string, on: boolean): Promise<boolean> {
  const m = current(meta, unitId);
  if (!m) return false;
  await save({ ...m, dash: on });
  return true;
}

export function resetMovementMemory() { mem = null; }
