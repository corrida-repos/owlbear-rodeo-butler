/**
 * Action bar popover (actions.html?id=<itemId>): a BG3-style hotbar for one unit, to consult.
 *  - Everything the unit can do as tiles, in one list sorted by what it costs: ● Action, ▲ Bonus Action, ◆ Reaction,
 *    ★ Legendary, spells, limited features, movement. The sheet's entries sit with the options anyone has (PHB, the
 *    DMG's optional ones unless the GM turns them off, and the room's homebrew, which the GM adds right here).
 *  - Hovering (or clicking) Attack reveals every way to attack: the sheet's weapons, Unarmed Strike, Grapple, Shove…
 *    Hovering Magic (Cast a Spell in 5E) reveals the sheet's spells cast with an action and its Magic actions.
 *    A creature's Multiattack is the first Action.
 *  - A tile opens "how it works" in plain words and the sheet's text.
 * Read-only: nothing is spent or counted here (Butler only tracks HP); rolls are made from the unit card.
 * Built from the unit's sheet: for a party member that's their D&D Beyond sync, so re-syncing updates it.
 */
import "../extension/devlog";
import { commonActionIcon } from "./icons";
import OBR, { type Item } from "@owlbear-rodeo/sdk";
import { actionBar, ATTACK_KEY, barLayout, HELP_KEY, MAGIC_KEYS, TWF_KEY, COST_EXPLAINED, explain, filterCount, type ActionBar, type ActionItem, type BarFilter, type Cost } from "../core/actions";
import { HOMEBREW_COSTS, HOMEBREW_LIMITS, type HomebrewCost } from "../core/homebrew";
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
import { deleteHomebrew, homebrewActions, initHomebrew, onHomebrew, saveHomebrew } from "../extension/homebrewStore";
import { initRoomSettings, onRoomSettings, roomSettings, roomSystem } from "../extension/roomSettings";

const app = document.getElementById("app")!;
const itemId = new URLSearchParams(location.search).get("id") ?? "";

type Tab = BarFilter;
const TABS: { tab: Tab; label: string; title: string }[] = [
  { tab: "all", label: "All", title: "Everything this unit can do: its sheet and what anyone can do by the rules" },
  { tab: "action", label: "● Action", title: COST_EXPLAINED.action },
  { tab: "bonus", label: "▲ Bonus", title: COST_EXPLAINED.bonus },
  { tab: "reaction", label: "◆ Reaction", title: COST_EXPLAINED.reaction },
  { tab: "legendary", label: "★ Legendary", title: COST_EXPLAINED.legendary },
  { tab: "spell", label: "✦ Spells", title: "Spells and spell lists" },
  { tab: "feature", label: "❖ Features", title: "Features with a limit or a recharge" },
  { tab: "move", label: "⇢ Move & other", title: "Movement, and what takes no action" },
];
const TAB_IDS = new Set(TABS.map((t) => t.tab));
const COST_GLYPH: Record<Cost, string> = { action: "●", bonus: "▲", reaction: "◆", legendary: "★", free: "○", longer: "⧗", move: "⇢", attack: "⚔", none: "" };
const COST_LABEL: Record<Cost, string> = { action: "Action", bonus: "Bonus Action", reaction: "Reaction", legendary: "Legendary Action", free: "Free", longer: "Longer casting time", move: "Movement", attack: "One attack", none: "" };

let item: Item | null = null;
let role: "GM" | "PLAYER" = "PLAYER";
let meId = "";
const savedTab = store.get("butler.actionsTab") as Tab | null;
let tab: Tab = savedTab && TAB_IDS.has(savedTab) ? savedTab : "all";
let selected: string | null = null;
let note = "";
/** Tiles that reveal options (Attack, Magic, Help, Utilize, a potion action, Two-Weapon Fighting): open while the
 *  pointer is over the tile or its options, or pinned by a click. Keyed by the tile's key. */
const revealOpen = new Set<string>();
const revealPinned = new Set<string>();
const revealTimer = new Map<string, ReturnType<typeof setTimeout>>();
/** What each shown tile reveals (set each render). */
let reveals: Record<string, ActionItem[]> = {};
const cssKey = (key: string) => key.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
const isOpen = (key: string) => revealOpen.has(key) || revealPinned.has(key);
/** The GM's homebrew form: null when closed, else the entry being edited ("" id = new). */
let hbForm: { id: string; name: string; cost: HomebrewCost; summary: string; text: string; error?: string } | null = null;

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
  return h("div", { className: "ab-tabs" },
    ...TABS.map((t) => ({ ...t, n: t.tab === "all" ? 0 : filterCount(bar, t.tab) })).filter((t) => t.tab === "all" || t.n).map((t) => h("button", {
      className: `${tab === t.tab ? "on" : ""} tab-${t.tab}`, title: t.title,
      onclick: () => { tab = t.tab; store.set("butler.actionsTab", t.tab); render(); },
    }, t.label, t.tab !== "all" ? h("span", { className: "count" }, ` ${t.n}`) : null)));
}

function setRevealOpen(key: string, open: boolean) {
  clearTimeout(revealTimer.get(key));
  if (open === revealOpen.has(key)) return;
  if (open) revealOpen.add(key); else revealOpen.delete(key);
  const on = isOpen(key);
  document.querySelector(`.ab-reveal.reveal-${cssKey(key)}`)?.classList.toggle("open", on);
  document.querySelector(`.tile.is-reveal-${cssKey(key)}`)?.classList.toggle("open", on);
}
const hoverReveal = (key: string) => ({
  onmouseenter: () => setRevealOpen(key, true),
  onmouseleave: () => { clearTimeout(revealTimer.get(key)); revealTimer.set(key, setTimeout(() => setRevealOpen(key, false), 350)); },
});

/** The line above a tile's options. */
function revealIntro(it: ActionItem, bar: ActionBar): Child[] {
  if (it.key === ATTACK_KEY) return [h("strong", {}, "Attack: "), bar.attacks > 1 ? `${bar.attacks} attacks per Attack action; each can be any of these.` : "each attack can be any of these."];
  if (MAGIC_KEYS.includes(it.key)) return [h("strong", {}, `${it.name}: `), it.key === "common:Magic" ? "cast one of these spells, or use one of these magic items or magical actions." : "cast one of these spells."];
  if (it.key === HELP_KEY) return [h("strong", {}, "Help: "), "help an ally with a check or an attack, or give first aid."];
  if (it.key === TWF_KEY) return [h("strong", {}, "Two-Weapon Fighting: "), bar.dualWielder ? "the extra attack, with a different weapon than the one you attacked with." : "the extra attack, with a different Light weapon than the one you attacked with."];
  return [h("strong", {}, `${it.name}: `), "with one of these."];
}

/** What a tile gathers, in a row right under it. */
function reveal(it: ActionItem, options: ActionItem[], bar: ActionBar): Child {
  const key = it.key;
  const open = isOpen(key) || options.some((o) => o.key === selected);
  const sheetCount = options.filter((o) => o.category !== "common").length;
  const color = key === ATTACK_KEY ? "act" : it.cost === "bonus" ? "bonus" : "accent";
  return h("div", { className: `ab-reveal reveal-${cssKey(key)} reveal-color-${color}${open ? " open" : ""}`, ...hoverReveal(key) },
    h("div", { className: "ab-reveal-head small" }, ...revealIntro(it, bar),
      revealPinned.has(key) ? h("button", { className: "icon tiny", title: "Hide these options", onclick: () => { revealPinned.delete(key); revealOpen.delete(key); render(); } }, "✕") : null),
    h("div", { className: "ab-reveal-grid" }, ...options.map((o, i) => [key === ATTACK_KEY && i === sheetCount && sheetCount && sheetCount < options.length ? h("span", { className: "ab-reveal-sep" }) : null, tile(o)]).flat()));
}

function tile(it: ActionItem): HTMLElement {
  const icon = it.category === "item" ? "⚱" : it.category === "spell" || MAGIC_KEYS.includes(it.key) ? "✦" : it.key === ATTACK_KEY ? "⚔" : it.category === "common" ? "⬡" : it.category === "feature" ? "❖" : /\[1d20[+-]\d+\]/.test(it.text) ? "⚔" : "✧";
  const badge = it.source === "DMG" ? "DMG" : it.source === "Homebrew" ? "HB" : it.limit ? it.limit.label : it.recharge ? `${it.recharge}–6` : it.spellLevel !== undefined ? (it.spellLevel ? `L${it.spellLevel}` : "C") : "";
  const rv = reveals[it.key]?.length ? it.key : null;
  const color = it.key === ATTACK_KEY ? "act" : it.cost === "bonus" ? "bonus" : "accent";
  return h("button", {
    className: `tile cost-${it.cost}${selected === it.key ? " sel" : ""}${rv ? ` is-reveal is-reveal-${cssKey(rv)} reveal-color-${color}${isOpen(rv) ? " open" : ""}` : ""}`,
    title: `${it.name}${it.cost !== "none" ? ` · ${COST_LABEL[it.cost]}` : ""}${it.costNote ? ` (${it.costNote})` : ""}${rv ? ` · hover or click for its options (${reveals[rv]!.length})` : ""}`,
    onclick: () => {
      if (rv) { if (selected !== it.key) { revealPinned.add(rv); revealOpen.add(rv); } else { revealPinned.delete(rv); revealOpen.delete(rv); } }
      selected = selected === it.key ? null : it.key; render();
    },
    ...(rv ? hoverReveal(rv) : {}),
  },
  h("span", { className: "tcost" }, COST_GLYPH[it.cost]),
  badge ? h("span", { className: "tbadge" }, badge) : null,
  h("span", { className: "ticon", "aria-hidden": "true" }, commonActionIcon(it) ?? icon),
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
      h("summary", {}, "From the sheet"), h("p", { className: "entry-text" }, ...sheetText(it.text))) : null,
    it.source === "Homebrew" && role === "GM" ? h("div", { className: "row" },
      h("button", { className: "secondary small", onclick: () => { const hb = homebrewActions().find((x) => x.id === it.homebrewId); if (hb) { hbForm = { id: hb.id, name: hb.name, cost: hb.cost, summary: hb.summary ?? "", text: hb.text }; render(); } } }, "Edit"),
      h("button", { className: "secondary small", onclick: () => { if (confirm(`Remove the homebrew action ${it.name} from the room?`)) { selected = null; void deleteHomebrew(it.homebrewId!).catch(showErr); } } }, "Remove")) : null);
}

function showErr(e: unknown) { note = e instanceof Error ? e.message : String(e); render(); }

/** The GM's form for a homebrew action (shared by the whole room). */
function homebrewForm(): Child {
  if (!hbForm) return null;
  const f = hbForm;
  const input = (key: "name" | "summary", placeholder: string, max: number) => h("input", { type: "text", value: f[key], placeholder, maxLength: max, oninput: (e: Event) => { f[key] = (e.target as HTMLInputElement).value; } });
  return h("div", { className: "panel ab-detail ab-hb" },
    h("div", { className: "row between" }, h("strong", {}, f.id ? "Edit homebrew action" : "New homebrew action"),
      h("button", { className: "icon tiny", title: "Close", onclick: () => { hbForm = null; render(); } }, "✕")),
    h("div", { className: "small muted" }, "Shows on every unit's action bar in this room."),
    h("div", { className: "grid2" },
      h("label", {}, "Name", input("name", "Called Shot", HOMEBREW_LIMITS.name)),
      h("label", {}, "Costs", h("select", { onchange: (e: Event) => { f.cost = (e.target as HTMLSelectElement).value as HomebrewCost; } },
        ...HOMEBREW_COSTS.map((c) => h("option", { value: c.cost, selected: c.cost === f.cost }, c.label))))),
    h("label", { className: "small col" }, "Short line for the tile (optional)", input("summary", "−5 to hit, +10 damage", HOMEBREW_LIMITS.summary)),
    h("label", { className: "small col" }, "How it works",
      h("textarea", { value: f.text, maxLength: HOMEBREW_LIMITS.text, placeholder: "What it does, what to roll, any limit.", oninput: (e: Event) => { f.text = (e.target as HTMLTextAreaElement).value; } })),
    f.error ? h("div", { className: "small warn-text" }, f.error) : null,
    h("div", { className: "row" },
      h("button", { className: "small", onclick: () => {
        void saveHomebrew({ ...(f.id ? { id: f.id } : {}), name: f.name, cost: f.cost, summary: f.summary, text: f.text })
          .then(() => { hbForm = null; render(); })
          .catch((e) => { f.error = e instanceof Error ? e.message : String(e); render(); });
      } }, "Save"),
      h("button", { className: "secondary small", onclick: () => { hbForm = null; render(); } }, "Cancel")));
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
    const bar = actionBar(sheet, roomSystem().rules, { dmg: roomSettings().dmgOptions, homebrew: homebrewActions(), conditions: state.conditions.map((c) => c.key) });
    const layout = barLayout(bar, tab);
    const { sections, magicOptions } = layout;
    reveals = layout.reveals;
    const sel = bar.items.find((it) => it.key === selected) ?? Object.values(reveals).flat().find((it) => it.key === selected);

    const tabInfo = tab === "action" || tab === "bonus" || tab === "reaction" || tab === "legendary" ? COST_EXPLAINED[tab] : "";
    const addHomebrew = role === "GM" ? h("button", { className: "tile tile-add", title: "Add a homebrew action for everyone in this room", onclick: () => { hbForm = { id: "", name: "", cost: tab === "bonus" || tab === "reaction" ? tab : "action", summary: "", text: "" }; selected = null; render(); } },
      h("span", { className: "ticon" }, "＋"), h("span", { className: "tname" }, "Homebrew"), h("span", { className: "tsum" }, "add an action")) : null;
    const grid: Child[] = sections.flatMap((sec) => [
      h("div", { className: `ab-group group-${sec.id}` }, sec.title),
      ...sec.items.flatMap((it) => reveals[it.key]?.length ? [tile(it), reveal(it, reveals[it.key]!, bar)] : [tile(it)]),
    ]);
    if (addHomebrew) grid.push(addHomebrew);
    nodes.push(
      head(sheet, state),
      tabsRow(bar),
      tabInfo ? h("div", { className: `small cost-text cost-${tab}` }, tabInfo) : null,
      h("div", { className: "ab-grid" }, ...(grid.length ? grid : [h("div", { className: "small muted" }, "Nothing here.")])),
      hbForm ? homebrewForm() : sel ? detail(sel, bar) : h("div", { className: "small muted" }, `Hover Attack for every way to attack${magicOptions.length ? `, ${roomSystem().rules === "2024" ? "Magic" : "Cast a Spell"} for spells${roomSystem().rules === "2024" ? " and magic items" : ""}` : ""}; click an option to see how it works.`),
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
  await Promise.all([initRoomSettings(), initHomebrew()]);
  onRoomSettings(() => render());
  onHomebrew(() => render());
  [item = null] = await OBR.scene.items.getItems([itemId]);
  render();
  OBR.scene.items.onChange((items) => { item = items.find((i) => i.id === itemId) ?? null; render(); });
});
