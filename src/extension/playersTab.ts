/**
 * "Players" tab (GM): one card per party member with what the GM keeps asking for — HP, AC, initiative, speed,
 * passive Perception / Insight / Investigation, spell save DC, saves, senses, defences, conditions and who plays it.
 * Read-only; follows the scene live. Click a name for the full unit card.
 */
import OBR, { type Player } from "@owlbear-rodeo/sdk";
import { fmtMod } from "../core/dice";
import { playerStats } from "../core/partyStats";
import { displayConditions } from "../core/systems";
import { trackerUnits, type TrackerUnit } from "../core/tracker";
import { openCard } from "./cardPopover";
import { h, rerender, type Child } from "./dom";
import { obrGateway } from "./obrGateway";
import { roomSystem } from "./roomSettings";

let units: TrackerUnit[] | null = null;
let players: Player[] = [];
let subscribed = false;
let timer: ReturnType<typeof setTimeout> | null = null;

export function refreshPlayersTab(immediate = false) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(async () => {
    try { units = trackerUnits(await obrGateway.getItems()); } catch { return; }
    if (!subscribed) {
      subscribed = true;
      try { players = await OBR.party.getPlayers(); OBR.party.onChange((p) => { players = p; rerender(); }); } catch { /* party unavailable */ }
    }
    rerender();
  }, immediate ? 0 : 120);
}
export function resetPlayersTab() { units = null; }

const ABBR: Record<string, string> = { str: "Str", dex: "Dex", con: "Con", int: "Int", wis: "Wis", cha: "Cha" };

const tile = (k: string, v: string, title?: string, cls = "") =>
  h("div", { className: `pstat${cls ? ` ${cls}` : ""}`, title: title ?? "" }, h("span", { className: "k" }, k), h("span", { className: "v" }, v));

function card(u: TrackerUnit): HTMLElement {
  const s = playerStats(u.sheet, u.state, u);
  const conds = displayConditions(roomSystem(), u.sheet, u.state);
  const player = u.state.controlledBy ? `played by ${players.find((p) => p.id === u.state.controlledBy)?.name ?? "(not connected)"}` : "no player assigned";
  const pct = u.maxHp > 0 ? Math.max(0, Math.min(100, (u.hp / u.maxHp) * 100)) : 0;
  const hpCls = u.hp <= 0 ? "bad" : u.hp * 2 <= u.maxHp ? "warn" : "ok";
  return h("div", { className: `panel pcard${u.hp <= 0 ? " down" : ""}` },
    h("div", { className: "row", style: "gap:8px;flex-wrap:nowrap" },
      u.imageUrl ? h("img", { className: "thumb round small", src: u.imageUrl, alt: "" }) : h("div", { className: "thumb empty small" }, "?"),
      h("div", { className: "grow" },
        h("button", { className: "linkish", title: "Open the unit card", onclick: () => void openCard(u.id) }, u.name),
        h("div", { className: "small muted" }, [s.subtitle, player].filter(Boolean).join(" · "))),
      h("div", { className: "phpwrap" },
        h("div", { className: `php ${hpCls}` }, `${u.hp}/${u.maxHp}`, u.tempHp ? h("span", { className: "ok small" }, ` +${u.tempHp}`) : null),
        h("div", { className: "hpbar" }, h("div", { className: `hpfill ${hpCls}`, style: `width:${pct}%` })))),
    h("div", { className: "pstats" },
      tile("AC", String(s.ac)),
      tile("Init", fmtMod(s.initiative)),
      tile("Perc", String(s.passives.perception), "Passive Perception"),
      tile("Ins", String(s.passives.insight), "Passive Insight"),
      tile("Inv", String(s.passives.investigation), "Passive Investigation"),
      s.spellDc !== undefined ? tile("Spell DC", String(s.spellDc), "Spell save DC") : tile("Speed", `${u.sheet.speed.walk}`, s.speed)),
    h("div", { className: "psaves small" },
      h("span", { className: "muted" }, "Saves "),
      ...s.saves.map((x) => h("span", { className: x.proficient ? "prof" : "", title: x.proficient ? "Proficient" : "" }, `${ABBR[x.ability]} ${fmtMod(x.bonus)}`))),
    h("div", { className: "small" }, h("span", { className: "muted" }, "Speed "), s.speed,
      s.senses.length ? ` · ${s.senses.join(", ")}` : ""),
    ...s.defenses.map((d) => h("div", { className: "small" }, h("span", { className: "muted" }, `${d.label} `), d.text)),
    u.state.concentrationCheck ? h("div", { className: "small warn" }, `Concentration check pending: DC ${u.state.concentrationCheck.dc}`) : null,
    conds.length ? h("div", { className: "conds tight" }, ...conds.map((c) => h("span", { className: `cond${c.automatic ? " auto" : ""}` }, c.label, c.level ? ` ${c.level}` : "", c.detail ? ` ${c.detail}` : ""))) : null);
}

export function renderPlayersTab(): Child[] {
  if (!units) { refreshPlayersTab(true); return [h("div", { className: "panel small muted" }, "Reading the party…")]; }
  const party = units.filter((u) => u.party).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  if (!party.length) return [h("div", { className: "panel small muted" }, "No party members in this scene yet. Add them in the Add Party tab (D&D Beyond sync, or mark a unit that's already here as a party member).")];
  const stats = party.map((u) => playerStats(u.sheet, u.state, u));
  const lowest = (f: (s: (typeof stats)[number]) => number) => Math.min(...stats.map(f));
  return [
    h("div", { className: "panel small" },
      h("span", { className: "muted" }, "Party lowest passives: "),
      `Perception ${lowest((s) => s.passives.perception)} · Insight ${lowest((s) => s.passives.insight)} · Investigation ${lowest((s) => s.passives.investigation)}`),
    ...party.map(card),
  ];
}
