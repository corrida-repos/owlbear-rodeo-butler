/**
 * "Combat" tab: Difficulty Calculator (2024 DMG budgets + an invented Extreme tier) over the Butler units in the
 * scene, and the Initiatives buttons (roll everyone, or just the creatures when players roll their own).
 */
import OBR from "@owlbear-rodeo/sdk";
import { crLabel, EXTREME_FACTOR, listCombatants, rollSceneInitiative, sceneDifficulty, setCombatSettings, xpForCr, type Combatant, type InitiativeReport, type Tier } from "../core/combat";
import { describeInitiative, fmtMod } from "../core/dice";
import { action, h, rerender, ui, type Child } from "./dom";
import { obrGateway } from "./obrGateway";
import { openCard } from "./cardPopover";
import { renderRollLog } from "./rollLogView";
import { roomSettings, roomSystem, setRoomSettings } from "./roomSettings";
import { SYSTEMS, type SystemId } from "../core/systems";

let combatants: Combatant[] | null = null;
let lastRoll: InitiativeReport | null = null;
let pending = false;
let timer: ReturnType<typeof setTimeout> | null = null;

/** Re-reads the scene. Waits while the GM is typing in a field so the re-render doesn't steal focus. */
export function refreshCombat(immediate = false) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(async () => {
    try { combatants = listCombatants(await obrGateway.getItems()); } catch { return; }
    const a = document.activeElement;
    if (a && a.closest("#app") && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName) && (a as HTMLInputElement).type !== "checkbox") { pending = true; return; }
    rerender();
  }, immediate ? 0 : 150);
}
document.addEventListener("focusout", () => { if (pending) { pending = false; setTimeout(rerender, 0); } });

const fmt = (n: number) => n.toLocaleString("en-US");
/** A unit's name that opens its card. */
const cardLink = (c: Combatant) => h("button", { className: "linkish", title: "Open the unit card", onclick: () => void openCard(c.id) }, c.name);
const TIER_TEXT: Record<Tier, string> = {
  Low: "Low: the party should win without much trouble, though it may spend some resources.",
  Moderate: "Moderate: expect the party to spend real resources (spell slots, Hit Points), with a chance of a character going down.",
  High: "High: a dangerous fight. One or more characters may drop, and smart tactics or luck may be needed.",
  Extreme: "Extreme: a boss-level fight, beyond the DMG's High. Party wipes are possible: give the party an edge, an escape route or a reason to fight anyway.",
};

function renderDifficulty(cs: Combatant[]): Child {
  const party = cs.filter((c) => c.party);
  const foes = cs.filter((c) => !c.party);
  const d = sceneDifficulty(cs);
  const b = d.budgets;
  const max = Math.max(b.extreme * 1.15, d.xp, 1);
  const pct = (v: number) => `${Math.min(100, (v / max) * 100)}%`;

  const result = d.tier
    ? h("div", { className: `tier tier-${d.tier.toLowerCase()}` },
      h("div", { className: "row between" },
        h("span", { className: "tier-name" }, d.tier),
        h("span", { className: "small" }, `${fmt(d.xp)} XP`)),
      h("div", { className: "meter" },
        h("div", { className: "fill", style: `width:${pct(d.xp)}` }),
        ...([["Low", b.low], ["Moderate", b.moderate], ["High", b.high], ["Extreme", b.extreme]] as const).map(([n, v]) =>
          h("div", { className: "mark", style: `left:${pct(v)}`, title: `${n}: ${fmt(v)} XP` }))),
      h("div", { className: "small budgets" },
        h("span", {}, `Low ${fmt(b.low)}`), h("span", {}, `Moderate ${fmt(b.moderate)}`), h("span", {}, `High ${fmt(b.high)}`), h("span", {}, `Extreme ${fmt(b.extreme)}`)),
      h("div", { className: "small", style: "margin-top:6px" }, TIER_TEXT[d.tier]),
      d.belowLow ? h("div", { className: "small muted" }, `This is under even the Low budget (${fmt(b.low)} XP): barely a speed bump.`) : null)
    : h("div", { className: "small muted" },
      !party.filter((c) => !c.exclude).length ? "Add party members (Add Party Members tab) to compare against." : "No hostile creatures in the scene yet (Add Creatures tab).");

  const levelInput = (c: Combatant) => {
    const inp = h("input", { type: "text", inputmode: "numeric", className: "lvl", value: c.level ? String(c.level) : "", placeholder: "?" }) as HTMLInputElement;
    inp.onchange = action(async () => {
      const v = Math.round(Number(inp.value));
      await setCombatSettings(obrGateway, c.id, { level: v >= 1 && v <= 20 ? v : undefined });
    });
    return inp;
  };
  const partyRows = party.map((c) =>
    h("tr", { className: c.exclude ? "off" : "" },
      h("td", {}, h("input", { type: "checkbox", checked: !c.exclude, title: "In this fight", onchange: action(() => setCombatSettings(obrGateway, c.id, { exclude: !c.exclude })) })),
      h("td", {}, cardLink(c), h("div", { className: "muted small" },
        c.levelSource === "sheet" ? "level from the sheet" : c.levelSource === "set" ? "level set here" : c.levelSource === "cr" ? `level guessed from CR ${crLabel(c.cr!)}` : "level unknown: enter it")),
      h("td", { className: "num" }, levelInput(c))));

  const foeRows = foes.map((c) =>
    h("tr", { className: c.exclude ? "off" : "" },
      h("td", {}, h("input", { type: "checkbox", checked: !c.exclude, title: "Hostile (counts toward difficulty)", onchange: action(() => setCombatSettings(obrGateway, c.id, { exclude: !c.exclude })) })),
      h("td", {}, cardLink(c), c.exclude ? h("div", { className: "muted small" }, "not hostile: ignored") : null),
      h("td", { className: "num" }, c.cr === null ? "?" : crLabel(c.cr)),
      h("td", { className: "num" }, c.cr === null ? "—" : fmt(xpForCr(c.cr)))));

  return h("div", { className: "panel" },
    h("h2", {}, "Difficulty calculator"),
    result,
    ...d.warnings.map((w) => h("div", { className: "small warn", style: "margin-top:4px" }, `⚠ ${w}`)),
    d.missingLevels.length ? h("div", { className: "small warn", style: "margin-top:4px" }, `⚠ No level for ${d.missingLevels.join(", ")}: enter it below to count them.`) : null,
    d.missingCr.length ? h("div", { className: "small warn", style: "margin-top:4px" }, `⚠ No CR for ${d.missingCr.join(", ")}: not counted.`) : null,
    h("h2", { style: "margin-top:12px" }, `Party members (${party.filter((c) => !c.exclude).length}/${party.length})`),
    party.length ? h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, ""), h("th", {}, "Name"), h("th", {}, "Level"))), h("tbody", {}, ...partyRows))
      : h("div", { className: "small muted" }, "None in this scene. Party members (Add Party Members tab) show up here."),
    h("h2", { style: "margin-top:12px" }, `Creatures (${foes.filter((c) => !c.exclude).length} hostile of ${foes.length})`),
    foes.length ? h("table", {}, h("thead", {}, h("tr", {}, h("th", { title: "Hostile" }, "Hostile"), h("th", {}, "Name"), h("th", {}, "CR"), h("th", {}, "XP"))), h("tbody", {}, ...foeRows))
      : h("div", { className: "small muted" }, "None in this scene."),
    h("details", { className: "small", style: "margin-top:8px" }, h("summary", {}, "How it's calculated"),
      h("p", {}, "2024 Dungeon Master's Guide: each character adds an XP budget for their level (Low, Moderate, High). The hostile creatures' XP (from their CR) is compared to the party's total. There are no group multipliers in these rules."),
      h("p", {}, `Extreme is an extra tier for boss-level fights, not from the DMG: ${EXTREME_FACTOR}× the High budget. The tier shown is the highest budget the encounter reaches. Untick a creature that isn't hostile, or a character who isn't in this fight.`)));
}

async function roll(scope: "all" | "creatures") {
  lastRoll = await rollSceneInitiative(obrGateway, scope);
  await OBR.notification.show(`Rolled initiative for ${lastRoll.rolled.length} ${scope === "all" ? "units" : "creatures"}.`, "SUCCESS");
}

function renderInitiative(cs: Combatant[]): Child {
  const onList = cs.filter((c) => c.onList);
  const creatures = onList.filter((c) => !c.party).length;
  const order = [...onList].filter((c) => c.initiative !== null).sort((a, b) => b.initiative! - a.initiative!);
  return h("div", { className: "panel" },
    h("h2", {}, "Initiatives"),
    h("div", { className: "row", style: "flex-wrap:nowrap" },
      h("button", { className: "grow", disabled: ui.busy || !onList.length, onclick: action(() => roll("all")) }, "Roll all initiatives"),
      h("button", { className: "grow secondary", disabled: ui.busy || !creatures, onclick: action(() => roll("creatures")) }, "Roll just creatures' initiatives")),
    h("div", { className: "small muted", style: "margin-top:4px" }, "Players rolling their own? Use the second button; entering their results comes with the initiative tracker."),
    lastRoll ? h("ul", { className: "plain small", style: "margin-top:8px" }, ...lastRoll.rolled.map((r) =>
      h("li", {}, h("strong", {}, `${r.roll.total}`), ` ${r.name}${r.party ? " (party)" : ""}: ${describeInitiative(r.roll)}`))) : null,
    !lastRoll && order.length ? h("div", { style: "margin-top:8px" },
      h("div", { className: "small muted" }, "Current order"),
      h("ul", { className: "plain small" }, ...order.map((c) => h("li", {}, h("strong", {}, String(c.initiative)), " ", cardLink(c), ` (${fmtMod(c.setup.modifier)}${c.setup.advantage ? " adv" : ""})`)))) : null);
}

function renderSettings(): Child {
  const sys = roomSystem();
  return h("div", { className: "panel" },
    h("h2", {}, "Game system"),
    h("select", { disabled: ui.busy, onchange: (e: Event) => { const v = (e.target as HTMLSelectElement).value as SystemId; void action(() => setRoomSettings({ system: v }))(); } },
      ...Object.values(SYSTEMS).map((s) => h("option", { value: s.id, selected: s.id === roomSettings().system }, s.label))),
    h("div", { className: "small muted", style: "margin-top:4px" },
      sys.rules === "2024"
        ? "2024 books come first in creature search; Bloodied is shown automatically."
        : "2014 books come first in creature search. The difficulty above still uses the 2024 budgets for now."),
    h("h2", { style: "margin-top:12px" }, "Room settings"),
    h("label", { className: "small" }, h("input", { type: "checkbox", checked: roomSettings().playerEdits, disabled: ui.busy, onchange: (e: Event) => void action(() => setRoomSettings({ playerEdits: (e.target as HTMLInputElement).checked }))() }),
      "Players may change their own units' HP, conditions and initiative, end their own turn and re-sync from D&D Beyond"),
    h("label", { className: "small", style: "margin-top:4px" }, h("input", { type: "checkbox", checked: roomSettings().autoDeadAtZero, disabled: ui.busy, onchange: (e: Event) => void action(() => setRoomSettings({ autoDeadAtZero: (e.target as HTMLInputElement).checked }))() }),
      "Mark creatures dead automatically at 0 HP (party members still make death saves)"));
}

export function renderCombatTab(): Child[] {
  if (!combatants) { refreshCombat(true); return [h("div", { className: "panel small muted" }, "Reading the scene…")]; }
  return [renderDifficulty(combatants), renderInitiative(combatants), renderRollLog(), renderSettings()];
}
export function resetCombatTab() { combatants = null; lastRoll = null; }
