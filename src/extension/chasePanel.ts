/**
 * DM Tools → Chase mode: on foot (pick the quarry and the pursuers, one-click sides or unit by unit) or in vehicles
 * (extension/vehiclePanel.ts), the environment and the escape factor. Once started, Butler rolls complications after
 * each participant's turn, tracks Dashes and rolls the quarry's escape checks at the end of each round
 * (background/chase.ts). The log shows what happened.
 */
import OBR from "@owlbear-rodeo/sdk";
import { CHASE_KEY, freeDashes, NEW_CHASE, quickSides, readChase, withLog, type ChaseState, type QuickSides } from "../core/chase";
import { skillBonus } from "../core/combatOptions";
import { abilityMod } from "../core/sheet";
import type { TrackerUnit } from "../core/tracker";
import { liveVehicles, ridersOf, VEHICLE_ENV_LABEL, vehicleGridProblem } from "../core/vehicles";
import { action, h, type Child } from "./dom";
import { roomSystem } from "./roomSettings";
import { vehicleSection } from "./vehiclePanel";

/** Stays open across re-renders once the GM opens it. */
let panelOpen = false;
const save = (c: ChaseState) => OBR.scene.setMetadata({ [CHASE_KEY]: c });

export function chasePanel(units: TrackerUnit[], meta: Record<string, unknown>, encounterStarted: boolean, grid: { multiplier: number; unit: string } | null = null): Child {
  const c = readChase(meta);
  const rules = roomSystem().rules;
  const name = (id: string) => units.find((u) => u.id === id)?.name ?? c.vehicles.find((v) => v.id === id)?.name ?? "(gone)";
  const set = (patch: Partial<ChaseState>) => action(() => save({ ...c, ...patch }));
  const vehicles = c.mode === "vehicles";
  const desc = vehicles
    ? `Vehicle chases, for any kind of vehicle on land, water or in the air, on a grid of at least 100 ft per square: each vehicle acts on its driver's turn. After it, Butler rolls a d20 complication that hits the next vehicle (the driver rolls with the vehicle's scores; failing a check by 5 or more causes a mishap), counts the vehicle's Dashes (3 + its Con modifier free, then a DC 10 Con ${rules === "2024" ? "save" : "check"} or vehicular Exhaustion), and at the end of each round rolls each quarry vehicle's Dexterity check against the best Passive Perception aboard the pursuers.`
    : rules === "2024"
      ? "The 2024 DMG's chase rules on top of initiative: after each participant's turn Butler rolls a d12 complication (it hits the next participant, who saves automatically), counts Dashes (3 + Con modifier free, then a DC 10 Con save or Exhaustion), and at the end of each round rolls each quarry's Stealth against the pursuers' best Passive Perception."
      : "The 2014 DMG's chase rules on top of initiative: after each participant's turn Butler rolls a d20 complication (1–10; it hits the next participant, who makes the check or save automatically), counts Dashes (3 + Con modifier free, then a DC 10 Con check or Exhaustion), and at the end of each round rolls each quarry's Stealth against the pursuers' best Passive Perception. Inspiration can negate a complication (undo it by hand).";

  return h("details", { className: "panel", open: c.active || panelOpen, ontoggle: (e: Event) => { panelOpen = (e.target as HTMLDetailsElement).open; } }, h("summary", {}, h("strong", {}, c.active ? `Chase mode (running${vehicles ? ", vehicles" : ""})` : "Chase mode")),
    h("div", { className: "row", style: "margin-top:4px" },
      h("label", { className: "small" }, h("input", { type: "radio", name: "chasemode", disabled: c.active, checked: !vehicles, onchange: set({ mode: "creatures" }) }), "On foot or mounted"),
      h("label", { className: "small" }, h("input", { type: "radio", name: "chasemode", disabled: c.active, checked: vehicles, onchange: set({ mode: "vehicles" }) }), "Vehicles")),
    h("div", { className: "small muted" }, desc),
    ...(vehicles ? [gridLine(grid), ...vehicleSection(c, units, set)] : creatureSection(c, units, set)),
    h("div", { className: "row wrap", style: "margin-top:6px" },
      h("select", { title: "Escape Factors", onchange: (e: Event) => void set({ escapeFactor: (e.target as HTMLSelectElement).value as ChaseState["escapeFactor"] })() },
        h("option", { value: "normal", selected: c.escapeFactor === "normal" }, "Escape: no factor"),
        h("option", { value: "advantage", selected: c.escapeFactor === "advantage" }, `Escape with Advantage (many hiding places, crowded${rules === "2014" ? " or noisy" : ""})`),
        h("option", { value: "disadvantage", selected: c.escapeFactor === "disadvantage" }, `Escape with Disadvantage (few hiding places, uncrowded${rules === "2014" ? " or quiet, or the lead pursuer is a ranger or proficient in Survival" : ""})`)),
      h("label", { className: "small" }, h("input", { type: "checkbox", checked: c.publicRolls, onchange: set({ publicRolls: !c.publicRolls }) }), "players see the chase rolls")),
    startRow(c, units, encounterStarted, name, grid),
    c.log.length ? h("div", { className: "small stack tight", style: "margin-top:6px" }, ...c.log.slice().reverse().map((l) => h("div", {}, "• ", l))) : null);
}

function creatureSection(c: ChaseState, units: TrackerUnit[], set: (patch: Partial<ChaseState>) => () => Promise<void>): Child[] {
  const side = (u: TrackerUnit) => c.quarry.includes(u.id) ? "quarry" : c.pursuers.includes(u.id) ? "pursuer" : "";
  const setSide = (u: TrackerUnit, to: string) => set({
    quarry: to === "quarry" ? [...c.quarry.filter((x) => x !== u.id), u.id] : c.quarry.filter((x) => x !== u.id),
    pursuers: to === "pursuer" ? [...c.pursuers.filter((x) => x !== u.id), u.id] : c.pursuers.filter((x) => x !== u.id),
  });
  const quick = (how: QuickSides, label: string) => h("button", { className: "secondary small", disabled: c.active, onclick: set(quickSides(units, how)) }, label);
  const live = units.filter((u) => !u.dead);
  const name = (id: string) => units.find((u) => u.id === id)?.name ?? "(gone)";
  const pursuers = c.pursuers.map((id) => units.find((u) => u.id === id)).filter((u): u is TrackerUnit => !!u);
  const bestPassive = Math.max(0, ...pursuers.map((u) => u.sheet.passivePerception ?? 10 + skillBonus(u.sheet, "Perception", "wis")));
  return [
    h("div", { className: "row wrap", style: "margin-top:6px" },
      quick("party-quarry-hostiles", "Party flees every hostile"), quick("party-quarry-everyone", "Party flees everyone else"),
      quick("party-pursuers-hostiles", "Party chases every hostile"), quick("party-pursuers-everyone", "Party chases everyone else")),
    h("div", { className: "small muted" }, "Every hostile = creatures in the initiative order; everyone else = every other unit in the scene."),
    h("div", { className: "dm-list" }, ...live.map((u) => h("div", { className: "dm-item" },
      h("span", { className: "grow" }, u.name, u.party ? h("span", { className: "small muted" }, " party") : null,
        c.escaped.includes(u.id) ? h("span", { className: "small ok" }, " escaped") : c.out.includes(u.id) ? h("span", { className: "small bad" }, " out") : null,
        side(u) ? h("span", { className: "small muted" }, ` · Dashes ${c.dashes[u.id] ?? 0}/${freeDashes(abilityMod(u.sheet.abilities.con))} free`) : null),
      c.quarry.includes(u.id) ? h("label", { className: "small", title: "The lead pursuer never lost sight of it: its escape check fails" },
        h("input", { type: "checkbox", checked: c.inSight.includes(u.id), onchange: set({ inSight: c.inSight.includes(u.id) ? c.inSight.filter((x) => x !== u.id) : [...c.inSight, u.id] }) }), "in sight") : null,
      h("select", { onchange: (e: Event) => void setSide(u, (e.target as HTMLSelectElement).value)() },
        h("option", { value: "", selected: !side(u) }, "not in the chase"), h("option", { value: "quarry", selected: side(u) === "quarry" }, "Quarry"), h("option", { value: "pursuer", selected: side(u) === "pursuer" }, "Pursuer"))))),
    h("div", { className: "row wrap", style: "margin-top:6px" },
      h("select", { onchange: (e: Event) => void set({ env: (e.target as HTMLSelectElement).value as ChaseState["env"] })() },
        h("option", { value: "urban", selected: c.env === "urban" }, "Urban complications"), h("option", { value: "wilderness", selected: c.env === "wilderness" }, "Wilderness complications"))),
    h("div", { className: "small", style: "margin-top:4px" }, `Quarry: ${c.quarry.map(name).join(", ") || "—"} · Pursuers: ${c.pursuers.map(name).join(", ") || "—"}${pursuers.length ? ` · best Passive Perception ${bestPassive}` : ""}`),
  ];
}

function startRow(c: ChaseState, units: TrackerUnit[], encounterStarted: boolean, name: (id: string) => string, grid: { multiplier: number; unit: string } | null): Child {
  const vehicles = c.mode === "vehicles";
  const inInit = (id?: string) => !!id && !!units.find((u) => u.id === id)?.inEncounter;
  let problem = "";
  let missing: string[] = [];
  if (vehicles) {
    const sided = c.vehicles.filter((v) => v.side && v.hp > 0);
    if (!sided.some((v) => v.side === "quarry") || !sided.some((v) => v.side === "pursuer")) problem = "Put at least one vehicle on each side.";
    const noDriver = sided.filter((v) => !v.driver);
    if (noDriver.length) problem = `${noDriver.map((v) => v.name).join(", ")}: no driver.`;
    missing = sided.map((v) => v.driver).filter((id): id is string => !!id && !inInit(id));
    problem = vehicleGridProblem(grid) ?? problem;
  } else {
    if (!c.quarry.length || !c.pursuers.length) problem = "Choose at least one quarry and one pursuer.";
    missing = [...c.quarry, ...c.pursuers].filter((id) => !inInit(id));
  }
  const start: ChaseState = {
    ...NEW_CHASE, mode: c.mode, env: c.env, vehicleEnv: c.vehicleEnv, escapeFactor: c.escapeFactor, publicRolls: c.publicRolls, quarry: c.quarry, pursuers: c.pursuers, inSight: c.inSight,
    vehicles: c.vehicles.map((v) => ({ ...v, dashes: 0, cover: undefined })), active: true,
    log: [vehicles
      ? `Vehicle chase started (${VEHICLE_ENV_LABEL[c.vehicleEnv]}): ${c.vehicles.filter((v) => v.side === "quarry").map((v) => v.name).join(", ")} fleeing ${c.vehicles.filter((v) => v.side === "pursuer").map((v) => v.name).join(", ")}.`
      : `Chase started: ${c.quarry.map(name).join(", ")} fleeing ${c.pursuers.map(name).join(", ")}.`],
  };
  const live = vehicles ? liveVehicles(c.vehicles, c) : [];
  return h("div", {},
    missing.length ? h("div", { className: "small warn" }, `Not in initiative yet: ${missing.map(name).join(", ")}. ${vehicles ? "Drivers" : "Participants"} need an initiative (roll it in the Tracker).`) : null,
    vehicles && c.active && live.some((v) => !ridersOf(v).length) ? h("div", { className: "small warn" }, "A vehicle with nobody aboard keeps going the way it was until it hits something.") : null,
    h("div", { className: "row", style: "margin-top:6px" },
      c.active
        ? h("button", { className: "secondary small", onclick: action(() => save({ ...c, active: false, pending: [], log: withLog(c, "The GM ended the chase.", ...tiredLine(c, name)).log })) }, "End chase")
        : h("button", { className: "small", disabled: !!problem, title: problem, onclick: action(() => save(start)) }, "Start chase"),
      problem && !c.active ? h("span", { className: "small muted" }, problem) : null,
      !encounterStarted && c.active ? h("span", { className: "small warn" }, "Start combat in the Tracker: the chase runs on turns.") : null));
}

/** Exhaustion the chase cost, which a Short or Long Rest removes. */
const tiredLine = (c: ChaseState, name: (id: string) => string) => {
  const t = Object.entries(c.exhaustionGained).filter(([, n]) => n > 0).map(([id, n]) => `${name(id)} ${n}`);
  return t.length ? [`Exhaustion gained in the chase (a Short or Long Rest removes it): ${t.join(", ")}.`] : [];
};

/** Vehicle chases run at a large scale: the scene's grid must be at least 100 ft per square. */
const gridLine = (grid: { multiplier: number; unit: string } | null): Child => {
  const why = vehicleGridProblem(grid);
  return why ? h("div", { className: "small bad", style: "margin-top:4px" }, why) : h("div", { className: "small ok", style: "margin-top:4px" }, `Grid: ${grid!.multiplier} ${grid!.unit} per square.`);
};
