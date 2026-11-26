import OBR from "@owlbear-rodeo/sdk";
import { actionBar, isAttackOption } from "../core/actions";
import { attackOutcome, castPlan, conditionsIn, damageFor } from "../core/cast";
import { combineModes, editionText } from "../core/card";
import { addCondition, d20Penalty, exhaustionLevel, type TurnPoint } from "../core/conditions";
import { fmtMod } from "../core/dice";
import { readEncounter } from "../core/encounter";
import { condition } from "../core/hp";
import {
  canAdvance, chokeTurn, grappleConditionId, holdConditionId, HOLDS, injuryText, martialArmorClass, moves, movesOppositely, ropeAc, ropeThreatensAlly, ROPE_HP, MARTIAL_QUEUE, MARTIAL_STATE,
  PARTS, SUFFOCATING_2014, readMartial, readMartialQueue, type Grapple, type MartialEntry, type MartialState, type Part, type Displacement,
} from "../core/martial";
import { bandFor, gridFeet, reachOf, type Measurement } from "../core/reach";
import { abilityMod, saveBonus, STATE_KEY, type ConditionInstance } from "../core/sheet";
import { changeHp, chooseAtZero, markUnitsDead, trackerUnits, type TrackerUnit } from "../core/tracker";
import type { MartialRequest } from "../core/turns";
import { gmRoll } from "../extension/gmRoll";
import { obrGateway } from "../extension/obrGateway";
import { roomSettings, roomSystem } from "../extension/roomSettings";

type Review = NonNullable<Extract<MartialRequest, { type: "martial-review" }>["options"]>;
type Unit = TrackerUnit & { martial: MartialState };
type Patches = Parameters<typeof obrGateway.patchMetadata>[0];

let work = Promise.resolve();
function serial<T>(run: () => Promise<T>): Promise<T> {
  const done = work.then(run);
  work = done.then(() => {}, () => {});
  return done;
}

async function units(): Promise<Unit[]> {
  const items = await obrGateway.getItems();
  const states = new Map(items.map((i) => [i.id, readMartial(i.metadata)]));
  return trackerUnits(items).map((u) => ({ ...u, martial: states.get(u.id) ?? {} }));
}

const incapacitated = (u: Unit) => u.hp <= 0 || u.dead || u.state.conditions.some((c) =>
  ["incapacitated", "paralyzed", "petrified", "stunned", "unconscious"].includes(c.key));
const immune = (u: Unit, key: string) => new RegExp(`\\b${key}\\b`, "i").test(u.sheet.defenses.conditionImmune ?? "");
const skills = { str: "Athletics", dex: "Acrobatics" } as const;
const skill = (u: Unit, a: keyof typeof skills) => u.sheet.skills.find((s) => s.name.toLowerCase() === skills[a].toLowerCase())?.bonus
  ?? abilityMod(u.sheet.abilities[a]);
const dcFor = (u: Unit) => 8 + u.sheet.proficiencyBonus + abilityMod(u.sheet.abilities.str);
const sizes = ["T", "S", "M", "L", "H", "G"];

async function distance(a: string, b: string) {
  const [from, to, dpi, scale, measurement] = await Promise.all([
    OBR.scene.items.getItemBounds([a]), OBR.scene.items.getItemBounds([b]), OBR.scene.grid.getDpi(),
    OBR.scene.grid.getScale(), OBR.scene.grid.getMeasurement().catch(() => "CHEBYSHEV"),
  ]);
  return gridFeet(from, to, dpi, scale.parsed?.multiplier || 5, measurement as Measurement);
}

async function roll(u: Unit, bonus: number, label: string, kind: "save" | "check", role: "public" | "private" = "private") {
  const system = roomSystem();
  const level = exhaustionLevel(u.state);
  const mode = system.rules === "2014" && level >= (kind === "check" ? 1 : 3) ? "disadvantage" : "normal";
  return (await gmRoll(`1d20${fmtMod(bonus + d20Penalty(system, u.state))}`, label, { unit: u, kind, mode, visibility: role })).total;
}

async function grappleCheck(a: Unit, b: Unit, defense: "str" | "dex", label: string, dc = dcFor(a)): Promise<boolean> {
  if (roomSystem().rules === "2024") return await roll(b, saveBonus(b.sheet, defense), `${label} · DC ${dc} save`, "save") < dc;
  const attack = await roll(a, skill(a, "str"), `${label} · Athletics`, "check", "public");
  return attack > await roll(b, skill(b, defense), `${label} · ${skills[defense]}`, "check");
}

function saveUnit(u: Unit, conditions: ConditionInstance[], martial: MartialState): Patches {
  return [
    { id: u.id, key: STATE_KEY, patch: { conditions } },
    { id: u.id, key: MARTIAL_STATE, patch: { ...martial } },
  ];
}

function linkConditions(u: Unit, g: Grapple, active: boolean, asActor = false) {
  const grappled = grappleConditionId(g), hold = holdConditionId(g);
  let conditions = u.state.conditions.filter((c) => c.id !== grappled && c.id !== hold);
  if (active && !asActor) conditions.push(condition("grappled", { id: grappled, note: roomSystem().rules === "2024" ? `Escape DC ${g.dc}.` : "Escape with a contested check." }));
  if (active && g.hold === "body" && !immune(u, "restrained")) conditions.push(condition("restrained", { id: hold, note: "Body Pin" }));
  if (active && !asActor && g.hold && g.hold !== "body") {
    conditions.push(condition("custom", { id: hold, label: HOLDS[g.hold][0], note: HOLDS[g.hold][1] }));
  }
  if (!active && !asActor && g.hold === "choke") conditions = conditions.filter((c) => c.id !== SUFFOCATING_2014);
  if (!active && !asActor && g.exhaustion) {
    const level = exhaustionLevel(u.state) - g.exhaustion;
    conditions = conditions.filter((c) => c.key !== "exhaustion");
    if (level > 0) conditions.push(condition("exhaustion", { level }));
  }
  return conditions;
}

async function updateLink(a: Unit | undefined, b: Unit, old: Grapple, updated?: Grapple, binding?: MartialState["binding"]) {
  const grapples = (b.martial.grapples ?? []).filter((g) => g.id !== old.id);
  if (updated) grapples.push(updated);
  let conditions = linkConditions(b, old, false);
  if (updated) conditions = linkConditions({ ...b, state: { ...b.state, conditions } }, updated, true);
  if (binding) conditions.push(bindingCondition(binding));
  const patches = saveUnit(b, conditions, { ...b.martial, grapples, ...(binding ? { binding } : {}) });
  if (a && (old.hold === "body" || updated?.hold === "body")) {
    patches.push({ id: a.id, key: STATE_KEY, patch: { conditions: linkConditions(a, updated ?? old, updated !== undefined, true) } });
  }
  await obrGateway.patchMetadata(patches);
}

function bindingCondition(binding: NonNullable<MartialState["binding"]>) {
  return condition(binding.hold === "body" ? "restrained" : "custom", {
    id: binding.id, ...(binding.hold === "arms" ? { label: "Arms Bound" } : {}),
    note: `Rope binding · AC ${ropeAc(binding.hold)} · ${binding.hp ?? ROPE_HP} HP. ${binding.hold === "arms" ? HOLDS.arms[1] : "Ends when the ropes are removed."}`,
  });
}

function setCondition(b: Unit, label: string, note: string, now: TurnPoint, at?: "start" | "end", id?: string) {
  const added = addCondition(b.state, "custom", { label, note, now, ...(at ? { duration: { kind: "turn", turnOf: b.id, at } } : {}) }).conditions!;
  b.state.conditions = id ? added.map((c) => c.label === label ? { ...c, id } : c) : added;
}

async function shot(a: Unit, b: Unit, entry: MartialEntry, opt: Review) {
  const move = entry.move;
  if (move.op !== "shot") return "";
  if (a.martial.shotRound === entry.round) throw new Error("This unit already made a called shot this turn.");
  const rules = roomSystem().rules;
  const attack = actionBar(a.sheet, rules).items.find((it) => it.key === move.attack && isAttackOption(it) && it.section === "actions");
  if (!attack || /\b(?:melee|ranged) spell attack\b/i.test(attack.text)) throw new Error("Pick a weapon attack from the unit's sheet.");
  const text = editionText(attack.text, rules);
  const plan = castPlan(text);
  if (plan?.kind !== "attack") throw new Error("That attack has no roll Butler can resolve.");
  const feet = await distance(a.id, b.id);
  const reach = reachOf(attack, 5);
  const band = reach ? bandFor(reach, feet) : null;
  if (reach && !band) throw new Error("The target is outside this attack's range.");
  const label = move.detail.trim() || PARTS[move.part][0];
  const special = move.part === "special";
  if (special && !move.detail.trim()) throw new Error("Name the stat-block part.");
  const roper = /\broper\b/i.test(b.sheet.name) && /tendril|tentacle/i.test(label);
  const partHp = opt.partHp || (roper ? 10 : 0);
  const partAc = opt.partAc || (roper ? 20 : 0);
  if (special && (!partAc || !partHp)) throw new Error("Enter this part's AC and maximum HP from the stat block.");
  if (special && (b.martial.parts?.[label.toLowerCase()] ?? partHp) <= 0) throw new Error("That part is already destroyed.");
  const mode = combineModes(move.mode, band?.kind === "long" || (rules === "2014" && exhaustionLevel(a.state) >= 3) ? "disadvantage" : undefined);
  const ac = special ? partAc : martialArmorClass(b.sheet, b.state.conditions) + 2 + opt.acAdjustment;
  const attackRoll = await gmRoll(`1d20${fmtMod((plan.bonus ?? 0) + d20Penalty(roomSystem(), a.state))}`, `${attack.name} · Called Shot (${label})`, {
    unit: a, kind: "attack", mode, visibility: a.hidden ? "private" : "public",
  });
  await obrGateway.patchMetadata([{ id: a.id, key: MARTIAL_STATE, patch: { shotRound: entry.round } }]);
  const outcome = attackOutcome(attackRoll.total, attackRoll.natural, ac);
  if (outcome === "miss") return `${a.name} missed ${b.name}'s ${label}.`;
  const rolled = [];
  for (const d of plan.damage) rolled.push({ type: d.type, amount: (await gmRoll(d.formula, `${attack.name} · ${d.type ?? ""} damage`, {
    unit: a, kind: "damage", crit: outcome === "crit", visibility: a.hidden || !roomSettings().revealHits ? "private" : "public",
  })).total });
  const damage = damageFor({ half: false }, { outcome, rolled }, special ? { immune: opt.partImmune || (roper ? "poison, psychic" : "") } : b.sheet.defenses).amount;
  if (special) {
    const parts = { ...b.martial.parts };
    const key = label.toLowerCase();
    parts[key] = Math.max(0, (parts[key] ?? partHp) - damage);
    await obrGateway.patchMetadata([{ id: b.id, key: MARTIAL_STATE, patch: { parts } }]);
    if (parts[key] === 0 && opt.holdingLimb) {
      const held = (await units()).find((u) => u.id === opt.holdingLimb);
      const link = held?.martial.grapples?.find((g) => g.actor === b.id);
      if (link && held) await updateLink(b, held, link);
    }
    return `${b.name}'s ${label}: ${parts[key]}/${partHp} HP.${parts[key] === 0 ? " Destroyed. Apply the creature’s stat-block effect." : ""}`;
  }

  if (damage) await changeHp(obrGateway, [b.id], { kind: "damage", amount: damage, critical: outcome === "crit" }, {
    system: roomSystem(), autoDeadAtZero: roomSettings().autoDeadAtZero,
  });
  const target = (await units()).find((u) => u.id === b.id);
  if (!target) return `${b.name} took ${damage} damage.`;
  const now = { round: entry.round, turnId: a.id };
  const line = `${b.name} took ${damage} damage to its ${label}.`;
  if (target.hp <= 0) {
    return line + (move.part === "neck" && rolled.some((d) => /slashing/i.test(d.type ?? ""))
      ? " If the blow killed the target, offer the player a decapitation narration if the anatomy allows it." : "");
  }
  setCondition(target, `Called Shot · ${label}`, PARTS[move.part][1], now, move.part === "neck" ? "start" : "end",
    `martial:short:${move.part}:${label.toLowerCase()}`);
  for (const c of conditionsIn(text)) {
    if (!immune(target, c.key)) target.state.conditions = addCondition(target.state, c.key, {
      now, note: attack.name,
      duration: c.until === "target-end" ? { kind: "turn", turnOf: target.id, at: "end" }
        : c.until ? { kind: "turn", turnOf: a.id, at: c.until === "caster-start" ? "start" : "end" }
        : c.rounds ? { kind: "rounds", rounds: c.rounds } : { kind: "none" },
    }).conditions!;
  }
  let result = line;
  let disabledHoldingPart = false;
  if (target.hp * 2 <= target.maxHp) {
    const dc = 8 + a.sheet.proficiencyBonus + abilityMod(a.sheet.abilities[opt.ability]);
    const save = await roll(target, saveBonus(target.sheet, "con"), `Called Shot · DC ${dc} Constitution save`, "save");
    if (save >= dc) {
      if (move.part === "neck") setCondition(target, "Neck Shot Guard", "Immune to further brief speech loss from neck shots.", now, "end", "martial:neck-guard");
    } else {
      const protectedVoice = target.state.conditions.some((c) => c.id === "martial:neck-guard");
      if (move.part === "neck" && !protectedVoice) {
        setCondition(target, "Speech Lost", "Can't speak or provide verbal spell components.", now, "end", "martial:speech-lost");
      }
      const id = `martial:injury:${move.part}:${label.toLowerCase()}`;
      const existing = target.martial.injuries?.find((i) => i.id === id);
      const permanent = existing?.rests === 0 || (outcome === "crit" && opt.permanent);
      setCondition(target, `${permanent ? "Permanent" : "Lingering"} Injury · ${label}`, injuryText(move.part, permanent), now, undefined, id);
      target.state.conditions = [...new Map(target.state.conditions.map((c) => [c.id, c])).values()];
      target.martial.injuries = [...(target.martial.injuries ?? []).filter((i) => i.id !== id), { id, rests: permanent ? 0 : 3 }];
      disabledHoldingPart = permanent && opt.cannotMaintain === true;
      result += permanent ? " Permanent injury." : " Lingering injury.";
    }
  }
  await obrGateway.patchMetadata(saveUnit(target, target.state.conditions, target.martial));
  if (move.part === "arm" && opt.holdingLimb) {
    const held = (await units()).find((u) => u.id === opt.holdingLimb);
    const link = held?.martial.grapples?.find((g) => g.actor === target.id);
    if (link && held) {
      const dc = roomSystem().concentrationDc(damage);
      if (disabledHoldingPart || await roll(target, saveBonus(target.sheet, "con"), `Keep Hold · DC ${dc} Constitution save`, "save") < dc) {
        await updateLink(target, held, link);
        result += ` ${held.name} breaks free.`;
      } else result += ` ${target.name} keeps its hold on ${held.name}.`;
    }
  }
  return result;
}

async function setRopeHp(unit: Unit, hp: number) {
  const binding = unit.martial.binding!;
  const conditions = unit.state.conditions.filter((c) => c.id !== binding.id);
  const updated = hp > 0 ? { ...binding, hp } : undefined;
  if (updated) conditions.push(bindingCondition(updated));
  await obrGateway.patchMetadata(saveUnit(unit, conditions, { ...unit.martial, binding: updated }));
}

async function shootRopes(a: Unit, b: Unit, move: Extract<MartialEntry["move"], { op: "shoot-ropes" }>, opt: Review) {
  const binding = b.martial.binding;
  if (!binding) throw new Error("This unit is no longer bound.");
  const rules = roomSystem().rules;
  const attack = actionBar(a.sheet, rules).items.find((it) => it.key === move.attack && isAttackOption(it) && it.section === "actions");
  const plan = attack && castPlan(editionText(attack.text, rules));
  const rangedBands = attack && reachOf(attack)?.bands.filter((band) => band.kind === "range" || band.kind === "long");
  if (!attack || plan?.kind !== "attack" || !rangedBands?.length || /\b(?:melee|ranged) spell attack\b/i.test(attack.text)) throw new Error("Choose a ranged weapon attack.");
  const feet = await distance(a.id, b.id);
  const band = rangedBands.find((candidate) => candidate.feet >= feet);
  if (!band) throw new Error("The ropes are outside this attack's range.");
  const wrongRange = band.kind === "long" || rules === "2014" && exhaustionLevel(a.state) >= 3;
  const visibility = a.hidden ? "private" : "public";
  const attackRoll = (label: string, advantage: boolean) => {
    const modes = [move.mode, wrongRange ? "disadvantage" : "normal", advantage ? "advantage" : "normal"];
    const mode = modes.includes("advantage") === modes.includes("disadvantage") ? "normal" : modes.includes("advantage") ? "advantage" : "disadvantage";
    return gmRoll(`1d20${fmtMod((plan.bonus ?? 0) + d20Penalty(roomSystem(), a.state))}`, label, { unit: a, kind: "attack", visibility, mode });
  };
  const damageRoll = async (label: string, outcome: "hit" | "crit", defenses?: Unit["sheet"]["defenses"]) => {
    const rolled = [];
    for (const d of plan.damage) rolled.push({ type: d.type, amount: (await gmRoll(d.formula, label, {
      unit: a, kind: "damage", visibility, crit: outcome === "crit",
    })).total });
    return damageFor({ half: false }, { outcome, rolled }, defenses).amount;
  };
  const ac = ropeAc(binding.hold) + opt.acAdjustment;
  const check = await attackRoll(`${attack.name} · Shoot the Ropes`, false);
  const hit = attackOutcome(check.total, check.natural, ac);
  let collateral = "";
  // Use the ally's AC and conditions at the moment of the shot, even if this arrow also cuts the ropes.
  if (ropeThreatensAlly(check.total, check.natural, ac)) {
    const risk = await attackRoll(`${attack.name} · Collateral attack`, b.state.conditions.some((c) => c.key === "restrained"));
    const outcome = attackOutcome(risk.total, risk.natural, b.ac + opt.acAdjustment);
    if (outcome === "hit" || outcome === "crit") {
      const damage = await damageRoll(`${attack.name} · Collateral damage`, outcome, b.sheet.defenses);
      if (damage) await changeHp(obrGateway, [b.id], { kind: "damage", amount: damage, critical: outcome === "crit" }, { system: roomSystem(), autoDeadAtZero: roomSettings().autoDeadAtZero });
      collateral = ` ${b.name} takes ${damage} damage.`;
    } else collateral = ` The attack misses ${b.name}.`;
  }
  if (hit === "hit" || hit === "crit") {
    const damage = await damageRoll(`${attack.name} · Rope damage`, hit);
    const hp = Math.max(0, (binding.hp ?? ROPE_HP) - damage);
    const fresh = (await units()).find((u) => u.id === b.id);
    if (fresh?.martial.binding?.id === binding.id) await setRopeHp(fresh, hp);
    return (hp ? `The ropes have ${hp} HP left.` : `${b.name} is free of the ropes.`) + collateral;
  }
  return `${a.name} misses the ropes.` + collateral;
}

async function displace(req: Extract<MartialRequest, { type: "martial-displace" }>) {
  const all = await units();
  const grappler = all.find((u) => u.id === req.unitId), held = all.find((u) => u.id === req.heldId);
  const link = held?.martial.grapples?.find((g) => g.actor === req.unitId);
  if (!link || !grappler || !held || incapacitated(grappler)) throw new Error("That grapple has ended.");
  const [from, to, dpi, scale, measurement] = await Promise.all([
    OBR.scene.items.getItemBounds([grappler.id]), OBR.scene.items.getItemBounds([held.id]), OBR.scene.grid.getDpi(),
    OBR.scene.grid.getScale(), OBR.scene.grid.getMeasurement().catch(() => "CHEBYSHEV"),
  ]);
  const feetPerCell = scale.parsed?.multiplier || 5;
  const translate = (v: Displacement) => ({ x: v.x * dpi / feetPerCell, y: v.y * dpi / feetPerCell });
  const add = (a: Displacement, b: Displacement) => ({ x: a.x + b.x, y: a.y + b.y });
  const shift = (bounds: typeof from, by: Displacement) => ({ min: add(bounds.min, by), max: add(bounds.max, by) });
  let a = translate(req.grapplerMove), b = translate(req.heldMove);
  if (!moves(a) && !moves(b)) throw new Error("Enter the forced movement for at least one creature.");
  let breaks = movesOppositely(a, b);
  if (!breaks && gridFeet(shift(from, a), shift(to, b), dpi, feetPerCell, measurement as Measurement) > link.reach) {
    breaks = true;
    if (moves(a) !== moves(b) && await roll(grappler, saveBonus(grappler.sheet, "str"), `Keep Hold · DC ${req.dc} Strength save`, "save") >= req.dc && req.canFollow) {
      if (moves(a)) b = a;
      else a = b;
      breaks = false;
    }
  }
  const movement = new Map([[grappler.id, a], [held.id, b]]);
  await OBR.scene.items.updateItems([...movement.keys()], (drafts) => {
    for (const token of drafts) token.position = add(token.position, movement.get(token.id)!);
  });
  if (breaks) await updateLink(grappler, held, link);
  return breaks ? `${held.name} breaks free from ${grappler.name}.` : `${grappler.name} keeps its hold on ${held.name}.`;
}

async function resolve(entry: MartialEntry, opt: Review): Promise<string> {
  const encounter = readEncounter(await OBR.scene.getMetadata());
  const { move } = entry;
  const outOfTurn = move.op === "release" || !encounter.started && (move.op === "untie" || move.op === "shoot-ropes");
  if (!outOfTurn && (encounter.turnId !== entry.actor || encounter.round !== entry.round)) throw new Error("This declaration's turn has ended.");
  const all = await units();
  const a = all.find((u) => u.id === entry.actor), b = all.find((u) => u.id === entry.target);
  if (!a || !b || !outOfTurn && incapacitated(a)) throw new Error("The acting unit is unavailable.");
  if (move.op === "shot") return shot(a, b, entry, opt);
  if (move.op === "shoot-ropes") return shootRopes(a, b, move, opt);
  const graphs = b.martial.grapples ?? [];
  const current = graphs.find((g) => g.actor === a.id);
  if (move.op === "untie") {
    const binding = b.martial.binding;
    if (!binding) throw new Error("This unit is not bound.");
    if (a.id === b.id || incapacitated(a) || await distance(a.id, b.id) > 5) throw new Error("An ally within 5 feet must untie the ropes.");
    await setRopeHp(b, 0);
    return `${b.name} is free of the ropes.`;
  }
  if (move.op === "rescue") {
    const ally = all.find((u) => u.id === move.ally);
    const g = ally?.martial.grapples?.find((x) => x.actor === b.id);
    if (!ally || ally.id === a.id || !g || await distance(a.id, b.id) > 5 || await distance(a.id, ally.id) > 5) {
      throw new Error("Choose a grappler and a held ally that are both within 5 feet.");
    }
    const check = await roll(a, skill(a, "str"), "Break Ally Free · Athletics", "check", "public");
    const dc = roomSystem().rules === "2024" ? g.dc : await roll(b, skill(b, "str"), "Hold grapple · Athletics", "check");
    if (roomSystem().rules === "2024" ? check < dc : check <= dc) return `${b.name} keeps its hold on ${ally.name}.`;
    await updateLink(b, ally, g);
    return `${a.name} freed ${ally.name} from ${b.name}'s grapple.`;
  }
  if (move.op === "escape") {
    const g = (a.martial.grapples ?? []).find((x) => x.actor === b.id);
    if (!g) throw new Error("That grapple has ended.");
    const check = await roll(a, skill(a, opt.defense), `Escape · ${skills[opt.defense]}`, "check", "public");
    const dc = roomSystem().rules === "2024" ? g.dc : await roll(b, skill(b, "str"), "Hold grapple · Athletics", "check");
    if (roomSystem().rules === "2024" ? check < dc : check <= dc) return `${a.name} remains grappled.`;
    await updateLink(b, a, g);
    return `${a.name} escaped the grapple.`;
  }
  if (move.op === "release" || move.op === "downgrade") {
    if (!current) throw new Error("This unit isn't grappling the target.");
    await updateLink(a, b, current, move.op === "downgrade" ? { id: current.id, actor: current.actor, round: current.round, dc: current.dc, reach: current.reach } : undefined);
    return move.op === "release" ? `${a.name} released ${b.name}.` : `${a.name} returned to a basic grapple.`;
  }
  if (move.op === "grapple") {
    if (current || !b.inEncounter || b.initiative === null || b.dead || immune(b, "grappled") || sizes.indexOf(b.sheet.size) > sizes.indexOf(a.sheet.size) + 1 || await distance(a.id, b.id) > 5) {
      throw new Error("That target isn't eligible for a basic grapple.");
    }
    if (roomSystem().rules === "2014" && incapacitated(b) || await grappleCheck(a, b, opt.defense, "Grapple")) {
      const g = { id: entry.id, actor: a.id, round: entry.round, dc: dcFor(a), reach: 5 };
      await updateLink(a, b, g, g);
      return `${a.name} grappled ${b.name}.`;
    }
    return `${b.name} resisted the grapple.`;
  }
  if (!current || !canAdvance(current, entry.round)) throw new Error("Maintain the grapple until your next turn first.");
  if (move.op === "bind") {
    if (b.martial.binding || current.hold !== "body" && current.hold !== "arms" || (current.holdRound ?? entry.round) >= entry.round) {
      throw new Error("Maintain a Body Pin or Arm Pin until your next turn before binding it.");
    }
    const held = current.hold;
    if (!await grappleCheck(a, b, opt.defense, "Rope Binding", current.dc)) return `${b.name} resisted the binding. The pin continues.`;
    await updateLink(a, b, current, undefined, { id: `martial:binding:${entry.id}`, hold: held, hp: ROPE_HP });
    return `${a.name} bound ${b.name} with rope and released the grapple.`;
  }
  if (move.op !== "advance") return "";
  if (b.martial.binding || graphs.some((g) => g.id !== current.id && g.hold)) throw new Error("The target already has an advanced hold or a rope binding.");
  if (current.hold === move.hold) throw new Error("This hold is already active.");
  if (move.hold === "body" && immune(b, "restrained")) throw new Error("The target is immune to being Restrained.");
  if (move.hold === "steal" && !move.detail.trim()) throw new Error("Name the held item.");
  const name = HOLDS[move.hold][0];
  const ok = await grappleCheck(a, b, opt.defense, name, current.dc);
  if (!ok) return `${b.name} resisted ${name}. The current grapple continues.`;
  if (move.hold === "steal") {
    await updateLink(a, b, current);
    return `${a.name} took ${move.detail} from ${b.name} and released the grapple.`;
  }
  const { id, actor, round, dc, reach } = current;
  const hold: Grapple = { id, actor, round, dc, reach, hold: move.hold, holdRound: entry.round,
    ...(move.hold === "choke" ? { chokeRound: entry.round + 1, breathless: opt.breathless } : {}),
  };
  await updateLink(a, b, current, hold);
  return `${a.name} used ${name} on ${b.name}.`;
}

export function martialRequest(req: MartialRequest, fromGm: boolean): Promise<string | undefined> {
  return serial(async () => {
    if (!roomSettings().martialOptions) return;
    const meta = await OBR.scene.getMetadata();
    const queue = readMartialQueue(meta);
    if (req.type === "martial") {
      const encounter = readEncounter(meta);
      const free = req.move.op === "release" || !encounter.started && (req.move.op === "untie" || req.move.op === "shoot-ropes");
      if (!free && (encounter.turnId !== req.unitId || encounter.round !== req.round)) throw new Error("It isn't this unit's turn.");
      if (req.targetId === req.unitId) throw new Error("Choose another unit.");
      if (queue.some((x) => x.actor === req.unitId)) throw new Error("This unit already has a declaration awaiting the GM.");
      if (queue.length >= 12) throw new Error("Resolve a martial declaration before adding another.");
      if (!fromGm && !(await OBR.scene.items.getItems([req.targetId])).some((item) => item.visible)) throw new Error("The target is unavailable.");
      await OBR.scene.setMetadata({ [MARTIAL_QUEUE]: [...queue, { id: crypto.randomUUID(), actor: req.unitId, target: req.targetId, move: req.move, round: req.round }] });
      return "Martial declaration ready in the Tracker.";
    }
    if (!fromGm) return;
    if (req.type === "martial-displace") return displace(req);
    if (req.type === "martial-review") {
      const entry = queue.find((x) => x.id === req.entryId && x.actor === req.unitId);
      if (!entry) return;
      if (!req.options) {
        await OBR.scene.setMetadata({ [MARTIAL_QUEUE]: queue.filter((x) => x.id !== entry.id) });
        return;
      }
      const result = await resolve(entry, req.options);
      await OBR.scene.setMetadata({ [MARTIAL_QUEUE]: queue.filter((x) => x.id !== entry.id) });
      return result;
    }
    const u = (await units()).find((x) => x.id === req.unitId);
    if (!u) return;
    if (req.care === "restore-part") {
      const parts = { ...u.martial.parts };
      delete parts[req.injuryId];
      await obrGateway.patchMetadata([{ id: u.id, key: MARTIAL_STATE, patch: { parts } }]);
      return `${u.name}'s ${req.injuryId} reset to full HP.`;
    }
    const injuries = (u.martial.injuries ?? []).flatMap((i) => req.care === "restore" ? i.id === req.injuryId ? [] : [i]
      : i.rests === 1 ? [] : [{ ...i, rests: Math.max(0, i.rests - 1) }]);
    const conditions = u.state.conditions.filter((c) => !u.martial.injuries?.some((i) => i.id === c.id) || injuries.some((i) => i.id === c.id));
    await obrGateway.patchMetadata(saveUnit(u, conditions, { ...u.martial, injuries }));
    return `${u.name}'s injuries updated.`;
  });
}

export function martialWatch(prev: TurnPoint | null, next: TurnPoint | null): Promise<string[]> {
  return serial(async () => {
    const all = await units();
    const messages: string[] = [];
    const rules = roomSystem().rules;
    const meta = await OBR.scene.getMetadata();
    const queue = readMartialQueue(meta);
    const open = queue.filter((entry) => {
      if (!all.some((u) => u.id === entry.actor) || !all.some((u) => u.id === entry.target)) return false;
      if (entry.move.op === "release" || !next && entry.round === 0 && (entry.move.op === "untie" || entry.move.op === "shoot-ropes")) return true;
      return next?.turnId === entry.actor && next.round === entry.round;
    });
    if (open.length !== queue.length) await OBR.scene.setMetadata({ [MARTIAL_QUEUE]: open });
    for (const snapshot of all) {
      for (const g of snapshot.martial.grapples ?? []) {
        const currentUnits = await units();
        const b = currentUnits.find((u) => u.id === snapshot.id), a = currentUnits.find((u) => u.id === g.actor);
        if (!b) continue;
        if (!next || !roomSettings().martialOptions || !a || incapacitated(a) || b.dead || !a.inEncounter || !b.inEncounter
          || !b.state.conditions.some((c) => c.id === grappleConditionId(g)) || await distance(a.id, b.id) > g.reach) {
          await updateLink(a, b, g);
          continue;
        }
        if (!prev) continue;
        const event = chokeTurn(g, b.id, prev, next, rules, abilityMod(b.sheet.abilities.con));
        if (event === "start") {
          const grapples = b.martial.grapples!.map((x) => x.id === g.id ? { ...x, suffocating: true } : x);
          await obrGateway.patchMetadata([{ id: b.id, key: MARTIAL_STATE, patch: { grapples } }]);
          messages.push(`${b.name} begins suffocating.`);
          continue;
        }
        if (rules === "2024" && event === "tick") {
          const level = exhaustionLevel(b.state);
          const grapples = b.martial.grapples!.map((x) => x.id === g.id ? { ...x, lastTick: prev.round, exhaustion: (x.exhaustion ?? 0) + 1 } : x);
          const conditions = addCondition(b.state, "exhaustion", { level: level + 1 }).conditions!;
          await obrGateway.patchMetadata(saveUnit(b, conditions, { ...b.martial, grapples }));
          messages.push(`${b.name} gains 1 Exhaustion from suffocation.`);
          if (level >= 5) await markUnitsDead(obrGateway, [b.id]);
        }
        if (rules === "2014" && event === "tick") {
          const grapples = b.martial.grapples!.map((x) => x.id === g.id ? { ...x, lastTick: prev.round, rounds: (x.rounds ?? 0) + 1 } : x);
          await obrGateway.patchMetadata([{ id: b.id, key: MARTIAL_STATE, patch: { grapples } }]);
        }
        if (event === "drop" && b.hp > 0) {
          await changeHp(obrGateway, [b.id], { kind: "set", amount: 0 }, { system: roomSystem() });
          const down = (await units()).find((u) => u.id === b.id);
          if (down?.hp !== 0) continue;
          await chooseAtZero(obrGateway, b.id, "dying");
          const effect = condition("custom", { id: SUFFOCATING_2014, label: "Suffocating", note: "Can't regain HP or stabilize while unable to breathe." });
          const conditions = down.state.conditions.filter((c) => c.id !== SUFFOCATING_2014 && c.key !== "concentration" && c.key !== "stable");
          await obrGateway.patchMetadata([{ id: b.id, key: STATE_KEY, patch: { conditions: [...conditions, effect], concentrationCheck: undefined } }]);
          messages.push(`${b.name} drops to 0 HP from suffocation and can't regain HP or stabilize until it can breathe.`);
        }
      }
    }
    const live = await units();
    for (const u of live) {
      const valid = new Set(live.flatMap((target) => (target.martial.grapples ?? []).filter((g) => g.actor === u.id && g.hold === "body").map(holdConditionId)));
      const stale = u.state.conditions.filter((c) => c.key === "restrained" && c.id.startsWith("martial:") && c.id.endsWith(":hold")
        && !valid.has(c.id) && !u.martial.grapples?.some((g) => holdConditionId(g) === c.id));
      if (!next) stale.push(...u.state.conditions.filter((c) => c.id.startsWith("martial:short:")
        || c.id === "martial:speech-lost" || c.id === "martial:neck-guard"));
      const clearRound = !next && u.martial.shotRound !== undefined;
      const missingBinding = u.martial.binding && !u.state.conditions.some((c) => c.id === u.martial.binding?.id);
      if (stale.length || clearRound || missingBinding) {
        await obrGateway.patchMetadata(saveUnit(u, u.state.conditions.filter((c) => !stale.includes(c)), {
          ...u.martial, ...(clearRound ? { shotRound: undefined } : {}), ...(missingBinding ? { binding: undefined } : {}),
        }));
      }
    }
    return messages;
  });
}
