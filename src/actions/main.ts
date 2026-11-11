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
    onclick: () => { selected = selected === it.key ? null : it.key; render(); },
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

function detail(it: ActionItem, bar: ActionBar): Child {
  const how = explain(it, bar.legendary);
  return h("div", { className: "panel ab-detail" },
    h("div", { className: "row between" },
      h("span", {}, h("strong", {}, it.name),
        it.cost !== "none" ? h("span", { className: `small cost-text cost-${it.cost}` }, ` ${COST_GLYPH[it.cost]} ${COST_LABEL[it.cost]}`) : null),
      h("button", { className: "icon tiny", title: "Close", onclick: () => { selected = null; render(); } }, "✕")),
    how.length ? h("div", { className: "ab-how" }, h("div", { className: "small muted" }, "How it works"),
      h("ul", { className: "small" }, ...how.map((line) => h("li", {}, line)))) : null,
    it.category !== "common" ? h("details", { className: "small", open: !how.length },
      h("summary", {}, "From the sheet"), h("p", { className: "entry-text" }, ...sheetText(it.text))) : null);
}

function footer(sheet: UnitSheet, state: UnitState): Child {
  const record = item?.metadata[BUTLER_ITEM_KEY] as PartyRecord | undefined;
  const mine = !!item && role === "PLAYER" && controls({ id: meId, role }, itemInfo(item), state);
  return h("div", { className: "ab-footer small muted" },
    h("span", { className: "grow" }, "To roll, open the unit card."),
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

function render() {
  const scroll = document.querySelector(".ab-grid")?.scrollTop ?? 0;
  const nodes: Child[] = [];
  const u = item ? readUnit(item.metadata) : null;
  if (!item || !u) nodes.push(h("div", { className: "panel warn" }, item ? "This token isn't an Encounter Butler unit." : "This token is no longer in the scene."));
  else if (cardAccess({ id: meId, role }, itemInfo(item), u.state) !== "full") nodes.push(h("div", { className: "panel warn" }, "These actions belong to the GM or another player."));
  else {
    const { sheet, state } = u;
    const bar = actionBar(sheet, roomSystem().rules);
    const shown = bar.items.filter((it) => inTab(it, tab));
    const sel = bar.items.find((it) => it.key === selected);
    const tabInfo = tab === "action" || tab === "bonus" || tab === "reaction" || tab === "legendary" ? COST_EXPLAINED[tab] : "";
    nodes.push(
      head(sheet, state),
      tabsRow(bar),
      tabInfo ? h("div", { className: `small cost-text cost-${tab}` }, tabInfo) : null,
      h("div", { className: "ab-grid" }, ...(!shown.length ? [h("div", { className: "small muted" }, "Nothing here.")]
        : tab === "common" ? OPTION_GROUPS.flatMap((g) => {
          const inGroup = shown.filter((it) => it.group === g);
          return inGroup.length ? [h("div", { className: "ab-group" }, g === "DMG optional rules" ? "DMG optional rules (ask your GM)" : g), ...inGroup.map(tile)] : [];
        })
          : shown.map(tile))),
      sel ? detail(sel, bar) : h("div", { className: "small muted" }, "Click an option to see how it works."),
      note ? h("div", { className: "panel small row between" }, note, h("button", { className: "icon tiny", onclick: () => { note = ""; render(); } }, "OK")) : null,
      footer(sheet, state));
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
  [item = null] = await OBR.scene.items.getItems([itemId]);
  render();
  OBR.scene.items.onChange((items) => { item = items.find((i) => i.id === itemId) ?? null; render(); });
});
