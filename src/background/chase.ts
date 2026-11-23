/**
 * Chase mode, run by the primary GM client on each forward turn change (see core/chase.ts and core/vehicles.ts for the
 * rules): for the participant whose turn ended, its pending complication, its Dash budget and the complication for the
 * next participant; for the one whose turn starts, effects that hit at the start of a turn (a burning vehicle); and the
 * escape checks when the round wraps. Returns lines for the GM's notifications; everything also goes in the chase log.
 */
import {
  COMPLICATION_TABLES, complicationDie, complicationFor, complicationIn, DASH_SAVE_DC, dashTestKind, DROP_OUT_EXHAUSTION, escapes, exhaustionOnTest,
  failText, freeDashes, nextParticipant, participants, tableKey, combineModes, type Complication,
} from "../core/chase";
import { skillBonus } from "../core/combatOptions";
import { addCondition, exhaustionLevel, type TurnPoint } from "../core/conditions";
import { fmtMod } from "../core/dice";
import { movedFeet, type MovementState } from "../core/movement";
import { abilityMod, STATE_KEY } from "../core/sheet";
import type { TrackerUnit } from "../core/tracker";
import {
  DROP_OUT_EXHAUSTION as VEHICLE_DROP_OUT, FIRE_DAMAGE, liveVehicles, nextVehicle, ridersOf, vehicleComplicationFor, vehicleOf, vehicleTest,
  VEHICLE_TABLES_BY_KEY, vehicleGridProblem,
} from "../core/vehicles";
import {
  chaseCtx, condUnit, sceneGrid, driverPb, fallUnit, hurtUnit, isDown, resolveVehicleComplication, rollDamage, saveChase, say, setVehicle, unitOf, unitTest,
  vehicleById, vehicleFeet, vehicleRoll, type ChaseCtx,
} from "../extension/chaseRun";
import { gmRoll } from "../extension/gmRoll";
import { obrGateway } from "../extension/obrGateway";

const passive = (u: TrackerUnit) => u.sheet.passivePerception ?? 10 + skillBonus(u.sheet, "Perception", "wis");

export async function chaseTurnEnded(ended: TurnPoint, next: TurnPoint, prevMovement: MovementState | null): Promise<string[]> {
  const x = await chaseCtx(ended);
  if (!x.c.active) return [];
  if (x.c.mode === "vehicles") {
    // Vehicle chases need a large-scale grid (at least 100 ft per square): paused until the scene has one.
    const why = vehicleGridProblem(await sceneGrid());
    if (why) {
      const line = `Vehicle chase paused: ${why}`;
      if (x.c.log.at(-1) === line) return [];
      say(x, line);
    } else await vehicleTurn(x, ended, next, prevMovement);
  }
  else await creatureTurn(x, ended, next, prevMovement);
  await saveChase(x);
  return x.lines;
}

// ------------------------------------------------------------------ creatures

async function resolveComplication(x: ChaseCtx, comp: Complication, target: TrackerUnit, head: string): Promise<void> {
  let failed = true;
  let testText = "";
  if (comp.attack) {
    const r = await gmRoll(`1d20${fmtMod(comp.attack.bonus)}`, `Opportunity Attack · chase complication (vs AC ${target.sheet.ac})`, { unit: { id: target.id, name: target.name }, kind: "attack", visibility: x.vis });
    const crit = r.natural === 20;
    failed = r.natural !== 1 && (crit || r.total >= target.sheet.ac);
    testText = ` Attack ${r.total} vs AC ${target.sheet.ac}: ${crit ? "critical hit" : failed ? "hits" : "misses"}.`;
    if (failed) {
      const dmg = await hurtUnit(x, target, await rollDamage(x, comp.attack.damage, "chase complication", target, crit));
      say(x, `${head} ${comp.text} ${target.name} is affected.${testText} ${target.name} ${dmg}.`);
    } else say(x, `${head} ${comp.text} ${target.name} is affected.${testText}`);
    return;
  }
  if (comp.test) {
    const r = await unitTest(x, target, comp.test, "chase complication");
    failed = !r.pass;
    testText = ` ${r.text}.`;
  }
  if (!failed) { say(x, `${head} ${comp.text} ${target.name} is affected.${testText}`); return; }
  const f = comp.fail;
  let dmgText = "";
  let fallText = "";
  let immune = "";
  if (f.damage?.length) dmgText = await hurtUnit(x, target, await rollDamage(x, f.damage, "chase complication", target));
  if (f.fall != null) {
    const feet = f.fall === "1d4x5" ? 5 * (await gmRoll("1d4", "Sudden drop: × 5 feet", { unit: { id: target.id, name: target.name }, kind: "dice", visibility: x.vis })).total : f.fall;
    fallText = await fallUnit(x, target, feet, "chase complication");
  }
  const conds = [
    ...(f.prone ? [{ key: "prone" }] : []),
    ...(f.restrained ? [{ key: "restrained", note: "chase: caught in a net" }] : []),
    ...(f.blindedThisTurn ? [{ key: "blinded", duration: { kind: "turn" as const, turnOf: target.id, at: "end" as const }, note: "chase: Speed halved while Blinded this way" }] : []),
  ];
  if (conds.length) immune = await condUnit(x, target, conds);
  const rest = failText({ fail: { ...f, damage: undefined, fall: undefined } });
  const words = [fallText ? fallText.replace(/\.$/, "") : "", dmgText, rest].filter(Boolean).join("; ");
  say(x, `${head} ${comp.text} ${target.name} is affected.${testText} ${target.name} ${words}.${immune}`);
}

async function creatureTurn(x: ChaseCtx, ended: TurnPoint, next: TurnPoint, prevMovement: MovementState | null): Promise<void> {
  const down = (id: string) => isDown(x, id);
  const me = unitOf(x, ended.turnId);

  if (me && participants(x.c, down).includes(me.id)) {
    // A complication that waited for the end of this turn ("if it moves 20 feet or more").
    const moved = prevMovement?.unitId === me.id ? movedFeet(prevMovement) : null;
    for (const p of x.c.pending.filter((q) => q.target === me.id)) {
      const comp = complicationIn(COMPLICATION_TABLES[p.table] ?? [], p.roll);
      if (!comp) continue;
      if (comp.ifMoves && moved !== null && moved < comp.ifMoves) say(x, `${me.name} moved only ${moved} feet: ${comp.text.split(":")[0]}, but nothing happens.`);
      else await resolveComplication(x, comp, me, `Chase (from ${p.from}'s roll, end of ${me.name}'s turn${moved === null ? "; movement not tracked, so it counts as moving" : ""}):`);
    }
    x.c = { ...x.c, pending: x.c.pending.filter((q) => q.target !== me.id) };

    // Dashing: count it; past the free ones, a DC 10 Constitution save (2014: check) or 1 Exhaustion level.
    if (prevMovement?.unitId === me.id && prevMovement.dash) {
      const n = (x.c.dashes[me.id] ?? 0) + 1;
      x.c = { ...x.c, dashes: { ...x.c.dashes, [me.id]: n } };
      const free = freeDashes(abilityMod(me.sheet.abilities.con));
      if (n > free) {
        const r = await unitTest(x, me, { kind: dashTestKind(x.rules), dc: DASH_SAVE_DC, options: [{ ability: "con" }] }, "extra Dash in the chase");
        if (r.pass) say(x, `${me.name} pushed through Dash ${n} (${free} free): ${r.text}, no Exhaustion.`);
        else {
          const level = exhaustionLevel(me.state) + 1;
          await obrGateway.patchMetadata([{ id: me.id, key: STATE_KEY, patch: addCondition(me.state, "exhaustion", { level }) }]);
          x.c = { ...x.c, exhaustionGained: { ...x.c.exhaustionGained, [me.id]: (x.c.exhaustionGained[me.id] ?? 0) + 1 } };
          say(x, `${me.name} Dashed past its limit (${n} of ${free}): ${r.text}, Exhaustion ${level}.`);
          if (level >= DROP_OUT_EXHAUSTION) { x.c = { ...x.c, out: [...x.c.out, me.id] }; say(x, `${me.name} has ${level} Exhaustion levels and drops out of the chase.`); }
        }
      }
    }

    // Complication: rolled at the end of its turn; it affects the next participant.
    const die = complicationDie(x.rules);
    const env = x.c.env === "urban" ? "Urban" : "Wilderness";
    const roll = await gmRoll(die, `Chase complication (${env}${x.rules === "2014" ? ", 2014 DMG" : ""})`, { unit: { id: me.id, name: me.name }, kind: "dice", visibility: x.vis });
    const comp = complicationFor(x.c.env, roll.total, x.rules);
    const targetId = comp ? nextParticipant(x.order, x.c, me.id, down) : null;
    const target = unitOf(x, targetId ?? undefined);
    const head = `Chase (${die.slice(1)} ${roll.total}, after ${me.name}):`;
    if (comp && target) {
      if (comp.ifMoves) {
        x.c = { ...x.c, pending: [...x.c.pending, { target: target.id, table: tableKey(x.c.env, x.rules), roll: roll.total, from: me.name }] };
        say(x, `${head} ${comp.text} ${target.name} is affected: resolved at the end of its turn.`);
      } else await resolveComplication(x, comp, target, head);
    } else if (comp) say(x, `${head} ${comp.text} Nobody after ${me.name} to affect.`);
  }

  // End of the round (initiative count 0): each quarry tries to slip away.
  if (next.round > ended.round) {
    const pursuers = x.c.pursuers.filter((id) => !x.c.out.includes(id) && !down(id)).map((id) => unitOf(x, id)!);
    const dc = Math.max(0, ...pursuers.map(passive));
    for (const id of x.c.quarry.filter((q) => !x.c.escaped.includes(q) && !x.c.out.includes(q) && !down(q))) {
      const q = unitOf(x, id)!;
      const sight = x.c.inSight.includes(id);
      const ex = exhaustionOnTest(exhaustionLevel(q.state), "check", x.rules);
      const mode = combineModes(x.c.escapeFactor === "normal" ? undefined : x.c.escapeFactor, ex.mode);
      const r = await gmRoll(`1d20${fmtMod(skillBonus(q.sheet, "Stealth", "dex") + ex.penalty)}`, `Stealth · escape the chase (vs Passive Perception ${dc})`, { unit: { id: q.id, name: q.name }, kind: "check", mode: mode === "normal" ? undefined : mode, visibility: x.vis });
      if (escapes(r.total, pursuers.map(passive), sight)) { x.c = { ...x.c, escaped: [...x.c.escaped, id] }; say(x, `${q.name} escapes! Stealth ${r.total} beats the pursuers' best Passive Perception (${dc}).`); }
      else say(x, `${q.name} doesn't escape: Stealth ${r.total}${sight ? " (never out of the lead pursuer's sight: automatic failure)" : ` vs Passive Perception ${dc}`}.`);
    }
    const left = x.c.quarry.filter((q) => !x.c.escaped.includes(q) && !x.c.out.includes(q) && !down(q));
    if (!left.length || !pursuers.length) endChase(x, !left.length ? "The chase is over: every quarry escaped or dropped out." : "The chase is over: no pursuers left.");
  }
}

/** Ends the chase, reminding the GM of the Exhaustion it cost (a Short or Long Rest removes it). */
export function endChase(x: ChaseCtx, line: string) {
  x.c = { ...x.c, active: false, pending: [] };
  say(x, line);
  const tired = Object.entries(x.c.exhaustionGained).filter(([, n]) => n > 0).map(([id, n]) => `${unitOf(x, id)?.name ?? "(gone)"} ${n}`);
  if (tired.length) say(x, `Exhaustion gained in the chase (a Short or Long Rest removes it): ${tired.join(", ")}.`);
}

// ------------------------------------------------------------------ vehicles

async function vehicleTurn(x: ChaseCtx, ended: TurnPoint, next: TurnPoint, prevMovement: MovementState | null): Promise<void> {
  const mine = liveVehicles(x.c.vehicles, x.c).find((v) => v.driver === ended.turnId);
  if (mine) {
    const id = mine.id;
    const mv = prevMovement?.unitId === mine.driver ? prevMovement : null;
    const dashed = !!mv?.dash;
    const feet = vehicleFeet(x, mine, mv ? movedFeet(mv) : 0, dashed);

    // "If the vehicle Dashes this turn": resolved now.
    for (const p of x.c.pending.filter((q) => q.target === id)) {
      const comp = VEHICLE_TABLES_BY_KEY[p.table]?.find((c) => p.roll >= c.roll[0] && p.roll <= c.roll[1]);
      if (!comp) continue;
      if (!dashed) say(x, `${mine.name} didn't Dash: it threads past the obstacles (from ${p.from}'s complication).`);
      else await resolveVehicleComplication(x, id, comp, `Vehicle chase (from ${p.from}'s roll, ${mine.name} Dashed):`, feet);
    }
    x.c = { ...x.c, pending: x.c.pending.filter((q) => q.target !== id) };

    // Dashing on the vehicle's Constitution; vehicular Exhaustion past the free Dashes.
    const v = vehicleById(x, id);
    if (v && v.hp > 0 && dashed) {
      const n = v.dashes + 1;
      setVehicle(x, { ...v, dashes: n });
      const free = freeDashes(abilityMod(v.con));
      if (n > free) {
        const kind = dashTestKind(x.rules);
        const r = await vehicleRoll(x, vehicleById(x, id)!, kind, ["con"], DASH_SAVE_DC, "extra Dash in the chase");
        if (r.pass) say(x, `${v.name} pushed through Dash ${n} (${free} free): ${r.text}.`);
        else {
          const level = Math.min(6, v.exhaustion + 1);
          setVehicle(x, { ...vehicleById(x, id)!, exhaustion: level });
          say(x, `${v.name} was driven past its limit (Dash ${n} of ${free}): ${r.text}, vehicular Exhaustion ${level} (only repairs remove it).`);
          if (level >= 6) { setVehicle(x, { ...vehicleById(x, id)!, hp: 0 }); x.c = { ...x.c, out: [...x.c.out, id] }; say(x, `${v.name} breaks down (0 HP).`); }
          else if (level >= VEHICLE_DROP_OUT) { x.c = { ...x.c, out: [...x.c.out, id] }; say(x, `${v.name} has ${level} Exhaustion levels and drops out of the chase.`); }
        }
      }
    }

    // Complication: d20 at the end of the driver's turn; it affects the next vehicle in initiative order.
    const driver = unitOf(x, mine.driver);
    const roll = await gmRoll("1d20", `Vehicle chase complication (${x.c.vehicleEnv})`, { unit: driver ? { id: driver.id, name: driver.name } : undefined, kind: "dice", visibility: x.vis });
    const comp = vehicleComplicationFor(x.c.vehicleEnv, roll.total);
    const target = comp ? nextVehicle(x.order, liveVehicles(x.c.vehicles, x.c), id) : null;
    const head = `Vehicle chase (d20 ${roll.total}, after ${mine.name}):`;
    if (comp && target) {
      if (comp.ifDashed) {
        x.c = { ...x.c, pending: [...x.c.pending, { target: target.id, table: x.c.vehicleEnv, roll: roll.total, from: mine.name }] };
        say(x, `${head} ${comp.text} ${target.name} is affected: resolved at the end of its driver's turn.`);
      } else await resolveVehicleComplication(x, target.id, comp, head, target.speed);
    } else if (comp) say(x, `${head} ${comp.text} No other vehicle to affect.`);
  }

  // Start of a turn: cover from swerving ends for the driver's vehicle; a burning vehicle burns its riders.
  const starting = vehicleOf(liveVehicles(x.c.vehicles, x.c), next.turnId);
  if (starting) {
    const v = starting.vehicle;
    if (starting.at === "driver" && v.cover) { setVehicle(x, { ...v, cover: undefined }); say(x, `${v.name}'s cover from swerving ends.`); }
    const u = unitOf(x, next.turnId);
    if (v.mishaps.includes("fire") && u && !u.dead) say(x, `${u.name} starts its turn aboard the burning ${v.name}: ${u.name} ${await hurtUnit(x, u, await rollDamage(x, [FIRE_DAMAGE], `${v.name} is on fire`, u))}.`);
  }

  // End of the round: each quarry vehicle tries to slip away.
  if (next.round > ended.round) {
    const live = liveVehicles(x.c.vehicles, x.c);
    const pursuers = live.filter((v) => v.side === "pursuer");
    const watchers = pursuers.flatMap((v) => ridersOf(v)).map((r) => unitOf(x, r.id)).filter((u): u is TrackerUnit => !!u && !u.dead && u.state.hp > 0);
    const dc = Math.max(0, ...watchers.map(passive));
    for (const q of live.filter((v) => v.side === "quarry")) {
      const sight = x.c.inSight.includes(q.id);
      const t = vehicleTest(q, "check", "dex", driverPb(x, q), x.rules);
      let total: number | null = null;
      if (!sight && !t.auto) {
        const mode = combineModes(t.mode, x.c.escapeFactor === "normal" ? undefined : x.c.escapeFactor);
        total = (await gmRoll(`1d20${fmtMod(t.bonus)}`, `${q.name}: vehicle Dexterity check · escape the chase (vs Passive Perception ${dc})`, { kind: "check", mode: mode === "normal" ? undefined : mode, visibility: x.vis })).total;
      }
      if (total !== null && escapes(total, watchers.map(passive), sight)) { x.c = { ...x.c, escaped: [...x.c.escaped, q.id] }; say(x, `${q.name} escapes! Dexterity ${total} beats the pursuers' best Passive Perception (${dc}).`); }
      else say(x, `${q.name} doesn't escape: ${sight ? "never out of the lead pursuer's sight (automatic failure)" : t.auto ? t.auto : `Dexterity ${total} vs Passive Perception ${dc}`}.`);
    }
    const after = liveVehicles(x.c.vehicles, x.c);
    const left = after.filter((v) => v.side === "quarry"), hunting = after.filter((v) => v.side === "pursuer");
    if (!left.length || !hunting.length) endChase(x, !left.length ? "The chase is over: every quarry vehicle escaped or dropped out." : "The chase is over: no pursuing vehicles left.");
  }
}
