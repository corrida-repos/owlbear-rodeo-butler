import { BUTLER_NS } from "./constants";
import type { ConditionInstance, UnitSheet } from "./sheet";
import type { RollMode } from "./schema";

export const MARTIAL_QUEUE = `${BUTLER_NS}/martial-queue`;
export const MARTIAL_STATE = `${BUTLER_NS}/martial-state`;
export const PARTS = {
  leg: ["Leg", "Walking Speed −10 ft. (minimum 0) through the end of the target's next turn."],
  arm: ["Weapon arm, claw or jaw", "Disadvantage on the next attack using that part through the end of the target's next turn."],
  wing: ["Wing", "Fly Speed −10 ft. (minimum 5 ft. if it was at least 5 ft.) through the end of the target's next turn."],
  eye: ["Eye or sensory organ", "Disadvantage on the next attack relying on that sense through the end of the target's next turn."],
  neck: ["Neck", "No reactions until the start of the target's next turn."],
  special: ["Stat-block part", "Use the creature's own rules for AC, HP, damage and effects."],
} as const;
export type Part = keyof typeof PARTS;

export const HOLDS = {
  choke: ["Choke", "Blocks speech and verbal spell components. Suffocation starts on your next turn if maintained."],
  body: ["Body Pin", "You and the target are both Restrained."],
  arms: ["Arm Pin", "Locks both arms. The target can't attack with either arm, benefit from a shield, manipulate items or provide somatic components."],
  steal: ["Item Steal", "Take one held, unsecured item and release your grapple on success."],
} as const;
export type Hold = Exclude<keyof typeof HOLDS, "steal">;

export type MartialMove =
  | { op: "shot"; part: Part; detail: string; attack: string; mode: RollMode }
  | { op: "grapple" | "escape" | "release" | "downgrade" | "bind" | "untie" }
  | { op: "shoot-ropes"; attack: string; mode: RollMode }
  | { op: "rescue"; ally: string }
  | { op: "advance"; hold: keyof typeof HOLDS; detail: string };

export interface MartialEntry {
  id: string;
  actor: string;
  target: string;
  round: number;
  move: MartialMove;
}

export interface Grapple {
  id: string;
  actor: string;
  round: number;
  dc: number;
  reach: number;
  hold?: Hold;
  holdRound?: number;
  chokeRound?: number;
  suffocating?: boolean;
  breathless?: boolean;
  rounds?: number;
  lastTick?: number;
  exhaustion?: number;
}

export interface MartialState {
  grapples?: Grapple[];
  shotRound?: number;
  binding?: { id: string; hold: "body" | "arms"; hp?: number };
  parts?: Record<string, number>;
  injuries?: { id: string; rests: number }[];
}

export const readMartial = (meta: Record<string, unknown>): MartialState =>
  (meta[MARTIAL_STATE] as MartialState | undefined) ?? {};
export const readMartialQueue = (meta: Record<string, unknown>): MartialEntry[] =>
  Array.isArray(meta[MARTIAL_QUEUE]) ? meta[MARTIAL_QUEUE] as MartialEntry[] : [];

export function isMartialMove(value: unknown): value is MartialMove {
  if (!value || typeof value !== "object") return false;
  const move = value as MartialMove;
  if (move.op === "shot") return Object.hasOwn(PARTS, move.part) && typeof move.detail === "string" && move.detail.length <= 80
    && typeof move.attack === "string" && move.attack.length <= 160 && ["normal", "advantage", "disadvantage"].includes(move.mode);
  if (move.op === "shoot-ropes") return typeof move.attack === "string" && move.attack.length <= 160 && ["normal", "advantage", "disadvantage"].includes(move.mode);
  if (move.op === "rescue") return typeof move.ally === "string" && move.ally.length <= 80;
  if (move.op === "advance") return Object.hasOwn(HOLDS, move.hold) && typeof move.detail === "string" && move.detail.length <= 80;
  return ["grapple", "escape", "release", "downgrade", "bind", "untie"].includes(move.op);
}

export function injuryText(part: Part, permanent: boolean): string {
  switch (part) {
    case "leg": return permanent ? "Walking Speed halved for a two-legged creature. GM sets the effect for other anatomies." : "Walking Speed −10 ft., minimum 5 ft. if the target could walk.";
    case "arm": return permanent ? "Actions requiring this specific limb are unavailable." : "Disadvantage on attack rolls that use this specific part.";
    case "wing": return permanent ? "Loses its Fly Speed if it needs this wing to fly." : "Fly Speed halved.";
    case "eye": return permanent ? "Disadvantage on sight-based Perception. Blinded if this was its last usable eye and it relies on sight." : "Disadvantage on sight-based Perception.";
    case "neck": return "Voice carries only 10 feet. Verbal spell components remain possible once the brief loss of speech ends.";
    default: return "";
  }
}

export const grappleConditionId = (g: Grapple) => `martial:${g.id}:grappled`;
export const holdConditionId = (g: Grapple) => `martial:${g.id}:hold`;
export const isMartialLink = (c: ConditionInstance) => c.id.startsWith("martial:") && (c.id.endsWith(":grappled") || c.id.endsWith(":hold"));
export const canAdvance = (g: Grapple, round: number) => g.round < round;
export const suffocationRounds = (constitutionModifier: number) => Math.max(3, constitutionModifier);

export const SUFFOCATING_2014 = "martial:suffocating-2014";
export const cannotRecoverHp = (state: { conditions: ConditionInstance[] }) => state.conditions.some((c) => c.id === SUFFOCATING_2014);

export function martialSpeeds<T extends { walk: number; fly?: number }>(speed: T, conditions: ConditionInstance[]): T {
  const has = (prefix: string) => conditions.some((c) => c.id.startsWith(prefix));
  const longLeg = conditions.find((c) => c.id.startsWith("martial:injury:leg:"));
  const longWing = conditions.find((c) => c.id.startsWith("martial:injury:wing:"));
  const shortLeg = has("martial:short:leg:");
  const shortWing = has("martial:short:wing:");
  const capped = (value: number, by: number, floor: number) => Math.min(value, Math.max(floor, value - by));
  let walk = speed.walk;
  let fly = speed.fly;
  if (longLeg?.label?.startsWith("Permanent")) walk = Math.floor(walk / 2);
  else if (longLeg) walk = capped(walk, 10, 5);
  if (shortLeg && !longLeg) walk = capped(walk, 10, 0);
  if (fly !== undefined) {
    if (longWing?.label?.startsWith("Permanent")) fly = 0;
    else if (longWing) fly = Math.floor(fly / 2);
    else if (shortWing) fly = capped(fly, 10, 5);
  }
  return { ...speed, walk, fly };
}

export function chokeTurn(
  grapple: Grapple, target: string, previous: { round: number; turnId: string }, next: { round: number; turnId: string },
  rules: "2014" | "2024", constitutionModifier: number,
): "start" | "tick" | "drop" | undefined {
  if (grapple.hold !== "choke" || grapple.breathless || grapple.chokeRound === undefined) return;
  if (!grapple.suffocating) {
    if (next.turnId === grapple.actor && next.round >= grapple.chokeRound) return "start";
    return;
  }
  if (previous.turnId === target && previous.round > (grapple.lastTick ?? 0)) return "tick";
  if (rules === "2014" && next.turnId === target && (grapple.rounds ?? 0) >= suffocationRounds(constitutionModifier)) return "drop";
}

export function martialActionWarning(action: { cost: string; category: string; text: string }, conditions: ConditionInstance[]): string | undefined {
  const bound = conditions.some((c) => c.label === HOLDS.arms[0] || c.label === "Arms Bound");
  const mute = conditions.some((c) => c.label === HOLDS.choke[0] || c.id === "martial:speech-lost");
  if (action.cost === "reaction" && conditions.some((c) => c.id.startsWith("martial:short:neck:"))) return "A neck called shot prevents reactions.";
  if (action.category !== "spell" || !bound && !mute) return;
  const components = /\bComponents:\s*([VSM](?:\s*,\s*[VSM])*)/i.exec(action.text)?.[1]?.toUpperCase() ?? "";
  if (mute && components.includes("V")) return "This hold or injury prevents verbal spell components.";
  if (bound && /[SM]/.test(components)) return "This hold prevents somatic components and handling spell materials.";
  if (!components) return "Check spell components against the active hold or injury.";
}

export const ROPE_HP = 2;
export const ropeAc = (hold: "body" | "arms") => hold === "body" ? 13 : 15;
export const ropeThreatensAlly = (total: number, natural: number | undefined, ac: number) =>
  natural !== 1 && natural !== 20 && Math.abs(total - ac) <= 2;

export function martialArmorClass(sheet: Pick<UnitSheet, "ac" | "acNote" | "inventory" | "shieldAcBonus" | "gear">, conditions: ConditionInstance[]): number {
  if (!conditions.some((c) => c.id.startsWith("martial:") && (c.label === HOLDS.arms[0] || c.label === "Arms Bound"))) return sheet.ac;
  const equipped = sheet.inventory.find((i) => /\bshield\b.*\(equipped\)/i.test(i.name));
  const shield = equipped?.name ?? sheet.gear?.find((i) => /\bshield\b/i.test(i)) ?? sheet.acNote ?? "";
  const bonus = sheet.shieldAcBonus ?? (/\bshield\b/i.test(shield) ? 2 + Number(/\+(\d+)\b/.exec(shield)?.[1] ?? 0) : 0);
  return sheet.ac - bonus;
}

export interface Displacement { x: number; y: number }
export const isDisplacement = (v: unknown): v is Displacement => {
  const p = v as Displacement | null;
  return !!p && typeof p.x === "number" && typeof p.y === "number" && Math.abs(p.x) <= 1000 && Math.abs(p.y) <= 1000;
};
export const moves = (p: Displacement) => p.x !== 0 || p.y !== 0;
export const movesOppositely = (a: Displacement, b: Displacement) => a.x * b.x + a.y * b.y < 0;
