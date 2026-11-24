/**
 * Naval and aerial combat on the Owlbear scene (rules in core/naval.ts): rolling and applying ship actions, crashes,
 * crew events and repairs, and falls of creatures in the air. Shared by the DM Tools panel (navalPanel.ts) and the
 * background page (background/naval.ts). Every roll goes through gmRoll; damage to units follows their defenses.
 */
import OBR from "@owlbear-rodeo/sdk";
import { skillBonus } from "../core/combatOptions";
import type { TurnPoint } from "../core/conditions";
import { fmtMod } from "../core/dice";
import {
  actionCount, afterFiring, attackMode, bosunRepair, BOSUN_DC, canTurn, casualtyDice, CRASH_CON_DC, crashPlan, damagedParts, damageShip, fallDamageFeet,
  fallDice, fallReason, fallStep, FIRE_CHECKS, FIRE_DAMAGE, FIRE_RESULT, fullSpeedAhead, groupResult, isDestroyed, isWrecked, loseCrew, mutinyResult,
  NAVAL_KEY, OFFICER_LABEL, ramAttack, readNaval, repairShip, setQuality, shipActions, shipInitiativeBonus, shipSpeed, shipTest, SIZE_LABEL, startShipTurn,
  staysAloft, takeAim, TILT_DC, EMERGENCY_REPAIR, canPatch, AIRSHIP_HAZARDS, weaponReady, weaponStep, withNavalLog, type Aloft, type Component, type NavalState, type Officer, type Ship,
} from "../core/naval";
import { abilityMod, STATE_KEY, type Ability, type SizeCode } from "../core/sheet";
import { trackerView, type TrackerUnit } from "../core/tracker";
import { condUnit, freshUnit, hurtUnit, rollDamage, unitOf, type UnitCtx } from "./chaseRun";
import { gmRoll } from "./gmRoll";
import { obrGateway } from "./obrGateway";
import { roomSystem } from "./roomSettings";

export interface NavalCtx extends UnitCtx { n: NavalState }

export async function navalCtx(now?: TurnPoint | null): Promise<NavalCtx> {
  const meta = await OBR.scene.getMetadata();
  const n = readNaval(meta);
  const view = trackerView(await obrGateway.getItems(), meta);
  const at = now !== undefined ? now : view.encounter.started && view.active ? { round: view.encounter.round, turnId: view.active } : null;
  return { n, units: [...view.order, ...view.waiting, ...view.outside], vis: n.publicRolls ? "public" : "private", rules: roomSystem().rules, now: at, lines: [] };
}

export const saveNaval = (x: NavalCtx) => OBR.scene.setMetadata({ [NAVAL_KEY]: x.n satisfies NavalState });
export const nsay = (x: NavalCtx, line: string) => { x.lines.push(line); x.n = withNavalLog(x.n, line); };
export const shipById = (x: NavalCtx, id: string) => x.n.ships.find((s) => s.id === id);
export const setShip = (x: NavalCtx, s: Ship) => { x.n = { ...x.n, ships: x.n.ships.map((o) => (o.id === s.id ? s : o)) }; };
const officer = (x: NavalCtx, s: Ship, o: Officer) => { const u = unitOf(x, s.officers[o]); return u && !u.dead && u.state.hp > 0 ? u : undefined; };
const sumParts = (parts: { amount: number; type?: string }[]) => {
  const ok = parts.filter((p) => !p.type || !/^(poison|psychic)$/i.test(p.type));
  return { amount: ok.reduce((t, p) => t + p.amount, 0), type: ok.length === 1 ? ok[0]!.type : ok.length ? ok.map((p) => p.type).filter(Boolean).join(" and ") : parts[0]?.type };
};

/** A unit's check with a tool or skill: skill bonus from the sheet, or ability + Proficiency Bonus when its proficiencies list the tool. */
function checkBonus(u: TrackerUnit, ability: Ability, skill?: string, tool?: string): number {
  if (skill) return skillBonus(u.sheet, skill, ability);
  const re = tool && /vehicles/i.test(tool) ? /vehicles?\s*\(\s*(water|sea|air|space)/i : tool ? new RegExp(tool.split(/\s+/)[0]!, "i") : null;
  return abilityMod(u.sheet.abilities[ability]) + (re && re.test(u.sheet.proficiencies ?? "") ? u.sheet.proficiencyBonus : 0);
}

async function shipRoll(x: NavalCtx, s: Ship, ability: "str" | "dex" | "con", dc: number, why: string, mode?: "advantage" | "disadvantage"): Promise<{ pass: boolean; text: string }> {
  const t = shipTest(s, ability);
  const name = `${ability === "str" ? "Strength" : ability === "dex" ? "Dexterity" : "Constitution"} save`;
  if (t.auto) return { pass: false, text: `${name}: ${t.auto}` };
  const r = await gmRoll(`1d20${fmtMod(t.bonus)}`, `${s.name}: ${name} · ${why} (DC ${dc})`, { kind: "save", mode, visibility: x.vis });
  return { pass: r.total >= dc, text: `${name} ${r.total} vs DC ${dc}: ${r.total >= dc ? "succeeds" : "fails"}` };
}

// ------------------------------------------------------------------ turns

export async function rollShipInitiative(x: NavalCtx, id: string): Promise<void> {
  const s = shipById(x, id);
  if (!s) return;
  const bonus = shipInitiativeBonus(s);
  if (bonus === null) { nsay(x, `${s.name} has no Dexterity: its crew act on their own turns (AAG suggests side initiative).`); return; }
  const r = await gmRoll(`1d20${fmtMod(bonus)}`, `${s.name}: initiative (Dexterity + crew quality)`, { kind: "dice", visibility: x.vis });
  setShip(x, { ...s, initiative: r.total });
  nsay(x, `${s.name} rolls initiative: ${r.total}.`);
}

/** The ship's turn begins: actions reset; the line says what it can do. */
export function beginShipTurn(x: NavalCtx, id: string): void {
  const s0 = shipById(x, id);
  if (!s0) return;
  const s = startShipTurn(s0);
  setShip(x, s);
  const n = actionCount(s) ?? 0;
  const sp = shipSpeed(s, x.n.wind);
  const acts = shipActions(s).map((a) => (a.key === "move" ? `Move ${sp.speed} ft${sp.via ? ` (${sp.via})` : ""}` : a.label));
  const notes = [!canTurn(s) ? "helm destroyed: it can't turn" : "", s.fullSpeed ? `Full Speed Ahead +${s.fullSpeed.bonus} ft` : ""].filter(Boolean);
  nsay(x, `⚓ ${s.name}'s turn${s.initiative !== undefined ? ` (initiative ${s.initiative})` : ""}: ${n ? `${n} action${n > 1 ? "s" : ""} (${s.crew} crew): ${acts.join(", ")}` : "no actions (too few crew)"}.${notes.length ? ` ${notes.join("; ")}.` : ""}`);
}

/** Marks a crewed ship's action as taken (each once per turn, up to its action count). Returns false if it can't. */
export function useAction(x: NavalCtx, id: string, key: string, label: string): boolean {
  const s = shipById(x, id);
  if (!s) return false;
  const n = actionCount(s);
  if (n === null) return true;
  if (s.used.includes(key)) { nsay(x, `${s.name} already took ${label} this turn (each action once per turn).`); return false; }
  if (s.used.length >= n) { nsay(x, `${s.name} has no actions left this turn (${n} with ${s.crew} crew).`); return false; }
  setShip(x, { ...s, used: [...s.used, key] });
  return true;
}

export function moveShip(x: NavalCtx, id: string, feet: number): void {
  const s = shipById(x, id);
  if (!s || !useAction(x, id, "move", "Move")) return;
  const sp = shipSpeed(s, x.n.wind);
  const ft = Math.max(0, Math.min(sp.speed, Math.floor(feet || sp.speed)));
  setShip(x, { ...shipById(x, id)!, moved: s.moved + ft });
  nsay(x, `${s.name} moves ${ft} ft${sp.via ? ` with its ${sp.via.toLowerCase()}` : ""} (speed ${sp.speed}${sp.notes.length ? `: ${sp.notes.join(", ")}` : ""})${canTurn(s) ? ", with one 90-degree turn" : ", straight ahead (helm destroyed)"}.`);
}

// ------------------------------------------------------------------ weapons

export type ShipTarget = { kind: "ship"; id: string; comp: string } | { kind: "unit"; id: string };

/** Fires weapons (a crewed ship's Fire action fires every working weapon in the group) at one target. */
export async function fireWeapons(x: NavalCtx, id: string, compIds: string[], target: ShipTarget, distance?: number): Promise<void> {
  for (const cid of compIds) {
    const s = shipById(x, id);
    const c = s?.comps.find((o) => o.id === cid);
    if (!s || !c) continue;
    const a = c.attacks?.[0];
    if (!a) { nsay(x, `${c.name}: ${c.text ?? "no attack roll"} (resolve it by hand).`); continue; }
    if (isDestroyed(c)) { nsay(x, `${c.name} is destroyed and can't fire.`); continue; }
    if (s.coreOff && /elemental core/i.test(a.name)) { nsay(x, `${c.name} needs the elemental core, which is suppressed.`); continue; }
    if (!weaponReady(c)) { nsay(x, `${c.name} isn't ready: loaded ${c.loaded ?? 0}/${c.load ?? 0}, aimed ${c.aimed ?? 0}/${c.aim ?? 0}.`); continue; }
    const m = attackMode(a, { distance, wind: x.n.wind, aimed: c.aimAdv !== undefined && c.aimAdv >= s.turn });
    if (!m.ok) { nsay(x, `${c.name} can't fire: ${m.notes.join(", ")}.`); continue; }
    const tShip = target.kind === "ship" ? shipById(x, target.id) : undefined;
    const tComp = tShip && target.kind === "ship" && target.comp !== "hull" ? tShip.comps.find((o) => o.id === target.comp) : undefined;
    const tUnit = target.kind === "unit" ? unitOf(x, target.id) : undefined;
    const ac = tComp ? tComp.ac : tShip ? tShip.hull.ac : tUnit?.ac ?? 10;
    const tName = tShip ? `${tShip.name}'s ${tComp ? tComp.name.toLowerCase() : "hull"}` : tUnit?.name ?? "the target";
    const r = await gmRoll(`1d20${fmtMod(a.bonus)}`, `${s.name}: ${c.name} · ${a.name} vs ${tName} (AC ${ac})`, { kind: "attack", mode: m.mode === "normal" ? undefined : m.mode, visibility: x.vis });
    setShip(x, { ...shipById(x, id)!, comps: shipById(x, id)!.comps.map((o) => (o.id === cid ? afterFiring(o) : o)) });
    const crit = r.natural === 20;
    const hit = r.natural !== 1 && (crit || r.total >= ac);
    const head = `${s.name}'s ${c.name} fires at ${tName}: ${r.total}${m.notes.length ? ` (${m.notes.join(", ")})` : ""} vs AC ${ac}, ${crit ? "critical hit" : hit ? "hit" : "miss"}`;
    if (!hit) { nsay(x, `${head}.`); continue; }
    if (!a.damage.length) { nsay(x, `${head}. ${a.text.replace(/^.*?Hit:\s*/, "")}`); continue; }
    const rolled = await rollDamage(x, a.damage, `${s.name}: ${c.name}`, tUnit, crit);
    const extra = /grappled|harpooned|speed of .* become 0|teleported/i.test(a.text) ? ` ${a.text.replace(/^.*?damage[,.]?\s*/, "")}` : "";
    if (tUnit) nsay(x, `${head}. ${tUnit.name} ${await hurtUnit(x, tUnit, rolled)}.${extra}`);
    else if (tShip && target.kind === "ship") { const p = sumParts(rolled); nsay(x, `${head}.${extra}`); await hurtShip(x, tShip.id, target.comp, p.amount, p.type, `${s.name}'s ${c.name}`); }
  }
}

/** One action loading (then aiming) a spelljammer weapon. */
export function weaponAction(x: NavalCtx, id: string, cid: string, by?: string): void {
  const s = shipById(x, id);
  const c = s?.comps.find((o) => o.id === cid);
  if (!s || !c) return;
  const r = weaponStep(c);
  if (!r.did) { nsay(x, `${c.name} is loaded and aimed: ready to fire.`); return; }
  setShip(x, { ...s, comps: s.comps.map((o) => (o.id === cid ? r.comp : o)) });
  const who = unitOf(x, by)?.name;
  nsay(x, `${who ? `${who} spends an action ${r.did === "load" ? "loading" : "aiming"}` : r.did === "load" ? "Loading" : "Aiming"} ${c.name} (${r.did === "load" ? `${r.comp.loaded}/${c.load}` : `${r.comp.aimed}/${c.aim}`})${weaponReady(r.comp) ? ": ready to fire" : ""}.`);
}

// ------------------------------------------------------------------ officers

export async function callFullSpeed(x: NavalCtx, id: string, by: string): Promise<void> {
  const s = shipById(x, id);
  if (!s) return;
  const r = await gmRoll("1d6", `${s.name}: Full Speed Ahead`, { kind: "dice", visibility: x.vis });
  const f = fullSpeedAhead(s, r.total);
  setShip(x, f.ship);
  const who = unitOf(x, by)?.name ?? "An officer";
  nsay(x, f.kept ? `${who} calls Full Speed Ahead on ${s.name}: +${f.bonus} ft, but the current +${s.fullSpeed?.bonus} ft is higher and stays.` : `${who} calls Full Speed Ahead on ${s.name}: +${f.bonus} ft speed until the end of its next turn.`);
}

export function callTakeAim(x: NavalCtx, id: string, cid: string, by: string): void {
  const s = shipById(x, id);
  const c = s?.comps.find((o) => o.id === cid);
  if (!s || !c) return;
  setShip(x, takeAim(s, cid));
  nsay(x, `${unitOf(x, by)?.name ?? "An officer"} takes aim with ${s.name}'s ${c.name}: Advantage on its next attack before the end of the ship's next turn.`);
}

// ------------------------------------------------------------------ damage

/** Damage to a ship's hull or component; destroyed and wrecked are announced; a destroyed balloon brings an airship down. */
export async function hurtShip(x: NavalCtx, id: string, comp: string, amount: number, type: string | undefined, why: string): Promise<void> {
  const s = shipById(x, id);
  if (!s) return;
  const hit = damageShip(s, comp, amount, type);
  setShip(x, hit.ship);
  const left = comp === "hull" ? `${hit.ship.hull.hp}/${s.hull.maxHp} HP` : (() => { const c = hit.ship.comps.find((o) => o.id === comp); return c ? `${c.hp}/${c.maxHp} HP` : ""; })();
  nsay(x, `${s.name}'s ${hit.target.toLowerCase()} takes ${hit.applied}${type ? ` ${type}` : ""} damage (${why})${hit.why ? `: ${hit.why}` : ""}; ${left}.`);
  if (hit.destroyed) nsay(x, `${s.name}'s ${hit.target.toLowerCase()} is destroyed and unusable.${!canTurn(hit.ship) ? " The ship can't turn." : ""}`);
  if (hit.wrecked) nsay(x, `${s.name} is wrecked: its hull is destroyed.${s.env === "water" ? " It's sinking." : s.altitude > 0 ? " It falls." : ""}`);
  if (s.altitude > 0 && ((hit.destroyed && !staysAloft(hit.ship)) || (hit.wrecked && s.type !== "airship"))) await shipFalls(x, id, hit.wrecked ? "its hull is destroyed" : `its ${hit.target.toLowerCase()} is destroyed and it can't stay aloft`);
}

/** An airship comes down from its altitude (BGDIA "Falling"): it and everyone aboard take 1d6 per 10 feet (at most 20d6) and land Prone. */
export async function shipFalls(x: NavalCtx, id: string, why: string): Promise<void> {
  const s = shipById(x, id);
  if (!s || s.altitude <= 0) return;
  const ft = s.altitude;
  const dice = fallDice(ft);
  setShip(x, { ...s, altitude: 0 });
  if (!dice) { nsay(x, `${s.name} drops ${ft} ft (${why}): no damage.`); return; }
  const r = await gmRoll(dice, `${s.name}: falls ${ft} ft`, { kind: "damage", visibility: x.vis });
  nsay(x, `${s.name} falls ${ft} ft (${why})${x.n.rateOfFalling && ft > 500 ? ", 500 ft per round (the GM decides where it is when it lands)" : ""}.`);
  await hurtShip(x, id, "hull", r.total, "Bludgeoning", "the fall");
  for (const uid of s.aboard) {
    const u = unitOf(x, uid);
    if (!u || u.dead) continue;
    nsay(x, `${u.name} ${await hurtUnit(x, u, [{ amount: r.total, type: "Bludgeoning" }])} and lands Prone.${await condUnit(x, u, [{ key: "prone" }])}`);
  }
}

// ------------------------------------------------------------------ crashing

export type CrashTarget = { kind: "ship"; id: string } | { kind: "unit"; id: string } | { kind: "object"; size: SizeCode; ac: number; immovable?: boolean };

/** Crashing (GoS for ships under sail and oar, AAG for spelljammers and elemental airships). `sure`: the GM rules the crash unavoidable (AAG: no attack roll). */
export async function crashShip(x: NavalCtx, id: string, target: CrashTarget, sure = false): Promise<void> {
  const s = shipById(x, id);
  if (!s) return;
  const tShip = target.kind === "ship" ? shipById(x, target.id) : undefined;
  const tUnit = target.kind === "unit" ? unitOf(x, target.id) : undefined;
  const size: SizeCode = tShip ? tShip.size : tUnit ? tUnit.sheet.size : target.kind === "object" ? target.size : ("M" as SizeCode);
  const tName = tShip?.name ?? tUnit?.name ?? `a ${SIZE_LABEL[size]!.toLowerCase()} object`;
  const plan = crashPlan(s, size, { immovable: target.kind === "object" && target.immovable });
  if (plan.rules === "gos") {
    const parts: string[] = [];
    if (plan.noCrash) parts.push(`${tName} is at least two sizes smaller: ${s.name} doesn't crash and keeps moving; ${tName} ends up in the nearest unoccupied space out of its path.`);
    else {
      const save = await shipRoll(x, s, "con", CRASH_CON_DC, `crashes into ${tName}`, plan.ram ? "advantage" : undefined);
      parts.push(`${s.name} crashes into ${tName}: ${save.text}${plan.ram ? " (naval ram: Advantage)" : ""}.`);
      nsay(x, parts.join(" ")); parts.length = 0;
      if (!save.pass && plan.shipDice) {
        const r = await gmRoll(plan.shipDice, `${s.name}: crash damage (${SIZE_LABEL[size]})`, { kind: "damage", visibility: x.vis });
        await hurtShip(x, id, plan.ram ? plan.ram.id : "hull", r.total, "Bludgeoning", `crash into ${tName}${plan.ram ? ", taken by the ram" : ""}`);
      }
      parts.push(plan.stops ? `${s.name} stops.` : `${s.name} keeps moving; ${tName} moves to the nearest unoccupied space out of its path${target.kind === "object" ? " (a fixed object may be destroyed instead, GM's call)" : ""}.`);
    }
    if ((tUnit || tShip) && plan.targetDice) {
      const why = `struck by ${s.name}`;
      if (tUnit) {
        const u = (await freshUnit(x, tUnit.id)) ?? tUnit;
        const r = await gmRoll(`1d20${fmtMod(u.sheet.saves.dex ?? abilityMod(u.sheet.abilities.dex))}`, `Dexterity save · ${why} (DC ${plan.dexDc})`, { unit: { id: u.id, name: u.name }, kind: "save", visibility: x.vis });
        const pass = r.total >= plan.dexDc!;
        const dmg = await rollDamage(x, [{ dice: plan.targetDice, type: "Bludgeoning" }], why, u);
        parts.push(`${u.name}: Dexterity save ${r.total} vs DC ${plan.dexDc}, ${u.name} ${await hurtUnit(x, u, dmg, pass)}.`);
      } else if (tShip) {
        // Butler's ruling: a rammed ship is struck like a creature (its Dexterity save, damage by the rammer's size) on its hull.
        const sv = await shipRoll(x, tShip, "dex", plan.dexDc!, why);
        const r = await gmRoll(plan.targetDice, `${tShip.name}: rammed by ${s.name}`, { kind: "damage", visibility: x.vis });
        parts.push(`${tShip.name}: ${sv.text} (Butler's ruling: struck like a creature).`);
        nsay(x, parts.join(" ")); parts.length = 0;
        await hurtShip(x, tShip.id, "hull", sv.pass ? Math.floor(r.total / 2) : r.total, "Bludgeoning", `rammed by ${s.name}${sv.pass ? ", half" : ""}`);
      }
    }
    if (parts.length) nsay(x, parts.join(" "));
    return;
  }
  if (plan.rules === "efa") {
    // EFA: no attack roll. A creature in the path can dodge (DC 15 Dexterity); both take damage by the size struck; everyone aboard saves.
    if (tUnit) {
      const u = (await freshUnit(x, tUnit.id)) ?? tUnit;
      const r = await gmRoll(`1d20${fmtMod(u.sheet.saves.dex ?? abilityMod(u.sheet.abilities.dex))}`, `Dexterity save · out of ${s.name}'s path (DC ${plan.dodgeDc})`, { unit: { id: u.id, name: u.name }, kind: "save", visibility: x.vis });
      if (r.total >= plan.dodgeDc!) { nsay(x, `${s.name} bears down on ${u.name}: Dexterity save ${r.total} vs DC ${plan.dodgeDc}, ${u.name} gets out of its path to the nearest unoccupied space and takes no damage.`); return; }
    }
    const dmg = await gmRoll(plan.shipDice, `${s.name}: crash damage (${SIZE_LABEL[size]})`, { kind: "damage", visibility: x.vis });
    nsay(x, `${s.name} crashes into ${tName}: both take ${dmg.total} Bludgeoning damage.${plan.stops ? ` ${s.name} stops.` : ` ${s.name} can keep moving; ${tName} moves to the nearest unoccupied space out of its path.`}`);
    await hurtShip(x, id, "hull", dmg.total, "Bludgeoning", `crash into ${tName}`);
    if (tShip) await hurtShip(x, tShip.id, "hull", dmg.total, "Bludgeoning", `${s.name} crashes into it`);
    if (tUnit) nsay(x, `${tUnit.name} ${await hurtUnit(x, tUnit, [{ amount: dmg.total, type: "Bludgeoning" }])}.`);
    await aboardSaves(x, shipById(x, id)!, plan.aboardDc!, plan.targetDice, `${s.name} crashes`);
    if (tShip) await aboardSaves(x, shipById(x, tShip.id)!, plan.aboardDc!, plan.targetDice, `${s.name} crashes into ${tShip.name}`);
    return;
  }
  // AAG: the spelljammer's attack roll, or the ship's ram against an object or a Gargantuan target.
  const pilot = officer(x, s, "pilot");
  const ram = ramAttack(s);
  const useRam = !!ram && (size === "G" || target.kind === "object" || !!tShip);
  const ac = tShip ? tShip.hull.ac : tUnit ? tUnit.ac : target.kind === "object" ? target.ac : 10;
  let hit = sure, crit = false, text = sure ? "the GM rules it unavoidable" : "";
  if (!sure) {
    if (!pilot && !useRam) { nsay(x, `${s.name} has no pilot at the helm to steer it into ${tName}.`); return; }
    const bonus = useRam ? ram!.bonus : pilot!.sheet.proficiencyBonus;
    const r = await gmRoll(`1d20${fmtMod(bonus)}`, `${s.name}: ${useRam ? ram!.name : "crash"} vs ${tName} (AC ${ac})`, { kind: "attack", visibility: x.vis });
    crit = r.natural === 20;
    hit = r.natural !== 1 && (crit || r.total >= ac);
    text = `${useRam ? ram!.name : `crash attack (d20 + ${pilot!.name}'s Proficiency Bonus)`} ${r.total} vs AC ${ac}: ${hit ? "hit" : "miss"}`;
  }
  if (!hit) { nsay(x, `${s.name} tries to run into ${tName}: ${text}. ${tName} moves out of its path${useRam ? " into the nearest unoccupied space" : ""}.`); return; }
  const dice = useRam ? ram!.damage[0]?.dice ?? plan.targetDice : plan.targetDice;
  const type = useRam ? ram!.damage[0]?.type ?? "Bludgeoning" : "Bludgeoning";
  const r = await gmRoll(crit ? dice.replace(/(\d+)d/, (_m, k: string) => `${Number(k) * 2}d`) : dice, `${s.name}: crash damage`, { kind: "damage", visibility: x.vis });
  nsay(x, `${s.name} crashes into ${tName}: ${text}. Both take ${useRam ? `${r.total} (the ship half)` : r.total} damage.${useRam || plan.stops ? ` ${s.name} comes to a dead stop.` : ` ${tName} moves to the nearest unoccupied space out of its path.`} Check the gravity planes: creatures may fall (AAG).`);
  await hurtShip(x, id, "hull", useRam ? Math.floor(r.total / 2) : r.total, "Bludgeoning", `crash into ${tName}`);
  if (tShip) await hurtShip(x, tShip.id, "hull", r.total, type, `${s.name} crashes into it`);
  if (tUnit) nsay(x, `${tUnit.name} ${await hurtUnit(x, tUnit, [{ amount: r.total, type }])}.`);
}

// ------------------------------------------------------------------ crew

export async function areaCasualties(x: NavalCtx, id: string, spellLevel: number): Promise<void> {
  const s = shipById(x, id);
  if (!s) return;
  const r = await gmRoll(casualtyDice(spellLevel), `${s.name}: crew caught in a level ${spellLevel} spell`, { kind: "dice", visibility: x.vis });
  setShip(x, loseCrew(s, r.total));
  const after = loseCrew(s, r.total);
  nsay(x, `${r.total} of ${s.name}'s crew are caught in the spell (1d6 per spell level): ${after.crew} crew left${actionCount(after) !== null ? `, ${actionCount(after)} action${actionCount(after) === 1 ? "" : "s"} per turn` : ""}.`);
}

export function crewLoss(x: NavalCtx, id: string, n: number): void {
  const s = shipById(x, id);
  if (!s || !n) return;
  const after = n > 0 ? loseCrew(s, n) : { ...s, crew: Math.min(s.crewMax, s.crew - n) };
  setShip(x, after);
  nsay(x, `${s.name}: ${n > 0 ? `${n} crew lost` : `${-n} crew back`}, ${after.crew} crew${actionCount(after) !== null ? `, ${actionCount(after)} action${actionCount(after) === 1 ? "" : "s"} per turn` : ""}.`);
}

export async function mutinyCheck(x: NavalCtx, id: string): Promise<void> {
  const s = shipById(x, id);
  if (!s) return;
  const cap = officer(x, s, "captain");
  if (!cap) { nsay(x, `${s.name} has no captain to keep the crew in line.`); return; }
  const best = Math.max(skillBonus(cap.sheet, "Intimidation", "cha"), skillBonus(cap.sheet, "Persuasion", "cha"));
  const r = await gmRoll(`1d20${fmtMod(best + s.quality)}`, `${cap.name}: Charisma check to head off a mutiny (crew quality ${fmtMod(s.quality)})`, { unit: { id: cap.id, name: cap.name }, kind: "check", visibility: x.vis });
  const m = mutinyResult(r.total);
  setShip(x, setQuality(s, s.quality + m.qualityChange));
  nsay(x, `${s.name}: ${cap.name}'s check ${r.total}. ${m.text}`);
}

/** Fire aboard: the officers' and crew's group check, then its effects. */
export async function fireAboard(x: NavalCtx, id: string, dc: number): Promise<void> {
  const s = shipById(x, id);
  if (!s) return;
  const parts: string[] = [];
  let passed = 0;
  for (const f of FIRE_CHECKS) {
    const u = officer(x, s, f.officer);
    if (!u) { parts.push(`${OFFICER_LABEL[f.officer]}: nobody (fails)`); continue; }
    const r = await gmRoll(`1d20${fmtMod(checkBonus(u, f.ability, f.skill, f.tool))}`, `${u.name}: ${f.label} · fire aboard ${s.name} (DC ${dc})`, { unit: { id: u.id, name: u.name }, kind: "check", visibility: x.vis });
    if (r.total >= dc) passed++;
    parts.push(`${OFFICER_LABEL[f.officer]} ${u.name} ${r.total}`);
  }
  const crew = await gmRoll(`1d20${fmtMod(s.quality)}`, `${s.name}: crew · fire aboard (DC ${dc})`, { kind: "check", visibility: x.vis });
  if (crew.total >= dc) passed++;
  parts.push(`crew ${crew.total}`);
  const res = groupResult(passed, FIRE_CHECKS.length + 1);
  const eff = FIRE_RESULT[res];
  nsay(x, `🔥 Fire aboard ${s.name} (DC ${dc}): ${parts.join(", ")}: ${passed}/${FIRE_CHECKS.length + 1}, ${res}. ${eff.text}`);
  if (eff.quality) setShip(x, setQuality(shipById(x, id)!, s.quality + eff.quality));
  if (!eff.damage) return;
  const dmg = await gmRoll(FIRE_DAMAGE.dice, `${s.name}: fire damage`, { kind: "damage", visibility: x.vis });
  const k = await gmRoll("1d3", `${s.name}: components the fire reaches`, { kind: "dice", visibility: x.vis });
  const pool = s.comps.filter((c) => c.maxHp && !isDestroyed(c));
  const hit = [...pool].sort(() => Math.random() - 0.5).slice(0, k.total);
  await hurtShip(x, id, "hull", dmg.total, "Fire", "fire aboard");
  for (const c of hit) await hurtShip(x, id, c.id, dmg.total, "Fire", "fire aboard");
}

/** The bosun's end-of-day repair: Strength (carpenter's tools) check, 15+ heals every damaged part by 1d6 + quality. */
export async function bosunRepairs(x: NavalCtx, id: string): Promise<void> {
  const s = shipById(x, id);
  if (!s) return;
  const b = officer(x, s, "bosun");
  if (!b) { nsay(x, `${s.name} has no bosun to lead repairs.`); return; }
  const r = await gmRoll(`1d20${fmtMod(checkBonus(b, "str", undefined, "Carpenter's Tools"))}`, `${b.name}: Strength (carpenter's tools) · repairs on ${s.name} (DC ${BOSUN_DC})`, { unit: { id: b.id, name: b.name }, kind: "check", visibility: x.vis });
  if (r.total < BOSUN_DC) { nsay(x, `${b.name}'s repairs on ${s.name}: ${r.total}, not enough (15 needed).`); return; }
  const rolls: Record<string, number> = {};
  for (const p of damagedParts(s)) rolls[p] = (await gmRoll("1d6", `${s.name}: repair ${p === "hull" ? "hull" : s.comps.find((c) => c.id === p)?.name}`, { kind: "dice", visibility: x.vis })).total;
  const after = bosunRepair(s, rolls);
  setShip(x, after);
  nsay(x, `${b.name}'s repairs on ${s.name}: ${r.total}. ${Object.keys(rolls).length ? Object.keys(rolls).map((p) => `${p === "hull" ? "hull" : s.comps.find((c) => c.id === p)!.name} ${p === "hull" ? after.hull.hp : after.comps.find((c) => c.id === p)!.hp} HP`).join(", ") : "Nothing was damaged."}`);
}

/** Mending on a ship or shipboard weapon (AAG): 1d8 + the caster's spellcasting modifier, once per hour per target. */
export async function mending(x: NavalCtx, id: string, comp: string, mod: number): Promise<void> {
  const s = shipById(x, id);
  if (!s || (comp === "hull" && isWrecked(s))) return;
  const r = await gmRoll(`1d8${fmtMod(mod)}`, `${s.name}: Mending`, { kind: "dice", visibility: x.vis });
  setShip(x, repairShip(s, comp, Math.max(0, r.total)));
  nsay(x, `Mending restores ${Math.max(0, r.total)} HP to ${s.name}'s ${comp === "hull" ? "hull" : s.comps.find((c) => c.id === comp)?.name.toLowerCase()} (once per hour per target).`);
}

export function setQualityOf(x: NavalCtx, id: string, q: number): void { const s = shipById(x, id); if (s) setShip(x, setQuality(s, q)); }

// ------------------------------------------------------------------ creatures in the air

const flyOf = (u: TrackerUnit) => u.sheet.speed.fly;
const conscious = (u: TrackerUnit) => u.state.hp > 0 && !u.state.conditions.some((c) => c.key === "unconscious");

export function setAloft(x: NavalCtx, unitId: string, a: Aloft | null): void {
  const aloft = { ...x.n.aloft };
  if (a && a.ft > 0) aloft[unitId] = a; else delete aloft[unitId];
  x.n = { ...x.n, aloft };
}

/** A creature in the air starts to fall: all the way, or 500 feet now with the rate-of-falling rule. */
export async function startFall(x: NavalCtx, unitId: string, why: string): Promise<void> {
  const u = unitOf(x, unitId);
  const a = x.n.aloft[unitId];
  if (!u || !a || a.ft <= 0) return;
  const step = fallStep(a.ft, x.n.rateOfFalling);
  const left = a.ft - step;
  if (left <= 0) { setAloft(x, unitId, null); await land(x, u, step, `${u.name} falls ${step} ft (${why})`); return; }
  setAloft(x, unitId, { ...a, ft: left, falling: { fallen: step } });
  nsay(x, `${u.name} falls (${why}): down ${step} ft at once, ${left} ft still to go; another 500 ft at the end of each of its turns (XGE "Rate of Falling").${flyOf(u) ? " If it starts a turn still falling and Prone, it can halt the fall by spending half its fly speed." : ""}`);
}

/** The end of a falling creature's turn (rate of falling): another 500 feet, landing if it reaches the ground. */
export async function continueFall(x: NavalCtx, unitId: string): Promise<void> {
  const u = unitOf(x, unitId);
  const a = x.n.aloft[unitId];
  if (!u || !a?.falling) return;
  const step = fallStep(a.ft, true);
  const fallen = a.falling.fallen + step;
  if (a.ft - step <= 0) { setAloft(x, unitId, null); await land(x, u, fallen, `${u.name} hits the ground after falling ${fallen} ft`); return; }
  setAloft(x, unitId, { ...a, ft: a.ft - step, falling: { fallen } });
  nsay(x, `${u.name} keeps falling: ${a.ft - step} ft to go (${fallen} ft so far).`);
}

async function land(x: NavalCtx, u: TrackerUnit, fallen: number, head: string): Promise<void> {
  const feet = fallDamageFeet(fallen, { flierRule: x.n.flierRule, fly: flyOf(u), conscious: conscious(u) });
  const dice = fallDice(feet);
  const less = feet < fallen ? ` (counted as ${feet} ft: minus its fly speed, XGE)` : "";
  if (!dice) { nsay(x, `${head}${less}: no damage, and it lands on its feet.`); return; }
  const dmg = await hurtUnit(x, u, await rollDamage(x, [{ dice, type: "Bludgeoning" }], "falling", u));
  nsay(x, `${head}${less}: ${u.name} ${dmg} and lands Prone.${await condUnit(x, u, [{ key: "prone" }])}`);
}

/** A Prone flier still falling at the start of its turn halts the fall with half its fly speed (XGE). */
export async function haltFall(x: NavalCtx, unitId: string): Promise<void> {
  const u = unitOf(x, unitId);
  const a = x.n.aloft[unitId];
  if (!u || !a) return;
  setAloft(x, unitId, { ft: a.ft, ...(a.magic ? { magic: true } : {}) });
  const prone = u.state.conditions.find((c) => c.key === "prone");
  if (prone) await obrGateway.patchMetadata([{ id: u.id, key: STATE_KEY, patch: { conditions: u.state.conditions.filter((c) => c.key !== "prone") } }]).catch(() => undefined);
  nsay(x, `${u.name} rights itself in midair with half its fly speed (${Math.floor((flyOf(u) ?? 0) / 2)} ft) and stops falling at ${a.ft} ft.`);
}

/** Falls for creatures in the air that can't stay up (Prone, speed 0, 2024 Incapacitated). Run on every scene change. */
export async function checkFalls(x: NavalCtx): Promise<void> {
  for (const [id, a] of Object.entries(x.n.aloft)) {
    const u = unitOf(x, id);
    if (!u) continue;
    if (u.dead && !a.falling) { await startFall(x, id, "it's dead"); continue; }
    const why = fallReason({ conditions: u.state.conditions, fly: flyOf(u), hover: u.sheet.speed.hover }, a, x.rules);
    if (why) await startFall(x, id, why);
  }
}

/** Off the side of a ship: into the water, or a fall from an airship's altitude. */
export async function overboard(x: NavalCtx, id: string, unitId: string): Promise<void> {
  const s = shipById(x, id);
  const u = unitOf(x, unitId);
  if (!s || !u) return;
  setShip(x, { ...s, aboard: s.aboard.filter((a) => a !== unitId) });
  if (s.altitude > 0) { setAloft(x, unitId, { ft: s.altitude }); await startFall(x, unitId, `over the side of ${s.name}`); return; }
  nsay(x, `${u.name} goes over the side of ${s.name} into the ${s.env === "space" ? "void (check the ship's gravity plane and air envelope, AAG)" : "water: swimming, and climbing back aboard is up to the GM"}.`);
}

// ------------------------------------------------------------------ elemental airships (EFA)

/** EFA crash: each creature aboard makes a Strength or Dexterity save (its better one): damage and Prone on a failure, half on a success. */
async function aboardSaves(x: NavalCtx, s: Ship, dc: number, dice: string, why: string): Promise<void> {
  const parts: string[] = [];
  for (const uid of s.aboard) {
    const u0 = unitOf(x, uid);
    if (!u0 || u0.dead) continue;
    const u = (await freshUnit(x, uid)) ?? u0;
    const save = (a: "str" | "dex") => u.sheet.saves[a] ?? abilityMod(u.sheet.abilities[a]);
    const a = save("str") >= save("dex") ? "str" : "dex";
    const r = await gmRoll(`1d20${fmtMod(save(a))}`, `${a === "str" ? "Strength" : "Dexterity"} save · ${why} (DC ${dc})`, { unit: { id: u.id, name: u.name }, kind: "save", visibility: x.vis });
    const pass = r.total >= dc;
    const dmg = await hurtUnit(x, u, await rollDamage(x, [{ dice, type: "Bludgeoning" }], why, u), pass);
    parts.push(`${u.name}: ${r.total} vs DC ${dc}, ${dmg}${pass ? "" : ` and falls Prone${await condUnit(x, u, [{ key: "prone" }])}`}.`);
  }
  if (parts.length) nsay(x, `Aboard ${s.name}: ${parts.join(" ")}`);
}

/** Tilt and Roll (EFA): the pilot spends half the Fly Speed to invert or right the ship; unanchored creatures fall unless a DC 15 Dexterity save grabs something fixed. */
export async function tiltAndRoll(x: NavalCtx, id: string, why = "Tilt and Roll"): Promise<void> {
  const s = shipById(x, id);
  if (!s) return;
  nsay(x, `${s.name} rolls onto its ${s.inverted ? "keel again" : "back"} (${why}). Unanchored creatures and objects fall unless they grab a fixed object (DC ${TILT_DC} Dexterity save).`);
  setShip(x, { ...s, inverted: !s.inverted || undefined });
  for (const uid of s.aboard) {
    const u = unitOf(x, uid);
    if (!u || u.dead) continue;
    const r = await gmRoll(`1d20${fmtMod(u.sheet.saves.dex ?? abilityMod(u.sheet.abilities.dex))}`, `Dexterity save · ${s.name} inverts (DC ${TILT_DC})`, { unit: { id: u.id, name: u.name }, kind: "save", visibility: x.vis });
    if (r.total >= TILT_DC) { nsay(x, `${u.name}: ${r.total}, grabs hold.`); continue; }
    nsay(x, `${u.name}: ${r.total}, loses their grip.`);
    if (s.altitude > 0) await overboard(x, id, uid);
    else nsay(x, `${u.name} falls Prone.${await condUnit(x, u, [{ key: "prone" }])}`);
  }
}

/** Emergency repairs (EFA): an hour's work and 100+ gp of spare parts; DC 16 Dexterity (Sleight of Hand) or Intelligence (Arcana) with tools; 2d4 + 2 HP, once per part until the ship docks. */
export async function emergencyRepair(x: NavalCtx, id: string, part: string, by: string): Promise<void> {
  const s = shipById(x, id);
  const u = unitOf(x, by);
  if (!s || !u) return;
  const label = part === "hull" ? "hull" : s.comps.find((c) => c.id === part)?.name.toLowerCase() ?? "part";
  const no = canPatch(s, part);
  if (no) { nsay(x, `Emergency repair on ${s.name}'s ${label}: ${no}.`); return; }
  const tools = /(carpenter|smith|tinker)/i.test(u.sheet.proficiencies ?? "") ? u.sheet.proficiencyBonus : 0;
  const best = Math.max(skillBonus(u.sheet, "Sleight of Hand", "dex"), skillBonus(u.sheet, "Arcana", "int"));
  // Tool proficiency and skill proficiency don't stack: the higher of skill bonus, or ability + tools.
  const bonus = Math.max(best, Math.max(abilityMod(u.sheet.abilities.dex), abilityMod(u.sheet.abilities.int)) + tools);
  const r = await gmRoll(`1d20${fmtMod(bonus)}`, `${u.name}: emergency repair on ${s.name}'s ${label} (DC ${EMERGENCY_REPAIR.dc})`, { unit: { id: u.id, name: u.name }, kind: "check", visibility: x.vis });
  if (r.total < EMERGENCY_REPAIR.dc) { nsay(x, `${u.name}'s emergency repair on ${s.name}'s ${label}: ${r.total}, fails after an hour; the parts can be used for another try.`); return; }
  const hp = await gmRoll(EMERGENCY_REPAIR.dice, `${s.name}: emergency repair`, { kind: "dice", visibility: x.vis });
  setShip(x, { ...repairShip(s, part, hp.total), patched: [...(s.patched ?? []), part] });
  nsay(x, `${u.name}'s emergency repair on ${s.name}'s ${label}: ${r.total}, regains ${hp.total} HP; the spare parts are used up. No more emergency repairs on it until the ship docks.`);
}

export function docked(x: NavalCtx, id: string): void {
  const s = shipById(x, id);
  if (!s) return;
  setShip(x, { ...s, patched: undefined, altitude: 0 });
  nsay(x, `${s.name} docks: emergency repairs are possible again. Berthed repairs: 1 HP a day, 20 gp per HP (PHB).`);
}

/** Environmental Hazards on an airship journey (EFA, d4); turbulence and strong wind are applied. */
export async function airshipHazard(x: NavalCtx, id: string): Promise<void> {
  const s = shipById(x, id);
  if (!s) return;
  const d = await gmRoll("1d4", `${s.name}: sky hazard`, { kind: "dice", visibility: x.vis });
  const hz = AIRSHIP_HAZARDS.find((h) => h.roll === d.total)!;
  nsay(x, `☁ ${s.name} (d4 ${d.total}): ${hz.text}`);
  if (d.total === 1) {
    const hours = (await gmRoll("1d4", "hours of motion sickness", { kind: "dice", visibility: x.vis })).total;
    for (const uid of s.aboard) {
      const u = unitOf(x, uid);
      if (!u || u.dead) continue;
      const r = await gmRoll(`1d20${fmtMod(u.sheet.saves.con ?? abilityMod(u.sheet.abilities.con))}`, `Constitution save · turbulence (DC 10)`, { unit: { id: u.id, name: u.name }, kind: "save", visibility: x.vis });
      nsay(x, r.total >= 10 ? `${u.name}: ${r.total}, keeps their stomach.` : `${u.name}: ${r.total}, Poisoned for ${hours} hours.${await condUnit(x, u, [{ key: "poisoned", note: `motion sickness, ${hours} hours` }])}`);
    }
  }
  if (d.total === 4) {
    x.n = { ...x.n, wind: "strong" };
    const p = unitOf(x, s.officers.pilot);
    if (!p) { nsay(x, `${s.name} has no pilot to hold it steady: it inverts.`); await tiltAndRoll(x, id, "the strong wind"); return; }
    const r = await gmRoll(`1d20${fmtMod(p.sheet.saves.con ?? abilityMod(p.sheet.abilities.con))}`, `${p.name}: Constitution save · strong wind at the helm (DC 15)`, { unit: { id: p.id, name: p.name }, kind: "save", visibility: x.vis });
    if (r.total >= 15) nsay(x, `${p.name} holds ${s.name} steady (${r.total}).`);
    else await tiltAndRoll(x, id, `the strong wind (${p.name}'s save ${r.total})`);
  }
}
