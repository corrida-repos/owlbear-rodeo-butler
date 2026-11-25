/**
 * Fight or flight (2024 DMG): the "likely to flee" prompt the background page raises at the start of a Bloodied
 * monster's turn, and "Will they fight?" before combat. Both roll a DC 10 Wisdom saving throw (the GM can change the DC).
 */
import OBR from "@owlbear-rodeo/sdk";
import { readEncounter } from "../core/encounter";
import { fmtMod } from "../core/dice";
import { lifeManagerOpponentIds } from "../core/lifeManager";
import { MORALE_DC, MORALE_KEY, moraleOutcome, readMorale } from "../core/morale";
import { saveBonus, STATE_KEY } from "../core/sheet";
import { setInEncounter } from "../core/tracker";
import { obrGateway } from "./obrGateway";
import type { TrackerUnit } from "../core/tracker";
import { action, h, rerender, type Child } from "./dom";
import { gmRoll } from "./gmRoll";

let result = "";
let withdrawalId = "";
let leaderId = "";
let npcId = "";
let dc = MORALE_DC;

async function rollWis(u: TrackerUnit, why: string, d: number): Promise<string> {
  const bonus = saveBonus(u.sheet, "wis");
  const msg = await gmRoll(`1d20${fmtMod(bonus)}`, `Wisdom save · ${why}`, { unit: { id: u.id, name: u.name }, kind: "save" });
  withdrawalId = msg.total < d && why === "fight or flight" ? u.id : "";
  return `${u.name} ${moraleOutcome(msg.total, d)}`;
}

/** The in-combat prompt (Tracker and DM Tools), or nothing. */
export function moralePrompt(units: TrackerUnit[], meta: Record<string, unknown>): Child {
  const p = readEncounter(meta).started ? readMorale(meta) : null;
  const u = p && units.find((x) => x.id === p.unitId);
  if (!p || !u) {
    const withdrawing = units.find((candidate) => candidate.id === withdrawalId && candidate.inEncounter);
    return result ? h("div", { className: "panel small ok row between" }, result,
      withdrawing ? h("button", { className: "secondary small", onclick: action(async () => {
        await setInEncounter(obrGateway, [withdrawing.id], false);
        withdrawalId = "";
      }) }, "Withdraw from initiative") : null,
      h("button", { className: "icon tiny", onclick: () => { result = ""; withdrawalId = ""; rerender(); } }, "OK")) : null;
  }
  const clear = () => OBR.scene.setMetadata({ [MORALE_KEY]: undefined });
  return h("div", { className: "panel warn small stack tight" },
    h("div", {}, h("strong", {}, `Fight or flight: ${p.name}`), ` is likely to flee: ${p.reason}.`),
    h("div", { className: "row" },
      h("button", { className: "small", onclick: action(async () => { result = await rollWis(u, "fight or flight", MORALE_DC); await clear(); }) }, `Roll DC ${MORALE_DC} Wisdom save (${fmtMod(saveBonus(u.sheet, "wis"))})`),
      h("button", { className: "secondary small", onclick: action(async () => {
        result = `${p.name} flees or tries to parley.`;
        withdrawalId = u.id;
        await clear();
      }) }, "It flees / parleys"),
      h("button", { className: "secondary small", onclick: action(async () => { result = ""; withdrawalId = ""; await clear(); }) }, "Keeps fighting")));
}

/** DM Tools: "Will they fight?" before Initiative, plus the prompt. */
export function moralePanel(units: TrackerUnit[], meta: Record<string, unknown>): Child {
  const imported = new Set(lifeManagerOpponentIds(meta));
  const candidates = units.filter((u) => u.inEncounter && !u.party && !u.dead);
  if (!candidates.some((u) => u.id === npcId)) npcId = candidates[0]?.id ?? "";
  const npc = candidates.find((u) => u.id === npcId);
  const monsters = units.filter((u) => !u.party && !u.dead && !u.state.influencedAlly && !imported.has(u.id));
  if (!monsters.some((u) => u.id === leaderId)) leaderId = monsters[0]?.id ?? "";
  const leader = monsters.find((u) => u.id === leaderId);
  return h("details", { className: "panel" }, h("summary", {}, h("strong", {}, "Fight or flight")),
    h("div", { className: "small muted" }, "Before Initiative, a creature unsure whether to fight makes a DC 10 Wisdom save (the leader for a group); on a failure it flees or parleys. In combat, Butler warns you when a Bloodied opponent starting its turn is Frightened, or has lost more than half its allies while nobody on the other side is down."),
    moralePrompt(units, meta),
    npc ? h("div", { className: "stack tight" },
      h("label", {}, "NPC fighting alongside the party",
        h("select", { onchange: (e: Event) => { npcId = (e.target as HTMLSelectElement).value; rerender(); } },
          ...candidates.map((u) => h("option", { value: u.id, selected: u.id === npcId }, u.name))),
      ),
      h("button", { className: "small", onclick: action(async () => {
        if (await obrGateway.getRole() !== "GM") throw new Error("Only the GM can change an NPC’s allegiance.");
        await obrGateway.patchMetadata([{ id: npc.id, key: STATE_KEY, patch: { influencedAlly: !npc.state.influencedAlly } }]);
      }) }, npc.state.influencedAlly ? "Clear NPC ally status" : "Mark as NPC ally"),
    ) : null,
    imported.size ? h("p", { className: "small muted" }, "Resolve opening morale for Life Manager creatures before exporting the encounter.") : null,
    monsters.length ? h("div", { className: "row", style: "margin-top:6px" },
      h("select", { onchange: (e: Event) => { leaderId = (e.target as HTMLSelectElement).value; rerender(); } },
        ...monsters.map((u) => h("option", { value: u.id, selected: u.id === leaderId }, `${u.name} (Wis ${fmtMod(saveBonus(u.sheet, "wis"))})`))),
      h("label", { className: "small" }, "DC ", h("input", { type: "number", className: "num", value: String(dc), onchange: (e: Event) => { dc = Number((e.target as HTMLInputElement).value) || MORALE_DC; } })),
      h("button", { className: "small", disabled: !leader, onclick: action(async () => { if (leader) result = await rollWis(leader, "will they fight?", dc); }) }, "Will they fight?")) : null);
}
