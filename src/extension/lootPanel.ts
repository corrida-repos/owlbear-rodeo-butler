/**
 * The GM's "Loot" panel on a dead monster's or NPC's card (see core/loot.ts). The loot is rolled the first time the GM
 * sees the dead unit's card and kept on the unit, however it died (prompt, auto-dead setting, status change). Coins are
 * always rolled; themed treasure is offered as buttons (one roll per monster; "Any" lets the GM pick). Posting sends a public note to the
 * roll log; nothing is added to anyone's inventory.
 */
import OBR from "@owlbear-rodeo/sdk";
import { cryptoRng } from "../core/dice";
import {
  addRolled, lootEligible, lootFields, lootPostText, markPosted, planLoot, removeLine, rollMagicItem,
  type LootRules, type LootSource, type Theme, type UnitLoot,
} from "../core/loot";
import { makeNote, ROLL_CHANNEL, type Role } from "../core/rolls";
import { STATE_KEY, type UnitSheet, type UnitState } from "../core/sheet";
import { isDead } from "../core/systems";
import { getLib } from "./bestiary";
import { h, type Child } from "./dom";
import { obrGateway } from "./obrGateway";

export interface LootPanelCtx {
  unitId: string;
  role: Role;
  me: { id: string; name: string };
  /** The name players know the unit by (its alias, if the GM set one). */
  publicName: string;
  rules: LootRules;
  /** Party members' names, for "taken by". */
  party: string[];
  report: (err: unknown) => void;
}

const rolling = new Set<string>();
let takenBy = "";

/** Tokens made before Butler kept the Treasure and Gear lines: read them from the book (5etools), if it's there. */
async function lootSource(sheet: UnitSheet): Promise<LootSource> {
  if (sheet.treasure !== undefined || sheet.gear !== undefined || sheet.source.provenance !== "official" || !sheet.source.book) return sheet;
  try {
    const lib = await getLib();
    const r = await lib.prepare(sheet.name, sheet.source.book);
    return { ...sheet, ...lootFields(r.monster) };
  } catch {
    return sheet;
  }
}

const save = (unitId: string, loot: UnitLoot | undefined) => obrGateway.patchMetadata([{ id: unitId, key: STATE_KEY, patch: { loot } }]);

/** Rolls the loot once for a dead monster, the first time the GM's card shows it. */
function ensureRolled(ctx: LootPanelCtx, sheet: UnitSheet) {
  if (rolling.has(ctx.unitId)) return;
  rolling.add(ctx.unitId);
  void (async () => {
    const src = await lootSource(sheet);
    await save(ctx.unitId, planLoot(src, ctx.rules, cryptoRng));
  })().catch(ctx.report).finally(() => rolling.delete(ctx.unitId));
}

async function post(ctx: LootPanelCtx, loot: UnitLoot, ids: string[]) {
  const lines = loot.lines.filter((l) => ids.includes(l.id));
  if (!lines.length) return;
  const msg = makeNote(lootPostText(ctx.publicName, lines, takenBy || undefined), { id: ctx.me.id, name: ctx.me.name, role: ctx.role }, "public",
    { unit: { id: ctx.unitId, name: ctx.publicName } });
  await OBR.broadcast.sendMessage(ROLL_CHANNEL, msg, { destination: "ALL" });
  await save(ctx.unitId, markPosted(loot, ids));
}

export function lootPanel(ctx: LootPanelCtx, sheet: UnitSheet, state: UnitState): Child {
  if (ctx.role !== "GM" || !isDead(state) || !lootEligible(sheet, state)) return null;
  const loot = state.loot;
  if (!loot) {
    ensureRolled(ctx, sheet);
    return h("div", { className: "panel small muted" }, "💰 Rolling loot…");
  }
  const act = (fn: () => Promise<unknown>) => () => void fn().catch(ctx.report);
  const cr = sheet.cr;
  const rollTheme = (t: Theme) => act(() => save(ctx.unitId, addRolled(loot, rollMagicItem(t, cr, cryptoRng), t)));
  const reroll = act(async () => save(ctx.unitId, planLoot(await lootSource(sheet), ctx.rules, cryptoRng)));
  const unposted = loot.lines.filter((l) => !l.posted).map((l) => l.id);

  const offers: Child[] = [];
  if (loot.themes.length) {
    offers.push(h("div", { className: "small" }, loot.any ? "Treasure: Any. Pick a theme to roll a magic item:" : "Treasure line offers a magic item roll:"));
    offers.push(h("div", { className: "row" },
      ...loot.themes.map((t) => h("button", { className: "secondary small", onclick: rollTheme(t), title: `Roll on the 2024 DMG ${t} tables (rarity by CR)` }, `🎲 ${t}`))));
  }

  const partySelect = ctx.party.length ? h("select", { onchange: (e: Event) => { takenBy = (e.target as HTMLSelectElement).value; } },
    h("option", { value: "", selected: !takenBy }, "Nobody in particular"),
    ...ctx.party.map((n) => h("option", { value: n, selected: n === takenBy }, n))) : null;

  return h("details", { className: "panel section", open: true },
    h("summary", {}, `💰 Loot (${loot.lines.length})`),
    h("div", { className: "stack tight", style: "margin-top:6px" },
      loot.lines.length
        ? h("ul", { className: "plain small" }, ...loot.lines.map((l) => h("li", { className: "row between" },
          h("span", { title: l.detail ?? "" }, h("strong", {}, l.text), l.detail ? h("span", { className: "muted" }, ` · ${l.detail}`) : null, l.posted ? h("span", { className: "ok" }, " · posted") : null),
          h("span", { className: "row" },
            h("button", { className: "secondary small", title: "Post this to the roll log (everyone sees it)", onclick: act(() => post(ctx, loot, [l.id])) }, "Post"),
            h("button", { className: "icon", title: "Remove from the suggestion", onclick: act(() => save(ctx.unitId, removeLine(loot, l.id))) }, "✕")))))
        : h("div", { className: "small muted" }, loot.note ?? "Nothing found."),
      loot.lines.length && loot.note ? h("div", { className: "small muted" }, loot.note) : null,
      ...offers,
      h("div", { className: "row" },
        partySelect ? h("label", { className: "small row" }, "Taken by ", partySelect) : null,
        unposted.length ? h("button", { className: "small", onclick: act(() => post(ctx, loot, unposted)), title: "Post everything not yet posted to the roll log" }, "Post all") : null,
        h("button", { className: "secondary small", onclick: reroll, title: "Throw this suggestion away and roll again" }, "Reroll")),
      h("div", { className: "small muted" }, "Only you see this. Posting adds a line to everyone's roll log; it doesn't change anyone's inventory.")));
}
