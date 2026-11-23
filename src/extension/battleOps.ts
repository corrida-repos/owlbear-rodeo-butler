/**
 * Mass combat on the Owlbear scene (rules in core/massCombat.ts): reading the battle units off their tokens, the turn
 * flow, the five actions, morale checks and removals. The GM's popover runs these. Dice go through gmRoll (private
 * unless the GM shows them); players get the results in words as public notes, with no numbers (they'd reveal BR).
 */
import OBR, { type Item } from "@owlbear-rodeo/sdk";
import { fmtMod } from "../core/dice";
import {
  afterLoss, atTurnEnd, atTurnStart, attackFactors, attackOutcome, BATTLE_KEY, BATTLE_UNIT_KEY, battleOrder, canAttack, cellOf, DC_DISENGAGE, DC_FRIENDLY,
  checkStep, DIRECTIONS, friendlyCheckIds, gridProblem, guardTriggers, movedSquares, nextBattleTurn, nextTurnRound, previousBattleTurn, readBattle, readBattleUnit, removeCreatures, sideStrength,
  startBattle, unitBrNow, unitMoraleOf, unitRange, withBattleLog, type BattleLine, type BattleState, type BattleUnit, type Cell, type FieldUnit,
  type MoraleCheck, type RollMode,
} from "../core/massCombat";
import type { BattleRequest } from "../core/turns";
import { makeNote, ROLL_CHANNEL } from "../core/rolls";
import { gmRoll } from "./gmRoll";

export interface FieldEntry { id: string; item: Item; unit: BattleUnit; cell: Cell }
export interface Field {
  battle: BattleState;
  units: FieldEntry[];
  dpi: number;
  /** Feet per square. */
  scale: number;
  /** Why this scene can't hold a battle, or null. */
  gridIssue: string | null;
}

export interface GridInfo { dpi: number; type: string; multiplier: number; unit: string }

export async function readGrid(): Promise<GridInfo> {
  const [dpi, scale, type] = await Promise.all([OBR.scene.grid.getDpi(), OBR.scene.grid.getScale(), OBR.scene.grid.getType()]);
  return { dpi, type, multiplier: scale.parsed.multiplier, unit: scale.parsed.unit };
}

/** The battle from items already in hand (the player's view keeps its own copy of the scene). */
export function buildField(items: Item[], meta: Record<string, unknown>, grid: GridInfo): Field {
  const units = items.flatMap((item): FieldEntry[] => {
    const unit = readBattleUnit(item.metadata);
    return unit ? [{ id: item.id, item, unit, cell: cellOf(item.position, grid.dpi) }] : [];
  });
  return { battle: readBattle(meta), units, dpi: grid.dpi, scale: grid.multiplier, gridIssue: gridProblem(grid) };
}

export async function readField(): Promise<Field> {
  const [items, meta, grid] = await Promise.all([OBR.scene.items.getItems(), OBR.scene.getMetadata(), readGrid()]);
  return buildField(items, meta, grid);
}

export const fieldUnit = (e: FieldEntry): FieldUnit => ({
  id: e.id, side: e.unit.side, cell: e.cell, removed: !!e.unit.removed,
  defending: e.unit.defendUntil !== undefined, range: unitRange(e.unit.members),
});

export const orderOf = (f: Field) => battleOrder(f.units);
/** Every unit by initiative, removed ones included (to pass the turn on from a unit that was just removed). */
const allIds = (f: Field) => battleOrder(f.units.map((u) => ({ ...u, unit: { ...u.unit, removed: null } }))).map((u) => u.id);

export const saveBattle = (b: BattleState) => OBR.scene.setMetadata({ [BATTLE_KEY]: b });

export async function patchUnits(patches: { id: string; patch: Partial<BattleUnit> }[]) {
  if (!patches.length) return;
  const byId = new Map(patches.map((p) => [p.id, p.patch]));
  await OBR.scene.items.updateItems([...byId.keys()], (drafts) => {
    for (const d of drafts) {
      const cur = readBattleUnit(d.metadata);
      if (!cur) continue;
      const next: Record<string, unknown> = { ...cur, ...byId.get(d.id) };
      for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
      d.metadata[BATTLE_UNIT_KEY] = next;
    }
  });
}

export const writeUnit = (id: string, unit: BattleUnit) => OBR.scene.items.updateItems([id], (ds) => { for (const d of ds) d.metadata[BATTLE_UNIT_KEY] = JSON.parse(JSON.stringify(unit)); });

/** The name players see: hidden tokens stay anonymous. */
const shown = (e: FieldEntry) => (e.item.visible ? e.unit.name : "an unseen unit");

async function announce(lines: BattleLine[]) {
  const pub = lines.map((l) => l.pub).filter(Boolean);
  if (!pub.length) return;
  const [name, role] = await Promise.all([OBR.player.getName(), OBR.player.getRole()]);
  const msg = makeNote(`Battle: ${pub.join(" ")}`, { id: OBR.player.id, name, role }, "public");
  await OBR.broadcast.sendMessage(ROLL_CHANNEL, msg, { destination: "ALL" });
}

/** Collects lines for one GM action, then saves them to the battle log and announces the public half. */
class Story {
  lines: BattleLine[] = [];
  say(pub: string, gm?: string) { this.lines.push({ pub, gm }); }
  async finish(b: BattleState): Promise<BattleState> {
    const next = withBattleLog(b, ...this.lines);
    await saveBattle(next);
    await announce(this.lines);
    return next;
  }
}

const vis = (b: BattleState) => (b.publicRolls ? "public" as const : "private" as const);

async function moraleRoll(b: BattleState, e: FieldEntry, check: MoraleCheck) {
  const morale = unitMoraleOf(e.unit);
  const r = await gmRoll(`1d20${fmtMod(morale)}`, `${e.unit.name} · morale check (DC ${check.dc}, ${check.why})`, { unit: { id: e.id, name: e.unit.name }, kind: "save", visibility: vis(b) });
  return { ok: r.total >= check.dc, total: r.total };
}

// ------------------------------------------------------------------ removal and its knock-on checks

/** Removes a unit (token hidden, not deleted), then rolls the friendly-casualty checks of its side within 500 ft. */
async function removeUnit(f: Field, b: BattleState, e: FieldEntry, why: string, story: Story) {
  await patchUnits([{ id: e.id, patch: { removed: { round: b.round, why }, defendUntil: undefined, guardRound: undefined, shakenRound: undefined } }]);
  await OBR.scene.items.updateItems([e.id], (ds) => { for (const d of ds) d.visible = false; });
  e.unit = { ...e.unit, removed: { round: b.round, why } };
  story.say(`${shown(e)} ${why}.`);
  const fieldUnits = f.units.map(fieldUnit);
  const order = orderOf(f);
  for (const id of friendlyCheckIds(fieldUnit(e), fieldUnits, f.scale)) {
    const ally = f.units.find((u) => u.id === id)!;
    const r = await moraleRoll(b, ally, { dc: DC_FRIENDLY, why: `${e.unit.name} was removed nearby` });
    if (r.ok) story.say(`${shown(ally)} holds steady.`, `${ally.unit.name}: morale ${r.total} vs DC ${DC_FRIENDLY}, holds.`);
    else {
      const round = nextTurnRound(id, b.turnId, order, b.round);
      await patchUnits([{ id, patch: { shakenRound: round } }]);
      ally.unit = { ...ally.unit, shakenRound: round };
      story.say(`${shown(ally)} is shaken and can't move or act on its next turn.`, `${ally.unit.name}: morale ${r.total} vs DC ${DC_FRIENDLY}, shaken (round ${round}).`);
    }
  }
}

/** After a unit lost BR: removal at 0 or below, or the morale checks in order (stopping at the first failure). */
async function afterBrLoss(f: Field, b: BattleState, e: FieldEntry, heavy: boolean, story: Story) {
  const br = unitBrNow(e.unit);
  const res = afterLoss(br, e.unit.startBr ?? br, { heavy, halfChecked: e.unit.halfChecked });
  if (res.removed) { await removeUnit(f, b, e, "is destroyed (BR 0)", story); return; }
  if (res.halfReached && !e.unit.halfChecked) {
    await patchUnits([{ id: e.id, patch: { halfChecked: true } }]);
    e.unit = { ...e.unit, halfChecked: true };
  }
  for (const c of res.checks) {
    const r = await moraleRoll(b, e, c);
    if (r.ok) { story.say(`${shown(e)} stands firm.`, `${e.unit.name}: morale ${r.total} vs DC ${c.dc} (${c.why}), stands.`); continue; }
    story.say("", `${e.unit.name}: morale ${r.total} vs DC ${c.dc} (${c.why}), fails.`);
    await removeUnit(f, b, e, c.dc === 10 ? "breaks and flees the battle" : "falls apart and leaves the battle", story);
    return;
  }
}

// ------------------------------------------------------------------ turn flow

export async function beginBattle(): Promise<void> {
  const f = await readField();
  if (f.gridIssue) throw new Error(f.gridIssue);
  const sides = new Set(f.units.filter((u) => !u.unit.removed).map((u) => u.unit.side));
  if (sides.size < 2) throw new Error("A battle needs units on at least two sides.");
  await patchUnits(f.units.map((u) => ({ id: u.id, patch: { startBr: unitBrNow(u.unit), halfChecked: false, defendUntil: undefined, guardRound: undefined, shakenRound: undefined } })));
  const order = orderOf(f);
  const first = f.units.find((u) => u.id === order[0]?.id);
  const b = startBattle({ ...f.battle, log: [] }, order);
  const story = new Story();
  story.say(`The battle begins: ${[...sides].join(" against ")}. ${first ? `${shown(first)} acts first.` : ""}`,
    `Order: ${order.map((u) => `${u.unit.name} (${10 + unitMoraleOf(u.unit) + u.unit.commander.cha})`).join(", ")}.`);
  await story.finish({ ...b, turn: { startCell: first?.cell } });
}

export async function stepTurn(dir: "next" | "previous"): Promise<void> {
  const f = await readField();
  const b = f.battle;
  if (!b.active) return;
  const order = orderOf(f);
  const cur = f.units.find((u) => u.id === b.turnId);
  const to = dir === "next" ? nextBattleTurn(b, order, allIds(f)) : previousBattleTurn(b, order);
  const patches: { id: string; patch: Partial<BattleUnit> }[] = [];
  if (dir === "next" && cur) { const p = atTurnEnd(cur.unit, b.round); if (Object.keys(p).length) patches.push({ id: cur.id, patch: p }); }
  const nextU = f.units.find((u) => u.id === to.turnId);
  if (dir === "next" && nextU) { const p = atTurnStart(nextU.unit, to.round); if (Object.keys(p).length) patches.push({ id: nextU.id, patch: p }); }
  await patchUnits(patches);
  let nb: BattleState = { ...b, ...to, turn: { startCell: nextU?.cell } };
  if (dir === "next" && to.round > b.round) nb = withBattleLog(nb, { pub: `Round ${to.round} (minute ${to.round}) begins.` });
  await saveBattle(nb);
}

export async function endBattle(): Promise<void> {
  const f = await readField();
  const story = new Story();
  const sides = sideStrength(f.units);
  story.say(`The battle ends after ${f.battle.round} round${f.battle.round === 1 ? "" : "s"}. ${sides.map((s) => `${s.side}: ${s.units} unit${s.units === 1 ? "" : "s"} still fighting, ${s.removed} lost`).join("; ")}.`,
    sides.map((s) => `${s.side}: BR ${s.br} left`).join("; "));
  await story.finish({ ...f.battle, active: false, turnId: null, turn: {} });
}

// ------------------------------------------------------------------ actions

export interface AttackChoice { highGround: boolean; cover: boolean; mode?: RollMode }

/** The attack as the rules see it right now (for the panel to show before rolling). */
export function attackPreview(f: Field, attackerId: string, targetId: string, gm: AttackChoice) {
  const a = f.units.find((u) => u.id === attackerId), t = f.units.find((u) => u.id === targetId);
  if (!a || !t) return null;
  const all = f.units.map(fieldUnit);
  return { reach: canAttack(fieldUnit(a), fieldUnit(t), f.scale), factors: attackFactors(fieldUnit(a), fieldUnit(t), all, gm) };
}

/** An attack (or a Guard's attack): both roll d20 + BR, BR is lost, morale checks follow. */
export async function attack(attackerId: string, targetId: string, gm: AttackChoice, opts: { guard?: boolean } = {}): Promise<void> {
  const f = await readField();
  const b = f.battle;
  const a = f.units.find((u) => u.id === attackerId), t = f.units.find((u) => u.id === targetId);
  if (!a || !t || a.unit.removed || t.unit.removed) throw new Error("Both units must still be in the battle.");
  const pv = attackPreview(f, attackerId, targetId, gm)!;
  if (!pv.reach.ok) throw new Error(`${a.unit.name} can't attack ${t.unit.name}: ${pv.reach.why}.`);
  const mode = gm.mode ?? pv.factors.mode;
  const aBr = unitBrNow(a.unit), tBr = unitBrNow(t.unit);
  const ra = await gmRoll(`1d20${fmtMod(aBr)}`, `${a.unit.name} attacks ${t.unit.name} · BR check`, { unit: { id: a.id, name: a.unit.name }, mode, visibility: vis(b) });
  const rt = await gmRoll(`1d20${fmtMod(tBr)}`, `${t.unit.name} resists ${a.unit.name} · BR check`, { unit: { id: t.id, name: t.unit.name }, visibility: vis(b) });
  const out = attackOutcome(ra.total, rt.total);
  const story = new Story();
  const how = opts.guard ? "guarding, strikes as" : pv.reach.how === "ranged" ? "looses a volley at" : "attacks";
  const nums = `${ra.total} vs ${rt.total}${mode !== "normal" ? ` (${mode})` : ""}`;
  if (out.kind === "none") story.say(`${shown(a)} ${how} ${shown(t)} to no effect.`, `${a.unit.name} → ${t.unit.name}: ${nums}, no effect.`);
  else {
    const brLost = t.unit.brLost + out.brLoss;
    await patchUnits([{ id: t.id, patch: { brLost } }]);
    t.unit = { ...t.unit, brLost };
    story.say(`${shown(a)} ${how} ${shown(t)}: ${out.kind === "heavy" ? "heavy casualties" : "casualties"}.`,
      `${a.unit.name} → ${t.unit.name}: ${nums}, −${out.brLoss} BR (now ${unitBrNow(t.unit)}).`);
    await afterBrLoss(f, b, t, out.kind === "heavy", story);
  }
  if (opts.guard) await patchUnits([{ id: a.id, patch: { guardRound: undefined } }]);
  await story.finish(opts.guard ? b : { ...b, turn: { ...b.turn, action: "attack" } });
}

export async function simpleAction(id: string, what: "dash" | "defend" | "guard"): Promise<void> {
  const f = await readField();
  const b = f.battle;
  const e = f.units.find((u) => u.id === id);
  if (!e) return;
  const story = new Story();
  if (what === "defend") { await patchUnits([{ id, patch: { defendUntil: b.round + 1 } }]); story.say(`${shown(e)} forms a shield wall.`); }
  if (what === "guard") { await patchUnits([{ id, patch: { guardRound: b.round } }]); story.say(`${shown(e)} stands guard.`); }
  if (what === "dash") story.say(`${shown(e)} moves at the double.`);
  await story.finish({ ...b, turn: { ...b.turn, action: what } });
}

export async function disengage(id: string): Promise<void> {
  const f = await readField();
  const b = f.battle;
  const e = f.units.find((u) => u.id === id);
  if (!e) return;
  const r = await moraleRoll(b, e, { dc: DC_DISENGAGE, why: "Disengage" });
  const story = new Story();
  if (r.ok) story.say(`${shown(e)} pulls back from the fight.`, `${e.unit.name}: morale ${r.total} vs DC ${DC_DISENGAGE}, may move half its speed.`);
  else story.say(`${shown(e)} can't break away.`, `${e.unit.name}: morale ${r.total} vs DC ${DC_DISENGAGE}, loses its action and doesn't move.`);
  await story.finish({ ...b, turn: { ...b.turn, action: "disengage", disengaged: r.ok } });
}

/** Creatures killed outside the BR roll (characters, spells, effects that leave them unable to act): BR is recalculated. */
export async function casualties(id: string, name: string, n: number, cause: string): Promise<void> {
  const f = await readField();
  const e = f.units.find((u) => u.id === id);
  if (!e || n <= 0) return;
  const before = unitBrNow(e.unit);
  const members = removeCreatures(e.unit.members, name, n);
  await patchUnits([{ id, patch: { members } }]);
  e.unit = { ...e.unit, members };
  const story = new Story();
  story.say(`${shown(e)} loses ${n} ${name}${cause ? ` to ${cause}` : ""}.`, `${e.unit.name}: BR ${before} → ${unitBrNow(e.unit)}.`);
  if (f.battle.active && unitBrNow(e.unit) < before) await afterBrLoss(f, f.battle, e, false, story);
  await story.finish(f.battle);
}

/** The GM takes a unit off the field by hand (routed by a critical event, say). */
export async function removeByHand(id: string, why: string): Promise<void> {
  const f = await readField();
  const e = f.units.find((u) => u.id === id);
  if (!e) return;
  const story = new Story();
  await removeUnit(f, f.battle, e, why || "leaves the battle", story);
  await story.finish(f.battle);
}

export async function restore(id: string): Promise<void> {
  await patchUnits([{ id, patch: { removed: null } }]);
  await OBR.scene.items.updateItems([id], (ds) => { for (const d of ds) d.visible = true; });
}

// ------------------------------------------------------------------ orders from a commanding player

/** Guarding enemies the acting unit has come next to this turn. */
export function guardsTriggered(f: Field): FieldEntry[] {
  const e = f.units.find((u) => u.id === f.battle.turnId);
  if (!e || !f.battle.active) return [];
  const guarding = new Set(f.units.filter((u) => u.unit.guardRound !== undefined).map((u) => u.id));
  return guardTriggers(fieldUnit(e), guarding, f.units.map(fieldUnit), f.battle.turn.startCell).map((id) => f.units.find((u) => u.id === id)!);
}

/** Moves the acting unit one square (a commanding player's order), the rules enforced. */
export async function stepUnit(id: string, dir: keyof typeof DIRECTIONS): Promise<void> {
  const f = await readField();
  const e = f.units.find((u) => u.id === id);
  if (!e || f.battle.turnId !== id) throw new Error("It isn't that unit's turn.");
  const r = checkStep(fieldUnit(e), e.unit, f.units.map(fieldUnit), f.battle, f.scale, dir);
  if (!r.ok) throw new Error(`${e.unit.name} can't move: ${r.why}.`);
  const [dc, dr] = DIRECTIONS[dir];
  await OBR.scene.items.updateItems([id], (ds) => { for (const d of ds) d.position = { x: d.position.x + dc * f.dpi, y: d.position.y + dr * f.dpi }; });
  const moved = movedSquares(f.battle.turn, e.cell) + 1;
  await saveBattle({ ...f.battle, turn: { ...f.battle.turn, moved } });
}

/** Puts the acting unit back where its turn started (before it takes an action). */
export async function undoMove(id: string): Promise<void> {
  const f = await readField();
  const e = f.units.find((u) => u.id === id);
  const start = f.battle.turn.startCell;
  if (!e || f.battle.turnId !== id || !start || f.battle.turn.action) return;
  await OBR.scene.items.updateItems([id], (ds) => { for (const d of ds) d.position = { x: d.position.x + (start.col - e.cell.col) * f.dpi, y: d.position.y + (start.row - e.cell.row) * f.dpi }; });
  await saveBattle({ ...f.battle, turn: { ...f.battle.turn, moved: 0 } });
}

/**
 * Applies an order from the player commanding `req.unitId` (primary GM client). Returns why it was refused, or null.
 * The caller has checked the room setting and that the player commands the unit.
 */
export async function applyBattleOrder(req: BattleRequest): Promise<string | null> {
  const f = await readField();
  const b = f.battle;
  const e = f.units.find((u) => u.id === req.unitId);
  if (!e || !b.active || e.unit.removed) return "the unit isn't in a running battle";
  if (req.op === "guard-attack") {
    if (!guardsTriggered(f).some((g) => g.id === e.id) || b.turnId !== req.targetId) return "no enemy unit has come next to it this turn";
    await attack(e.id, req.targetId, { highGround: false, cover: false }, { guard: true });
    return null;
  }
  if (b.turnId !== e.id || b.round !== req.round) return "it isn't that unit's turn";
  const acts = ["attack", "dash", "defend", "disengage", "guard"];
  if (acts.includes(req.op) && (b.turn.action || e.unit.shakenRound === b.round)) return b.turn.action ? "it already took its action" : "it's shaken";
  switch (req.op) {
    case "attack": await attack(e.id, req.targetId, { highGround: false, cover: false }); break;
    case "dash": case "defend": case "guard": await simpleAction(e.id, req.op); break;
    case "disengage": await disengage(e.id); break;
    case "move": await stepUnit(e.id, req.dir); break;
    case "undo-move": await undoMove(e.id); break;
    case "end-turn": await stepTurn("next"); break;
  }
  return null;
}
