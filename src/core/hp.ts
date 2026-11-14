/**
 * Hit points (F6) and the 0-HP statuses Butler manages ahead of the rest of F11: Death Saves, Stable and Dead.
 * Pure: each function returns a state patch (a key set to `undefined` means "remove it") plus events for the UI.
 *
 * Rules (same in 2014 and 2024 unless noted):
 *  - Damage removes temporary HP first. Temp HP doesn't stack: the higher value is kept.
 *  - Healing can't go above max HP. A unit at 0 HP that is healed stops making death saves (and loses Stable).
 *  - Damage to a party member already at 0 HP is a death save failure (two on a critical hit). Damage while Stable
 *    removes Stable and death saves resume. Damage at 0 HP that equals or exceeds max HP kills outright (massive
 *    damage); Butler offers Mark as dead rather than doing it silently.
 *  - Death save: 10+ succeeds, a natural 1 counts as two failures, a natural 20 restores 1 HP. Three successes:
 *    Stable. Three failures: dead (tracker.ts marks the unit dead), as is massive damage taken while already at 0 HP.
 *  - Any healing above 0 HP brings the unit back at once: death saves, Stable and the 0 HP prompt end.
 *  - Any unit dropping to 0 HP from above is flagged `zeroHpPending`: its controller chooses Dead, Death saves, Stable
 *    or Alive (see zeroHpChoicePatch). Until then a party member is on death saves (the rules' default) and a creature
 *    is simply at 0 HP. Death saves aren't only for the party: a creature put on them follows the same rules.
 */
import { maxHp, type ConditionInstance, type UnitSheet, type UnitState } from "./sheet";
import { DND5E_2024, isDead, isStable, type GameSystem } from "./systems";

export type HpChange =
  | { kind: "damage"; amount: number; critical?: boolean }
  | { kind: "heal"; amount: number }
  | { kind: "set"; amount: number }
  | { kind: "temp"; amount: number };

/** "-7" damage, "+5" heal, "12" or "=12" set, "t5" / "temp 5" temporary HP. Null if it isn't one of those. */
export function parseHpInput(raw: string): HpChange | null {
  const s = raw.trim().toLowerCase().replace(/\s+/g, "");
  let m: RegExpExecArray | null;
  if ((m = /^-(\d{1,5})$/.exec(s))) return { kind: "damage", amount: Number(m[1]) };
  if ((m = /^\+(\d{1,5})$/.exec(s))) return { kind: "heal", amount: Number(m[1]) };
  if ((m = /^=?(\d{1,5})$/.exec(s))) return { kind: "set", amount: Number(m[1]) };
  if ((m = /^t(?:emp)?(\d{1,5})$/.exec(s))) return { kind: "temp", amount: Number(m[1]) };
  return null;
}

export type HpEvent =
  | "dropped-to-zero"        // reached 0 HP from above
  | "death-save-failure"     // damaged while at 0 HP (party)
  | "three-failures"         // death saves: offer Mark as dead
  | "massive-damage"         // damage at 0 HP ≥ max HP: offer Mark as dead
  | "stable-lost"
  | "revived-from-zero"      // healed above 0 HP: death saves / Stable cleared
  | "creature-at-zero"       // a non-party unit at 0 HP: offer Mark as dead (or automatic, by setting)
  | "concentration-check"    // damaged while concentrating: Con save pending (state.concentrationCheck)
  | "concentration-lost"     // dropped to 0 HP while concentrating: Concentration ends
  | "wild-shape-ended";      // a druid's beast form ended at 0 HP (see wildshape.ts)

export interface HpResult { patch: Partial<UnitState>; events: HpEvent[] }

type S = Pick<UnitState, "hp" | "tempHp" | "maxHpOverride" | "party" | "conditions" | "deathSaves" | "concentrationCheck" | "zeroHpPending">;

const without = (conds: ConditionInstance[], key: string) => conds.filter((c) => c.key !== key);
const ZERO = { successes: 0, failures: 0 };

export function applyHp(sheet: Pick<UnitSheet, "hp">, state: S, change: HpChange, system: Pick<GameSystem, "concentrationDc"> = DND5E_2024): HpResult {
  const max = maxHp(sheet, state);
  const events: HpEvent[] = [];
  const patch: Partial<UnitState> = {};
  const n = Math.max(0, Math.floor(change.amount));

  if (change.kind === "temp") {
    patch.tempHp = n === 0 ? 0 : Math.max(state.tempHp, n);
    return { patch, events };
  }

  let hp = state.hp;
  let conditions = state.conditions;
  let deathSaves = state.deathSaves;

  if (change.kind === "damage") {
    if (n === 0) return { patch, events };
    const absorbed = Math.min(state.tempHp, n);
    if (absorbed) patch.tempHp = state.tempHp - absorbed;
    const rest = n - absorbed;
    if (rest > 0) {
      if (hp > 0) {
        const overflow = rest - hp;
        hp = Math.max(0, hp - rest);
        if (hp === 0 && !isDead(state)) {
          events.push(state.party ? "dropped-to-zero" : "creature-at-zero");
          if (state.party && overflow >= max && !isDead(state)) events.push("massive-damage");
        }
      } else if ((state.party || state.deathSaves) && !isDead(state)) {
        if (rest >= max) events.push("massive-damage");
        if (isStable(state)) { conditions = without(conditions, "stable"); events.push("stable-lost"); deathSaves = { ...ZERO }; }
        const ds = deathSaves ?? ZERO;
        deathSaves = { ...ds, failures: Math.min(3, ds.failures + (change.critical ? 2 : 1)) };
        events.push("death-save-failure");
        if (deathSaves.failures >= 3) events.push("three-failures");
      }
    }
  } else {
    const target = change.kind === "heal" ? Math.min(max, hp + n) : Math.min(max, n);
    if (state.hp <= 0 && target > 0) {
      if (deathSaves || isStable(state)) events.push("revived-from-zero");
      deathSaves = undefined;
      if (state.zeroHpPending) patch.zeroHpPending = undefined;
      if (isStable(state)) conditions = without(conditions, "stable");
    } else if (state.hp > 0 && target === 0 && !isDead(state)) {
      events.push(state.party ? "dropped-to-zero" : "creature-at-zero");
    }
    hp = target;
  }

  // Concentration: damage calls for a Constitution save (DC from the system); 0 HP ends it (Incapacitated).
  if (change.kind === "damage" && n > 0 && !isDead(state) && conditions.some((c) => c.key === "concentration")) {
    if (hp === 0) { conditions = without(conditions, "concentration"); events.push("concentration-lost"); patch.concentrationCheck = undefined; }
    else { patch.concentrationCheck = { dc: system.concentrationDc(n), damage: n }; events.push("concentration-check"); }
  }

  if (hp !== state.hp) patch.hp = hp;
  if (conditions !== state.conditions) patch.conditions = conditions;
  if (deathSaves !== state.deathSaves) patch.deathSaves = deathSaves;
  if (hp === 0 && state.hp > 0 && !isDead(state)) {
    if (state.party) patch.deathSaves = { ...ZERO };
    patch.zeroHpPending = true;
  }
  return { patch, events };
}

export type DeathSaveOutcome = "success" | "failure" | "two-failures" | "regain-1-hp" | "stable" | "dead";

/** Applies a death saving throw with the given natural d20. */
export function applyDeathSave(state: S, natural: number): { patch: Partial<UnitState>; outcome: DeathSaveOutcome } {
  const r = deathSaveResult(state, natural);
  // Rolling a death save answers the 0-HP prompt (Death saves).
  return state.zeroHpPending ? { ...r, patch: { ...r.patch, zeroHpPending: undefined } } : r;
}

function deathSaveResult(state: S, natural: number): { patch: Partial<UnitState>; outcome: DeathSaveOutcome } {
  const ds = state.deathSaves ?? ZERO;
  if (natural >= 20) return { patch: { hp: 1, deathSaves: undefined, conditions: without(state.conditions, "stable") }, outcome: "regain-1-hp" };
  if (natural >= 10) {
    const successes = ds.successes + 1;
    if (successes >= 3) return { patch: { deathSaves: { ...ZERO }, conditions: [...without(state.conditions, "stable"), condition("stable")] }, outcome: "stable" };
    return { patch: { deathSaves: { ...ds, successes } }, outcome: "success" };
  }
  const failures = Math.min(3, ds.failures + (natural <= 1 ? 2 : 1));
  return { patch: { deathSaves: { ...ds, failures } }, outcome: failures >= 3 ? "dead" : natural <= 1 ? "two-failures" : "failure" };
}

/**
 * Death save counters set by hand (the player rolled at the table, or a correction): each 0–3. Three successes make
 * the unit Stable, as a rolled third success would; three failures are reported ("dead") and the unit dies.
 */
export function setDeathSaveCounts(state: S, successes: number, failures: number): { patch: Partial<UnitState>; outcome: "set" | "stable" | "dead" } {
  const clamp = (n: number) => Math.max(0, Math.min(3, Math.floor(Number(n) || 0)));
  const s = clamp(successes), f = clamp(failures);
  const pending = state.zeroHpPending ? { zeroHpPending: undefined } : {};
  if (s >= 3) return { patch: { deathSaves: { ...ZERO }, conditions: [...without(state.conditions, "stable"), condition("stable")], ...pending }, outcome: "stable" };
  return { patch: { deathSaves: { successes: s, failures: f }, ...pending }, outcome: f >= 3 ? "dead" : "set" };
}

let counter = 0;
/** A new condition instance (id unique within this session; ids only need to be unique per unit). */
export function condition(key: string, extra: Partial<ConditionInstance> = {}): ConditionInstance {
  counter = (counter + 1) % 1e6;
  return { id: `${key}-${Date.now().toString(36)}-${counter.toString(36)}`, key, ...extra };
}

/** Mark as dead (F10): Dead replaces Death Saves and Stable, and the unit leaves initiative. */
export function markDead(state: Pick<UnitState, "conditions">): Partial<UnitState> {
  if (isDead(state)) return { inEncounter: false, zeroHpPending: undefined };
  return { conditions: [...without(without(state.conditions, "stable"), "dead"), condition("dead")], deathSaves: undefined, inEncounter: false, zeroHpPending: undefined };
}

/** Revive: removes Dead. The unit can then be added back to initiative. */
export function revive(state: Pick<UnitState, "conditions">): Partial<UnitState> {
  return { conditions: without(state.conditions, "dead") };
}

/** Stable set by hand on a party member at 0 HP: supersedes Death Saves (counters reset; stays in initiative). */
export function setStable(state: Pick<UnitState, "conditions" | "hp" | "party" | "deathSaves">): Partial<UnitState> {
  if (state.hp > 0 || !(state.party || state.deathSaves)) throw new Error("Only a unit at 0 HP making death saves can be made Stable this way.");
  return { conditions: [...without(state.conditions, "stable"), condition("stable")], deathSaves: state.party ? { ...ZERO } : undefined, zeroHpPending: undefined };
}

/**
 * The 0-HP statuses as conditions you can set by hand ("Change status"): Dead, Stable, Death Saves, or none of them.
 *  - Dead: as markDead.
 *  - Stable: 0 HP, no death saves (any unit: a creature knocked out rather than killed is Stable too).
 *  - Death Saves: at 0 HP making death saving throws (counters reset). Any unit: a creature can make them too.
 *  - none: clears Dead and Stable; a party member still at 0 HP goes back to death saves.
 * Any of them answers a pending 0-HP prompt.
 * Dropping to 0 HP this way also ends Concentration, as damage would.
 */
export type LifeStatus = "dead" | "stable" | "dying" | "none";

export function lifeStatusPatch(state: Pick<UnitState, "conditions" | "hp" | "party" | "deathSaves" | "zeroHpPending">, to: LifeStatus): Partial<UnitState> {
  const p = lifeStatus(state, to);
  return state.zeroHpPending ? { ...p, zeroHpPending: undefined } : p;
}

function lifeStatus(state: Pick<UnitState, "conditions" | "hp" | "party" | "deathSaves">, to: LifeStatus): Partial<UnitState> {
  if (to === "dead") return markDead(state);
  const base = without(without(state.conditions, "dead"), "stable");
  const toZero = (conds: ConditionInstance[]): Partial<UnitState> => state.hp > 0
    ? { hp: 0, conditions: without(conds, "concentration"), concentrationCheck: undefined }
    : { conditions: conds };
  if (to === "stable") return { ...toZero([...base, condition("stable")]), deathSaves: state.party ? { ...ZERO } : undefined };
  if (to === "dying") return { ...toZero(base), deathSaves: { ...ZERO } };
  return { conditions: base, deathSaves: state.party && state.hp <= 0 ? { ...ZERO } : undefined };
}

/**
 * The controller's answer when a unit drops to 0 HP:
 *  - dead: Mark as dead (out of initiative).
 *  - dying: Death saves (any unit). Counters already running (a party member hit again before choosing) are kept.
 *  - stable: 0 HP, unconscious but not dying.
 *  - alive: it stays up after all (Relentless Endurance, Undead Fortitude, the GM's call): back to 1 HP.
 */
export type ZeroHpChoice = "dead" | "dying" | "stable" | "alive";
export const ZERO_HP_CHOICES: ZeroHpChoice[] = ["dead", "dying", "stable", "alive"];

export function zeroHpChoicePatch(state: Pick<UnitState, "conditions" | "hp" | "party" | "deathSaves" | "zeroHpPending">, choice: ZeroHpChoice): Partial<UnitState> {
  if (choice === "alive") {
    return { hp: Math.max(1, state.hp), conditions: without(without(state.conditions, "dead"), "stable"), deathSaves: undefined, zeroHpPending: undefined };
  }
  const p = lifeStatusPatch(state, choice);
  if (choice === "dying" && state.deathSaves && state.hp <= 0) p.deathSaves = { ...state.deathSaves };
  return { ...p, zeroHpPending: undefined };
}

export const ZERO_HP_LABEL: Record<ZeroHpChoice, string> = { dead: "💀 Dead", dying: "🎲 Death saves", stable: "🛌 Stable", alive: "💪 Alive" };
export const ZERO_HP_HINT: Record<ZeroHpChoice, string> = {
  dead: "It dies: marked Dead and taken out of initiative",
  dying: "Unconscious and dying: it makes death saving throws (roll them here, or track rolls made at the table)",
  stable: "Unconscious at 0 HP but not dying: no death saves",
  alive: "It stays up after all (Relentless Endurance, Undead Fortitude, the GM's call): back to 1 HP",
};
/** "<name> …" for notifications. */
export const ZERO_HP_TEXT: Record<ZeroHpChoice, string> = { dead: "is dead", dying: "makes death saves", stable: "is Stable", alive: "stays up with 1 HP" };
