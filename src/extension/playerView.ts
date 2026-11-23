/**
 * The popover for players (F12, D5, F15):
 *  - whose turn it is, End my turn, the movement bar;
 *  - the initiative order: every unit they can see by name (or the GM's alias), image and conditions; their own units
 *    also show HP and take HP / initiative changes (sent to the GM's client, applied when the GM allows player edits);
 *  - their units, with the card and a D&D Beyond re-sync of their own character;
 *  - the session's roll log.
 */
import OBR, { type Item } from "@owlbear-rodeo/sdk";
import { controls, portraitUrl, shownName, unitName } from "../core/card";
import { BUTLER_ITEM_KEY } from "../core/constants";
import { parseHpInput } from "../core/hp";
import type { SceneItemLite } from "../core/importer";
import { partyFromDdbExport, type PartyRecord } from "../core/party";
import { displayConditions } from "../core/systems";
import { trackerUnits, trackerView, type TrackerUnit } from "../core/tracker";
import { readUnit } from "../core/unit";
import { maxHp } from "../core/sheet";
import { checkStep, moveAllowance, movedSquares, playerBattleView, readBattle, readBattleUnit, unitBrNow, type Direction } from "../core/massCombat";
import { attackPreview, buildField, fieldUnit, guardsTriggered, readGrid, type GridInfo } from "./battleOps";
import { openActions } from "./actionsPopover";
import { openCard } from "./cardPopover";
import { bookmarkButton, DDB_ORIGIN, onDdbExport } from "./ddbLink";
import { h, store, type Child } from "./dom";
import { followToggle } from "./follow";
import { pendingSaves, pendingSavesBox } from "./castUi";
import { movementInfo } from "./movementView";
import { obrGateway } from "./obrGateway";
import { sendRequest } from "./requests";
import { renderRollLog } from "./rollLogView";
import { roomSettings, roomSystem } from "./roomSettings";
import { visionPanel } from "./visionPanel";

let items: Item[] = [];
let lite: SceneItemLite[] = [];
let sceneMeta: Record<string, unknown> = {};
let subscribed = false;
let sent: string | null = null;
let note = "";
let syncTarget: string | null = null;
let renderAgain = () => {};

const me = () => ({ id: OBR.player.id, role: "PLAYER" as const });
const itemOf = (id: string) => items.find((i) => i.id === id);
const mine = (u: TrackerUnit) => controls(me(), itemOf(u.id) ?? {}, u.state);

async function request(body: Parameters<typeof sendRequest>[0], done: string) {
  try { await sendRequest(body); note = done; } catch (e) { note = `Couldn't send: ${e instanceof Error ? e.message : String(e)}`; }
  renderAgain();
}

function turnPanel(): Child {
  const v = trackerView(lite, sceneMeta);
  if (!v.encounter.started) return h("div", { className: "panel small muted" }, "Not in combat.", followToggle(), autoActionsToggle());
  const visible = v.order.filter((u) => !u.hidden);
  const nameOf = (id?: string) => {
    const u = visible.find((x) => x.id === id);
    return u ? shownName(mine(u) ? "full" : "limited", me(), { label: u.name, name: u.name }, u.sheet, u.state) : null;
  };
  const active = v.order.find((u) => u.id === v.active);
  const myTurn = !!(active && mine(active));
  const key = `${v.encounter.round}:${v.active}`;
  return h("div", { className: `panel${myTurn ? " myturn" : ""}` },
    h("div", { className: "row between" },
      h("span", {}, h("strong", { className: "round" }, `Round ${v.encounter.round}`), nameOf(v.active) ? ` · ${nameOf(v.active)}'s turn` : " · the GM's turn"),
      myTurn && roomSettings().playerEdits
        ? h("button", { disabled: sent === key, onclick: async () => { sent = key; await request({ type: "end-turn", unitId: active!.id, round: v.encounter.round }, ""); } }, sent === key ? "Sent…" : "End my turn")
        : null),
    myTurn ? movementInfo(sceneMeta, active!, "PLAYER") : null,
    myTurn ? h("button", { className: "small", style: "margin-top:4px", title: "Actions, bonus actions, reactions, spells and uses", onclick: () => void openActions(active!.id) }, "⚔ My actions") : null,
    nameOf(v.next) ? h("div", { className: "small muted" }, `Next: ${nameOf(v.next)}`) : null,
    followToggle(), autoActionsToggle());
}

/** Opens the action bar by itself when one of this player's units starts its turn (this browser). */
const autoActionsToggle = () => h("label", { className: "small", title: "When it's your turn, open your action bar at the bottom of the screen" },
  h("input", { type: "checkbox", checked: store.get("butler.autoActions") === "1", onchange: (e: Event) => store.set("butler.autoActions", (e.target as HTMLInputElement).checked ? "1" : "0") }),
  "Open my action bar on my turn");

function ownEdits(u: TrackerUnit): Child {
  if (!roomSettings().playerEdits) return null;
  const hp = h("input", { type: "text", className: "hpbox", placeholder: "−7 / +5", title: "-7 damage · +5 heal · 12 set · t5 temp HP; Enter sends it" }) as HTMLInputElement;
  hp.onkeydown = (e: KeyboardEvent) => {
    if (e.key !== "Enter") return;
    const change = parseHpInput(hp.value);
    if (!change) { note = `"${hp.value}" isn't an HP change: use -7, +5, 12 or t5.`; renderAgain(); return; }
    hp.value = "";
    hp.blur();
    void request({ type: "hp", unitId: u.id, change }, "");
  };
  return hp;
}

function initBox(u: TrackerUnit): Child {
  if (!mine(u) || !roomSettings().playerEdits) return h("div", { className: "initval" }, u.initiative === null ? "–" : String(u.initiative));
  const inp = h("input", { type: "text", inputmode: "numeric", className: "initbox", value: u.initiative === null ? "" : String(u.initiative), placeholder: "–", title: "Your initiative roll" }) as HTMLInputElement;
  inp.onchange = () => { const v = inp.value.trim(); const n = Math.round(Number(v)); void request({ type: "initiative", unitId: u.id, value: v === "" ? null : Number.isFinite(n) ? n : null }, ""); };
  return inp;
}

function orderPanel(): Child {
  const v = trackerView(lite, sceneMeta);
  const rows = [...v.order, ...v.waiting].filter((u) => !u.hidden);
  if (!rows.length) return null;
  return h("div", { className: "panel tracker" },
    h("h2", {}, "Initiative"),
    ...rows.map((u) => {
      const own = mine(u);
      const name = shownName(own ? "full" : "limited", me(), { label: u.name, name: u.name }, u.sheet, u.state);
      const conds = displayConditions(roomSystem(), u.sheet, u.state);
      const img = portraitUrl({ imageUrl: (itemOf(u.id) as any)?.image?.url }, u.state);
      return h("div", { className: `trow${v.active === u.id ? " active" : ""}${v.next === u.id ? " next" : ""}` },
        h("div", { className: "tinit" }, initBox(u)),
        img ? h("img", { className: "thumb round small", src: img, alt: "" }) : h("div", { className: "thumb empty small" }, "?"),
        h("div", { className: "grow" },
          h("button", { className: "linkish", onclick: () => void openCard(u.id) }, name),
          own ? h("span", { className: "small muted" }, " (you)") : null,
          conds.length ? h("div", { className: "conds tight" }, ...conds.map((c) => h("span", { className: `cond${c.automatic ? " auto" : ""}` }, c.label, c.level ? ` ${c.level}` : ""))) : null),
        own ? h("div", { className: "thp" }, h("div", { className: "hpval" }, `${u.hp}/${u.maxHp}`, u.tempHp ? h("span", { className: "ok small" }, ` +${u.tempHp}`) : null), ownEdits(u)) : null);
    }));
}

function startDdbSync(unitId: string, ddbId?: number) {
  syncTarget = unitId;
  const w = window.open(ddbId ? `${DDB_ORIGIN}/characters/${ddbId}` : `${DDB_ORIGIN}/characters`, "_blank");
  note = w ? "On your character's D&D Beyond page, click the “Copy party for Encounter Butler” bookmark." : "Your browser blocked the D&D Beyond tab. Allow pop-ups for Owlbear and try again.";
  renderAgain();
}

onDdbExport(async (bundle) => {
  if (!syncTarget) return;
  try {
    const [member] = partyFromDdbExport(bundle).members;
    if (!member) throw new Error("No character in what D&D Beyond sent.");
    const hp = store.get("butler.selfSyncHp") === "ddb" ? "ddb" : "keep";
    await sendRequest({ type: "sheet-sync", unitId: syncTarget, member, hp });
    note = `${member.name} sent to the GM's Encounter Butler: your card updates in a moment.`;
  } catch (e) {
    note = `D&D Beyond sync failed: ${e instanceof Error ? e.message : String(e)}`;
  }
  renderAgain();
});

function myUnitsPanel(): Child {
  const own = items.flatMap((i) => {
    const u = i.layer === "CHARACTER" ? readUnit(i.metadata) : null;
    if (!u || !controls(me(), i, u.state)) return [];
    return [{ item: i, ...u, ddbId: (i.metadata[BUTLER_ITEM_KEY] as PartyRecord | undefined)?.ddbId }];
  });
  const canSync = roomSettings().playerEdits;
  return h("div", { className: "panel" },
    h("h2", {}, "My units"),
    own.length
      ? h("div", {}, ...own.map(({ item, sheet, state, ddbId }) => {
        const img = portraitUrl({ imageUrl: (item as any).image?.url }, state);
        const isPc = sheet.kind === "character" || state.party;
        return h("div", { className: "entry" },
          img ? h("img", { className: "thumb round", src: img, alt: "" }) : h("div", { className: "thumb empty" }, "?"),
          h("div", { className: "grow" },
            h("div", {}, h("strong", {}, unitName({ label: (item as any).text?.plainText, name: item.name }, sheet))),
            h("div", { className: "small muted" }, `HP ${state.hp}/${maxHp(sheet, state)}${state.tempHp ? ` (+${state.tempHp})` : ""} · AC ${sheet.ac}`)),
          h("div", { className: "stack tight" },
            h("button", { onclick: () => void openCard(item.id) }, "Card"),
            h("button", { className: "small", title: "Actions, bonus actions, reactions, spells and uses (BG3-style)", onclick: () => void openActions(item.id) }, "⚔ Actions"),
            isPc && canSync ? h("button", { className: "secondary small", title: "Update this character from your D&D Beyond sheet", onclick: () => startDdbSync(item.id, ddbId) }, "⟳ D&D Beyond") : null));
      }))
      : h("div", { className: "small muted" }, "No units yet. Ask the GM to set you as the controller of your character (unit card → Edit unit → Controlled by)."),
    own.some((o) => o.sheet.kind === "character" || o.state.party) && canSync
      ? h("details", { className: "small", style: "margin-top:6px" }, h("summary", {}, "D&D Beyond sync: set up the bookmark (once)"),
        h("p", {}, "Drag this to your browser's bookmarks bar. Then ⟳ D&D Beyond opens your character, you click the bookmark there, and your sheet comes back here."),
        bookmarkButton(),
        h("label", { style: "margin-top:6px" }, h("input", { type: "checkbox", checked: store.get("butler.selfSyncHp") === "ddb", onchange: (e: Event) => store.set("butler.selfSyncHp", (e.target as HTMLInputElement).checked ? "ddb" : "keep") }),
          "Also take current HP from D&D Beyond (otherwise the token's HP is kept)"))
      : null);
}

/** The units a player can pick for the Vision HUD: their own and the party's, as they see them. */
function visionUnits() {
  const v = trackerView(lite, sceneMeta);
  return [...v.order, ...v.waiting, ...v.outside].filter((u) => !u.hidden && (u.party || mine(u))).map((u) => ({
    id: u.id, party: u.party, mine: mine(u),
    name: shownName(mine(u) ? "full" : "limited", me(), { label: u.name, name: u.name }, u.sheet, u.state),
  }));
}

let grid: GridInfo | null = null;
let battleTarget = "";
let battleNote = "";

/** Orders for the battle unit this player commands: one square at a time, the five actions, End turn (applied by the GM's client). */
function battleOrders(): Child {
  if (!grid) return null;
  const f = buildField(items, sceneMeta, grid);
  const b = f.battle;
  const send = (unitId: string, body: Record<string, unknown>) => async () => {
    battleNote = "";
    try { await sendRequest({ type: "battle", unitId, round: b.round, ...body } as Parameters<typeof sendRequest>[0]); } catch (e) { battleNote = String(e); renderAgain(); }
  };
  const mine = f.units.filter((u) => u.unit.commandedBy === OBR.player.id && !u.unit.removed);
  const out: Child[] = [];
  // A guarding unit of mine that the acting enemy came next to.
  for (const g of guardsTriggered(f).filter((x) => mine.some((m) => m.id === x.id))) {
    const foe = f.units.find((u) => u.id === b.turnId)!;
    out.push(h("div", { className: "row small" }, h("span", { className: "warn grow" }, `${foe.unit.name} came next to ${g.unit.name}, which is guarding.`),
      h("button", { className: "small", onclick: send(g.id, { op: "guard-attack", targetId: foe.id }) }, "Attack it now")));
  }
  const e = mine.find((u) => u.id === b.turnId);
  if (b.active && e) {
    const me = fieldUnit(e);
    const all = f.units.map(fieldUnit);
    const shaken = e.unit.shakenRound === b.round;
    const used = b.turn.action;
    const allowed = moveAllowance(e.unit, b.turn, f.scale);
    const moved = movedSquares(b.turn, e.cell);
    const targets = f.units.filter((t) => !t.unit.removed && t.unit.side !== e.unit.side && t.item.visible)
      .map((t) => ({ t, pv: attackPreview(f, e.id, t.id, { highGround: false, cover: false })! }));
    if (!targets.some((x) => x.t.id === battleTarget && x.pv.reach.ok)) battleTarget = targets.find((x) => x.pv.reach.ok)?.t.id ?? "";
    const chosen = targets.find((x) => x.t.id === battleTarget);
    const arrow = (d: Direction | null, label: string) => {
      if (!d) return h("span", {});
      const r = checkStep(me, e.unit, all, b, f.scale, d);
      return h("button", { className: "secondary small", disabled: !r.ok, title: r.ok ? `Move ${d.toUpperCase()}` : r.why, onclick: send(e.id, { op: "move", dir: d }) }, label);
    };
    const act = (label: string, op: string, title: string, extra: Record<string, unknown> = {}, off = false) =>
      h("button", { className: "small", disabled: !!used || shaken || off, title, onclick: send(e.id, { op, ...extra }) }, label);
    const pad: [Direction | null, string][] = [["nw", "↖"], ["n", "↑"], ["ne", "↗"], ["w", "←"], [null, ""], ["e", "→"], ["sw", "↙"], ["s", "↓"], ["se", "↘"]];
    out.push(h("div", { className: "stack tight", style: "margin-top:6px" },
      h("div", {}, h("strong", {}, `Your unit acts: ${e.unit.name}`), h("span", { className: "small muted" }, `${b.showCommandedBr ? ` · BR ${unitBrNow(e.unit)}` : ""} · moved ${moved}/${allowed} squares`)),
      shaken ? h("div", { className: "small bad" }, "Shaken: it can't move or take actions this turn.") : null,
      used ? h("div", { className: "small ok" }, `Action used: ${used}${used === "disengage" ? (b.turn.disengaged ? " (it may move half its speed)" : " (failed: it doesn't move)") : ""}.`) : null,
      h("div", { className: "row", style: "align-items:flex-start" },
        h("div", { style: "display:grid;grid-template-columns:repeat(3,2.2em);gap:2px" }, ...pad.map(([d, l]) => arrow(d, l))),
        h("div", { className: "stack tight grow" },
          h("div", { className: "row wrap" },
            h("select", { onchange: (ev: Event) => { battleTarget = (ev.target as HTMLSelectElement).value; renderAgain(); } },
              ...targets.map(({ t, pv }) => h("option", { value: t.id, selected: t.id === battleTarget, disabled: !pv.reach.ok }, `${t.unit.name}${pv.reach.ok ? ` (${pv.reach.how})` : ` — ${pv.reach.why}`}`))),
            act("Attack", "attack", "Opposed d20 + BR rolls", { targetId: battleTarget }, !chosen?.pv.reach.ok)),
          chosen ? h("div", { className: "small muted" }, [...chosen.pv.factors.adv.map((x) => `Advantage: ${x}`), ...chosen.pv.factors.dis.map((x) => `Disadvantage: ${x}`)].join(" · ") || "No Advantage or Disadvantage from the map (higher ground and cover are the GM's call).") : null,
          h("div", { className: "row wrap" },
            act("Dash", "dash", "Double its speed this turn"),
            act("Defend", "defend", "Attacks against it have Disadvantage until the end of its next turn"),
            act("Disengage", "disengage", "DC 10 morale check: move half its speed away from enemies, or lose the action"),
            act("Guard", "guard", "Attack the next enemy unit that moves next to it")),
          h("div", { className: "row wrap" },
            h("button", { className: "secondary small", disabled: !!used || moved === 0, title: "Back to where it started this turn", onclick: send(e.id, { op: "undo-move" }) }, "Undo move"),
            h("button", { className: "small", onclick: send(e.id, { op: "end-turn" }) }, "End turn"))))));
  }
  if (battleNote) out.push(h("div", { className: "small bad" }, battleNote));
  return out.length ? h("div", {}, ...out) : null;
}

/** Mass combat: the units the player can see, how they're doing in words, and the battle's public log. */
function battlePanel(): Child {
  if (!roomSettings().massCombat) return null;
  const units = items.flatMap((i) => { const unit = readBattleUnit(i.metadata); return unit ? [{ id: i.id, visible: i.visible, unit }] : []; });
  const b = readBattle(sceneMeta);
  if (!units.length && !b.active) return null;
  const v = playerBattleView(units, b, OBR.player.id);
  return h("details", { className: "panel", open: b.active }, h("summary", {}, h("strong", {}, b.active ? `Battle · round ${v.round}` : "Battle")),
    h("div", { className: "dm-list" }, ...v.rows.map((r) => h("div", { className: "dm-item", style: r.active ? "outline:2px solid var(--accent, #6c5ce7)" : "" },
      h("div", { className: "grow" },
        h("div", {}, h("strong", {}, r.name), h("span", { className: "small muted" }, ` · ${r.side}`), r.mine ? h("span", { className: "small ok" }, " · you command it") : null, r.active ? h("span", { className: "small warn" }, " · acting") : null),
        h("div", { className: "small muted" }, r.makeup),
        h("div", { className: "small" }, r.status, r.numbers ? ` · ${r.numbers}` : ""))))),
    battleOrders(),
    v.log.length ? h("div", { className: "small stack tight", style: "margin-top:6px" }, ...v.log.slice(-10).reverse().map((l) => h("div", {}, "• ", l))) : null);
}

export function renderPlayerView(): Child[] {
  return [
    turnPanel(),
    pendingSavesBox(pendingSaves(sceneMeta, trackerUnits(lite), items, me()), "PLAYER"),
    note ? h("div", { className: "panel small" }, note, " ", h("button", { className: "icon tiny", onclick: () => { note = ""; renderAgain(); } }, "OK")) : null,
    battlePanel(),
    orderPanel(),
    myUnitsPanel(),
    visionPanel("PLAYER", renderAgain, visionUnits()),
    renderRollLog(),
  ];
}

/** Keeps the player's view current. */
export async function initPlayerItems(onChange: () => void) {
  renderAgain = onChange;
  [items, lite, sceneMeta] = await Promise.all([OBR.scene.items.getItems(), obrGateway.getItems(), OBR.scene.getMetadata()]);
  grid = await readGrid().catch(() => null);
  if (subscribed) return;
  subscribed = true;
  OBR.scene.grid.onChange(async () => { grid = await readGrid().catch(() => null); onChange(); });
  OBR.scene.items.onChange(async (i) => { items = i; lite = await obrGateway.getItems(); onChange(); });
  OBR.scene.onMetadataChange((m) => { sceneMeta = m; onChange(); });
}
