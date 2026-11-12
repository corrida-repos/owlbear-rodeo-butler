/**
 * Conditions and status effects (F11): adding/removing, exhaustion levels, custom effects, durations that expire on
 * turn changes, concentration checks, and the short badge text shown on tokens. Pure functions over UnitState.
 *
 * Durations (ConditionInstance.until), all relative to when the condition was applied (`from`):
 *  - { rounds: N }: ends when the initiative order reaches the same point N rounds later (start of that turn).
 *  - { turnOf: X, at: "start" }: ends at the first start of X's turn after it was applied.
 *  - { turnOf: X, at: "end" }: ends at the end of X's next turn (applied during X's own turn → the following one).
 */
import type { ConditionInstance, UnitState } from "./sheet";
import type { GameSystem } from "./systems";
import { condition } from "./hp";
import { isGrappleKey } from "./grapple";

export interface TurnPoint { round: number; turnId: string }

export type Duration =
  | { kind: "none" }
  | { kind: "rounds"; rounds: number }
  | { kind: "turn"; turnOf: string; at: "start" | "end" };

/** Adds (or replaces) a condition. Exhaustion keeps one instance with a level; others are one per key (custom: per label). */
export function addCondition(
  state: Pick<UnitState, "conditions">,
  key: string,
  opts: { label?: string; note?: string; level?: number; duration?: Duration; now?: TurnPoint | null; with?: string } = {},
): Partial<UnitState> {
  // Custom effects are one per label; Grappling / Grappled one per partner (a creature can hold or be held by two).
  const same = (c: ConditionInstance) => c.key === key
    && (key !== "custom" || (c.label ?? "").toLowerCase() === (opts.label ?? "").toLowerCase())
    && (!isGrappleKey(key) || (c.with ?? "") === (opts.with ?? ""));
  const rest = state.conditions.filter((c) => !same(c));
  const d = opts.duration ?? { kind: "none" };
  const until: ConditionInstance["until"] | undefined =
    d.kind === "rounds" && d.rounds > 0 && opts.now ? { rounds: d.rounds, turnOf: opts.now.turnId, at: "start" }
      : d.kind === "turn" && opts.now ? { turnOf: d.turnOf, at: d.at }
        : undefined;
  const inst = condition(key, {
    ...(opts.label ? { label: opts.label.trim() } : {}),
    ...(opts.note ? { note: opts.note.trim() } : {}),
    ...(key === "exhaustion" ? { level: Math.min(6, Math.max(1, Math.round(opts.level ?? 1))) } : {}),
    ...(until ? { until, from: opts.now! } : {}),
    ...(opts.with && isGrappleKey(key) ? { with: opts.with } : {}),
  } as Partial<ConditionInstance>);
  return { conditions: [...rest, inst] };
}

export function removeCondition(state: Pick<UnitState, "conditions">, id: string): Partial<UnitState> {
  return { conditions: state.conditions.filter((c) => c.id !== id) };
}

/** Exhaustion level (0 if none). */
export const exhaustionLevel = (state: Pick<UnitState, "conditions">) =>
  state.conditions.find((c) => c.key === "exhaustion")?.level ?? 0;

/** 2024 rules: d20 tests take −2 per exhaustion level (2014: no flat penalty; the effects table applies instead). */
export const d20Penalty = (system: Pick<GameSystem, "rules">, state: Pick<UnitState, "conditions">) =>
  system.rules === "2024" ? -2 * exhaustionLevel(state) : 0;

/** 2024 rules: speed −5 ft per exhaustion level. */
export const speedPenalty = (system: Pick<GameSystem, "rules">, state: Pick<UnitState, "conditions">) =>
  system.rules === "2024" ? 5 * exhaustionLevel(state) : 0;

/** 2014 exhaustion effects by level (PHB appendix A), cumulative. */
export const EXHAUSTION_2014 = [
  "Disadvantage on ability checks",
  "Speed halved",
  "Disadvantage on attack rolls and saving throws",
  "Hit point maximum halved",
  "Speed reduced to 0",
  "Death",
];

export interface Expired { unitId: string; condition: ConditionInstance }

/** Order position of a turn, for "has this point passed?" comparisons. */
type Pos = (turnId: string) => number;

/**
 * Conditions that end because the turn moved from `prev` to `next` (one step; a Next turn or a passed turn).
 * `position` gives a unit's index in the current order (−1 if it left).
 */
export function expiredOnTurnChange(
  units: { id: string; state: Pick<UnitState, "conditions"> }[],
  prev: TurnPoint | null,
  next: TurnPoint,
  position: Pos,
): Expired[] {
  const out: Expired[] = [];
  for (const u of units) {
    for (const c of u.state.conditions) {
      const until = c.until;
      const from = c.from;
      if (!until || !from) continue;
      if (until.rounds) {
        // Same point in the order N rounds later: the turn of the unit that was active when it was applied.
        const target = from.round + until.rounds;
        const startingAt = until.turnOf ?? from.turnId;
        const reached = next.round > target
          || (next.round === target && (next.turnId === startingAt || position(next.turnId) > position(startingAt)));
        if (reached) out.push({ unitId: u.id, condition: c });
      } else if (until.turnOf && until.at === "start") {
        if (next.turnId === until.turnOf && !(next.round === from.round && next.turnId === from.turnId)) out.push({ unitId: u.id, condition: c });
      } else if (until.turnOf && until.at === "end") {
        if (prev && prev.turnId === until.turnOf && !(prev.round === from.round && prev.turnId === from.turnId)) out.push({ unitId: u.id, condition: c });
      }
    }
  }
  return out;
}

/** "Prone", "Exhaustion 2", "Hexed" (custom), "Poisoned (2 rounds)". */
export function conditionText(c: ConditionInstance, system: Pick<GameSystem, "conditions">): string {
  const base = c.key === "custom" ? c.label ?? "Effect" : c.label ?? system.conditions.find((d) => d.key === c.key)?.label ?? c.key;
  return `${base}${c.level ? ` ${c.level}` : ""}`;
}

export function durationText(c: ConditionInstance, nameOf: (id: string) => string): string {
  const u = c.until;
  if (!u) return "";
  if (u.rounds) return `${u.rounds} round${u.rounds === 1 ? "" : "s"}`;
  if (u.turnOf) return u.at === "end" ? `until the end of ${nameOf(u.turnOf)}'s next turn` : `until the start of ${nameOf(u.turnOf)}'s turn`;
  return "";
}

/** Short text for the badge under a token: up to three conditions, then "+N". */
export function badgeText(labels: string[]): string {
  if (!labels.length) return "";
  const shown = labels.slice(0, 3).join(" · ");
  return labels.length > 3 ? `${shown} +${labels.length - 3}` : shown;
}

/** Whether the unit is concentrating. */
export const isConcentrating = (state: Pick<UnitState, "conditions">) => state.conditions.some((c) => c.key === "concentration");
