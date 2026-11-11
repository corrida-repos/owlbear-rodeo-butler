/**
 * Unit card popover (card.html?id=<itemId>), F2 + F3 + F7.
 *  - GM, or a player who controls the unit: the full stat block, every roll clickable.
 *  - Any other player: name (or the GM's alias), portrait and conditions only.
 * Rolls: click = normal, Shift = advantage, Ctrl/Cmd = disadvantage (or the Adv/Dis toggle for touch). Attacks offer
 * their damage next, with crit damage after a natural 20. Public rolls go to everyone; private ones stay with the
 * roller (and the GM, for a player's roll).
 */
import "../extension/devlog";
import OBR, { type Item, type Player } from "@owlbear-rodeo/sdk";
import {
  abilityRows, cardAccess, challengeLine, combineModes, controls, editionText, initiativeRoll, portraitUrl, SECTIONS, shownName, skillRolls,
  speedLine, typeLine, unitName, type CardAccess, type StandardRoll,
} from "../core/card";
import { damageAfter, parseChips, rollLabel, type RollSegment, type Segment } from "../core/chips";
import { cryptoRng, fmtMod } from "../core/dice";
import { makeRoll, rollDetail, ROLL_CHANNEL, rollDestination, type Role, type RollMessage, type RollVisibility } from "../core/rolls";
import type { RollMode } from "../core/schema";
import { maxHp, STATE_KEY, type SheetEntry, type UnitSheet, type UnitState } from "../core/sheet";
import { displayConditions, isDead, needsDeathSaves } from "../core/systems";
import { parseHpInput } from "../core/hp";
import { addConditionTo, changeHp, makeStable, markUnitsDead, removeConditionFrom, resolveConcentration, reviveUnits, undoHp } from "../core/tracker";
import { conditionText, d20Penalty, durationText, EXHAUSTION_2014, speedPenalty } from "../core/conditions";
import { turnOrder } from "../core/encounter";
import { trackerUnits } from "../core/tracker";
import { conditionEditor } from "../extension/conditionEditor";
import { saveToCollection } from "../extension/collectionPanel";
import { obrGateway } from "../extension/obrGateway";
import { sendRequest } from "../extension/requests";
import { readUnit } from "../core/unit";
import { readWildShape, revertWildShape } from "../core/wildshape";
import { hasLairFeatures, leftOf, legendaryCost, resetUses, setInLair, setUsesSpent, sheetUses, spentOf, type UseResource } from "../core/uses";
import { openWildShape } from "../extension/wildShapePopover";
import { h, store, type Child } from "../extension/dom";
import { onRollLog, readRollLog } from "../extension/rollLog";
import { initRoomSettings, onRoomSettings, roomSettings, roomSystem } from "../extension/roomSettings";

const app = document.getElementById("app")!;
const itemId = new URLSearchParams(location.search).get("id") ?? "";

let item: Item | null = null;
let role: Role = "PLAYER";
let me = { id: "", name: "" };
let players: Player[] = [];
let visibility: RollVisibility = store.get("butler.rollVisibility") === "private" ? "private" : "public";
/** Advantage/disadvantage toggle for the next roll (touch-friendly); resets after a roll. */
let nextMode: RollMode = "normal";
/** The last roll made from this card, with its follow-up damage rolls. */
let last: { msg: RollMessage; entry?: string; damage: RollSegment[]; attackNatural?: number; note?: string } | null = null;
let log: RollMessage[] = [];
let editOpen = false;
let error = "";
const closed = new Set<string>(["spells", "inventory"]);
let renderPending = false;
document.addEventListener("focusout", () => { if (renderPending) { renderPending = false; setTimeout(render, 0); } });

// ------------------------------------------------------------------ rolling

async function roll(formula: string, label: string, kind: RollMessage["kind"], ev: MouseEvent | null, opts: { builtIn?: RollMode; crit?: boolean; entry?: string; segs?: Segment[]; seg?: RollSegment; followUp?: boolean } = {}): Promise<RollMessage | null> {
  const u = item && readUnit(item.metadata);
  if (!item || !u) return null;
  let sent: RollMessage | null = null;
  // 2024 exhaustion: −2 per level on every d20 test.
  const penalty = kind === "attack" || kind === "save" || kind === "check" ? d20Penalty(roomSystem(), u.state) : 0;
  if (penalty) { formula = `${formula.replace(/\s+/g, "")}${fmtMod(penalty)}`; label = `${label} (exhaustion ${fmtMod(penalty)})`; }
  const clicked: RollMode = ev?.shiftKey ? "advantage" : ev && (ev.ctrlKey || ev.metaKey) ? "disadvantage" : nextMode;
  const mode = combineModes(clicked, opts.builtIn);
  // Public rolls name the unit the way players know it (alias), private ones by its real name.
  const name = visibility === "public" && u.state.alias?.trim() ? u.state.alias.trim() : unitName(itemInfo(item), u.sheet, u.state);
  try {
    const msg = makeRoll(formula, label, { id: me.id, name: me.name, role }, visibility,
      { rng: cryptoRng, unit: { id: item.id, name }, kind, mode, crit: opts.crit });
    await OBR.broadcast.sendMessage(ROLL_CHANNEL, msg, { destination: rollDestination(msg) });
    // Damage rolled from the result panel keeps the attack's other damage buttons (e.g. Slashing + Fire, or a crit).
    const damage = kind === "attack" && opts.segs && opts.seg ? damageAfter(opts.segs, opts.seg) : opts.followUp && last ? last.damage : [];
    const attackNatural = kind === "attack" ? msg.natural : opts.followUp ? last?.attackNatural : undefined;
    last = { msg, entry: opts.entry ?? last?.entry, damage, attackNatural };
    nextMode = "normal";
    error = "";
    sent = msg;
    // Rolling from a Recharge (or once-per-rest) ability uses it up.
    if (opts.entry && !opts.followUp && canEdit()) {
      const r = sheetUses(u.sheet, { inLair: u.state.inLair }).find((x) => x.entry === opts.entry && x.max === 1 && (x.kind === "recharge" || x.kind === "rest"));
      if (r && leftOf(r, u.state) > 0) {
        await writeUses(r.key, 1);
        last.note = `${r.label} is now used${r.kind === "recharge" ? `: it rolls to recharge (${r.recharge}–6) at the start of ${name}'s turn` : ""}.`;
      }
    }
  } catch (e) {
    error = `Roll failed: ${e instanceof Error ? e.message : String(e)}`;
  }
  render();
  return sent;
}

function zeroHpPanel(state: UnitState): Child {
  const dead = isDead(state);
  if (dead) {
    return role === "GM" ? h("div", { className: "panel row between" }, h("strong", {}, "☠ Dead"),
      h("button", { className: "secondary", onclick: () => void reviveUnits(obrGateway, [itemId]).catch(showErr) }, "Revive")) : null;
  }
  if (!needsDeathSaves(state)) return null;
  // A status only: the table keeps the successes and failures; the GM settles it with Stable or Dead (or healing).
  return h("div", { className: "panel deathsaves" },
    h("div", {}, h("strong", {}, "Death Saves"), h("span", { className: "small muted" }, " · at 0 HP. Count successes and failures at the table.")),
    h("div", { className: "row", style: "margin-top:6px" },
      h("button", { onclick: (ev: MouseEvent) => void roll("1d20", "Death save", "save", ev), title: "Just the d20 roll: 10+ succeeds, 1 counts twice, 20 is back to 1 HP. Nothing is recorded." }, "Roll death save"),
      role === "GM" ? h("button", { className: "secondary", title: "Stable: no more death saves", onclick: () => void makeStable(obrGateway, itemId).catch(showErr) }, "Stable") : null,
      role === "GM" ? h("button", { className: "secondary", title: "Mark as dead (leaves initiative)", onclick: () => void markUnitsDead(obrGateway, [itemId]).catch(showErr) }, "☠ Dead") : null));
}

/** Units in the scene by id, for duration texts and the "until X's turn" choices. */
let sceneUnits: { id: string; name: string }[] = [];
async function refreshSceneUnits() {
  const items = await obrGateway.getItems();
  const units = trackerUnits(items);
  const order = turnOrder(units);
  sceneUnits = [...order, ...units.filter((u) => !order.includes(u))].map((u) => ({ id: u.id, name: u.name }));
}

/** Wild Shape: the current form with Revert, and the button to the Known Shapes popover. */
function wildShapePanel(state: UnitState): Child {
  if (!item) return null;
  const ws = readWildShape(item.metadata);
  if (!ws && !(role === "GM" && state.party)) return null;
  const open = () => void openWildShape(itemId).catch(showErr);
  if (!ws) return h("div", { className: "row" }, h("button", { className: "secondary small", onclick: open }, "Set up Wild Shape"));
  if (!ws.active) return h("div", { className: "row" }, h("button", { className: "secondary small", onclick: open, title: "Known Shapes and transforming" }, "🐾 Wild Shape"));
  const revert = () => void (role === "GM" ? revertWildShape(obrGateway, itemId) : sendRequest({ type: "wild-shape", unitId: itemId, op: "revert" })).catch(showErr);
  return h("div", { className: "panel row between", style: "border-color:var(--ok)" },
    h("span", {}, "🐾 ", h("strong", {}, `Wild Shape: ${ws.active.form.name}`),
      h("span", { className: "small muted" }, ws.active.rules === "2014" ? " · beast HP, reverts at 0" : " · reverts at 0 HP or Incapacitated")),
    h("span", { className: "row" },
      h("button", { className: "secondary small", onclick: open }, "Change"),
      h("button", { className: "small", onclick: revert }, "Revert")));
}

let addOpen = false;
/** The GM edits directly; the unit's player (when the GM allows player edits) sends the change to the GM's client. */
const canEdit = () => role === "GM" || (roomSettings().playerEdits && !!item && controls({ id: me.id, role }, itemInfo(item), readUnit(item.metadata)?.state ?? {}));

function conditionsPanel(state: UnitState): Child {
  const sys = roomSystem();
  const own = state.conditions.filter((c) => !sys.conditions.find((d) => d.key === c.key)?.automatic);
  const edit = canEdit();
  if (!edit && !own.length) return null;
  const nameOf = (id: string) => sceneUnits.find((u) => u.id === id)?.name ?? "another unit";
  return h("div", { className: "panel stack tight" },
    h("strong", { className: "small" }, "Conditions"),
    own.length ? h("div", { className: "stack tight" }, ...own.map((c) => h("div", { className: "row between small" },
      h("span", {}, h("strong", {}, conditionText(c, sys)), c.until ? h("span", { className: "muted" }, ` · ${durationText(c, nameOf)}`) : null,
        c.source === "ddb" ? h("span", { className: "muted", title: "Set on D&D Beyond; the next sync updates or removes it" }, " · D&D Beyond") : null, c.note ? h("span", { className: "muted" }, ` · ${c.note}`) : null,
        // 2014 exhaustion works by levels of effects (5.5E applies its flat penalties to rolls and speed instead).
        c.key === "exhaustion" && sys.rules === "2014" && c.level ? h("div", { className: "muted" }, EXHAUSTION_2014.slice(0, c.level).join("; ")) : null),
      edit ? h("button", { className: "icon tiny", title: "Remove", onclick: () => void (role === "GM" ? removeConditionFrom(obrGateway, itemId, c.id) : sendRequest({ type: "condition-remove", unitId: itemId, conditionId: c.id })).catch(showErr) }, "✕") : null)))
      : h("div", { className: "small muted" }, "None."),
    edit ? h("details", { open: addOpen, ontoggle: (e: Event) => { addOpen = (e.target as HTMLDetailsElement).open; } },
      h("summary", { className: "small" }, "Add condition"),
      conditionEditor(sys, sceneUnits, (c) => void (role === "GM" ? addConditionTo(obrGateway, [itemId], c.key, c) : sendRequest({ type: "condition-add", unitId: itemId, ...c })).catch(showErr))) : null);
}

function concentrationPanel(sheet: UnitSheet, state: UnitState): Child {
  const chk = state.concentrationCheck;
  if (!chk) return null;
  const con = abilityRows(sheet).find((a) => a.ability === "con")!.save;
  return h("div", { className: "panel deathsaves" },
    h("div", {}, h("strong", {}, "Concentration check"), ` · took ${chk.damage} damage: DC ${chk.dc} Constitution save`),
    h("div", { className: "row", style: "margin-top:6px" },
      h("button", { onclick: async (ev: MouseEvent) => {
        const msg = await roll(con.formula, `Concentration (DC ${chk.dc})`, "save", ev);
        if (!msg) return;
        try {
          if (role === "GM") {
            const r = await resolveConcentration(obrGateway, itemId, msg.total);
            if (r === "lost") await OBR.notification.show(`Concentration lost (${msg.total} vs DC ${chk.dc}).`, "WARNING");
          } else await sendRequest({ type: "concentration", unitId: itemId, total: msg.total });
        } catch (e) { showErr(e); }
      } }, `Roll Con save ${fmtMod(con.bonus)}`),
      role === "GM" ? h("button", { className: "secondary", onclick: () => void resolveConcentration(obrGateway, itemId, null).catch(showErr) }, "Dismiss") : null));
}

const showErr = (e: unknown) => { error = e instanceof Error ? e.message : String(e); render(); };

function gmHpBox(): Child {
  if (!canEdit()) return null;
  const inp = h("input", { type: "text", className: "hpbox", placeholder: "−7 / +5 / t5", title: "-7 damage · +5 heal · 12 set · t5 temp HP; Enter applies" }) as HTMLInputElement;
  inp.onkeydown = async (e: KeyboardEvent) => {
    if (e.key !== "Enter") return;
    const change = parseHpInput(inp.value);
    if (!change) { error = `"${inp.value}" isn't an HP change: use -7, +5, 12 or t5.`; render(); return; }
    inp.value = "";
    inp.blur();
    try {
      if (role === "GM") await changeHp(obrGateway, [itemId], change, { autoDeadAtZero: roomSettings().autoDeadAtZero, system: roomSystem() });
      else await sendRequest({ type: "hp", unitId: itemId, change });
    } catch (err) { error = String(err); render(); }
  };
  const last = item ? readUnit(item.metadata)?.state.hpLog?.at(-1) : undefined;
  if (!last) return inp;
  const undo = h("button", { className: "icon tiny", title: `Undo ${last.text} (back to ${last.before.hp} HP${last.before.tempHp ? ` +${last.before.tempHp} temp` : ""})`,
    onclick: () => void (role === "GM" ? undoHp(obrGateway, itemId) : sendRequest({ type: "hp-undo", unitId: itemId })).catch(showErr) }, "↶");
  return h("span", { className: "row", style: "gap:2px;flex-wrap:nowrap" }, inp, undo);
}

const rollStandard = (r: StandardRoll) => (ev: MouseEvent) => void roll(r.formula, r.label, r.kind === "initiative" ? "check" : r.kind, ev, { builtIn: r.mode });

function chipButton(entry: SheetEntry, segs: Segment[], seg: RollSegment): HTMLElement {
  return h("button", {
    className: `chip chip-${seg.kind}`,
    title: `${seg.formula}${seg.kind === "attack" || seg.kind === "save" || seg.kind === "check" ? " · Shift: advantage · Ctrl: disadvantage" : ""}`,
    onclick: (ev: MouseEvent) => void roll(seg.formula, rollLabel(entry.name, seg), seg.kind, ev, { entry: entry.name, segs, seg }),
  }, seg.display);
}

function entryText(entry: SheetEntry, canRoll: boolean): Child[] {
  const segs = parseChips(editionText(entry.text, roomSystem().rules));
  const out: Child[] = [];
  for (const s of segs) {
    if (s.t === "text") {
      // Keep the sheet's line breaks (lists, multi-paragraph traits).
      s.text.split("\n").forEach((line, i) => { if (i) out.push(h("br")); out.push(line); });
    } else out.push(canRoll ? chipButton(entry, segs, s) : s.display);
  }
  return out;
}

// ------------------------------------------------------------------ limited uses (uses.ts)

/** GM: straight to the token. The unit's player: a request the GM's client applies. */
async function writeUses(key: string, spent: number) {
  try {
    if (role === "GM") await setUsesSpent(obrGateway, itemId, key, spent);
    else await sendRequest({ type: "uses", unitId: itemId, key, spent });
  } catch (e) { showErr(e); }
}

/** A recharge roll made from the card: a d6, and the ability is back on a high enough roll. */
async function rollRecharge(r: UseResource, ev: MouseEvent) {
  const msg = await roll("1d6", `${r.label} · recharge (${r.recharge}–6)`, "dice", ev);
  if (msg && msg.total >= (r.recharge ?? 6)) await writeUses(r.key, 0);
  if (msg && last?.msg.id === msg.id) { last.note = msg.total >= (r.recharge ?? 6) ? `${r.label} recharged.` : `${r.label} didn't recharge.`; render(); }
}

/** Pips for a resource: filled = left. Click a filled pip to spend one, an empty one to get one back. */
function usePips(r: UseResource, state: UnitState): Child {
  const edit = canEdit();
  const left = leftOf(r, state);
  const spent = spentOf(state, r.key);
  if (r.max === 1) {
    const ready = left > 0;
    const label = r.kind === "recharge" ? (ready ? "Ready" : `Used · recharge ${r.recharge}–6`) : ready ? "Unused" : "Used";
    return h("span", { className: "uses" },
      h("button", { className: `usebtn${ready ? " ready" : " spent"}`, disabled: !edit, title: edit ? (ready ? "Mark as used" : "Mark as ready again") : "",
        onclick: () => void writeUses(r.key, ready ? 1 : 0) }, label),
      !ready && edit && r.kind === "recharge" ? h("button", { className: "usebtn", title: `Roll a d6: ${r.recharge} or more recharges it`, onclick: (ev: MouseEvent) => void rollRecharge(r, ev) }, "🎲 d6") : null);
  }
  return h("span", { className: "uses", title: `${left} of ${r.max} left` },
    ...Array.from({ length: r.max }, (_, i) => h("button", {
      className: `pip${i < left ? " on" : ""}`, disabled: !edit,
      title: i < left ? "Spend one" : "Get one back",
      onclick: () => void writeUses(r.key, i < left ? spent + 1 : spent - 1),
    }, i < left ? "●" : "○")),
    h("span", { className: "small muted" }, ` ${left}/${r.max}`));
}

/** Controls shown after an entry's name: its own uses, or (legendary actions) the cost to spend from the pool. */
function entryUses(section: string, entry: SheetEntry, uses: UseResource[], state: UnitState): Child[] {
  const out: Child[] = [];
  const pool = uses.find((r) => r.kind === "legendary");
  if (section === "legendary" && pool) {
    if (/^(legendary actions|mythic actions)$/i.test(entry.name.trim())) {
      if (/^legendary/i.test(entry.name.trim())) out.push(usePips(pool, state));
    } else {
      const cost = legendaryCost(entry.name);
      const left = leftOf(pool, state);
      out.push(h("button", { className: "usebtn", disabled: !canEdit() || left < cost, title: left < cost ? "Not enough legendary actions left this round" : `Spend ${cost} legendary action${cost === 1 ? "" : "s"}`,
        onclick: () => void writeUses(pool.key, spentOf(state, pool.key) + cost) }, `Use${cost > 1 ? ` (${cost})` : ""}`));
    }
  }
  for (const r of uses.filter((x) => x.section === section && x.entry === entry.name && !x.spell)) out.push(usePips(r, state));
  return out.length ? [" ", ...out, " "] : [];
}

/** Per-spell uses of an "N/Day Each" list, under the list. */
function spellUses(entry: SheetEntry, uses: UseResource[], state: UnitState): Child {
  const each = uses.filter((x) => x.section === "spells" && x.entry === entry.name && x.spell);
  if (!each.length) return null;
  return h("span", { className: "spelluses" }, ...each.map((r) => h("span", { className: "spelluse" }, h("span", { className: "small" }, r.label), usePips(r, state))));
}

/** "Limited uses" panel: summary, reset (GM) and the In its lair switch. */
function usesPanel(sheet: UnitSheet, state: UnitState): Child {
  const uses = sheetUses(sheet, { inLair: state.inLair });
  const lair = hasLairFeatures(sheet);
  if (!uses.length && !lair) return null;
  const spentAny = uses.some((r) => spentOf(state, r.key) > 0);
  return h("div", { className: "panel stack tight" },
    h("div", { className: "row between" },
      h("strong", { className: "small" }, "Limited uses"),
      role === "GM" ? h("span", { className: "row" },
        lair ? h("label", { className: "small", style: "align-items:center", title: sheet.lair?.length ? "Lair actions on initiative 20 (losing ties), and the stat block's in-lair uses" : "The stat block's in-lair uses" },
          h("input", { type: "checkbox", checked: !!state.inLair, onchange: (e: Event) => void setInLair(obrGateway, itemId, (e.target as HTMLInputElement).checked).catch(showErr) }), "In its lair") : null,
        h("button", { className: "secondary small", disabled: !spentAny, title: "Every use back (a new day or a rest)", onclick: () => void resetUses(obrGateway, [itemId]).catch(showErr) }, "Reset uses")) : null),
    uses.length ? h("div", { className: "small" }, ...uses.filter((r) => r.section !== "spells").map((r, i) =>
      h("span", { className: leftOf(r, state) ? "" : "muted" }, i ? " · " : "", r.max === 1 ? `${r.label} ${leftOf(r, state) ? "✓" : "✗"}` : `${r.label} ${leftOf(r, state)}/${r.max}`))) : null,
    uses.some((r) => r.kind === "legendary" || r.kind === "recharge") ? h("div", { className: "small muted" }, "Legendary actions come back and Recharge abilities roll at the start of the unit's turn.") : null);
}

// ------------------------------------------------------------------ rendering

interface ItemInfo { visible: boolean; createdUserId?: string; label?: string; name: string; imageUrl?: string }
const itemInfo = (i: Item): ItemInfo => ({
  visible: i.visible, createdUserId: i.createdUserId, name: i.name,
  label: (i as any).text?.plainText || undefined, imageUrl: (i as any).image?.url,
});

function header(info: ItemInfo, sheet: UnitSheet | undefined, state: UnitState, access: CardAccess): Child {
  const viewer = { id: me.id, role };
  const img = portraitUrl(info, state);
  const name = shownName(access, viewer, info, sheet, state);
  const conds = sheet ? displayConditions(roomSystem(), sheet, state) : [];
  return h("div", { className: "panel card-head" },
    h("div", { className: "row", style: "flex-wrap:nowrap;align-items:flex-start" },
      img ? h("img", { className: "portrait", src: img, alt: "" }) : h("div", { className: "portrait empty" }, "?"),
      h("div", { className: "grow" },
        h("h1", {}, name),
        access === "full" && sheet ? h("div", { className: "small muted" }, typeLine(sheet)) : null,
        role === "GM" && state.alias?.trim() ? h("div", { className: "small warn" }, `Players see: ${state.alias.trim()}`) : null,
        role === "GM" && !info.visible ? h("div", { className: "small warn" }, "Hidden from players") : null)),
    conds.length ? h("div", { className: "conds" }, ...conds.map((c) =>
      h("span", { className: `cond${c.automatic ? " auto" : ""}`, title: c.detail ?? "" }, c.label, c.level ? ` ${c.level}` : "", c.detail ? ` (${c.detail})` : ""))) : null);
}

function statsBar(sheet: UnitSheet, state: UnitState): Child {
  const init = initiativeRoll(sheet, roomSystem().rules, state);
  const max = maxHp(sheet, state);
  return h("div", { className: "statbar" },
    h("div", { className: "stat" }, h("span", { className: "k" }, "AC"), h("span", { className: "v" }, String(sheet.ac)), sheet.acNote ? h("span", { className: "small muted" }, sheet.acNote) : null),
    h("div", { className: "stat" }, h("span", { className: "k" }, "HP"),
      h("span", { className: `v${state.hp * 2 <= max ? " low" : ""}` }, `${state.hp}/${max}`),
      state.tempHp ? h("span", { className: "small ok" }, `+${state.tempHp} temp`) : sheet.hp.formula ? h("span", { className: "small muted" }, sheet.hp.formula) : null,
      gmHpBox()),
    h("div", { className: "stat" }, h("span", { className: "k" }, "Initiative"),
      h("button", { className: "chip chip-check big", title: `${init.formula}${init.mode ? ` (${init.mode})` : ""}`, onclick: rollStandard(init) },
        fmtMod(init.bonus), init.mode === "advantage" ? " adv" : init.mode === "disadvantage" ? " dis" : ""),
      state.initiative !== null ? h("span", { className: "small muted" }, `rolled ${state.initiative}`) : null),
    h("div", { className: "stat wide" }, h("span", { className: "k" }, "Speed"), h("span", { className: "small" }, speedLine(sheet)),
      speedPenalty(roomSystem(), state) ? h("span", { className: "small warn" }, `−${speedPenalty(roomSystem(), state)} ft (exhaustion)`) : null));
}

function rollControls(): Child {
  const modeBtn = (m: RollMode, label: string) => h("button", { className: nextMode === m ? "on" : "", onclick: () => { nextMode = m; render(); } }, label);
  return h("div", { className: "panel rollbar" },
    h("div", { className: "seg" }, modeBtn("normal", "Normal"), modeBtn("advantage", "Advantage"), modeBtn("disadvantage", "Disadvantage")),
    h("div", { className: "seg" },
      h("button", { className: visibility === "public" ? "on" : "", onclick: () => setVisibility("public") }, "Public"),
      h("button", { className: visibility === "private" ? "on" : "", title: role === "GM" ? "Only you see it" : "Only you and the GM see it", onclick: () => setVisibility("private") },
        role === "GM" ? "Private (only me)" : "Private (me + GM)")));
}

function setVisibility(v: RollVisibility) {
  visibility = v;
  store.set("butler.rollVisibility", v);
  render();
}

function abilities(sheet: UnitSheet): Child {
  return h("div", { className: "abilities" }, ...abilityRows(sheet).map((a) =>
    h("div", { className: "ab" },
      h("div", { className: "k" }, a.short),
      h("button", { className: "chip chip-check", title: `${a.check.label}: ${a.check.formula}`, onclick: rollStandard(a.check) }, fmtMod(a.mod)),
      h("div", { className: "small muted" }, String(a.score)),
      h("button", { className: `chip chip-save small${a.proficientSave ? " prof" : ""}`, title: `${a.save.label}: ${a.save.formula}`, onclick: rollStandard(a.save) }, `save ${fmtMod(a.save.bonus)}`))));
}

function infoLines(sheet: UnitSheet): Child {
  const d = sheet.defenses;
  const lines: [string, string | undefined][] = [
    ["Vulnerabilities", d.vulnerable], ["Resistances", d.resist], ["Immunities", d.immune], ["Condition immunities", d.conditionImmune],
    ["Senses", [sheet.senses, sheet.passivePerception !== undefined ? `Passive Perception ${sheet.passivePerception}` : ""].filter(Boolean).join("; ") || undefined],
    ["Languages", sheet.languages], ["Challenge", challengeLine(sheet)],
  ];
  const skills = skillRolls(sheet);
  return h("div", { className: "panel stack tight" },
    skills.length ? h("div", { className: "row" }, h("strong", { className: "small" }, "Skills"), ...skills.map((s) =>
      h("button", { className: "chip chip-check", title: s.formula, onclick: rollStandard(s) }, `${s.label.replace(/ check$/, "")} ${fmtMod(s.bonus)}`))) : null,
    ...lines.filter(([, v]) => v).map(([k, v]) => h("div", { className: "small" }, h("strong", {}, `${k} `), v!)));
}

function sections(sheet: UnitSheet, state: UnitState): Child[] {
  const uses = sheetUses(sheet, { inLair: state.inLair });
  return SECTIONS.filter(([key]) => (sheet[key] ?? []).length).map(([key, title]) =>
    h("details", { className: "panel section", open: !closed.has(key), ontoggle: (e: Event) => { (e.target as HTMLDetailsElement).open ? closed.delete(key) : closed.add(key); } },
      h("summary", {}, `${title} (${sheet[key]!.length})${key === "lair" ? state.inLair ? " · initiative 20" : " · not in its lair" : ""}`),
      ...sheet[key]!.map((entry) => h("p", { className: "entry-text" }, h("strong", {}, `${entry.name}.`), ...entryUses(key, entry, uses, state), " ", ...entryText(entry, true), spellUses(entry, uses, state)))));
}

function lastRoll(): Child {
  if (!last) return null;
  const m = last.msg;
  const nat20 = m.natural === 20;
  const critHint = last.attackNatural === 20;
  return h("div", { className: `panel lastroll${nat20 ? " nat20" : m.natural === 1 ? " nat1" : ""}` },
    h("div", { className: "row between" },
      h("span", {}, h("strong", {}, m.label), m.crit ? " (critical)" : "", m.visibility === "private" ? h("span", { className: "small muted" }, " · private") : null),
      h("button", { className: "icon", title: "Close", onclick: () => { last = null; render(); } }, "✕")),
    h("div", { className: "row" }, h("span", { className: "total" }, String(m.total)),
      nat20 ? h("span", { className: "badge" }, "NATURAL 20") : m.natural === 1 ? h("span", { className: "badge bad-bg" }, "natural 1") : null,
      h("span", { className: "small muted" }, rollDetail(m))),
    last.note ? h("div", { className: "small ok" }, last.note) : null,
    last.damage.length ? h("div", { className: "row", style: "margin-top:6px" },
      ...last.damage.flatMap((d) => [
        h("button", { className: critHint ? "secondary" : "", onclick: (ev: MouseEvent) => void roll(d.formula, rollLabel(last!.entry ?? "", d), "damage", ev, { followUp: true }) },
          `Damage ${d.display}${d.damageType ? ` ${d.damageType}` : ""}`),
        h("button", { className: critHint ? "" : "secondary", title: "Critical hit: damage dice doubled", onclick: (ev: MouseEvent) => void roll(d.formula, rollLabel(last!.entry ?? "", d), "damage", ev, { crit: true, followUp: true }) },
          "Crit"),
      ])) : null);
}

function rollLog(): Child {
  const mine = item ? log.filter((m) => m.unit?.id === item!.id) : [];
  return h("details", { className: "panel" },
    h("summary", {}, `Roll log (${log.length})`),
    log.length ? h("ul", { className: "plain small log" }, ...log.slice(0, 25).map((m) =>
      h("li", { className: mine.includes(m) ? "" : "muted" },
        h("strong", {}, String(m.total)), ` ${m.unit?.name ?? m.by.name} · ${m.label}${m.crit ? " (crit)" : ""}`,
        m.natural === 20 ? " · nat 20" : m.natural === 1 ? " · nat 1" : "", m.visibility === "private" ? " · private" : "",
        h("span", { className: "muted" }, ` (${m.by.name})`))))
      : h("div", { className: "small muted" }, "No rolls yet this session."));
}

function editPanel(info: ItemInfo, state: UnitState): Child {
  if (role !== "GM") return null;
  const name = h("input", { type: "text", value: unitName(info, undefined, state) }) as HTMLInputElement;
  const alias = h("input", { type: "text", value: state.alias ?? "", placeholder: "e.g. Hooded figure (empty: real name)" }) as HTMLInputElement;
  const portrait = h("input", { type: "text", value: state.portraitUrl ?? "", placeholder: "https://… (empty: token image)" }) as HTMLInputElement;
  // One entry per player: the same account connected twice appears twice in the party list.
  const known = [...new Map(players.filter((p) => p.role === "PLAYER").map((p) => [p.id, p])).values()];
  const ctrl = h("select", {},
    h("option", { value: "", selected: !state.controlledBy }, "Nobody (GM)"),
    ...known.map((p) => h("option", { value: p.id, selected: p.id === state.controlledBy }, p.name)),
    state.controlledBy && !known.some((p) => p.id === state.controlledBy) ? h("option", { value: state.controlledBy, selected: true }, "A player who isn't connected") : null) as HTMLSelectElement;
  return h("details", { className: "panel", open: editOpen, ontoggle: (e: Event) => { editOpen = (e.target as HTMLDetailsElement).open; } },
    h("summary", {}, "Edit unit (GM)"),
    h("div", { className: "grid2", style: "margin-top:8px" },
      h("label", { className: "span2" }, "Name (token label)", name),
      h("label", { className: "span2" }, "Alias players see until revealed", alias),
      h("label", { className: "span2" }, "Portrait URL", h("div", { className: "row", style: "flex-wrap:nowrap" }, portrait,
        h("button", { className: "secondary", title: "Pick an image from your Owlbear library", onclick: async () => {
          try {
            const [img] = await OBR.assets.downloadImages(false, undefined, "CHARACTER");
            if (img) portrait.value = img.image.url;
          } catch (e) { error = e instanceof Error ? e.message : String(e); render(); }
        } }, "Library"))),
      h("label", { className: "span2" }, "Controlled by", ctrl)),
    h("div", { className: "row", style: "margin-top:8px" },
      h("button", { onclick: () => void saveEdits(name.value, alias.value, portrait.value, ctrl.value) }, "Save"),
      state.alias ? h("button", { className: "secondary", onclick: () => void saveEdits(name.value, "", portrait.value, ctrl.value) }, "Reveal (clear alias)") : null,
      h("button", { className: "secondary", title: "Keep a copy of this unit's stat block and picture in your collection (this browser)", onclick: () => void saveTokenToCollection() }, "Save to collection")));
}

async function saveTokenToCollection() {
  const u = item && readUnit(item.metadata);
  if (!item || !u) return;
  try {
    const img = (item as any).image as { url: string; width: number; height: number; mime: string } | undefined;
    await saveToCollection([u.sheet], img ? { url: img.url, width: img.width, height: img.height, mime: img.mime } : null, `token ${unitName(itemInfo(item), u.sheet, u.state)}`);
    await OBR.notification.show(`Saved ${u.sheet.name} to your collection.`, "SUCCESS");
  } catch (e) { showErr(e); }
}

async function saveEdits(name: string, alias: string, portrait: string, controller: string) {
  try {
    const p = portrait.trim();
    if (p && !/^https:\/\//i.test(p)) throw new Error("Portrait must be an https:// link that players' browsers can load.");
    await OBR.scene.items.updateItems([itemId], (ds) => {
      for (const d of ds as any[]) {
        // The token label shows the alias while one is set (players see the map); the real name stays as the item name.
        const n = name.trim() || d.name;
        d.name = n;
        if (d.text) d.text.plainText = alias.trim() || n;
        const cur = (d.metadata[STATE_KEY] ?? {}) as Record<string, unknown>;
        const next: Record<string, unknown> = { ...cur };
        for (const [k, v] of [["alias", alias.trim()], ["portraitUrl", p], ["controlledBy", controller]] as const) {
          if (v) next[k] = v; else delete next[k];
        }
        d.metadata[STATE_KEY] = next;
      }
    });
    error = "";
    await OBR.notification.show("Unit updated.", "SUCCESS");
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    render();
  }
}

function render() {
  const scrollY = window.scrollY;
  const focused = document.activeElement as HTMLElement | null;
  // Don't wipe a field someone is typing in; render once it loses focus.
  if (focused && /^(INPUT|SELECT|TEXTAREA)$/.test(focused.tagName) && (focused as HTMLInputElement).type !== "checkbox") { renderPending = true; return; }
  const nodes: Child[] = [];
  const u = item ? readUnit(item.metadata) : null;
  if (!item || !u) {
    nodes.push(h("div", { className: "panel warn" }, item ? "This token isn't an Encounter Butler unit." : "This token is no longer in the scene."));
  } else {
    const info = itemInfo(item);
    const access = cardAccess({ id: me.id, role }, info, u.state);
    if (access === "none") {
      nodes.push(h("div", { className: "panel warn" }, "This token is no longer in the scene."));
    } else {
      nodes.push(header(info, u.sheet, u.state, access));
      if (access === "full") {
        
        nodes.push(statsBar(u.sheet, u.state), wildShapePanel(u.state), zeroHpPanel(u.state), concentrationPanel(u.sheet, u.state), conditionsPanel(u.state), usesPanel(u.sheet, u.state), rollControls(), abilities(u.sheet), infoLines(u.sheet), ...sections(u.sheet, u.state), editPanel(info, u.state));
        if (u.sheet.flags.length && role === "GM") nodes.push(h("details", { className: "panel small" }, h("summary", {}, `Notes (${u.sheet.flags.length})`), h("ul", { className: "plain" }, ...u.sheet.flags.map((f) => h("li", {}, f)))));
      } else {
        nodes.push(h("div", { className: "panel small muted" }, "You can see this unit's name and conditions. Its stats belong to the GM (or another player)."));
      }
    }
  }
  if (error) nodes.push(h("div", { className: "panel bad" }, error));
  nodes.push(rollLog());
  // Last: sticks to the bottom of the popover while the stat block scrolls above it.
  nodes.push(lastRoll());
  app.replaceChildren(...nodes.filter((n): n is Node | string => !!n));
  window.scrollTo(0, scrollY);
}

OBR.onReady(async () => {
  const [r, name] = await Promise.all([OBR.player.getRole(), OBR.player.getName()]);
  role = r;
  me = { id: OBR.player.id, name };
  await initRoomSettings();
  onRoomSettings(() => render());
  [item = null] = await OBR.scene.items.getItems([itemId]);
  log = readRollLog();
  if (role === "GM") {
    players = await OBR.party.getPlayers();
    OBR.party.onChange((ps) => { players = ps; render(); });
  }
  await refreshSceneUnits();
  render();
  onRollLog((l) => { log = l; render(); });
  OBR.scene.items.onChange(async (items) => { item = items.find((i) => i.id === itemId) ?? null; await refreshSceneUnits(); render(); });
  OBR.scene.onMetadataChange(async () => { await refreshSceneUnits(); render(); });
});
