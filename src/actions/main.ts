/**
 * Action bar popover (actions.html?id=<itemId>): a BG3-style hotbar for one unit.
 *  - This turn's economy: Action ●, Bonus Action ▲, Reaction ◆ (and Legendary Actions), reset when the unit's turn
 *    starts; the movement tracker's feet.
 *  - Spell slots and limited uses as pips; Short / Long Rest.
 *  - Everything the unit can do as tiles, filtered by what it costs, greyed out when it can't be used now. A tile
 *    opens its text with clickable dice, and Use / Cast spends what it costs.
 * Built from the unit's sheet: for a party member that's their D&D Beyond sync, and re-syncing updates the bar.
 * The GM writes directly; the unit's player sends requests the GM's client applies (core/turns.ts), like the card.
 */
import "../extension/devlog";
import OBR, { type Item } from "@owlbear-rodeo/sdk";
import {
  actionBar, castableWith, currentEconomy, ECONOMY, ECONOMY_LABEL, inTab, ownTurnRound, recharging, slotsLeft, unavailable, usesLeft,
  useOnUnit, type ActionBar, type ActionItem, type Category, type Cost, type Economy, type SlotPool, type TurnEconomy, type UseChange,
} from "../core/actions";
import { cardAccess, combineModes, controls, editionText, portraitUrl, unitName } from "../core/card";
import { damageAfter, parseChips, rollLabel, type RollSegment, type Segment } from "../core/chips";
import { BUTLER_ITEM_KEY } from "../core/constants";
import { speedPenalty } from "../core/conditions";
import type { SceneItemLite } from "../core/importer";
import { movedFeet, readMovement, speedLimit } from "../core/movement";
import { partyFromDdbExport, type PartyRecord } from "../core/party";
import { rollDetail, type Role, type RollMessage, type RollVisibility } from "../core/rolls";
import type { RollMode } from "../core/schema";
import { maxHp, type SheetEntry, type UnitSheet, type UnitState } from "../core/sheet";
import { addConditionTo } from "../core/tracker";
import { trackerView } from "../core/tracker";
import { readUnit } from "../core/unit";
import { openCard } from "../extension/cardPopover";
import { DDB_ORIGIN, onDdbExport } from "../extension/ddbLink";
import { h, store, type Child } from "../extension/dom";
import { obrGateway } from "../extension/obrGateway";
import { sendRequest } from "../extension/requests";
import { initRoomSettings, onRoomSettings, roomSettings, roomSystem } from "../extension/roomSettings";
import { sendUnitRoll } from "../extension/unitRoll";

const app = document.getElementById("app")!;
const itemId = new URLSearchParams(location.search).get("id") ?? "";

type Tab = Category | "all";
const TABS: { tab: Tab; label: string; title: string }[] = [
  { tab: "all", label: "All", title: "Everything on this sheet" },
  { tab: "action", label: "● Action", title: "Costs your Action" },
  { tab: "bonus", label: "▲ Bonus", title: "Costs your Bonus Action" },
  { tab: "reaction", label: "◆ Reaction", title: "Costs your Reaction" },
  { tab: "legendary", label: "★ Legendary", title: "Legendary Actions" },
  { tab: "spell", label: "✦ Spells", title: "Spells and spell lists" },
  { tab: "feature", label: "❖ Features", title: "Features with limited uses or a recharge" },
  { tab: "common", label: "Common", title: "Actions anyone can take (Dash, Dodge, Help…)" },
];
const COST_GLYPH: Record<Cost, string> = { action: "●", bonus: "▲", reaction: "◆", legendary: "★", free: "○", longer: "⧗", none: "" };
const COST_LABEL: Record<Cost, string> = { action: "Action", bonus: "Bonus Action", reaction: "Reaction", legendary: "Legendary Action", free: "No action", longer: "Longer casting time", none: "" };

let item: Item | null = null;
let lite: SceneItemLite[] = [];
let sceneMeta: Record<string, unknown> = {};
let role: Role = "PLAYER";
let me = { id: "", name: "" };
let tab: Tab = (store.get("butler.actionsTab") as Tab | null) ?? "all";
let availableOnly = store.get("butler.actionsAvailable") === "1";
let selected: string | null = null;
let visibility: RollVisibility = store.get("butler.rollVisibility") === "private" ? "private" : "public";
let nextMode: RollMode = "normal";
let last: { msg: RollMessage; entry: string; damage: RollSegment[]; attackNatural?: number } | null = null;
let error = "";
let note = "";

const showErr = (e: unknown) => { error = e instanceof Error ? e.message : String(e); render(); };
const itemInfo = (i: Item) => ({ visible: i.visible, createdUserId: i.createdUserId, name: i.name, label: (i as any).text?.plainText || undefined, imageUrl: (i as any).image?.url });

/** The GM edits directly; the unit's player when the GM allows player edits (like the card). */
function canEdit(state: UnitState): boolean {
  if (role === "GM") return true;
  return roomSettings().playerEdits && !!item && controls({ id: me.id, role }, itemInfo(item), state);
}

async function change(c: UseChange) {
  try {
    if (role === "GM") await useOnUnit(obrGateway, itemId, c, roomSystem().rules);
    else await sendRequest({ type: "use", unitId: itemId, change: c });
    error = "";
  } catch (e) { showErr(e); }
}

// ------------------------------------------------------------------ rolling

async function roll(entry: SheetEntry, sheet: UnitSheet, state: UnitState, segs: Segment[], seg: RollSegment, ev: MouseEvent, opts: { crit?: boolean; followUp?: boolean } = {}) {
  if (!item) return;
  const clicked: RollMode = ev.shiftKey ? "advantage" : ev.ctrlKey || ev.metaKey ? "disadvantage" : nextMode;
  try {
    const msg = await sendUnitRoll({ id: item.id, info: itemInfo(item), sheet, state }, seg.formula, rollLabel(entry.name, seg), seg.kind,
      { by: { id: me.id, name: me.name, role }, visibility, mode: combineModes(clicked, undefined), crit: opts.crit });
    const damage = seg.kind === "attack" ? damageAfter(segs, seg) : opts.followUp && last ? last.damage : [];
    last = { msg, entry: entry.name, damage, attackNatural: seg.kind === "attack" ? msg.natural : opts.followUp ? last?.attackNatural : undefined };
    nextMode = "normal";
    error = "";
  } catch (e) { error = `Roll failed: ${e instanceof Error ? e.message : String(e)}`; }
  render();
}

/** Recharge X–6: roll a d6; on X or more the ability is back. */
async function rollRecharge(it: ActionItem, sheet: UnitSheet, state: UnitState) {
  if (!item || !it.recharge) return;
  try {
    const msg = await sendUnitRoll({ id: item.id, info: itemInfo(item), sheet, state }, "1d6", `${it.name}: recharge (${it.recharge}–6)`, "dice",
      { by: { id: me.id, name: me.name, role }, visibility, mode: "normal" });
    last = { msg, entry: it.name, damage: [] };
    if (msg.total >= it.recharge) { await change({ used: { [it.key]: 0 } }); note = `${it.name} recharged (${msg.total}).`; }
    else note = `${it.name} didn't recharge (${msg.total}).`;
  } catch (e) { showErr(e); }
  render();
}

// ------------------------------------------------------------------ using things

/** Use / Cast: spends the cost (and a slot of `slot`, or a use), adds Concentration for a concentration spell. */
async function use(it: ActionItem, bar: ActionBar, state: UnitState, eco: TurnEconomy, slot?: SlotPool) {
  const c: UseChange = {};
  if (it.cost === "action" || it.cost === "bonus" || it.cost === "reaction") c.economy = { [it.cost]: true };
  if (it.cost === "legendary") c.legendary = (eco.legendary ?? 0) + (it.legendaryCost ?? 1);
  const used: Record<string, number> = {};
  if (it.uses) used[it.key] = it.uses.max - usesLeft(it, state) + 1;
  else if (slot) used[slot.key] = slot.max - slotsLeft(slot, state) + 1;
  if (it.recharge) used[it.key] = 1;
  if (Object.keys(used).length) c.used = used;
  await change(c);
  // Dash: the movement tracker doubles this turn's movement.
  if (it.key === "common:Dash") {
    const m = readMovement(sceneMeta);
    if (m?.unitId === itemId && !m.dash) await sendRequest({ type: "dash", unitId: itemId, on: true }, role).catch(showErr);
  }
  if (it.concentration) {
    try {
      if (role === "GM") await addConditionTo(obrGateway, [itemId], "concentration", { note: it.name });
      else await sendRequest({ type: "condition-add", unitId: itemId, key: "concentration", note: it.name });
    } catch (e) { showErr(e); }
  }
  note = `${it.name}${slot ? ` (level ${slot.level} slot)` : ""}: ${[it.cost !== "none" && it.cost !== "free" && it.cost !== "longer" ? COST_LABEL[it.cost] : "", slot ? "slot" : "", it.uses ? "use" : ""].filter(Boolean).join(", ") || "used"}${it.concentration ? " · Concentrating" : ""}.`;
  render();
}

// ------------------------------------------------------------------ rendering

function head(sheet: UnitSheet, state: UnitState): Child {
  if (!item) return null;
  const v = trackerView(lite, sceneMeta);
  const img = portraitUrl(itemInfo(item), state);
  const mine = v.active === itemId;
  const status = !v.encounter.started ? "Not in combat" : mine ? `Round ${v.encounter.round} · your turn` : `Round ${v.encounter.round}`;
  return h("div", { className: `ab-head${mine ? " myturn" : ""}` },
    img ? h("img", { className: "thumb round small", src: img, alt: "" }) : h("div", { className: "thumb empty small" }, "?"),
    h("div", { className: "grow" },
      h("strong", {}, unitName(itemInfo(item), sheet, state)),
      h("span", { className: "small muted" }, ` · HP ${state.hp}/${maxHp(sheet, state)}${state.tempHp ? ` +${state.tempHp}` : ""} · AC ${sheet.ac}`),
      h("div", { className: `small ${mine ? "ok" : "muted"}` }, status)),
    h("button", { className: "secondary small", onclick: () => void openCard(itemId).catch(showErr) }, "Card"));
}

function economyRow(sheet: UnitSheet, state: UnitState, bar: ActionBar, eco: TurnEconomy, edit: boolean): Child {
  const pip = (k: Economy) => h("button", {
    className: `pip pip-${k}${eco[k] ? " used" : ""}`, disabled: !edit,
    title: `${ECONOMY_LABEL[k]}: ${eco[k] ? "used this turn (click to get it back)" : "available (click to mark used)"}`,
    onclick: () => void change({ economy: { [k]: !eco[k] } }),
  }, h("span", { className: "glyph" }, COST_GLYPH[k]), ECONOMY_LABEL[k]);
  const legendary = bar.legendary ? h("span", { className: "pips", title: "Legendary Actions this round" },
    h("span", { className: "small muted" }, "Legendary "),
    ...Array.from({ length: bar.legendary }, (_, i) => h("button", {
      className: `dotpip leg${i < bar.legendary - (eco.legendary ?? 0) ? " on" : ""}`, disabled: !edit,
      onclick: () => void change({ legendary: i < bar.legendary - (eco.legendary ?? 0) ? (eco.legendary ?? 0) + 1 : Math.max(0, (eco.legendary ?? 0) - 1) }),
    }, "★"))) : null;
  const m = readMovement(sceneMeta);
  const move = m && m.unitId === itemId ? (() => {
    const lim = speedLimit(sheet, { dash: m.dash, penalty: speedPenalty(roomSystem(), state) });
    const moved = movedFeet(m);
    return h("span", { className: `small ${moved > lim ? "bad" : "ok"}`, title: "Movement this turn (movement tracker)" }, `⇢ ${moved}/${lim} ft${m.dash ? " Dash" : ""}`);
  })() : h("span", { className: "small muted", title: "Speed" }, `⇢ ${sheet.speed.walk} ft`);
  return h("div", { className: "ab-economy" },
    ...ECONOMY.map(pip), legendary, move,
    edit ? h("button", { className: "icon tiny", title: "Start a fresh turn (Action, Bonus Action and Reaction back). Happens on its own when this unit's turn starts.", onclick: () => void change({ resetTurn: true }) }, "↺") : null);
}

function slotsRow(bar: ActionBar, state: UnitState, edit: boolean): Child {
  if (!bar.slots.length) return null;
  const sources = new Set(bar.slots.map((p) => p.source));
  return h("div", { className: "ab-slots" }, ...bar.slots.map((p) => {
    const left = slotsLeft(p, state);
    const used = p.max - left;
    return h("span", { className: "pips", title: `${p.pact ? "Pact Magic" : "Spell slots"} level ${p.level}${sources.size > 1 ? ` (${p.source})` : ""}: ${left} of ${p.max} left` },
      h("span", { className: "small" }, `${sources.size > 1 ? `${p.source.slice(0, 3)} ` : ""}${p.pact ? "P" : "L"}${p.level}`),
      ...Array.from({ length: p.max }, (_, i) => h("button", {
        className: `dotpip${i < left ? " on" : ""}${p.pact ? " pact" : ""}`, disabled: !edit,
        onclick: () => void change({ used: { [p.key]: i < left ? used + 1 : Math.max(0, used - 1) } }),
      })));
  }));
}

function tabsRow(bar: ActionBar): Child {
  const counts = (t: Tab) => bar.items.filter((it) => inTab(it, t)).length;
  return h("div", { className: "ab-tabs" },
    ...TABS.filter((t) => t.tab === "all" || t.tab === "common" || counts(t.tab)).map((t) => h("button", {
      className: `${tab === t.tab ? "on" : ""} tab-${t.tab}`, title: t.title,
      onclick: () => { tab = t.tab; store.set("butler.actionsTab", t.tab); render(); },
    }, t.label, t.tab !== "common" ? h("span", { className: "count" }, ` ${counts(t.tab)}`) : null)),
    h("label", { className: "small avail", title: "Hide what this turn's economy, uses or slots don't allow" },
      h("input", { type: "checkbox", checked: availableOnly, onchange: (e: Event) => { availableOnly = (e.target as HTMLInputElement).checked; store.set("butler.actionsAvailable", availableOnly ? "1" : "0"); render(); } }),
      "Available"));
}

function tile(it: ActionItem, bar: ActionBar, state: UnitState, eco: TurnEconomy): HTMLElement {
  const why = unavailable(it, bar, state, eco);
  const icon = it.category === "spell" ? "✦" : it.category === "common" ? "⬡" : it.category === "feature" ? "❖" : /\[1d20[+-]\d+\]/.test(it.text) ? "⚔" : "✧";
  const badge = it.uses ? `${usesLeft(it, state)}/${it.uses.max}` : it.recharge ? (recharging(it, state) ? `⟳${it.recharge}–6` : `${it.recharge}–6`) : it.spellLevel !== undefined ? (it.spellLevel ? `L${it.spellLevel}` : "C") : "";
  return h("button", {
    className: `tile cost-${it.cost}${why ? " off" : ""}${selected === it.key ? " sel" : ""}`,
    title: `${it.name}${it.cost !== "none" ? ` · ${COST_LABEL[it.cost]}` : ""}${it.costNote ? ` (${it.costNote})` : ""}${why ? ` · ${why}` : ""}`,
    onclick: () => { selected = selected === it.key ? null : it.key; render(); },
  },
  h("span", { className: "tcost" }, COST_GLYPH[it.cost]),
  badge ? h("span", { className: "tbadge" }, badge) : null,
  h("span", { className: "ticon" }, icon),
  h("span", { className: "tname" }, it.name),
  it.summary ? h("span", { className: "tsum" }, it.summary) : null,
  it.concentration ? h("span", { className: "tconc", title: "Concentration" }, "◎") : null);
}

function detail(it: ActionItem, bar: ActionBar, sheet: UnitSheet, state: UnitState, eco: TurnEconomy, edit: boolean): Child {
  const entry: SheetEntry = { name: it.name, text: it.text };
  const segs = parseChips(editionText(it.text, roomSystem().rules));
  const body: Child[] = [];
  for (const s of segs) {
    if (s.t === "text") s.text.split("\n").forEach((line, i) => { if (i) body.push(h("br")); body.push(line); });
    else body.push(h("button", { className: `chip chip-${s.kind}`, title: `${s.formula} · Shift: advantage · Ctrl: disadvantage`, onclick: (ev: MouseEvent) => void roll(entry, sheet, state, segs, s, ev) }, s.display));
  }
  const why = unavailable(it, bar, state, eco);
  const actions: Child[] = [];
  const leveled = it.spellLevel !== undefined && it.spellLevel > 0 && !it.uses && bar.slots.length > 0;
  if (edit && leveled) {
    const pools = castableWith(it.spellLevel!, bar.slots, state);
    actions.push(...(pools.length ? pools.map((p) => h("button", { disabled: !!why && why !== "No spell slots left", onclick: () => void use(it, bar, state, eco, p) },
      `Cast · ${p.pact ? "Pact " : ""}L${p.level} (${slotsLeft(p, state)})`)) : [h("span", { className: "small warn" }, "No slots of this level or higher left.")]));
  } else if (edit && it.cost !== "none" || edit && (it.uses || it.recharge)) {
    actions.push(h("button", { disabled: !!why, onclick: () => void use(it, bar, state, eco) },
      `${it.category === "spell" ? "Cast" : "Use"}${it.cost !== "none" && it.cost !== "free" && it.cost !== "longer" ? ` · ${COST_LABEL[it.cost]}` : ""}${it.uses ? " · 1 use" : ""}`));
  }
  if (edit && it.uses) {
    const used = it.uses.max - usesLeft(it, state);
    actions.push(h("span", { className: "small" }, `Uses ${usesLeft(it, state)}/${it.uses.max} (${it.uses.label})`),
      h("button", { className: "icon tiny", title: "Get a use back", disabled: used <= 0, onclick: () => void change({ used: { [it.key]: used - 1 } }) }, "+"));
  }
  if (edit && it.recharge && recharging(it, state)) actions.push(h("button", { className: "secondary", onclick: () => void rollRecharge(it, sheet, state) }, `Roll recharge (${it.recharge}–6)`));
  return h("div", { className: "panel ab-detail" },
    h("div", { className: "row between" },
      h("span", {}, h("strong", {}, it.name),
        it.cost !== "none" ? h("span", { className: `small cost-text cost-${it.cost}` }, ` ${COST_GLYPH[it.cost]} ${COST_LABEL[it.cost]}`) : null,
        it.costNote ? h("span", { className: "small muted" }, ` · ${it.costNote}`) : null,
        it.ritual ? h("span", { className: "small muted" }, " · Ritual") : null,
        it.concentration ? h("span", { className: "small muted" }, " · Concentration") : null),
      h("button", { className: "icon tiny", title: "Close", onclick: () => { selected = null; render(); } }, "✕")),
    h("p", { className: "entry-text small" }, ...body),
    why ? h("div", { className: "small warn" }, why) : null,
    actions.length ? h("div", { className: "row" }, ...actions) : null);
}

function lastRollPanel(sheet: UnitSheet, state: UnitState): Child {
  if (!last) return null;
  const m = last.msg;
  const entry: SheetEntry = { name: last.entry, text: "" };
  return h("div", { className: `panel lastroll${m.natural === 20 ? " nat20" : m.natural === 1 ? " nat1" : ""}` },
    h("div", { className: "row between" },
      h("span", {}, h("strong", {}, m.label), " ", h("span", { className: "total" }, String(m.total)), " ",
        m.natural === 20 ? h("span", { className: "badge" }, "NATURAL 20") : m.natural === 1 ? h("span", { className: "badge bad-bg" }, "natural 1") : null,
        h("span", { className: "small muted" }, ` ${rollDetail(m)}`)),
      h("button", { className: "icon tiny", onclick: () => { last = null; render(); } }, "✕")),
    last.damage.length ? h("div", { className: "row", style: "margin-top:4px" }, ...last.damage.flatMap((d) => [
      h("button", { className: "small", onclick: (ev: MouseEvent) => void roll(entry, sheet, state, [], d, ev, { followUp: true }) }, `Damage ${d.display}${d.damageType ? ` ${d.damageType}` : ""}`),
      h("button", { className: `small${last!.attackNatural === 20 ? "" : " secondary"}`, title: "Critical hit: damage dice doubled", onclick: (ev: MouseEvent) => void roll(entry, sheet, state, [], d, ev, { crit: true, followUp: true }) }, "Crit"),
    ])) : null);
}

function footer(sheet: UnitSheet, state: UnitState, edit: boolean): Child {
  const record = item?.metadata[BUTLER_ITEM_KEY] as PartyRecord | undefined;
  const fromDdb = !!record?.ddbId;
  const modeBtn = (m: RollMode, label: string) => h("button", { className: nextMode === m ? "on" : "", onclick: () => { nextMode = m; render(); } }, label);
  const vis = (v: RollVisibility, label: string) => h("button", { className: visibility === v ? "on" : "", onclick: () => { visibility = v; store.set("butler.rollVisibility", v); render(); } }, label);
  return h("div", { className: "ab-footer" },
    h("div", { className: "seg small" }, modeBtn("normal", "Normal"), modeBtn("advantage", "Adv"), modeBtn("disadvantage", "Dis")),
    h("div", { className: "seg small" }, vis("public", "Public"), vis("private", "Private")),
    edit ? h("div", { className: "seg small" },
      h("button", { title: "Short Rest: Short Rest uses and Pact Magic slots come back", onclick: () => void change({ rest: "short" }) }, "Short rest"),
      h("button", { title: "Long Rest: every use and spell slot comes back", onclick: () => void change({ rest: "long" }) }, "Long rest")) : null,
    fromDdb ? h("span", { className: "small muted grow", style: "text-align:right" },
      `D&D Beyond · ${record!.syncedAt ? new Date(record!.syncedAt).toLocaleDateString() : "synced"}`,
      role === "PLAYER" && edit && sheet.kind === "character" ? h("button", { className: "icon tiny", title: "Re-sync from your D&D Beyond sheet (needs the bookmark set up in the Encounter Butler panel)", onclick: () => startDdbSync(record!.ddbId) }, "⟳") : null) : null);
}

// ------------------------------------------------------------------ D&D Beyond re-sync (players)

let syncing = false;
function startDdbSync(ddbId: number) {
  syncing = true;
  const w = window.open(`${DDB_ORIGIN}/characters/${ddbId}`, "_blank");
  note = w ? "On your D&D Beyond character page, click the “Copy party for Encounter Butler” bookmark." : "Your browser blocked the D&D Beyond tab. Allow pop-ups for Owlbear and try again.";
  render();
}
onDdbExport(async (bundle) => {
  if (!syncing) return;
  syncing = false;
  try {
    const [member] = partyFromDdbExport(bundle).members;
    if (!member) throw new Error("No character in what D&D Beyond sent.");
    await sendRequest({ type: "sheet-sync", unitId: itemId, member, hp: store.get("butler.selfSyncHp") === "ddb" ? "ddb" : "keep" });
    note = `${member.name} sent to the GM: your actions update in a moment.`;
  } catch (e) { note = `D&D Beyond sync failed: ${e instanceof Error ? e.message : String(e)}`; }
  render();
});

// ------------------------------------------------------------------ page

let renderPending = false;
document.addEventListener("focusout", () => { if (renderPending) { renderPending = false; setTimeout(render, 0); } });

function render() {
  const focused = document.activeElement as HTMLElement | null;
  if (focused && /^(INPUT|SELECT|TEXTAREA)$/.test(focused.tagName) && (focused as HTMLInputElement).type !== "checkbox") { renderPending = true; return; }
  const scroll = document.querySelector(".ab-grid")?.scrollTop ?? 0;
  const nodes: Child[] = [];
  const u = item ? readUnit(item.metadata) : null;
  if (!item || !u) nodes.push(h("div", { className: "panel warn" }, item ? "This token isn't an Encounter Butler unit." : "This token is no longer in the scene."));
  else if (cardAccess({ id: me.id, role }, itemInfo(item), u.state) !== "full") nodes.push(h("div", { className: "panel warn" }, "These actions belong to the GM or another player."));
  else {
    const { sheet, state } = u;
    const bar = actionBar(sheet, roomSystem().rules);
    const v = trackerView(lite, sceneMeta);
    const eco = currentEconomy(state, ownTurnRound(v.encounter, v.order, itemId));
    const edit = canEdit(state);
    const shown = bar.items.filter((it) => inTab(it, tab) && (!availableOnly || !unavailable(it, bar, state, eco)));
    const sel = bar.items.find((it) => it.key === selected);
    nodes.push(
      head(sheet, state),
      economyRow(sheet, state, bar, eco, edit),
      slotsRow(bar, state, edit),
      tabsRow(bar),
      h("div", { className: "ab-grid" }, ...(shown.length ? shown.map((it) => tile(it, bar, state, eco)) : [h("div", { className: "small muted" }, availableOnly ? "Nothing available right now." : "Nothing here.")])),
      sel ? detail(sel, bar, sheet, state, eco, edit) : null,
      !edit && role === "PLAYER" ? h("div", { className: "small muted" }, "Player edits are off: you can look and roll, but the GM tracks what you spend.") : null,
      note ? h("div", { className: "panel small row between" }, note, h("button", { className: "icon tiny", onclick: () => { note = ""; render(); } }, "OK")) : null,
      error ? h("div", { className: "panel bad small" }, error) : null,
      lastRollPanel(sheet, state),
      footer(sheet, state, edit));
  }
  app.replaceChildren(...nodes.filter((n): n is Node | string => !!n));
  const grid = document.querySelector(".ab-grid");
  if (grid) grid.scrollTop = scroll;
}

OBR.onReady(async () => {
  const [r, name] = await Promise.all([OBR.player.getRole(), OBR.player.getName()]);
  role = r;
  me = { id: OBR.player.id, name };
  await initRoomSettings();
  onRoomSettings(() => render());
  [[item = null], lite, sceneMeta] = await Promise.all([OBR.scene.items.getItems([itemId]), obrGateway.getItems(), OBR.scene.getMetadata()]);
  render();
  OBR.scene.items.onChange(async (items) => { item = items.find((i) => i.id === itemId) ?? null; lite = await obrGateway.getItems(); render(); });
  OBR.scene.onMetadataChange((m) => { sceneMeta = m; render(); });
});
