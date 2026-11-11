/**
 * The initiative tracker's data and GM operations (F4, F5, F6, F10), on top of the SceneGateway so they run against
 * Owlbear or the in-memory test scene. Turn logic is in encounter.ts, HP rules in hp.ts.
 */
import { BUTLER_NS } from "./constants";
import { abilityMod, maxHp, STATE_KEY, type UnitSheet, type UnitState } from "./sheet";
import { cryptoRng, resolveRollMode, rollInitiative, type Rng } from "./dice";
import {
  activeAndNext, compareOrder, endCombat, ENCOUNTER_KEY, moveInTie, nextTurn, passTurnFrom, previousTurn, readEncounter, startCombat,
  turnOrder, waitingForInitiative, type EncounterState, type OrderUnit,
} from "./encounter";
import { applyHp, condition, hpLogEntry, markDead, revive, setStable, undoHpPatch, withHpLog, type HpChange, type HpEvent } from "./hp";
import type { SceneGateway, SceneItemLite } from "./importer";
import { initiativeSetupFor } from "./combat";
import { addCondition, conditionText, expiredOnTurnChange, removeCondition, type Duration, type TurnPoint } from "./conditions";
import { isDead, type GameSystem } from "./systems";
import { isUnitItem, readUnit } from "./unit";
import { unitName } from "./card";
import { finishRevert, readWildShape, revertIfIncapacitated, wildShapeHp } from "./wildshape";

export interface TrackerUnit extends OrderUnit {
  sheet: UnitSheet;
  state: UnitState;
  party: boolean;
  hidden: boolean;
  dead: boolean;
  imageUrl?: string;
  hp: number;
  maxHp: number;
  tempHp: number;
  ac: number;
}

export function trackerUnits(items: SceneItemLite[]): TrackerUnit[] {
  return items.filter(isUnitItem).flatMap((i) => {
    const u = readUnit(i.metadata);
    if (!u) return [];
    const { sheet, state } = u;
    return [{
      id: i.id,
      name: unitName(i, sheet, state),
      initiative: state.initiative,
      initMod: sheet.initiative.modifier,
      dex: sheet.abilities.dex,
      tiebreak: state.initiativeTiebreak,
      inEncounter: state.inEncounter,
      sheet, state,
      party: state.party,
      hidden: i.visible === false,
      dead: isDead(state),
      imageUrl: state.portraitUrl || i.image?.url,
      hp: state.hp, maxHp: maxHp(sheet, state), tempHp: state.tempHp, ac: sheet.ac,
    }];
  });
}

/**
 * Lair actions: a turn of its own on initiative count 20, losing ties, while a creature in the fight is in its lair and
 * has lair actions. It isn't a token, so it only exists in `turns` (the encounter steps through `turns`).
 */
export const LAIR_TURN_ID = "butler-lair";
export interface LairTurn extends OrderUnit { lair: true; units: TrackerUnit[] }
export type TurnEntry = TrackerUnit | LairTurn | WorldTurnEntry;
export const isLairTurn = (t: TurnEntry | OrderUnit | undefined): t is LairTurn => !!t && (t as LairTurn).lair === true;

export function lairTurn(order: TrackerUnit[]): LairTurn | null {
  const units = order.filter((u) => !u.dead && u.state.inLair && (u.sheet.lair?.length ?? 0) > 0);
  if (!units.length) return null;
  // Loses initiative ties: below any unit's tie-break, modifier and Dexterity.
  return { id: LAIR_TURN_ID, name: "Lair actions", initiative: 20, initMod: -1e6, dex: -1e6, tiebreak: -1e9, inEncounter: true, lair: true, units };
}

/**
 * World turns: slots the GM adds to the order by hand (lair actions without a stat block, a collapsing ceiling, a
 * storm, reinforcements…), as a reminder to resolve those effects. Not tokens: they live in scene metadata, stay
 * across fights in the scene until removed, and lose initiative ties like lair actions.
 */
export const WORLD_KEY = `${BUTLER_NS}/worldTurns`;
export interface WorldTurn {
  id: string;
  name: string;
  initiative: number;
  /** What to resolve, shown in the tracker and in the GM's notice. */
  note?: string;
  /** Players see it in their initiative order (off: a GM-only reminder). */
  shown?: boolean;
}
export interface WorldTurnEntry extends OrderUnit { world: true; turn: WorldTurn }
export const isWorldTurn = (t: TurnEntry | OrderUnit | undefined): t is WorldTurnEntry => !!t && (t as WorldTurnEntry).world === true;
/** Lair or world turn: a slot in the order without a token. */
export const isTokenlessTurn = (t: TurnEntry | OrderUnit | undefined): t is LairTurn | WorldTurnEntry => isLairTurn(t) || isWorldTurn(t);

const isWorldTurnData = (x: any): x is WorldTurn => !!x && typeof x.id === "string" && typeof x.name === "string" && Number.isFinite(x.initiative);
export function readWorldTurns(sceneMeta: Record<string, unknown>): WorldTurn[] {
  const x = sceneMeta[WORLD_KEY];
  return Array.isArray(x) ? x.filter(isWorldTurnData) : [];
}

const worldEntry = (t: WorldTurn): WorldTurnEntry =>
  ({ id: t.id, name: t.name, initiative: t.initiative, initMod: -1e6, dex: -1e6, tiebreak: -1e9, inEncounter: true, world: true, turn: t });

/** The order the encounter steps through: units, plus the lair turn and the GM's world turns. */
export function turnsOf(order: TrackerUnit[], world: WorldTurn[] = []): TurnEntry[] {
  const lair = lairTurn(order);
  const extra: TurnEntry[] = [...(lair ? [lair] : []), ...world.map(worldEntry)];
  return extra.length ? [...order, ...extra].sort(compareOrder) : order;
}

export interface TrackerView {
  encounter: EncounterState;
  /** Units taking turns (tokens only). */
  order: TrackerUnit[];
  /** `order` plus the lair turn, sorted: what Next / Previous step through. */
  turns: TurnEntry[];
  waiting: TrackerUnit[];
  /** Units in the scene that aren't in the encounter. */
  outside: TrackerUnit[];
  active?: string;
  next?: string;
}

export function trackerView(items: SceneItemLite[], sceneMeta: Record<string, unknown>): TrackerView {
  const units = trackerUnits(items);
  const encounter = readEncounter(sceneMeta);
  const order = turnOrder(units);
  const turns = turnsOf(order, readWorldTurns(sceneMeta));
  return {
    encounter, order, turns,
    waiting: waitingForInitiative(units),
    outside: units.filter((u) => !u.inEncounter).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
    ...activeAndNext(encounter, turns),
  };
}

async function load(gw: SceneGateway) {
  const [items, meta] = await Promise.all([gw.getItems(), gw.getSceneMetadata()]);
  return { items, meta, view: trackerView(items, meta) };
}

async function requireGm(gw: SceneGateway) {
  if ((await gw.getRole()) !== "GM") throw new Error("Only the GM can do that.");
}

const saveEncounter = (gw: SceneGateway, enc: EncounterState) => gw.setSceneMetadata({ [ENCOUNTER_KEY]: enc });

// ------------------------------------------------------------------ turn flow

export type EncounterAction = "start" | "next" | "previous" | "end" | "reset";

export async function encounterAction(gw: SceneGateway, action: EncounterAction, opts: { rules?: "2024" | "2014" } = {}): Promise<EncounterState> {
  await requireGm(gw);
  const { view } = await load(gw);
  const enc = view.encounter;
  let next: EncounterState;
  const all = [...view.order, ...view.waiting, ...view.outside];
  const surprised = all.filter((u) => u.state.surprised);
  switch (action) {
    case "start": {
      next = startCombat(enc, view.turns);
      // Surprise is settled when combat starts: 5.5E already rolled initiative with disadvantage; in 5E the unit is
      // Surprised until the end of its first turn.
      if (surprised.length) {
        await gw.patchMetadata(surprised.map((u) => ({ id: u.id, key: STATE_KEY, patch: {
          surprised: undefined,
          ...(opts.rules === "2014" && u.inEncounter ? { conditions: [...u.state.conditions.filter((c) => c.key !== "surprised"),
            condition("surprised", { until: { turnOf: u.id, at: "end" }, from: { round: 0, turnId: "" } })] } : {}),
        } })));
      }
      break;
    }
    case "next": next = nextTurn(enc, view.turns); break;
    case "previous": next = previousTurn(enc, view.turns); break;
    case "end": {
      next = endCombat();
      if (surprised.length) await gw.patchMetadata(surprised.map((u) => ({ id: u.id, key: STATE_KEY, patch: { surprised: undefined } })));
      break;
    }
    case "reset": {
      // Reset round & initiative (F10): clear initiative values and the round; units stay in the encounter.
      const ids = [...view.order, ...view.waiting].map((u) => u.id);
      if (ids.length) await gw.patchMetadata(ids.map((id) => ({ id, key: STATE_KEY, patch: { initiative: null, initiativeRoll: undefined, initiativeTiebreak: undefined } })));
      if (surprised.length) await gw.patchMetadata(surprised.map((u) => ({ id: u.id, key: STATE_KEY, patch: { surprised: undefined } })));
      next = endCombat();
      break;
    }
  }
  await saveEncounter(gw, next);
  return next;
}

/** A player's "end my turn" request, applied by the GM's client if it's still that unit's turn. */
export async function endTurnFor(gw: SceneGateway, unitId: string, round: number): Promise<boolean> {
  const { view } = await load(gw);
  if (!view.encounter.started || view.encounter.turnId !== unitId || view.encounter.round !== round) return false;
  await saveEncounter(gw, nextTurn(view.encounter, view.turns));
  return true;
}

export async function moveTie(gw: SceneGateway, id: string, dir: "up" | "down") {
  await requireGm(gw);
  const { view } = await load(gw);
  const patches = moveInTie(view.order, id, dir);
  if (patches.length) await gw.patchMetadata(patches.map((p) => ({ id: p.id, key: STATE_KEY, patch: { initiativeTiebreak: p.tiebreak } })));
}

// ------------------------------------------------------------------ membership, initiative

/** Adds units to the encounter or removes them (passing the turn on if the active unit leaves). */
export async function setInEncounter(gw: SceneGateway, ids: string[], on: boolean) {
  await requireGm(gw);
  const { view } = await load(gw);
  if (!on) {
    const enc = passTurnFrom(view.encounter, view.turns, ids);
    if (enc !== view.encounter) await saveEncounter(gw, enc);
  }
  await gw.patchMetadata(ids.map((id) => ({ id, key: STATE_KEY, patch: { inEncounter: on } })));
}

export async function setInitiative(gw: SceneGateway, id: string, value: number | null) {
  await gw.patchMetadata([{ id, key: STATE_KEY, patch: { initiative: value, initiativeRoll: undefined, initiativeTiebreak: undefined } }]);
}

/** Rolls initiative for the given units (stat block modifier and advantage); they join the encounter. */
export async function rollInitiativeFor(gw: SceneGateway, ids: string[], opts: { rng?: Rng; rules?: "2024" | "2014" } = {}) {
  await requireGm(gw);
  const items = (await gw.getItems()).filter((i) => ids.includes(i.id));
  const patches = items.flatMap((i) => {
    const u = readUnit(i.metadata);
    if (!u) return [];
    const setup = initiativeSetupFor(i.metadata, u.sheet, u.state, opts.rules);
    const roll = rollInitiative(setup.modifier, resolveRollMode(setup.advantage, setup.disadvantage), opts.rng ?? cryptoRng, "manual");
    return [{ id: i.id, key: STATE_KEY, patch: { initiative: roll.total, initiativeRoll: roll, initiativeTiebreak: undefined, inEncounter: true } }];
  });
  await gw.patchMetadata(patches);
  return patches.length;
}

/** Marks units as surprised (or not) before combat starts. */
export async function setSurprised(gw: SceneGateway, ids: string[], on: boolean) {
  await requireGm(gw);
  await gw.patchMetadata(ids.map((id) => ({ id, key: STATE_KEY, patch: { surprised: on ? true : undefined } })));
}

/** A hidden unit that becomes visible when its turn comes (or not). */
export async function setRevealOnTurn(gw: SceneGateway, ids: string[], on: boolean) {
  await requireGm(gw);
  await gw.patchMetadata(ids.map((id) => ({ id, key: STATE_KEY, patch: { revealOnTurn: on ? true : undefined } })));
}

/** Shows hidden units to the players (and drops their reveal-on-turn mark). */
export async function revealUnits(gw: SceneGateway, ids: string[]) {
  await requireGm(gw);
  await gw.setVisible(ids, true);
  await gw.patchMetadata(ids.map((id) => ({ id, key: STATE_KEY, patch: { revealOnTurn: undefined } })));
}

/**
 * When a unit's turn starts: if it's hidden and marked to be revealed on its turn, it becomes visible.
 * Returns its name when it was revealed.
 */
export async function revealOnTurnStart(gw: SceneGateway, id: string): Promise<string | null> {
  const u = trackerUnits(await gw.getItems()).find((x) => x.id === id);
  if (!u || !u.hidden || !u.state.revealOnTurn) return null;
  await revealUnits(gw, [id]);
  return u.name;
}

export async function setParty(gw: SceneGateway, ids: string[], on: boolean) {
  await requireGm(gw);
  await gw.patchMetadata(ids.map((id) => ({ id, key: STATE_KEY, patch: { party: on } })));
}

// ------------------------------------------------------------------ HP, death, revive

export interface HpReport { id: string; name: string; events: HpEvent[]; markedDead: boolean }

/**
 * Applies one HP change to several units (e.g. one Fireball). Creatures reaching 0 HP are marked dead when the room
 * setting says so; everything else is reported so the UI can offer it.
 */
export async function changeHp(gw: SceneGateway, ids: string[], change: HpChange, opts: { autoDeadAtZero?: boolean; system?: GameSystem } = {}): Promise<HpReport[]> {
  const { view, items } = await load(gw);
  const all = [...view.order, ...view.waiting, ...view.outside];
  const reports: HpReport[] = [];
  const patches: { id: string; key: string; patch: Record<string, unknown> }[] = [];
  const reverts: { item: SceneItemLite; patch: Record<string, unknown> }[] = [];
  const dying: string[] = [];
  for (const id of ids) {
    const u = all.find((x) => x.id === id);
    if (!u) continue;
    // Wild Shape: the beast form takes the hit (2014) or ends at 0 HP (2024), see wildshape.ts.
    const item = items.find((i) => i.id === id);
    const active = item ? readWildShape(item.metadata)?.active : undefined;
    const wild = active ? wildShapeHp(u.sheet, u.state, active, change, opts.system) : null;
    const { patch, events } = wild ?? applyHp(u.sheet, u.state, change, opts.system);
    let full: Partial<UnitState> = patch;
    const autoDead = opts.autoDeadAtZero && events.includes("creature-at-zero");
    if (autoDead) { full = { ...patch, ...markDead({ conditions: patch.conditions ?? u.state.conditions }) }; dying.push(id); }
    // Logged for Undo, except when Wild Shape ended: the sheet and picture changed too, which Undo can't put back.
    if (wild?.revert && item) reverts.push({ item, patch: { ...full, hpLog: undefined } });
    else if (Object.keys(full).length) {
      const entry = hpLogEntry(u.state, full, change, Date.now());
      patches.push({ id, key: STATE_KEY, patch: entry ? { ...full, hpLog: withHpLog(u.state, entry) } : full });
    }
    reports.push({ id, name: u.name, events, markedDead: !!autoDead });
  }
  if (dying.length) {
    const enc = passTurnFrom(view.encounter, view.turns, dying);
    if (enc !== view.encounter) await saveEncounter(gw, enc);
  }
  if (patches.length) await gw.patchMetadata(patches);
  for (const r of reverts) await finishRevert(gw, r.item, r.patch);
  return reports;
}

// ------------------------------------------------------------------ world turns

const saveWorld = (gw: SceneGateway, turns: WorldTurn[]) => gw.setSceneMetadata({ [WORLD_KEY]: turns });
/** The list is rewritten whole, so this client's edits run one after another (a quick name + note edit would race). */
let worldQueue: Promise<unknown> = Promise.resolve();
function queued<T>(fn: () => Promise<T>): Promise<T> {
  const run = worldQueue.then(fn, fn);
  worldQueue = run.catch(() => {});
  return run;
}
const cleanWorld = (t: Partial<WorldTurn>): Partial<WorldTurn> => {
  const out: Partial<WorldTurn> = {};
  if (t.name !== undefined) {
    const name = t.name.trim().slice(0, 60);
    if (!name) throw new Error("Give the world turn a name, e.g. Lair actions or Collapsing ceiling.");
    out.name = name;
  }
  if (t.initiative !== undefined) {
    if (!Number.isFinite(t.initiative)) throw new Error("Initiative must be a number.");
    out.initiative = Math.round(t.initiative);
  }
  if (t.note !== undefined) out.note = t.note.trim().slice(0, 300) || undefined;
  if (t.shown !== undefined) out.shown = t.shown || undefined;
  return out;
};

/** Adds a world turn (default: "Lair / world actions" on initiative 20). Returns its id. */
export const addWorldTurn = (gw: SceneGateway, t: { name?: string; initiative?: number; note?: string; shown?: boolean } = {}) => queued(() => addWorldTurnNow(gw, t));
async function addWorldTurnNow(gw: SceneGateway, t: { name?: string; initiative?: number; note?: string; shown?: boolean }): Promise<string> {
  await requireGm(gw);
  const turns = readWorldTurns(await gw.getSceneMetadata());
  const id = `world-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
  const c = cleanWorld({ name: t.name ?? "Lair / world actions", initiative: t.initiative ?? 20, note: t.note, shown: t.shown });
  await saveWorld(gw, [...turns, JSON.parse(JSON.stringify({ id, ...c }))]);
  return id;
}

/** Renames a world turn, moves it in the order, changes its note or whether players see it. */
export const updateWorldTurn = (gw: SceneGateway, id: string, patch: Partial<Omit<WorldTurn, "id">>) => queued(() => updateWorldTurnNow(gw, id, patch));
async function updateWorldTurnNow(gw: SceneGateway, id: string, patch: Partial<Omit<WorldTurn, "id">>) {
  await requireGm(gw);
  const turns = readWorldTurns(await gw.getSceneMetadata());
  if (!turns.some((t) => t.id === id)) throw new Error("That world turn is gone.");
  const c = cleanWorld(patch);
  await saveWorld(gw, turns.map((t) => (t.id === id ? JSON.parse(JSON.stringify({ ...t, ...c })) : t)));
}

/** Removes a world turn; if it's the current turn, the turn passes to the next one. */
export const removeWorldTurn = (gw: SceneGateway, id: string) => queued(() => removeWorldTurnNow(gw, id));
async function removeWorldTurnNow(gw: SceneGateway, id: string) {
  await requireGm(gw);
  const { view, meta } = await load(gw);
  const enc = passTurnFrom(view.encounter, view.turns, [id]);
  if (enc !== view.encounter) await saveEncounter(gw, enc);
  await saveWorld(gw, readWorldTurns(meta).filter((t) => t.id !== id));
}

/** Undoes the unit's last HP change (see hp.ts undoHpPatch). Returns e.g. "-70" and the HP it went back to. */
export async function undoHp(gw: SceneGateway, id: string): Promise<{ text: string; hp: number }> {
  const u = trackerUnits(await gw.getItems()).find((x) => x.id === id);
  if (!u) throw new Error("That token is no longer in the scene.");
  const { patch, entry } = undoHpPatch(u.state);
  await gw.patchMetadata([{ id, key: STATE_KEY, patch }]);
  return { text: entry.text, hp: entry.before.hp };
}

/** Mark as dead (F10): Dead condition, out of initiative, turn passes on if it was theirs. */
export async function markUnitsDead(gw: SceneGateway, ids: string[]) {
  await requireGm(gw);
  const { view } = await load(gw);
  const all = [...view.order, ...view.waiting, ...view.outside];
  const enc = passTurnFrom(view.encounter, view.turns, ids);
  if (enc !== view.encounter) await saveEncounter(gw, enc);
  await gw.patchMetadata(all.filter((u) => ids.includes(u.id)).map((u) => ({ id: u.id, key: STATE_KEY, patch: markDead(u.state) })));
  await revertIfIncapacitated(gw, ids);
}

export async function reviveUnits(gw: SceneGateway, ids: string[]) {
  await requireGm(gw);
  const units = trackerUnits(await gw.getItems()).filter((u) => ids.includes(u.id));
  await gw.patchMetadata(units.map((u) => ({ id: u.id, key: STATE_KEY, patch: revive(u.state) })));
}

export async function makeStable(gw: SceneGateway, id: string) {
  const u = trackerUnits(await gw.getItems()).find((x) => x.id === id);
  if (!u) throw new Error("That token is no longer in the scene.");
  await gw.patchMetadata([{ id, key: STATE_KEY, patch: setStable(u.state) }]);
}

/** Sets a max HP override (or clears it with null), keeping current HP within the new maximum. */
export async function setMaxHp(gw: SceneGateway, id: string, max: number | null) {
  const u = trackerUnits(await gw.getItems()).find((x) => x.id === id);
  if (!u) throw new Error("That token is no longer in the scene.");
  const newMax = max ?? u.sheet.hp.max;
  if (!(newMax > 0)) throw new Error("Max HP must be above 0.");
  await gw.patchMetadata([{ id, key: STATE_KEY, patch: { maxHpOverride: max === null || max === u.sheet.hp.max ? undefined : max, hp: Math.min(u.hp, newMax) } }]);
}

export const dexMod = (u: Pick<TrackerUnit, "dex">) => abilityMod(u.dex);

// ------------------------------------------------------------------ conditions (F11)

/** The current turn as a duration anchor (null outside combat: durations then don't apply). */
async function currentTurn(gw: SceneGateway): Promise<TurnPoint | null> {
  const enc = readEncounter(await gw.getSceneMetadata());
  return enc.started && enc.turnId ? { round: enc.round, turnId: enc.turnId } : null;
}

/** Adds a condition to one or more units (e.g. Prone on five goblins). Durations count from the current turn. */
export async function addConditionTo(gw: SceneGateway, ids: string[], key: string, opts: { label?: string; note?: string; level?: number; duration?: Duration } = {}) {
  const now = await currentTurn(gw);
  if (opts.duration && opts.duration.kind !== "none" && !now) throw new Error("Durations count turns: start combat first, or add it without a duration.");
  const units = trackerUnits(await gw.getItems()).filter((u) => ids.includes(u.id));
  await gw.patchMetadata(units.map((u) => ({ id: u.id, key: STATE_KEY, patch: addCondition(u.state, key, { ...opts, now }) })));
  // 5.5E: Incapacitated (or Paralyzed, Petrified, Stunned, Unconscious) ends Wild Shape.
  return revertIfIncapacitated(gw, ids);
}

export async function removeConditionFrom(gw: SceneGateway, id: string, conditionId: string) {
  const u = trackerUnits(await gw.getItems()).find((x) => x.id === id);
  if (!u) throw new Error("That token is no longer in the scene.");
  const patch: Partial<UnitState> = removeCondition(u.state, conditionId);
  if (u.state.conditions.find((c) => c.id === conditionId)?.key === "concentration") patch.concentrationCheck = undefined;
  await gw.patchMetadata([{ id, key: STATE_KEY, patch }]);
}

/** Result of a Concentration save (the roll's total): below the DC ends Concentration. Clears the pending check. */
export async function resolveConcentration(gw: SceneGateway, id: string, total: number | null): Promise<"kept" | "lost" | "dismissed"> {
  const u = trackerUnits(await gw.getItems()).find((x) => x.id === id);
  if (!u?.state.concentrationCheck) return "dismissed";
  if (total === null) { await gw.patchMetadata([{ id, key: STATE_KEY, patch: { concentrationCheck: undefined } }]); return "dismissed"; }
  const lost = total < u.state.concentrationCheck.dc;
  await gw.patchMetadata([{ id, key: STATE_KEY, patch: { concentrationCheck: undefined, ...(lost ? { conditions: u.state.conditions.filter((c) => c.key !== "concentration") } : {}) } }]);
  return lost ? "lost" : "kept";
}

/** Removes conditions whose duration ended with this turn change; returns "Poisoned ended on Wolf 2"-style lines. */
export async function expireConditions(gw: SceneGateway, prev: TurnPoint | null, next: TurnPoint, system: Pick<GameSystem, "conditions">): Promise<string[]> {
  const { view } = await load(gw);
  const all = [...view.order, ...view.waiting, ...view.outside];
  const pos = (id: string) => view.turns.findIndex((u) => u.id === id);
  const expired = expiredOnTurnChange(all, prev, next, pos);
  if (!expired.length) return [];
  const byUnit = new Map<string, string[]>();
  for (const e of expired) byUnit.set(e.unitId, [...(byUnit.get(e.unitId) ?? []), e.condition.id]);
  await gw.patchMetadata([...byUnit].map(([id, condIds]) => {
    const u = all.find((x) => x.id === id)!;
    return { id, key: STATE_KEY, patch: { conditions: u.state.conditions.filter((c) => !condIds.includes(c.id)) } };
  }));
  return expired.map((e) => `${conditionText(e.condition, system)} ended on ${all.find((u) => u.id === e.unitId)?.name ?? "a unit"}.`);
}
