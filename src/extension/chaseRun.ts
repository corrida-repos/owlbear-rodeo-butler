/**
 * Rolling and applying chase effects on units and vehicles: shared by the turn-by-turn runner (background/chase.ts)
 * and the DM Tools buttons (extension/vehiclePanel.ts). Every roll goes through gmRoll; damage follows Resistances,
 * Vulnerabilities and Immunities; conditions a unit is immune to are skipped. Lines are collected for notifications and
 * the chase log.
 */
import OBR from "@owlbear-rodeo/sdk";
import {
  CHASE_KEY, combineModes, exhaustionOnTest, fallDice, optionText, readChase, withLog,
  type ChaseState, type ChaseTest, type DamagePart, type Mode,
} from "../core/chase";
import { skillBonus } from "../core/combatOptions";
import { addCondition, exhaustionLevel, type Duration, type TurnPoint } from "../core/conditions";
import { hitAgainst, immuneToCondition } from "../core/defenses";
import { fmtMod } from "../core/dice";
import { outOfFight } from "../core/morale";
import { abilityMod, ABILITY_NAMES, saveBonus, STATE_KEY, type Ability } from "../core/sheet";
import { changeHp, trackerView, type TrackerUnit } from "../core/tracker";
import {
  crashDice, CRASH_SAVE_DC, damageVehicle, driverProficient, dropRider, effectiveSpeed, isExposed, mishapFor, overturnWord, OVERTURN, ridersOf,
  vehicleTest, MISHAP_MARGIN, MISHAPS, type VAbility, type Vehicle, type VehicleComplication,
} from "../core/vehicles";
import { gmRoll } from "./gmRoll";
import { obrGateway } from "./obrGateway";
import { roomSettings, roomSystem } from "./roomSettings";

const MISHAPS_BY_KEY = Object.fromEntries(MISHAPS.map((m) => [m.key, m]));

/** What rolling and applying effects on units needs (chases, naval and aerial combat). */
export interface UnitCtx {
  units: TrackerUnit[];
  vis: "public" | "private";
  rules: "2024" | "2014";
  /** The turn point used for condition durations (null outside combat). */
  now: TurnPoint | null;
  lines: string[];
}

export interface ChaseCtx extends UnitCtx {
  c: ChaseState;
  /** Initiative order (unit ids). */
  order: string[];
}

export async function chaseCtx(now?: TurnPoint | null): Promise<ChaseCtx> {
  const meta = await OBR.scene.getMetadata();
  const c = readChase(meta);
  const view = trackerView(await obrGateway.getItems(), meta);
  const at = now !== undefined ? now : view.encounter.started && view.active ? { round: view.encounter.round, turnId: view.active } : null;
  return { c, units: [...view.order, ...view.waiting, ...view.outside], order: view.order.map((u) => u.id), vis: c.publicRolls ? "public" : "private", rules: roomSystem().rules, now: at, lines: [] };
}

/** The scene's grid scale (e.g. 100 ft per square). */
export async function sceneGrid(): Promise<{ multiplier: number; unit: string } | null> {
  try { const s = await OBR.scene.grid.getScale(); return { multiplier: s.parsed.multiplier, unit: s.parsed.unit }; } catch { return null; }
}

export const saveChase = (x: ChaseCtx) => OBR.scene.setMetadata({ [CHASE_KEY]: x.c satisfies ChaseState });
export const say = (x: ChaseCtx, line: string) => { x.lines.push(line); x.c = withLog(x.c, line); };
export const unitOf = (x: UnitCtx, id: string | undefined) => (id ? x.units.find((u) => u.id === id) : undefined);
/** Dead, at 0 HP, or gone from the scene. */
export const isDown = (x: UnitCtx, id: string) => { const u = unitOf(x, id); return !u || u.dead || u.state.hp <= 0; };

export async function freshUnit(x: UnitCtx, id: string): Promise<TrackerUnit | undefined> {
  const view = trackerView(await obrGateway.getItems(), await OBR.scene.getMetadata());
  const u = [...view.order, ...view.waiting, ...view.outside].find((v) => v.id === id);
  if (u) x.units = x.units.map((o) => (o.id === id ? u : o));
  return u;
}

// ------------------------------------------------------------------ units

const optionBonus = (u: TrackerUnit, kind: ChaseTest["kind"], o: { ability: Ability; skill?: string }) =>
  kind === "save" ? saveBonus(u.sheet, o.ability) : o.skill ? skillBonus(u.sheet, o.skill, o.ability) : abilityMod(u.sheet.abilities[o.ability]);

/** A unit's save or check against `test` with its best option; Exhaustion applies (2024 −2 per level, 2014 Disadvantage). */
export async function unitTest(x: UnitCtx, u: TrackerUnit, test: ChaseTest, why: string, extra?: Mode): Promise<{ total: number; pass: boolean; text: string }> {
  const best = [...test.options].sort((a, b) => optionBonus(u, test.kind, b) - optionBonus(u, test.kind, a))[0]!;
  const ex = exhaustionOnTest(exhaustionLevel(u.state), test.kind, x.rules);
  const mode = combineModes(ex.mode, extra);
  const name = optionText(best, test.kind);
  const r = await gmRoll(`1d20${fmtMod(optionBonus(u, test.kind, best) + ex.penalty)}`, `${name} · ${why} (DC ${test.dc})`,
    { unit: { id: u.id, name: u.name }, kind: test.kind === "save" ? "save" : "check", mode: mode === "normal" ? undefined : mode, visibility: x.vis });
  const pass = r.total >= test.dc;
  return { total: r.total, pass, text: `${name} ${r.total} vs DC ${test.dc}: ${pass ? "succeeds" : "fails"}` };
}

export const unitSave = (x: UnitCtx, u: TrackerUnit, ability: Ability, dc: number, why: string) =>
  unitTest(x, u, { kind: "save", dc, options: [{ ability }] }, why);

/** Rolls the damage dice once (an area or one source), for several units to take. */
export async function rollDamage(x: UnitCtx, parts: DamagePart[], why: string, unit?: TrackerUnit, crit = false): Promise<{ amount: number; type?: string }[]> {
  const out: { amount: number; type?: string }[] = [];
  for (const p of parts) {
    const dice = crit ? p.dice.replace(/(\d+)d(\d+)/g, (_m, n: string, d: string) => `${Number(n) * 2}d${d}`) : p.dice;
    const r = await gmRoll(dice, `${p.type} damage · ${why}`, { unit: unit ? { id: unit.id, name: unit.name } : undefined, kind: "damage", visibility: x.vis });
    out.push({ amount: r.total, type: p.type });
  }
  return out;
}

/** Applies rolled damage to a unit (halved if `half`), after its defenses. Returns "takes 7 damage (Resistance to Fire)". */
export async function hurtUnit(x: UnitCtx, u: TrackerUnit, rolled: { amount: number; type?: string }[], half = false): Promise<string> {
  const parts = rolled.map((p) => ({ ...p, amount: half ? Math.floor(p.amount / 2) : p.amount }));
  const hit = hitAgainst(u.sheet.defenses, parts);
  if (hit.amount > 0) await changeHp(obrGateway, [u.id], { kind: "damage", amount: hit.amount }, { autoDeadAtZero: roomSettings().autoDeadAtZero, system: roomSystem() });
  await freshUnit(x, u.id);
  return `takes ${hit.amount} damage${half ? " (half)" : ""}${hit.notes.length ? ` (${hit.notes.join("; ")})` : ""}`;
}

/** Adds conditions to a unit, skipping those it's immune to. Returns "" or " Immune to Prone." */
export async function condUnit(x: UnitCtx, u: TrackerUnit, conds: { key: string; duration?: Duration; note?: string }[]): Promise<string> {
  const t = (await freshUnit(x, u.id)) ?? u;
  let state = t.state;
  const skipped: string[] = [];
  for (const k of conds) {
    if (immuneToCondition(u.sheet.defenses, k.key)) { skipped.push(k.key[0]!.toUpperCase() + k.key.slice(1)); continue; }
    state = { ...state, ...addCondition(state, k.key, { duration: k.duration, now: x.now, note: k.note }) };
  }
  if (state !== t.state) await obrGateway.patchMetadata([{ id: u.id, key: STATE_KEY, patch: { conditions: state.conditions } }]);
  await freshUnit(x, u.id);
  return skipped.length ? ` Immune to ${skipped.join(", ")}.` : "";
}

/** A fall: 1d6 Bludgeoning per 10 feet (at most 20d6), landing Prone. */
export async function fallUnit(x: UnitCtx, u: TrackerUnit, feet: number, why: string): Promise<string> {
  const dice = fallDice(feet);
  const dmg = dice ? await hurtUnit(x, u, await rollDamage(x, [{ dice, type: "Bludgeoning" }], why, u)) : "takes no damage";
  return `falls ${feet} feet, ${dmg} and lands Prone.${await condUnit(x, u, [{ key: "prone" }])}`;
}

// ------------------------------------------------------------------ vehicles

export const vehicleById = (x: ChaseCtx, id: string) => x.c.vehicles.find((v) => v.id === id);
export const setVehicle = (x: ChaseCtx, v: Vehicle) => { x.c = { ...x.c, vehicles: x.c.vehicles.map((o) => (o.id === v.id ? v : o)) }; };

/** The driver's Proficiency Bonus if proficient (else 0), or null with no able driver at the helm. */
export function driverPb(x: ChaseCtx, v: Vehicle): number | null {
  const d = unitOf(x, v.driver);
  if (!d || d.dead || outOfFight(d)) return null;
  return driverProficient(v, d.sheet) ? d.sheet.proficiencyBonus : 0;
}

/** The vehicle's check or save with the best of `abilities`. `margin` is how much it failed by (0 on success or an automatic failure). */
export async function vehicleRoll(x: ChaseCtx, v: Vehicle, kind: "save" | "check", abilities: VAbility[], dc: number, why: string, extra?: Mode): Promise<{ pass: boolean; margin: number; auto: boolean; text: string }> {
  const pb = driverPb(x, v);
  const tests = abilities.map((a) => ({ a, t: vehicleTest(v, kind, a, pb, x.rules) })).sort((p, q) => Number(!!p.t.auto) - Number(!!q.t.auto) || q.t.bonus - p.t.bonus);
  const { a, t } = tests[0]!;
  const name = `${ABILITY_NAMES[a]} ${kind}`;
  if (t.auto) return { pass: false, margin: 0, auto: true, text: `${name}: ${t.auto}` };
  const mode = combineModes(t.mode, extra);
  const r = await gmRoll(`1d20${fmtMod(t.bonus)}`, `${v.name}: vehicle ${name} · ${why} (DC ${dc})`, { kind: kind === "save" ? "save" : "check", mode: mode === "normal" ? undefined : mode, visibility: x.vis });
  const pass = r.total >= dc;
  return { pass, margin: pass ? 0 : dc - r.total, auto: false, text: `vehicle ${name} ${r.total}${t.notes.length ? ` (${t.notes.join(", ")})` : ""} vs DC ${dc}: ${pass ? "succeeds" : "fails"}` };
}

/** Damage to a vehicle; a wrecked vehicle drops out; a mishap is rolled if the damage reached its mishap threshold. */
export async function hurtVehicle(x: ChaseCtx, id: string, amount: number, type: string | undefined, why: string): Promise<void> {
  const v = vehicleById(x, id);
  if (!v) return;
  const hit = damageVehicle(v, amount, type);
  setVehicle(x, hit.vehicle);
  say(x, `${v.name} takes ${hit.applied}${type ? ` ${type}` : ""} damage (${why})${hit.why ? `: ${hit.why}` : ""}; ${hit.vehicle.hp}/${v.maxHp} HP.`);
  if (hit.vehicle.hp <= 0) {
    x.c = { ...x.c, out: x.c.out.includes(id) ? x.c.out : [...x.c.out, id] };
    say(x, `${v.name} is wrecked and out of the chase. Its riders are on their own (the GM decides where they end up).`);
  } else if (hit.mishap) await rollMishap(x, id, `${hit.applied} damage reached its mishap threshold of ${v.mt}`);
}

/** Rolls on the Mishaps table and applies the result. */
export async function rollMishap(x: ChaseCtx, id: string, why: string): Promise<void> {
  const v = vehicleById(x, id);
  if (!v) return;
  const r = await gmRoll("1d20", `${v.name}: mishap`, { kind: "dice", visibility: x.vis });
  const m = mishapFor(r.total);
  if (m.key === "weapon" && !v.weapons) { say(x, `${v.name} mishap (d20 ${r.total}, ${why}): ${m.name}, but it has no weapons: no mishap.`); return; }
  if (m.key === "overturn") {
    setVehicle(x, { ...v, overturned: true, cover: undefined });
    const parts: string[] = [];
    for (const rider of ridersOf(v)) {
      const u = unitOf(x, rider.id);
      if (!u || u.dead) continue;
      if (rider.at === "clinging") {
        const s = await unitSave(x, u, "str", OVERTURN.clingDc, `${v.name} overturns`);
        if (s.pass) parts.push(`${u.name}: ${s.text}, holds on.`);
        else { setVehicle(x, dropRider(vehicleById(x, id)!, u.id)); parts.push(`${u.name}: ${s.text}, thrown off, lands Prone within 20 feet.${await condUnit(x, u, [{ key: "prone" }])}`); }
      } else {
        const s = await unitSave(x, u, "str", OVERTURN.insideDc, `${v.name} overturns`);
        const dmg = s.pass ? "no damage" : await hurtUnit(x, u, await rollDamage(x, [OVERTURN.damage], `${v.name} overturns`, u));
        parts.push(`${u.name}: falls Prone, ${s.text}, ${dmg}.${await condUnit(x, u, [{ key: "prone" }])}`);
      }
    }
    say(x, `${v.name} mishap (d20 ${r.total}, ${why}): Overturned! It ${overturnWord(v.terrain)} and comes to a dead stop. ${parts.join(" ")}`.trim());
    return;
  }
  if (!v.mishaps.includes(m.key)) setVehicle(x, { ...v, mishaps: [...v.mishaps, m.key] });
  let extra = "";
  if (m.key === "smoke") {
    const d = unitOf(x, v.driver);
    if (d && !d.dead) extra = ` ${d.name} is Blinded at the helm.${await condUnit(x, d, [{ key: "blinded", note: `${v.name}: Blinding Smoke (until repaired)` }])}`;
  }
  say(x, `${v.name} mishap (d20 ${r.total}, ${why}): ${m.name}. ${m.text}${m.repair ? ` Repair: DC ${m.repair.dc} ${ABILITY_NAMES[m.repair.ability]} check.` : ""}${extra}`);
}

/** The vehicle crashes after moving `feet`: damage to it (threshold applies) and to what it hit; riders make a DC 15 Strength save for half. */
export async function crashVehicle(x: ChaseCtx, id: string, feet: number, what: string): Promise<void> {
  const v = vehicleById(x, id);
  if (!v) return;
  const dice = crashDice(feet);
  if (!dice) { say(x, `${v.name} bumps ${what} at low speed: no damage.`); return; }
  const [hit] = await rollDamage(x, [{ dice, type: "Bludgeoning" }], `${v.name} crashes (${feet} ft)`);
  say(x, `${v.name} crashes into ${what} after ${feet} feet and comes to a sudden stop: ${hit!.amount} Bludgeoning damage (${dice}), and what it hit takes the same.`);
  await hurtVehicle(x, id, hit!.amount, "Bludgeoning", "crash");
  const parts: string[] = [];
  const after = vehicleById(x, id) ?? v;
  for (const rider of ridersOf(after)) {
    const u = unitOf(x, rider.id);
    if (!u || u.dead) continue;
    const s = await unitSave(x, u, "str", CRASH_SAVE_DC, `${v.name} crashes`);
    parts.push(`${u.name}: ${s.text}, ${await hurtUnit(x, u, [{ amount: hit!.amount, type: "Bludgeoning" }], s.pass)}.`);
  }
  if (parts.length) say(x, `Riders of ${v.name}: ${parts.join(" ")}`);
}

/** Resolves a vehicle chase complication on vehicle `id`. `feet`: how far it moved this turn (for a crash). */
export async function resolveVehicleComplication(x: ChaseCtx, id: string, comp: VehicleComplication, head: string, feet: number): Promise<void> {
  const v = vehicleById(x, id);
  if (!v) return;
  let failed = false;
  let testText = "";
  let mishap = false;
  if (comp.test) {
    const r = await vehicleRoll(x, v, comp.test.kind, comp.test.abilities, comp.test.dc, "chase complication");
    failed = !r.pass;
    testText = ` ${r.text}.`;
    mishap = comp.test.kind === "check" && !r.auto && r.margin >= MISHAP_MARGIN && !v.overturned;
  }
  const effects: string[] = [];
  if (!failed && comp.success?.cover && comp.test) { setVehicle(x, { ...vehicleById(x, id)!, cover: true }); effects.push(`${v.name} has Three-Quarters Cover against attacks from other vehicles until the start of its driver's next turn.`); }
  if (failed && comp.fail?.difficult) effects.push(`The obstacle counts as ${comp.fail.difficult} feet of Difficult Terrain for ${v.name}.`);
  if (failed && comp.fail?.overturn) { setVehicle(x, { ...vehicleById(x, id)!, overturned: true, cover: undefined }); effects.push(`${v.name} ${overturnWord(v.terrain)} and comes to a dead stop.`); }
  if (comp.note) effects.push(comp.note[0]!.toUpperCase() + comp.note.slice(1) + ".");
  say(x, `${head} ${comp.text} ${v.name} is affected.${testText}${effects.length ? ` ${effects.join(" ")}` : ""}`);
  if (failed && comp.fail?.damage) {
    const [d] = await rollDamage(x, [comp.fail.damage], `${v.name}: chase complication`);
    await hurtVehicle(x, id, d!.amount, d!.type, "chase complication");
  }
  if (failed && comp.fail?.crash) await crashVehicle(x, id, feet, "an obstacle");
  const rd = comp.riders;
  if (rd && (rd.when === "always" || failed)) {
    const now = vehicleById(x, id) ?? v;
    const who = ridersOf(now).filter((r) => (rd.who === "clinging" ? r.at === "clinging" : isExposed(r.at)));
    const shared = rd.damage ? await rollDamage(x, [rd.damage], `${v.name}: chase complication`) : null;
    const parts: string[] = [];
    for (const r of who) {
      const u = unitOf(x, r.id);
      if (!u || u.dead) continue;
      const s = rd.save ? await unitSave(x, u, rd.save.ability, rd.save.dc, "chase complication") : null;
      const out: string[] = [];
      if (s) out.push(s.text);
      if (shared && (!s || !s.pass || rd.save?.half)) out.push(await hurtUnit(x, u, shared, !!s?.pass));
      let cond = "";
      if (rd.blinded) { out.push("Blinded until the start of its next turn"); cond += await condUnit(x, u, [{ key: "blinded", duration: { kind: "turn", turnOf: u.id, at: "start" } }]); }
      if (rd.thrownOff && (!s || !s.pass)) {
        setVehicle(x, dropRider(vehicleById(x, id)!, u.id));
        if (rd.thrownOff.fall) out.push(`is thrown off: ${await fallUnit(x, u, rd.thrownOff.fall, `thrown off ${v.name}`)}`);
        else if (rd.thrownOff.water) out.push("goes overboard into the water");
        else { out.push(`is thrown off${rd.thrownOff.note ? ` (${rd.thrownOff.note})` : ""}`); if (/Prone/.test(rd.thrownOff.note ?? "")) cond += await condUnit(x, u, [{ key: "prone" }]); }
      } else if (rd.thrownOff && s?.pass) out.push("holds on");
      parts.push(`${u.name}: ${out.join(", ")}.${cond}`);
    }
    if (parts.length) say(x, `Riders of ${v.name}: ${parts.join(" ")}`);
    else if (who.length === 0 && rd.who === "clinging") say(x, `Nobody is clinging on to ${v.name}.`);
  }
  if (mishap && vehicleById(x, id)!.hp > 0) await rollMishap(x, id, `the check failed by ${MISHAP_MARGIN} or more`);
}

/** How far a vehicle moved this turn: the driver's tracked movement, else its Speed (doubled when Dashing). */
export const vehicleFeet = (x: ChaseCtx, v: Vehicle, moved: number, dashed: boolean) => (moved > 0 ? moved : effectiveSpeed(v, x.rules) * (dashed ? 2 : 1));

const SIZES = ["T", "S", "M", "L", "H", "G"];

/** The vehicle drives into a creature's space: a DC 10 Dexterity save (its reaction) to get clear, else 1d6 per 10 feet. */
export async function ramCreature(x: ChaseCtx, id: string, unitId: string, feet: number): Promise<void> {
  const v = vehicleById(x, id), u = unitOf(x, unitId);
  if (!v || !u) return;
  const dice = crashDice(feet);
  const s = await unitSave(x, u, "dex", 10, `${v.name} runs it down`);
  if (s.pass || !dice) { say(x, `${v.name} drives at ${u.name}: ${s.text}${s.pass ? `, ${u.name} gets out of the way` : ", but at too low a speed to hurt"}.`); return; }
  const dmg = await hurtUnit(x, u, await rollDamage(x, [{ dice, type: "Bludgeoning" }], `${v.name} slams into it (${feet} ft)`, u));
  const through = SIZES.indexOf(v.size) - SIZES.indexOf(u.sheet.size) >= 2;
  say(x, `${v.name} slams into ${u.name}: ${s.text}, ${u.name} ${dmg}.${through ? ` ${v.name} is two sizes bigger and can keep moving through.` : ` ${v.name} comes to a sudden stop.`}`);
  if (through) return;
  const [hit] = await rollDamage(x, [{ dice, type: "Bludgeoning" }], `${v.name} stops suddenly`);
  const parts: string[] = [];
  for (const rider of ridersOf(v)) {
    const r = unitOf(x, rider.id);
    if (!r || r.dead) continue;
    const save = await unitSave(x, r, "str", CRASH_SAVE_DC, `${v.name} stops suddenly`);
    parts.push(`${r.name}: ${save.text}, ${await hurtUnit(x, r, [hit!], save.pass)}.`);
  }
  if (parts.length) say(x, `Riders of ${v.name}: ${parts.join(" ")}`);
}

/** A creature tries to end a mishap: an ability check (plus its Proficiency Bonus with the right tools), at Disadvantage while the vehicle moves. */
export async function repairMishap(x: ChaseCtx, id: string, key: string, unitId: string, tools: boolean): Promise<void> {
  const v = vehicleById(x, id), u = unitOf(x, unitId);
  const m = MISHAPS_BY_KEY[key];
  if (!v || !u || !m?.repair) return;
  const ex = exhaustionOnTest(exhaustionLevel(u.state), "check", x.rules);
  const mode = combineModes(ex.mode, v.overturned ? undefined : "disadvantage");
  const bonus = abilityMod(u.sheet.abilities[m.repair.ability]) + (tools ? u.sheet.proficiencyBonus : 0) + ex.penalty;
  const r = await gmRoll(`1d20${fmtMod(bonus)}`, `${ABILITY_NAMES[m.repair.ability]} check · repair ${m.name} on ${v.name} (DC ${m.repair.dc})`, { unit: { id: u.id, name: u.name }, kind: "check", mode: mode === "normal" ? undefined : mode, visibility: x.vis });
  if (r.total < m.repair.dc) { say(x, `${u.name} tries to repair ${m.name} on ${v.name}: ${r.total} vs DC ${m.repair.dc}, not yet.`); return; }
  setVehicle(x, { ...v, mishaps: v.mishaps.filter((k) => k !== m.key) });
  say(x, `${u.name} repairs ${m.name} on ${v.name} (${r.total} vs DC ${m.repair.dc}).`);
  if (m.key === "smoke") await clearSmoke(x, v);
}

/** Blinding Smoke ends: its Blinded condition goes from whoever got it. */
export async function clearSmoke(x: ChaseCtx, v: Vehicle) {
  for (const u of x.units) {
    const c = u.state.conditions.find((k) => k.key === "blinded" && k.note === `${v.name}: Blinding Smoke (until repaired)`);
    if (c) await obrGateway.patchMetadata([{ id: u.id, key: STATE_KEY, patch: { conditions: u.state.conditions.filter((k) => k.id !== c.id) } }]);
  }
}
