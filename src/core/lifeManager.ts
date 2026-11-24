import { BUTLER_ITEM_KEY, BUTLER_NS, SIZE_CELLS } from "./constants";
import { readEncounter } from "./encounter";
import { type ImageItemSpec, type ResolvedImage, type SceneGateway, type SceneItemLite } from "./importer";
import { tokenImageGrid, type Vec2 } from "./layout";
import { type Disposition, type TacticalEncounter, type TacticalParticipant, type TacticalResult, type TacticalVitals, validVitals } from "./lifeManagerProtocol";
import { maxHp, STATE_KEY, type ConditionInstance, type UnitSheet, type UnitState } from "./sheet";
import { isDead, isStable } from "./systems";
import { readUnit, unitMetadata, unitState } from "./unit";

const KEY = `${BUTLER_NS}/life-manager`;
const SLEEP_ID = "life-manager:asleep";
const SURPRISE_ID = "life-manager:surprised";
interface Binding { participantId: string; tokenId: string; party: boolean }
interface Handoff { id: string; campaignId?: string; bindings: Binding[]; previousIds?: string[] }
export type PreparedCreature = { sheet: UnitSheet; image: ResolvedImage };

function readHandoff(meta: Record<string, unknown>): Handoff | undefined {
  const value = meta[KEY] as Handoff | undefined;
  return value && typeof value.id === "string" && Array.isArray(value.bindings) ? value : undefined;
}

export function lifeManagerOpponentIds(meta: Record<string, unknown>): string[] {
  return readHandoff(meta)?.bindings.filter((binding) => !binding.party).map((binding) => binding.tokenId) ?? [];
}

export async function activeLifeManagerHandoff(gw: SceneGateway) {
  const meta = await gw.getSceneMetadata();
  const linked = readHandoff(meta);
  return { id: linked?.id, tokenIds: linked?.bindings.map((binding) => binding.tokenId) ?? [], seconds: Math.max(0, readEncounter(meta).round - 1) * 6 };
}

export function lifeManagerMatch(p: TacticalParticipant, items: SceneItemLite[]): string {
  if (p.side !== "party") return "create";
  const party = items.filter((i) => readUnit(i.metadata)?.state.party);
  const candidates = p.ddbId ? party.filter((i) =>
    (i.metadata[BUTLER_ITEM_KEY] as { ddbId?: number } | undefined)?.ddbId === p.ddbId) : [];
  const matching = candidates.length ? candidates : party.filter((i) =>
    [i.label, i.name, readUnit(i.metadata)?.sheet.name].some((n) => n?.trim().toLowerCase() === p.name.trim().toLowerCase()));
  return matching.length === 1 ? matching[0]!.id : "";
}

function importedState(p: TacticalParticipant, state: UnitState, sheet: UnitSheet, tokenId: string): UnitState {
  const v = p.vitals;
  const party = p.side === "party";
  const conditions = state.conditions.filter((c) => !["surprised", "dead", "stable"].includes(c.key) && c.id !== SLEEP_ID &&
    (!v || !["exhaustion", "concentration", ...v.conditions.map((condition) => condition.key)].includes(c.key)));
  for (const c of v?.conditions ?? []) {
    const rounds = c.remainingSeconds == null ? 0 : Math.ceil(c.remainingSeconds / 6);
    conditions.push({
      id: c.id, key: c.key, level: c.level, label: c.label,
      ...(rounds > 0 ? { until: { rounds, at: "start", turnOf: tokenId }, from: { round: 1, turnId: tokenId } } : {}),
    });
  }
  if (p.surprised) conditions.push({ id: SURPRISE_ID, key: "surprised" });
  if (p.asleep && !conditions.some((condition) => condition.key === "unconscious")) {
    conditions.push({ id: SLEEP_ID, key: "unconscious", note: "Asleep at the start of the encounter." });
  }
  if (v?.status === "stable") conditions.push({ id: "life-manager:stable", key: "stable" });
  if (v?.status === "dead") conditions.push({ id: "life-manager:dead", key: "dead" });
  if (!v) {
    conditions.push(...state.conditions.filter((c) => c.key === "stable" || c.key === "dead"));
    return { ...state, party, conditions, inEncounter: true, initiative: p.initiative ?? null, initiativeRoll: undefined, initiativeTiebreak: undefined };
  }
  return {
    ...state, party, hp: v.hp, tempHp: v.tempHp, maxHpOverride: v.maxHp === sheet.hp.max ? undefined : v.maxHp,
    conditions, inEncounter: true, initiative: p.initiative ?? null, initiativeRoll: undefined, initiativeTiebreak: undefined, deathSaves: v.status === "dying" ? { successes: v.successes, failures: v.failures } : undefined,
    concentrationCheck: undefined, zeroHpPending: undefined,
  };
}

export async function importLifeManagerEncounter(
  gw: SceneGateway, encounter: TacticalEncounter, selections: Record<string, string>, creatures: Map<string, PreparedCreature>,
  center: Vec2, newId: () => string = () => crypto.randomUUID(),
) {
  if (await gw.getRole() !== "GM") throw new Error("Only the GM can import an encounter.");
  const [items, meta, grid] = await Promise.all([gw.getItems(), gw.getSceneMetadata(), gw.getGrid()]);
  const previousHandoff = readHandoff(meta);
  if (previousHandoff?.id === encounter.id || previousHandoff?.previousIds?.includes(encounter.id)) throw new Error("This encounter is already in the scene.");
  if (readEncounter(meta).started) throw new Error("Finish the running combat before importing this encounter.");
  const bindings: Binding[] = [];
  const additions: ImageItemSpec[] = [];
  const updates: { id: string; metadata: Record<string, unknown> }[] = [];
  const previous: { id: string; metadata: Record<string, unknown> }[] = [];
  const used = new Set<string>();
  const gridFeet = Number.parseFloat(grid.scale) || 5;
  const spacing = Math.max(grid.dpi, encounter.distanceFt * grid.dpi / gridFeet);
  let origin = center;
  const partyTokens = items.filter((item) => encounter.participants.some((p) => p.side === "party" && selections[p.id] === item.id));
  if (partyTokens.length) {
    const bounds = await gw.getItemBounds(partyTokens.map((item) => item.id));
    origin = { x: (bounds.min.x + bounds.max.x) / 2, y: (bounds.min.y + bounds.max.y) / 2 };
  }
  let nextY = origin.y;
  for (const p of encounter.participants) {
    const selection = selections[p.id];
    if (selection === "skip") continue;
    if (selection === "create") {
      const creature = creatures.get(p.id);
      if (!creature || p.side !== "encounter") throw new Error(`Choose a token for ${p.name}.`);
      const id = newId();
      const { sheet, image } = creature;
      const size = SIZE_CELLS[sheet.size] ?? 1;
      const hp = p.vitals?.hp ?? sheet.hp.max;
      const state = importedState(p, unitState(sheet, { max: sheet.hp.max, current: hp }, null), sheet, id);
      additions.push({
        id, name: p.name, label: p.name, image, layer: "CHARACTER", visible: false, locked: false,
        grid: tokenImageGrid(image.width, image.height, size),
        position: { x: origin.x + spacing, y: nextY },
        metadata: unitMetadata(sheet, state),
      });
      nextY += Math.max(size, 1) * grid.dpi;
      bindings.push({ participantId: p.id, tokenId: id, party: false });
      continue;
    }
    const item = items.find((i) => i.id === selection && i.layer === "CHARACTER" && i.type === "IMAGE");
    const unit = item && readUnit(item.metadata);
    if (!item || !unit) throw new Error(`Choose an existing Butler token for ${p.name}.`);
    if (used.has(item.id)) throw new Error("Each participant must use a different token.");
    used.add(item.id);
    bindings.push({ participantId: p.id, tokenId: item.id, party: p.side === "party" });
    updates.push({ id: item.id, metadata: { [STATE_KEY]: importedState(p, unit.state, unit.sheet, item.id) } });
    previous.push({ id: item.id, metadata: { [STATE_KEY]: item.metadata[STATE_KEY] ?? unit.state } });
  }
  if (!bindings.length) throw new Error("Choose at least one participant.");
  // Keep unrelated tokens on the map and out of this fight's initiative order.
  for (const item of items) {
    const unit = readUnit(item.metadata);
    if (!unit?.state.inEncounter || used.has(item.id)) continue;
    updates.push({ id: item.id, metadata: { [STATE_KEY]: { ...unit.state, inEncounter: false } } });
    previous.push({ id: item.id, metadata: { [STATE_KEY]: item.metadata[STATE_KEY] ?? unit.state } });
  }
  let updated = false;
  try {
    if (additions.length) await gw.addImages(additions);
    if (updates.length) { updated = true; await gw.updateMetadata(updates); }
    const previousIds = previousHandoff ? [...(previousHandoff.previousIds ?? []), previousHandoff.id].slice(-100) : [];
    await gw.setSceneMetadata({ [KEY]: { id: encounter.id, campaignId: encounter.campaignId, bindings, previousIds } satisfies Handoff });
  } catch (error) {
    const present = new Set((await gw.getItems()).map((item) => item.id));
    const created = additions.map((item) => item.id).filter((id) => present.has(id));
    if (created.length) await gw.deleteItems(created);
    if (updated) await gw.updateMetadata(previous);
    throw error;
  }
}

export async function lifeManagerResult(gw: SceneGateway, elapsedSeconds: number, resultId: () => string = () => crypto.randomUUID(), disposition?: Disposition): Promise<TacticalResult> {
  if (await gw.getRole() !== "GM") throw new Error("Only the GM can export encounter results.");
  const [meta, items] = await Promise.all([gw.getSceneMetadata(), gw.getItems()]);
  const handoff = readHandoff(meta);
  if (!handoff) throw new Error("Import a Life Manager encounter into this scene first.");
  if (!Number.isSafeInteger(elapsedSeconds) || elapsedSeconds < 0 || elapsedSeconds > 86400) {
    throw new Error("Enter elapsed time in whole seconds, up to 24 hours.");
  }
  const round = readEncounter(meta).round;
  const participants: TacticalResult["participants"] = [];
  for (const binding of handoff.bindings.filter((b) => b.party)) {
    const item = items.find((candidate) => candidate.id === binding.tokenId);
    const unit = item && readUnit(item.metadata);
    if (!unit) throw new Error("A linked party token is missing. Restore it before exporting, or record the outcome in Life Manager.");
    const { sheet, state } = unit;
    if (state.zeroHpPending || state.concentrationCheck) {
      throw new Error(`Resolve ${sheet.name}’s pending zero HP or concentration decision before exporting.`);
    }
    const status = isDead(state) ? "dead" : state.hp > 0 ? "alive" : isStable(state) ? "stable" : "dying";
    const conditions: TacticalVitals["conditions"] = state.conditions.flatMap((condition: ConditionInstance) => {
      if (["surprised", "dead", "stable", "bloodied"].includes(condition.key) || condition.id === SLEEP_ID) return [];
      const remainingSeconds = condition.until?.rounds && condition.from
        ? Math.max(0, condition.from.round + condition.until.rounds - Math.max(1, round)) * 6 : undefined;
      if (remainingSeconds === 0) return [];
      return [{
        id: condition.id, key: condition.key, label: condition.label, level: condition.level,
        remainingSeconds, turnBased: condition.until != null && condition.until.rounds == null,
      }];
    });
    const vitals: TacticalVitals = {
      hp: status === "alive" ? state.hp : 0, maxHp: maxHp(sheet, state), tempHp: state.tempHp, status,
      successes: status === "dying" ? state.deathSaves?.successes ?? 0 : 0,
      failures: status === "dying" ? state.deathSaves?.failures ?? 0 : 0, conditions,
    };
    if (!validVitals(vitals)) throw new Error(`Review ${sheet.name}’s vitals before exporting.`);
    participants.push({ id: binding.participantId, vitals });
  }
  return { schema: "life-manager/result@1", id: resultId(), encounterId: handoff.id, campaignId: handoff.campaignId, elapsedSeconds, disposition, participants };
}
