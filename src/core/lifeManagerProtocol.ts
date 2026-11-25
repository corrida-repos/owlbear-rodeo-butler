/** Version 1 of the Life Manager / Encounter Butler file and clipboard protocol. */
export interface TacticalCondition {
  id: string;
  key: string;
  label?: string;
  level?: number;
  remainingSeconds?: number;
  turnBased?: boolean;
}

export interface TacticalVitals {
  hp: number;
  maxHp: number;
  tempHp: number;
  status: 'alive' | 'dying' | 'stable' | 'dead';
  successes: number;
  failures: number;
  conditions: TacticalCondition[];
}

export interface OpeningPosition {
  feature: string;
  cover?: 'half' | 'three-quarters';
  elevationFt?: number;
}

export function openingPositionText(position: OpeningPosition): string {
  const details = [
    position.cover === 'half' ? 'Half Cover (+2 AC and Dexterity saves)' :
      position.cover === 'three-quarters' ? 'Three-Quarters Cover (+5 AC and Dexterity saves)' : '',
    position.elevationFt ? `${position.elevationFt} ft above the party` : '',
  ].filter(Boolean);
  return `${details.join(' · ')} at ${position.feature}`;
}

export interface TacticalParticipant {
  id: string;
  name: string;
  side: 'party' | 'encounter';
  influencedAlly?: boolean;
  ddbId?: number;
  source?: string;
  creatureName?: string;
  surprised?: boolean;
  roadNetRestrained?: boolean;
  openingPosition?: OpeningPosition;
  initiative?: number;
  asleep?: boolean;
  vitals?: TacticalVitals;
}

export const FIGHT_OR_FLIGHT_DC = 10;
export type FightOrFlight =
  | { kind: 'committed' }
  | { kind: 'save'; leader: string; roll: number; modifier: number; dc?: number };

export function fightOrFlightText(decision: FightOrFlight): string {
  if (decision.kind === 'committed') return 'The creatures are committed to fighting.';
  const { leader, roll, modifier, dc = FIGHT_OR_FLIGHT_DC } = decision;
  const total = roll + modifier;
  return `${leader}: ${roll} ${modifier >= 0 ? '+' : '−'} ${Math.abs(modifier)} = ${total} vs. DC ${dc}. ${total >= dc ? 'They fight.' : 'They flee or try to parley.'}`;
}

export type StartingAttitude = 'Hostile' | 'Indifferent' | 'Friendly';
export const DISPOSITIONS = ['Avoided combat', 'Parleyed', 'Party withdrew', 'Creatures fled', 'Creatures surrendered', 'Creatures defeated', 'Encounter unresolved'] as const;
export type Disposition = typeof DISPOSITIONS[number];

export interface TacticalEncounter {
  schema: 'life-manager/encounter@1';
  campaignId?: string;
  id: string;
  at: number;
  title: string;
  activity: 'camp' | 'travel' | 'rest' | 'explore';
  place: string;
  distanceFt: number;
  context: string;
  attitude?: StartingAttitude;
  fightOrFlight?: FightOrFlight;
  rules: '2024';
  participants: TacticalParticipant[];
}

export interface TacticalResult {
  schema: 'life-manager/result@1';
  campaignId?: string;
  id: string;
  encounterId: string;
  elapsedSeconds: number;
  disposition?: Disposition;
  participants: { id: string; vitals: TacticalVitals }[];
}

type RecordValue = Record<string, unknown>;
const object = (x: unknown): x is RecordValue => !!x && typeof x === 'object' && !Array.isArray(x);
const str = (x: unknown): x is string => typeof x === 'string' && x.trim().length > 0 && x.length <= 4000;
const int = (x: unknown, min = 0, max = 1_000_000): x is number =>
  typeof x === 'number' && Number.isSafeInteger(x) && x >= min && x <= max;
const optional = (x: unknown, test: (value: unknown) => boolean) => x === undefined || test(x);
const bool = (x: unknown) => typeof x === 'boolean';
const unique = (xs: { id: string }[]) => new Set(xs.map((x) => x.id)).size === xs.length;

function condition(x: unknown): x is TacticalCondition {
  return object(x) && str(x.id) && str(x.key) && optional(x.label, str) &&
    optional(x.level, int) && optional(x.remainingSeconds, int) && optional(x.turnBased, bool);
}

export function validVitals(x: unknown): x is TacticalVitals {
  return object(x) && int(x.hp) && int(x.maxHp, 1) && x.hp <= x.maxHp && int(x.tempHp) &&
    ['alive', 'dying', 'stable', 'dead'].includes(String(x.status)) &&
    (x.status === 'alive' ? x.hp > 0 : x.hp === 0) &&
    int(x.successes, 0, 2) && int(x.failures, 0, 2) &&
    Array.isArray(x.conditions) && x.conditions.length <= 100 &&
    x.conditions.every(condition) && unique(x.conditions) &&
    x.conditions.filter((c) => c.key === 'exhaustion').every((c) => int(c.level, 1, 6)) &&
    x.conditions.filter((c) => c.key === 'exhaustion').length <= 1;
}

function validOpeningPosition(x: unknown): boolean {
  return object(x) && str(x.feature) &&
    optional(x.cover, (value) => value === 'half' || value === 'three-quarters') &&
    optional(x.elevationFt, (value) => int(value, 1, 1000)) &&
    (x.cover !== undefined || x.elevationFt !== undefined);
}

function participant(x: unknown): x is TacticalParticipant {
  return object(x) && str(x.id) && str(x.name) && ['party', 'encounter'].includes(String(x.side)) &&
    optional(x.ddbId, (value) => int(value, 1, Number.MAX_SAFE_INTEGER)) && optional(x.source, str) && optional(x.creatureName, str) &&
    optional(x.influencedAlly, bool) && (x.influencedAlly !== true || x.side === 'encounter') &&
    optional(x.openingPosition, validOpeningPosition) && (x.openingPosition === undefined || x.side === 'encounter') &&
    optional(x.roadNetRestrained, bool) && (x.roadNetRestrained !== true || x.side === 'party') &&
    optional(x.surprised, bool) && optional(x.initiative, (value) => int(value, -999, 999)) && optional(x.asleep, bool) && optional(x.vitals, validVitals);
}

function read(text: string): RecordValue {
  if (text.length > 1_000_000) throw new Error('The encounter file exceeds 1 MB.');
  let x: unknown;
  try { x = JSON.parse(text); } catch { throw new Error('Enter a valid JSON file.'); }
  if (!object(x)) throw new Error('Enter a valid encounter file.');
  return x;
}

/** Convert the original Life Manager export, before Butler returned results. */
function upgradePreviousEncounter(x: RecordValue): RecordValue {
  const e = object(x.environment) ? x.environment : {};
  const surprise = object(x.surprise) ? x.surprise : {};
  const attitude = object(x.attitude) ? x.attitude.attitude : undefined;
  const participants = Array.isArray(x.participants) && x.participants.length <= 300
    ? x.participants.map((p: unknown) => {
      if (!object(p)) return p;
      const creature = object(p.creature) ? p.creature : {};
      const exhaustion = int(p.exhaustion, 1, 6) ? [{ id: 'exhaustion', key: 'exhaustion', level: p.exhaustion }] : [];
      const vitals = int(p.hp) && int(p.maxHp, 1) && int(p.tempHp) ? {
        hp: p.hp, maxHp: p.maxHp, tempHp: p.tempHp,
        status: p.hp > 0 ? 'alive' : p.stable ? 'stable' : 'dying', successes: 0, failures: 0, conditions: exhaustion,
      } : undefined;
      return { id: p.id, name: p.name, side: p.side, ddbId: p.ddbId, surprised: p.surprised,
        asleep: p.resting, roadNetRestrained: p.roadNetRestrained, openingPosition: p.openingPosition, source: creature.source, creatureName: creature.name, vitals };
    }) : x.participants;
  return {
    schema: 'life-manager/encounter@1', id: x.encounterId, campaignId: x.campaignId, at: x.minute, title: x.summary,
    rules: x.rulesEdition, activity: e.activity, place: e.place || e.terrain, distanceFt: e.distanceFt, attitude,
    context: str(surprise.narrative) ? surprise.narrative : 'Earlier Life Manager encounter export.', participants,
  };
}

export function parseTacticalEncounter(text: string): TacticalEncounter {
  let x = read(text);
  if (x.format === 'life-manager.encounter' && x.version === 1) x = upgradePreviousEncounter(x);
  if (x.schema !== 'life-manager/encounter@1' || x.rules !== '2024' || !str(x.id) || !optional(x.campaignId, str) ||
      !int(x.at, 0, Number.MAX_SAFE_INTEGER) || !str(x.title) || !str(x.place) || !str(x.context) ||
      !['camp', 'travel', 'rest', 'explore'].includes(String(x.activity)) || !int(x.distanceFt) ||
      !optional(x.fightOrFlight, (value) => object(value) && (value.kind === 'committed' ||
        (value.kind === 'save' && str(value.leader) && int(value.roll, 1, 20) && int(value.modifier, -99, 99) && optional(value.dc, (dc) => int(dc, 1, 99))))) ||
      !optional(x.attitude, (value) => ['Hostile', 'Indifferent', 'Friendly'].includes(String(value))) ||
      !Array.isArray(x.participants) || !x.participants.length || x.participants.length > 300 ||
      !x.participants.every(participant) || !unique(x.participants)) {
    throw new Error('This is not a supported Life Manager encounter.');
  }
  return x as unknown as TacticalEncounter;
}

export function parseTacticalResult(text: string): TacticalResult {
  const x = read(text);
  if (x.schema !== 'life-manager/result@1' || !str(x.id) || !str(x.encounterId) || !optional(x.campaignId, str) ||
      !int(x.elapsedSeconds, 0, 86400) ||
      !optional(x.disposition, (value) => DISPOSITIONS.some((outcome) => outcome === value)) || !Array.isArray(x.participants) || x.participants.length > 300 ||
      !x.participants.every((p: unknown) => object(p) && str(p.id) && validVitals(p.vitals)) ||
      !unique(x.participants)) {
    throw new Error('This is not a supported Encounter Butler result.');
  }
  return x as unknown as TacticalResult;
}
