/**
 * The initiative tracker's data and GM operations (F4, F5, F6, F10), on top of the SceneGateway so they run against
 * Owlbear or the in-memory test scene. Turn logic is in encounter.ts, HP rules in hp.ts.
 */
import { abilityMod, maxHp, STATE_KEY, type UnitSheet, type UnitState } from "./sheet";
import { cryptoRng, resolveRollMode, rollInitiative, type Rng } from "./dice";
import {
  activeAndNext, endCombat, ENCOUNTER_KEY, moveInTie, nextTurn, passTurnFrom, previousTurn, readEncounter, startCombat,
  turnOrder, waitingForInitiative, type EncounterState, type OrderUnit,
} from "./encounter";
import { applyDeathSave, applyHp, markDead, revive, setStable, type DeathSaveOutcome, type HpChange, type HpEvent } from "./hp";
import type { SceneGateway, SceneItemLite } from "./importer";
import { initiativeSetupFor } from "./combat";
import { isDead } from "./systems";
import { isUnitItem, readUnit } from "./unit";

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
      name: i.label || i.name || sheet.name,
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

export interface TrackerView {
  encounter: EncounterState;
  order: TrackerUnit[];
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
  return {
    encounter, order,
    waiting: waitingForInitiative(units),
    outside: units.filter((u) => !u.inEncounter).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
    ...activeAndNext(encounter, order),
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

export async function encounterAction(gw: SceneGateway, action: EncounterAction): Promise<EncounterState> {
  await requireGm(gw);
  const { view } = await load(gw);
  const enc = view.encounter;
  let next: EncounterState;
  switch (action) {
    case "start": next = startCombat(enc, view.order); break;
    case "next": next = nextTurn(enc, view.order); break;
    case "previous": next = previousTurn(enc, view.order); break;
    case "end": next = endCombat(); break;
    case "reset": {
      // Reset round & initiative (F10): clear initiative values and the round; units stay in the encounter.
      const ids = [...view.order, ...view.waiting].map((u) => u.id);
      if (ids.length) await gw.patchMetadata(ids.map((id) => ({ id, key: STATE_KEY, patch: { initiative: null, initiativeRoll: undefined, initiativeTiebreak: undefined } })));
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
  await saveEncounter(gw, nextTurn(view.encounter, view.order));
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
    const enc = passTurnFrom(view.encounter, view.order, ids);
    if (enc !== view.encounter) await saveEncounter(gw, enc);
  }
  await gw.patchMetadata(ids.map((id) => ({ id, key: STATE_KEY, patch: { inEncounter: on } })));
}

export async function setInitiative(gw: SceneGateway, id: string, value: number | null) {
  await gw.patchMetadata([{ id, key: STATE_KEY, patch: { initiative: value, initiativeRoll: undefined, initiativeTiebreak: undefined } }]);
}

/** Rolls initiative for the given units (stat block modifier and advantage); they join the encounter. */
export async function rollInitiativeFor(gw: SceneGateway, ids: string[], opts: { rng?: Rng } = {}) {
  await requireGm(gw);
  const items = (await gw.getItems()).filter((i) => ids.includes(i.id));
  const patches = items.flatMap((i) => {
    const u = readUnit(i.metadata);
    if (!u) return [];
    const setup = initiativeSetupFor(i.metadata, u.sheet, u.state);
    const roll = rollInitiative(setup.modifier, resolveRollMode(setup.advantage, setup.disadvantage), opts.rng ?? cryptoRng, "manual");
    return [{ id: i.id, key: STATE_KEY, patch: { initiative: roll.total, initiativeRoll: roll, initiativeTiebreak: undefined, inEncounter: true } }];
  });
  await gw.patchMetadata(patches);
  return patches.length;
}

export async function setParty(gw: SceneGateway, ids: string[], on: boolean) {
  await requireGm(gw);
  await gw.patchMetadata(ids.map((id) => ({ id, key: STATE_KEY, patch: { party: on, ...(on ? {} : { deathSaves: undefined }) } })));
}

// ------------------------------------------------------------------ HP, death, revive

export interface HpReport { id: string; name: string; events: HpEvent[]; markedDead: boolean }

/**
 * Applies one HP change to several units (e.g. one Fireball). Creatures reaching 0 HP are marked dead when the room
 * setting says so; everything else is reported so the UI can offer it.
 */
export async function changeHp(gw: SceneGateway, ids: string[], change: HpChange, opts: { autoDeadAtZero?: boolean } = {}): Promise<HpReport[]> {
  const { view } = await load(gw);
  const all = [...view.order, ...view.waiting, ...view.outside];
  const reports: HpReport[] = [];
  const patches: { id: string; key: string; patch: Record<string, unknown> }[] = [];
  const dying: string[] = [];
  for (const id of ids) {
    const u = all.find((x) => x.id === id);
    if (!u) continue;
    const { patch, events } = applyHp(u.sheet, u.state, change);
    let full: Partial<UnitState> = patch;
    const autoDead = opts.autoDeadAtZero && events.includes("creature-at-zero");
    if (autoDead) { full = { ...patch, ...markDead({ conditions: patch.conditions ?? u.state.conditions }) }; dying.push(id); }
    if (Object.keys(full).length) patches.push({ id, key: STATE_KEY, patch: full });
    reports.push({ id, name: u.name, events, markedDead: !!autoDead });
  }
  if (dying.length) {
    const enc = passTurnFrom(view.encounter, view.order, dying);
    if (enc !== view.encounter) await saveEncounter(gw, enc);
  }
  if (patches.length) await gw.patchMetadata(patches);
  return reports;
}

/** Mark as dead (F10): Dead condition, out of initiative, turn passes on if it was theirs. */
export async function markUnitsDead(gw: SceneGateway, ids: string[]) {
  await requireGm(gw);
  const { view } = await load(gw);
  const all = [...view.order, ...view.waiting, ...view.outside];
  const enc = passTurnFrom(view.encounter, view.order, ids);
  if (enc !== view.encounter) await saveEncounter(gw, enc);
  await gw.patchMetadata(all.filter((u) => ids.includes(u.id)).map((u) => ({ id: u.id, key: STATE_KEY, patch: markDead(u.state) })));
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

/** Records a death saving throw rolled from the card (natural d20 value). */
export async function recordDeathSave(gw: SceneGateway, id: string, natural: number): Promise<DeathSaveOutcome> {
  const u = trackerUnits(await gw.getItems()).find((x) => x.id === id);
  if (!u) throw new Error("That token is no longer in the scene.");
  const { patch, outcome } = applyDeathSave(u.state, natural);
  await gw.patchMetadata([{ id, key: STATE_KEY, patch }]);
  return outcome;
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
