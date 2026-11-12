/**
 * Action bar popover (actions.html?id=<itemId>): a BG3-style hotbar for one unit, to consult.
 *  - Everything the unit can do as tiles, sorted by what it costs: ● Action, ▲ Bonus Action, ◆ Reaction, ★ Legendary,
 *    plus spells, limited features and every combat option the PHB (and the DMG's optional rules) give anyone.
 *  - A tile opens "how it works" in plain words and the sheet's text.
 * Read-only: nothing is spent or counted here (Butler only tracks HP); rolls are made from the unit card.
 * Built from the unit's sheet: for a party member that's their D&D Beyond sync, so re-syncing updates it.
 */
import "../extension/devlog";
import OBR, { type Item } from "@owlbear-rodeo/sdk";
import { actionBar, COST_EXPLAINED, explain, inTab, type ActionBar, type ActionItem, type Category, type Cost } from "../core/actions";
import { OPTION_GROUPS } from "../core/combatOptions";
import { cardAccess, controls, editionText, portraitUrl, unitName } from "../core/card";
import { parseChips } from "../core/chips";
import { BUTLER_ITEM_KEY } from "../core/constants";
import { partyFromDdbExport, type PartyRecord } from "../core/party";
import type { UnitSheet, UnitState } from "../core/sheet";
import { readUnit } from "../core/unit";
import { currentEconomy, currentReadied, ECONOMY_GLYPH, ECONOMY_LABEL, ownTurnRound, setEconomy, type Economy, type EconomyChange } from "../core/economy";
import type { SceneItemLite } from "../core/importer";
import { trackerView } from "../core/tracker";
import { obrGateway } from "../extension/obrGateway";
import { openCard } from "../extension/cardPopover";
import { DDB_ORIGIN, onDdbExport } from "../extension/ddbLink";
import { h, store, type Child } from "../extension/dom";
import { sendRequest } from "../extension/requests";
import { initRoomSettings, onRoomSettings, roomSettings, roomSystem } from "../extension/roomSettings";

const app = document.getElementById("app")!;
const itemId = new URLSearchParams(location.search).get("id") ?? "";

type Tab = Category | "all";
const TABS: { tab: Tab; label: string; title: string }[] = [
  { tab: "all", label: "All", title: "Everything on this sheet" },
  { tab: "action", label: "● Action", title: COST_EXPLAINED.action },
  { tab: "bonus", label: "▲ Bonus", title: COST_EXPLAINED.bonus },
  { tab: "reaction", label: "◆ Reaction", title: COST_EXPLAINED.reaction },
  { tab: "legendary", label: "★ Legendary", title: COST_EXPLAINED.legendary },
  { tab: "spell", label: "✦ Spells", title: "Spells and spell lists" },
  { tab: "feature", label: "❖ Features", title: "Features with a limit or a recharge" },
  { tab: "common", label: "⚔ Combat", title: "What anyone can do in combat by the rules: actions, Unarmed Strike, Grapple, Shove, movement, and the DMG's optional options" },
];
const COST_GLYPH: Record<Cost, string> = { action: "●", bonus: "▲", reaction: "◆", legendary: "★", free: "○", longer: "⧗", move: "⇢", attack: "⚔", none: "" };
const COST_LABEL: Record<Cost, string> = { action: "Action", bonus: "Bonus Action", reaction: "Reaction", legendary: "Legendary Action", free: "Free", longer: "Longer casting time", move: "Movement", attack: "One attack", none: "" };

let item: Item | null = null;
let role: "GM" | "PLAYER" = "PLAYER";
let meId = "";
let tab: Tab = (store.get("butler.actionsTab") as Tab | null) ?? "all";
let selected: string | null = null;
let note = "";
let lite: SceneItemLite[] = [];
let sceneMeta: Record<string, unknown> = {};

const itemInfo = (i: Item) => ({ visible: i.visible, createdUserId: i.createdUserId, name: i.name, label: (i as any).text?.plainText || undefined, imageUrl: (i as any).image?.url });

// ------------------------------------------------------------------ rendering

function head(sheet: UnitSheet, state: UnitState): Child {
  if (!item) return null;
  const img = portraitUrl(itemInfo(item), state);
  return h("div", { className: "ab-head" },
    img ? h("img", { className: "thumb round small", src: img, alt: "" }) : h("div", { className: "thumb empty small" }, "?"),
    h("div", { className: "grow" },
      h("strong", {}, unitName(itemInfo(item), sheet, state)),
      h("div", { className: "small muted" }, "Each turn: move up to your Speed, take one ● Action, and one ▲ Bonus Action if something gives you one. ◆ One Reaction per round.")),
    h("button", { className: "secondary small", title: "Roll from the unit card", onclick: () => void openCard(itemId) }, "Card"));
}

function tabsRow(bar: ActionBar): Child {
  const counts = (t: Tab) => bar.items.filter((it) => inTab(it, t)).length;
  return h("div", { className: "ab-tabs" },
    ...TABS.filter((t) => t.tab === "all" || t.tab === "common" || counts(t.tab)).map((t) => h("button", {
      className: `${tab === t.tab ? "on" : ""} tab-${t.tab}`, title: t.title,
      onclick: () => { tab = t.tab; store.set("butler.actionsTab", t.tab); render(); },
    }, t.label, t.tab !== "common" ? h("span", { className: "count" }, ` ${counts(t.tab)}`) : null)));
}

function tile(it: ActionItem): HTMLElement {
  const icon = it.category === "spell" ? "✦" : it.category === "common" ? (it.source === "DMG" ? "◇" : "⬡") : it.category === "feature" ? "❖" : /\[1d20[+-]\d+\]/.test(it.text) ? "⚔" : "✧";
  const badge = it.source === "DMG" ? "DMG" : it.limit ? it.limit.label : it.recharge ? `${it.recharge}–6` : it.spellLevel !== undefined ? (it.spellLevel ? `L${it.spellLevel}` : "C") : "";
  return h("button", {
    className: `tile cost-${it.cost}${selected === it.key ? " sel" : ""}`,
    title: `${it.name}${it.cost !== "none" ? ` · ${COST_LABEL[it.cost]}` : ""}${it.costNote ? ` (${it.costNote})` : ""}`,
    onclick: () => { selected = selected === it.key ? null : it.key; menu = null; render(); },
    oncontextmenu: (e: MouseEvent) => { e.preventDefault(); menu = { key: it.key, x: e.clientX, y: e.clientY }; render(); },
  },
  h("span", { className: "tcost" }, COST_GLYPH[it.cost]),
  badge ? h("span", { className: "tbadge" }, badge) : null,
  h("span", { className: "ticon" }, icon),
  h("span", { className: "tname" }, it.name),
  it.summary ? h("span", { className: "tsum" }, it.summary) : null,
  it.concentration ? h("span", { className: "tconc", title: "Concentration" }, "◎") : null);
}

/** The sheet's text, dice shown as plain values (rolls are made from the card). */
function sheetText(text: string): Child[] {
  const out: Child[] = [];
  for (const s of parseChips(editionText(text, roomSystem().rules))) {
    if (s.t === "text") s.text.split("\n").forEach((line, i) => { if (i) out.push(h("br")); out.push(line); });
    else out.push(h("span", { className: `dice dice-${s.kind}` }, s.display));
  }
  return out;
}

/** In combat, on an option that costs an Action / Bonus Action / Reaction: mark it spent on the combat HUD. */
// ------------------------------------------------------------------ Ready (hold an option until a trigger)

/** Right-click menu on a tile. */
let menu: { key: string; x: number; y: number } | null = null;
/** The tile whose Ready form is open. */
let readyFor: string | null = null;
document.addEventListener("click", (e) => { if (menu && !(e.target as HTMLElement).closest(".ab-menu")) { menu = null; render(); } });

const sendEconomy = (change: EconomyChange) => role === "GM" ? setEconomy(obrGateway, itemId, change) : sendRequest({ type: "economy", unitId: itemId, change });

/** Can this option be readied now? Ready takes the Action on your own turn; the option fires later with the Reaction. */
function readyCheck(it: ActionItem, state: UnitState): { ok: boolean; why?: string; cost?: "action" | "bonus" } {
  const cost = it.cost === "action" || it.cost === "attack" ? "action" : it.cost === "bonus" ? "bonus" : null;
  if (!cost) return { ok: false, why: "Only an Action (or, with your GM's OK, a Bonus Action) can be readied." };
  if (!item || (role !== "GM" && !controls({ id: meId, role }, itemInfo(item), state))) return { ok: false, why: "Not your unit." };
  const v = trackerView(lite, sceneMeta);
  if (!v.encounter.started || !v.order.some((u) => u.id === itemId)) return { ok: false, why: "Ready is for combat." };
  if (v.active !== itemId) return { ok: false, why: "You ready on your own turn.", cost };
  if (currentEconomy(state, ownTurnRound(v.encounter, v.order, itemId)).action) return { ok: false, why: "Your Action is already used: readying takes it.", cost };
  return { ok: true, cost };
}

function contextMenu(bar: ActionBar, state: UnitState): Child {
  const it = menu && bar.items.find((x) => x.key === menu!.key);
  if (!menu || !it) return null;
  const chk = readyCheck(it, state);
  const left = Math.min(menu.x, window.innerWidth - 230), top = Math.min(menu.y, window.innerHeight - 90);
  return h("div", { className: "ab-menu", style: `left:${left}px;top:${top}px` },
    h("div", { className: "small muted" }, it.name),
    h("button", { disabled: !chk.ok, title: chk.why ?? "Hold it until a trigger: uses your Action now and your Reaction when it happens",
      onclick: () => { selected = it.key; readyFor = it.key; menu = null; render(); setTimeout(() => (document.querySelector(".ab-ready input") as HTMLInputElement | null)?.focus(), 0); } },
      "⏳ Ready this…"),
    !chk.ok && chk.why ? h("div", { className: "small muted" }, chk.why) : null,
    h("button", { className: "secondary", onclick: () => { selected = it.key; menu = null; render(); } }, "How it works"));
}

function readyForm(it: ActionItem, state: UnitState): Child {
  const chk = readyCheck(it, state);
  // Ready is only offered from the tile's right-click menu; the form opens here once chosen.
  if (readyFor !== it.key) return null;
  const trigger = h("input", { type: "text", maxLength: 160, placeholder: "Trigger, e.g. \"when the orc comes around the corner\"" }) as HTMLInputElement;
  const go = () => {
    const t = trigger.value.trim();
    trigger.blur();
    readyFor = null;
    void sendEconomy({ ready: { name: it.name, cost: chk.cost!, ...(t ? { trigger: t } : {}) } })
      .then(() => { note = `${it.name} readied: ● Action used. When the trigger happens, take it with your ◆ Reaction from the HUD.`; render(); })
      .catch((e) => { note = String(e); render(); });
  };
  trigger.onkeydown = (e: KeyboardEvent) => { if (e.key === "Enter") go(); if (e.key === "Escape") { readyFor = null; trigger.blur(); render(); } };
  return h("div", { className: "ab-ready stack tight" },
    h("strong", { className: "small" }, `⏳ Ready ${it.name}`),
    trigger,
    h("div", { className: "small muted" },
      "Uses your ● Action now. When the trigger happens, you take it with your ◆ Reaction (or let it go). It's lost if you don't use it before your next turn.",
      it.category === "spell" ? " A readied spell is cast now and held with Concentration until you release it." : "",
      chk.cost === "bonus" ? " By the rules only an Action can be readied: ask your GM." : ""),
    h("div", { className: "row" },
      h("button", { className: "small econ-action", disabled: !chk.ok, title: chk.why ?? "", onclick: go }, "Ready it"),
      h("button", { className: "secondary small", onclick: () => { readyFor = null; render(); } }, "Cancel")));
}

/** What's readied right now, shown at the top of the bar. */
function readiedLine(state: UnitState): Child {
  const v = trackerView(lite, sceneMeta);
  const r = currentReadied(state, ownTurnRound(v.encounter, v.order, itemId));
  if (!r) return null;
  return h("div", { className: "hudready small" }, h("span", { className: "grow" }, "⏳ Readied: ", h("strong", {}, r.name), r.trigger ? h("span", { className: "muted" }, ` · ${r.trigger}`) : null),
    h("span", { className: "muted" }, "Trigger it from the HUD"));
}

function economyButton(it: ActionItem, state: UnitState): Child {
  const k: Economy | null = it.cost === "action" || it.cost === "attack" ? "action" : it.cost === "bonus" ? "bonus" : it.cost === "reaction" ? "reaction" : null;
  if (!k || !item) return null;
  const v = trackerView(lite, sceneMeta);
  if (!v.encounter.started || !v.order.some((u) => u.id === itemId)) return null;
  if (role !== "GM" && !controls({ id: meId, role }, itemInfo(item), state)) return null;
  // Action and Bonus Action belong to the unit's own turn; a Reaction can be used any time.
  if (k !== "reaction" && v.active !== itemId) return h("div", { className: "small muted" }, `${ECONOMY_GLYPH[k]} ${ECONOMY_LABEL[k]}: on your turn.`);
  const spent = !!currentEconomy(state, ownTurnRound(v.encounter, v.order, itemId))[k];
  const set = (on: boolean) => void (role === "GM" ? setEconomy(obrGateway, itemId, { [k]: on }) : sendRequest({ type: "economy", unitId: itemId, change: { [k]: on } }))
    .then(() => { note = on ? `${it.name}: ${ECONOMY_LABEL[k]} marked as used.` : `${ECONOMY_LABEL[k]} available again.`; render(); })
    .catch((e) => { note = String(e); render(); });
  return spent
    ? h("div", { className: "row" }, h("span", { className: "small muted" }, `${ECONOMY_GLYPH[k]} ${ECONOMY_LABEL[k]} already used`), h("button", { className: "secondary small", onclick: () => set(false) }, "Get it back"))
    : h("div", { className: "row" }, h("button", { className: `small econ-${k}`, title: "Marks it on your combat HUD", onclick: () => set(true) }, `Use it · mark ${ECONOMY_GLYPH[k]} ${ECONOMY_LABEL[k]} used`));
}

function detail(it: ActionItem, bar: ActionBar, state: UnitState): Child {
  const how = explain(it, bar.legendary);
  return h("div", { className: "panel ab-detail" },
    h("div", { className: "row between" },
      h("span", {}, h("strong", {}, it.name),
        it.cost !== "none" ? h("span", { className: `small cost-text cost-${it.cost}` }, ` ${COST_GLYPH[it.cost]} ${COST_LABEL[it.cost]}`) : null),
      h("button", { className: "icon tiny", title: "Close", onclick: () => { selected = null; render(); } }, "✕")),
    how.length ? h("div", { className: "ab-how" }, h("div", { className: "small muted" }, "How it works"),
      h("ul", { className: "small" }, ...how.map((line) => h("li", {}, line)))) : null,
    it.category !== "common" ? h("details", { className: "small", open: !how.length },
      h("summary", {}, "From the sheet"), h("p", { className: "entry-text" }, ...sheetText(it.text))) : null,
    h("div", { className: "row" }, economyButton(it, state), readyForm(it, state)));
}

function footer(sheet: UnitSheet, state: UnitState): Child {
  const record = item?.metadata[BUTLER_ITEM_KEY] as PartyRecord | undefined;
  const mine = !!item && role === "PLAYER" && controls({ id: meId, role }, itemInfo(item), state);
  return h("div", { className: "ab-footer small muted" },
    h("span", { className: "grow" }, "Right-click an action to Ready it. To roll, open the unit card."),
    record?.ddbId ? h("span", {},
      `From D&D Beyond · synced ${record.syncedAt ? new Date(record.syncedAt).toLocaleDateString() : ""}`,
      mine && sheet.kind === "character" && roomSettings().playerEdits
        ? h("button", { className: "icon tiny", title: "Re-sync from your D&D Beyond sheet (needs the bookmark set up in the Encounter Butler panel)", onclick: () => startDdbSync(record.ddbId) }, "⟳") : null) : null);
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
    note = `${member.name} sent to the GM: this list updates in a moment.`;
  } catch (e) { note = `D&D Beyond sync failed: ${e instanceof Error ? e.message : String(e)}`; }
  render();
});

// ------------------------------------------------------------------ page

let renderPending = false;
document.addEventListener("focusout", () => { if (renderPending) { renderPending = false; setTimeout(render, 0); } });

function render() {
  const focused = document.activeElement as HTMLElement | null;
  if (focused && focused.tagName === "INPUT" && (focused as HTMLInputElement).type === "text") { renderPending = true; return; }
  const scroll = document.querySelector(".ab-grid")?.scrollTop ?? 0;
  const nodes: Child[] = [];
  const u = item ? readUnit(item.metadata) : null;
  if (!item || !u) nodes.push(h("div", { className: "panel warn" }, item ? "This token isn't an Encounter Butler unit." : "This token is no longer in the scene."));
  else if (cardAccess({ id: meId, role }, itemInfo(item), u.state) !== "full") nodes.push(h("div", { className: "panel warn" }, "These actions belong to the GM or another player."));
  else {
    const { sheet, state } = u;
    const bar = actionBar(sheet, roomSystem().rules, roomSettings().dmgOptions);
    const shown = bar.items.filter((it) => inTab(it, tab));
    const sel = bar.items.find((it) => it.key === selected);
    const tabInfo = tab === "action" || tab === "bonus" || tab === "reaction" || tab === "legendary" ? COST_EXPLAINED[tab] : "";
    nodes.push(
      head(sheet, state),
      readiedLine(state),
      tabsRow(bar),
      tabInfo ? h("div", { className: `small cost-text cost-${tab}` }, tabInfo) : null,
      h("div", { className: "ab-grid" }, ...(!shown.length ? [h("div", { className: "small muted" }, "Nothing here.")]
        : tab === "common" ? OPTION_GROUPS.flatMap((g) => {
          const inGroup = shown.filter((it) => it.group === g);
          return inGroup.length ? [h("div", { className: "ab-group" }, g === "DMG optional rules" ? "DMG optional rules (used in this room)" : g), ...inGroup.map(tile)] : [];
        })
          : shown.map(tile))),
      sel ? detail(sel, bar, state) : h("div", { className: "small muted" }, "Click an option to see how it works."),
      note ? h("div", { className: "panel small row between" }, note, h("button", { className: "icon tiny", onclick: () => { note = ""; render(); } }, "OK")) : null,
      footer(sheet, state),
      contextMenu(bar, state));
  }
  app.replaceChildren(...nodes.filter((n): n is Node | string => !!n));
  const grid = document.querySelector(".ab-grid");
  if (grid) grid.scrollTop = scroll;
}

OBR.onReady(async () => {
  role = await OBR.player.getRole();
  meId = OBR.player.id;
  await initRoomSettings();
  onRoomSettings(() => render());
  [[item = null], lite, sceneMeta] = await Promise.all([OBR.scene.items.getItems([itemId]), obrGateway.getItems(), OBR.scene.getMetadata()]);
  render();
  OBR.scene.items.onChange(async (items) => { item = items.find((i) => i.id === itemId) ?? null; lite = await obrGateway.getItems(); render(); });
  OBR.scene.onMetadataChange((m) => { sceneMeta = m; render(); });
});
