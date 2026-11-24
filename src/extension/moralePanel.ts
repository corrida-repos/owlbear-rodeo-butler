/**
 * Fight or flight (2024 DMG): the "likely to flee" prompt the background page raises at the start of a Bloodied
 * monster's turn, and "Will they fight?" before combat. Both roll a DC 10 Wisdom saving throw (the GM can change the DC).
 */
import OBR from "@owlbear-rodeo/sdk";
import { fmtMod } from "../core/dice";
import { lifeManagerOpponentIds } from "../core/lifeManager";
import { MORALE_DC, MORALE_KEY, moraleOutcome, readMorale } from "../core/morale";
import { saveBonus } from "../core/sheet";
import type { TrackerUnit } from "../core/tracker";
import { action, h, rerender, type Child } from "./dom";
import { gmRoll } from "./gmRoll";

let result = "";
let leaderId = "";
let dc = MORALE_DC;

async function rollWis(u: TrackerUnit, why: string, d: number): Promise<string> {
  const bonus = saveBonus(u.sheet, "wis");
  const msg = await gmRoll(`1d20${fmtMod(bonus)}`, `Wisdom save · ${why}`, { unit: { id: u.id, name: u.name }, kind: "save" });
  return `${u.name} ${moraleOutcome(msg.total, d)}`;
}

/** The in-combat prompt (Tracker and DM Tools), or nothing. */
export function moralePrompt(units: TrackerUnit[], meta: Record<string, unknown>): Child {
  const p = readMorale(meta);
  const u = p && units.find((x) => x.id === p.unitId);
  if (!p || !u) return result ? h("div", { className: "panel small ok row between" }, result, h("button", { className: "icon tiny", onclick: () => { result = ""; rerender(); } }, "OK")) : null;
  const clear = () => OBR.scene.setMetadata({ [MORALE_KEY]: undefined });
  return h("div", { className: "panel warn small stack tight" },
    h("div", {}, h("strong", {}, `Fight or flight: ${p.name}`), ` is likely to flee: ${p.reason}.`),
    h("div", { className: "row" },
      h("button", { className: "small", onclick: action(async () => { result = await rollWis(u, "fight or flight", MORALE_DC); await clear(); }) }, `Roll DC ${MORALE_DC} Wisdom save (${fmtMod(saveBonus(u.sheet, "wis"))})`),
      h("button", { className: "secondary small", onclick: action(async () => { result = `${p.name} flees or tries to parley (your call, no roll).`; await clear(); }) }, "It flees / parleys"),
      h("button", { className: "secondary small", onclick: action(async () => { result = ""; await clear(); }) }, "Keeps fighting")));
}

/** DM Tools: "Will they fight?" before Initiative, plus the prompt. */
export function moralePanel(units: TrackerUnit[], meta: Record<string, unknown>): Child {
  const imported = new Set(lifeManagerOpponentIds(meta));
  const monsters = units.filter((u) => !u.party && !u.dead && !imported.has(u.id));
  if (!monsters.some((u) => u.id === leaderId)) leaderId = monsters[0]?.id ?? "";
  const leader = monsters.find((u) => u.id === leaderId);
  return h("details", { className: "panel" }, h("summary", {}, h("strong", {}, "Fight or flight")),
    h("div", { className: "small muted" }, "Before Initiative, a creature unsure whether to fight makes a DC 10 Wisdom save (the leader for a group); on a failure it flees or parleys. In combat, Butler warns you when a Bloodied monster starting its turn is Frightened, or has lost more than half its allies while nobody on the other side is down."),
    moralePrompt(units, meta),
    imported.size ? h("p", { className: "small muted" }, "Resolve opening morale for Life Manager creatures before exporting the encounter.") : null,
    monsters.length ? h("div", { className: "row", style: "margin-top:6px" },
      h("select", { onchange: (e: Event) => { leaderId = (e.target as HTMLSelectElement).value; rerender(); } },
        ...monsters.map((u) => h("option", { value: u.id, selected: u.id === leaderId }, `${u.name} (Wis ${fmtMod(saveBonus(u.sheet, "wis"))})`))),
      h("label", { className: "small" }, "DC ", h("input", { type: "number", className: "num", value: String(dc), onchange: (e: Event) => { dc = Number((e.target as HTMLInputElement).value) || MORALE_DC; } })),
      h("button", { className: "small", disabled: !leader, onclick: action(async () => { if (leader) result = await rollWis(leader, "will they fight?", dc); }) }, "Will they fight?")) : null);
}
