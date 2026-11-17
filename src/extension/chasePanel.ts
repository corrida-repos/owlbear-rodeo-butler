/**
 * DM Tools → Chase mode: pick the quarry and the pursuers (one-click sides or unit by unit), the environment and the
 * escape factor. Once started, Butler rolls complications after each participant's turn, tracks Dashes and rolls the
 * quarry's escape checks at initiative count 0 (background/chase.ts). The log shows what happened.
 */
import OBR from "@owlbear-rodeo/sdk";
import { CHASE_KEY, freeDashes, NEW_CHASE, quickSides, readChase, withLog, type ChaseState, type QuickSides } from "../core/chase";
import { skillBonus } from "../core/combatOptions";
import { abilityMod } from "../core/sheet";
import type { TrackerUnit } from "../core/tracker";
import { action, h, type Child } from "./dom";

const save = (c: ChaseState) => OBR.scene.setMetadata({ [CHASE_KEY]: c });

export function chasePanel(units: TrackerUnit[], meta: Record<string, unknown>, encounterStarted: boolean): Child {
  const c = readChase(meta);
  const name = (id: string) => units.find((u) => u.id === id)?.name ?? "(gone)";
  const set = (patch: Partial<ChaseState>) => action(() => save({ ...c, ...patch }));
  const side = (u: TrackerUnit) => c.quarry.includes(u.id) ? "quarry" : c.pursuers.includes(u.id) ? "pursuer" : "";
  const setSide = (u: TrackerUnit, to: string) => set({
    quarry: to === "quarry" ? [...c.quarry.filter((x) => x !== u.id), u.id] : c.quarry.filter((x) => x !== u.id),
    pursuers: to === "pursuer" ? [...c.pursuers.filter((x) => x !== u.id), u.id] : c.pursuers.filter((x) => x !== u.id),
  });
  const quick = (how: QuickSides, label: string) => h("button", { className: "secondary small", disabled: c.active, onclick: set(quickSides(units, how)) }, label);
  const live = units.filter((u) => !u.dead);
  const pursuers = c.pursuers.map((id) => units.find((u) => u.id === id)).filter((u): u is TrackerUnit => !!u);
  const bestPassive = Math.max(0, ...pursuers.map((u) => u.sheet.passivePerception ?? 10 + skillBonus(u.sheet, "Perception", "wis")));
  const missingInit = [...c.quarry, ...c.pursuers].filter((id) => !units.find((u) => u.id === id)?.inEncounter);

  return h("details", { className: "panel", open: c.active }, h("summary", {}, h("strong", {}, c.active ? "Chase mode (running)" : "Chase mode")),
    h("div", { className: "small muted" }, "The DMG's chase rules on top of initiative: after each participant's turn Butler rolls a d12 complication (it hits the next participant, who saves automatically), counts Dashes (3 + Con modifier free, then a DC 10 Con save or Exhaustion), and at the end of each round rolls each quarry's Stealth against the pursuers' best Passive Perception."),
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
        h("option", { value: "urban", selected: c.env === "urban" }, "Urban complications"), h("option", { value: "wilderness", selected: c.env === "wilderness" }, "Wilderness complications")),
      h("select", { title: "Escape Factors", onchange: (e: Event) => void set({ escapeFactor: (e.target as HTMLSelectElement).value as ChaseState["escapeFactor"] })() },
        h("option", { value: "normal", selected: c.escapeFactor === "normal" }, "Escape: no factor"),
        h("option", { value: "advantage", selected: c.escapeFactor === "advantage" }, "Escape with Advantage (many hiding places, crowded)"),
        h("option", { value: "disadvantage", selected: c.escapeFactor === "disadvantage" }, "Escape with Disadvantage (few hiding places, uncrowded)")),
      h("label", { className: "small" }, h("input", { type: "checkbox", checked: c.publicRolls, onchange: set({ publicRolls: !c.publicRolls }) }), "players see the chase rolls")),
    h("div", { className: "small", style: "margin-top:4px" }, `Quarry: ${c.quarry.map(name).join(", ") || "—"} · Pursuers: ${c.pursuers.map(name).join(", ") || "—"}${pursuers.length ? ` · best Passive Perception ${bestPassive}` : ""}`),
    missingInit.length ? h("div", { className: "small warn" }, `Not in initiative yet: ${missingInit.map(name).join(", ")}. Participants need an initiative (roll it in the Tracker).`) : null,
    h("div", { className: "row", style: "margin-top:6px" },
      c.active
        ? h("button", { className: "secondary small", onclick: set({ active: false, log: withLog(c, "The GM ended the chase.").log }) }, "End chase")
        : h("button", { className: "small", disabled: !c.quarry.length || !c.pursuers.length, onclick: set({ ...NEW_CHASE, env: c.env, escapeFactor: c.escapeFactor, publicRolls: c.publicRolls, quarry: c.quarry, pursuers: c.pursuers, inSight: c.inSight, active: true, log: [`Chase started: ${c.quarry.map(name).join(", ")} fleeing ${c.pursuers.map(name).join(", ")}.`] }) }, "Start chase"),
      !encounterStarted && c.active ? h("span", { className: "small warn" }, "Start combat in the Tracker: the chase runs on turns.") : null),
    c.log.length ? h("div", { className: "small stack tight", style: "margin-top:6px" }, ...c.log.slice().reverse().map((l) => h("div", {}, "• ", l))) : null);
}
