/**
 * Naval and aerial combat, run by the primary GM client while the room setting is on (rules: core/naval.ts):
 * - on every scene change, creatures in the air that can't stay up (Prone, speed 0, 2024 Incapacitated) start to fall;
 * - on each forward turn change: a falling creature drops another 500 ft at the end of its turn (rate of falling), a
 *   flier that didn't land in a strong wind falls, and crewed ships whose initiative came up take their turn.
 * Returns lines for the GM's notifications; everything also goes in the naval log.
 */
import type { TurnPoint } from "../core/conditions";
import { readNaval, shipsUpBetween, windGrounds } from "../core/naval";
import type { TrackerView } from "../core/tracker";
import { unitOf } from "../extension/chaseRun";
import { beginShipTurn, checkFalls, continueFall, navalCtx, nsay, saveNaval, startFall } from "../extension/navalRun";

export async function navalWatch(meta: Record<string, unknown>): Promise<string[]> {
  if (!Object.keys(readNaval(meta).aloft).length) return [];
  const x = await navalCtx();
  await checkFalls(x);
  if (x.lines.length) await saveNaval(x);
  return x.lines;
}

export async function navalTurnChanged(prev: TurnPoint, next: TurnPoint, v: TrackerView): Promise<string[]> {
  const x = await navalCtx(prev);
  if (!x.n.ships.length && !Object.keys(x.n.aloft).length) return [];
  const ended = unitOf(x, prev.turnId);
  const a = ended ? x.n.aloft[ended.id] : undefined;
  if (ended && a?.falling && x.n.rateOfFalling) await continueFall(x, ended.id);
  else if (ended && windGrounds(x.n.wind, a, ended.sheet.speed.hover)) await startFall(x, ended.id, "the strong wind: it didn't land by the end of its turn");
  const starting = unitOf(x, next.turnId);
  const sa = starting ? x.n.aloft[starting.id] : undefined;
  if (starting && sa?.falling && starting.sheet.speed.fly && starting.state.conditions.some((c) => c.key === "prone"))
    nsay(x, `${starting.name} starts its turn still falling (${sa.ft} ft up): it can halt the fall by spending half its fly speed (DM Tools → Ships and sky → Halt).`);
  const init = (id: string) => v.order.find((u) => u.id === id)?.initiative ?? null;
  for (const s of shipsUpBetween(x.n.ships, init(prev.turnId), init(next.turnId), next.round > prev.round)) beginShipTurn(x, s.id);
  if (x.lines.length) await saveNaval(x);
  return x.lines;
}
