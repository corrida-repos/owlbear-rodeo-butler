/**
 * DM Tools → Mass combat (UA 2017, playtest): build units (from selected tokens, the 5etools search or by hand), put
 * each on a 100 ft square, then run the battle: fixed initiative, the five actions, morale checks, removals,
 * characters fighting from inside units, casualties from spells, and critical events. Rules: core/massCombat.ts;
 * scene operations: battleOps.ts.
 */
import OBR, { buildImage } from "@owlbear-rodeo/sdk";
import { SIZE_NAMES } from "../core/constants";
import { convertMonster } from "../core/fivetools";
import type { ResolvedImage } from "../core/importer";
import {
  adjacent, BATTLE_UNIT_KEY, cellDistance, crLabel, MORALE_FACTORS, MORALE_LABELS, MORALE_ROWS, memberFromSheet, membersFromSheets, moraleFromFactors,
  notRanged, sideStrength, squaresAllowed, unitBrNow, unitInitiativeOf, unitMakeup, unitMoraleOf, unitSpeed, unitSummary, unitWarnings, fmtBonus,
  type BattleUnit, type CriticalEvent, type Member, type MemberRole, type MoraleFactors, type RollMode,
} from "../core/massCombat";
import { targetsInArea, type AreaShape } from "../core/mob";
import { CR_STEPS, crValue } from "../core/search";
import { abilityMod } from "../core/sheet";
import type { TrackerUnit } from "../core/tracker";
import { readUnit } from "../core/unit";
import {
  attack, attackPreview, beginBattle, casualties, disengage, endBattle, orderOf, patchUnits, readField, removeByHand, restore, saveBattle,
  simpleAction, stepTurn, writeUnit, type Field, type FieldEntry,
} from "./battleOps";
import { fivetoolsImage, getLib } from "./bestiary";
import { action, h, rerender, type Child } from "./dom";
import { createSearchBox } from "./roster";

let field: Field | null = null;
let players: { id: string; name: string }[] = [];

/** Re-reads the battle from the scene (the DM Tools tab calls it on every scene change). */
export async function refreshBattle() {
  try {
    field = await readField();
    players = (await OBR.party.getPlayers()).filter((p) => p.role === "PLAYER").map((p) => ({ id: p.id, name: p.name }));
  } catch { field = null; }
}

// ------------------------------------------------------------------ the unit being built

interface Draft {
  editing: string | null;
  name: string;
  side: string;
  members: Member[];
  commander: BattleUnit["commander"];
  moraleMode: "factors" | "pick";
  factors: MoraleFactors;
  pick: number;
  image: ResolvedImage | null;
}
const blankDraft = (): Draft => ({ editing: null, name: "", side: "", members: [], commander: { name: "Commander", cr: 1, cha: 0 }, moraleMode: "factors", factors: {}, pick: 0, image: null });
let draft = blankDraft();
let note = "";

const draftUnit = (prev?: BattleUnit): BattleUnit => ({
  v: 1, name: draft.name.trim() || `${draft.members[0]?.name ?? "New"} unit`, side: draft.side.trim() || "Side A",
  members: draft.members, commander: draft.commander,
  moraleBase: draft.moraleMode === "factors" ? moraleFromFactors(draft.factors) : draft.pick,
  factors: draft.moraleMode === "factors" ? draft.factors : undefined,
  startBr: prev?.startBr ?? null, brLost: prev?.brLost ?? 0, halfChecked: prev?.halfChecked ?? false, removed: prev?.removed ?? null,
  defendUntil: prev?.defendUntil, shakenRound: prev?.shakenRound, guardRound: prev?.guardRound,
  characters: prev?.characters ?? [], commandedBy: prev?.commandedBy, tie: prev?.tie ?? Math.random(),
});

const placeholder = (): ResolvedImage => ({ url: new URL("tokens/party-placeholder.png", location.href).toString(), width: 256, height: 256, mime: "image/png" });

let search: ReturnType<typeof createSearchBox> | null = null;
function searchBox() {
  if (search) return search.el;
  search = createSearchBox("Add a creature from 5etools (e.g. orc, knight)…", async (r) => {
    const L = await getLib();
    const ft = await L.prepare(r.name, r.source);
    const sheet = convertMonster(ft.monster, { catalogEntry: ft.catalogEntry, copyChain: ft.copyChain, copyNotes: ft.copyNotes });
    draft.members.push(memberFromSheet(sheet, 10));
    if (!draft.image) void fivetoolsImage(ft.monster).then((img) => { if (!draft.image && img.image) { draft.image = img.image; rerender(); } });
    rerender();
  });
  search.refresh(); // once: it loads the creature index (refreshing on every render would loop if that fails)
  return search.el;
}

/** Fills the draft from the selected Butler tokens: their creatures grouped, the highest CR as commander. */
async function fromSelection() {
  const sel = (await OBR.player.getSelection()) ?? [];
  const items = await OBR.scene.items.getItems(sel);
  const sheets = items.flatMap((i) => { const u = readUnit(i.metadata); return u ? [u.sheet] : []; });
  if (!sheets.length) throw new Error("Select some creature tokens first (Butler units).");
  const lead = sheets.reduce((a, b) => ((b.cr ?? 0) > (a.cr ?? 0) ? b : a));
  const rest = [...sheets];
  rest.splice(rest.indexOf(lead), 1);
  draft.members = [...draft.members, ...membersFromSheets(rest)];
  draft.commander = { name: lead.name, cr: lead.cr ?? 0, cha: abilityMod(lead.abilities.cha) };
  const img = (items.find((i) => i.id === sel[0]) as any)?.image;
  if (img && !draft.image) draft.image = { url: img.url, width: img.width, height: img.height, mime: img.mime };
  note = `Took ${sheets.length} token${sheets.length === 1 ? "" : "s"}: ${lead.name} leads.`;
}

/** A new token, one grid square across, at the centre of the view. */
async function placeUnit(unit: BattleUnit) {
  const img = draft.image ?? placeholder();
  const [w, hgt] = await Promise.all([OBR.viewport.getWidth(), OBR.viewport.getHeight()]);
  const centre = await OBR.viewport.inverseTransformPoint({ x: w / 2, y: hgt / 2 });
  const pos = await OBR.scene.grid.snapPosition(centre, 1, false, true);
  const item = buildImage({ url: img.url, mime: img.mime, width: img.width, height: img.height }, { dpi: Math.max(img.width, img.height), offset: { x: img.width / 2, y: img.height / 2 } })
    .name(unit.name).position(pos).layer("CHARACTER").plainText(unit.name).textItemType("LABEL")
    .metadata({ [BATTLE_UNIT_KEY]: JSON.parse(JSON.stringify(unit)) }).build();
  await OBR.scene.items.addItems([item]);
}

async function attachToSelection(unit: BattleUnit) {
  const sel = (await OBR.player.getSelection()) ?? [];
  if (sel.length !== 1) throw new Error("Select exactly one token to stand for the unit.");
  await writeUnit(sel[0]!, unit);
}

function memberRow(m: Member, i: number): Child {
  const set = (patch: Partial<Member>) => { draft.members[i] = { ...m, ...patch }; rerender(); };
  const n = (v: string) => Math.max(0, Number(v) || 0);
  return h("div", { className: "row wrap dm-item" },
    h("input", { type: "text", value: m.name, style: "width:9em", onchange: (e: Event) => set({ name: (e.target as HTMLInputElement).value }) }),
    h("label", { className: "small" }, "×", h("input", { type: "number", className: "num", min: 0, value: String(m.count), onchange: (e: Event) => set({ count: Math.floor(n((e.target as HTMLInputElement).value)) }) })),
    h("select", { title: "CR", onchange: (e: Event) => set({ cr: crValue((e.target as HTMLSelectElement).value) ?? 0 }) },
      ...CR_STEPS.map((c) => h("option", { value: c, selected: c === crLabel(m.cr) }, `CR ${c}`))),
    h("select", { title: "Size", onchange: (e: Event) => set({ size: (e.target as HTMLSelectElement).value as Member["size"] }) },
      ...["T", "S", "M", "L", "H", "G"].map((z) => h("option", { value: z, selected: z === m.size }, SIZE_NAMES[z] ?? z))),
    h("label", { className: "small", title: "Walking speed (ft)" }, "walk", h("input", { type: "number", className: "num", value: String(m.speed.walk), onchange: (e: Event) => set({ speed: { ...m.speed, walk: n((e.target as HTMLInputElement).value) } }) })),
    h("label", { className: "small", title: "Flying speed (ft), 0 for none" }, "fly", h("input", { type: "number", className: "num", value: String(m.speed.fly ?? 0), onchange: (e: Event) => set({ speed: { ...m.speed, fly: n((e.target as HTMLInputElement).value) || undefined } }) })),
    h("label", { className: "small", title: "Longest maximum range of an at-will ranged attack (ft), 0 for none" }, "range", h("input", { type: "number", className: "num", value: String(m.rangeFt), onchange: (e: Event) => set({ rangeFt: n((e.target as HTMLInputElement).value) }) })),
    h("select", { title: "Riders move on their mounts; mounts don't need a ranged attack", onchange: (e: Event) => set({ role: (e.target as HTMLSelectElement).value as MemberRole }) },
      ...(["soldier", "rider", "mount"] as const).map((r) => h("option", { value: r, selected: r === m.role }, r))),
    h("button", { className: "icon tiny", title: "Remove", onclick: () => { draft.members.splice(i, 1); rerender(); } }, "✕"));
}

function builder(f: Field, units: TrackerUnit[]): Child {
  const u = draftUnit();
  const warnings = unitWarnings(u);
  const sides = [...new Set(f.units.map((x) => x.unit.side))];
  const blocked = f.gridIssue;
  const prev = draft.editing ? f.units.find((x) => x.id === draft.editing)?.unit : undefined;
  return h("details", { className: "panel", open: !!draft.editing || draft.members.length > 0 }, h("summary", {}, h("strong", {}, draft.editing ? `Edit ${prev?.name ?? "unit"}` : "Build a unit")),
    h("div", { className: "row wrap" },
      h("input", { type: "text", placeholder: "Unit name (e.g. Orc warband)", value: draft.name, onchange: (e: Event) => { draft.name = (e.target as HTMLInputElement).value; rerender(); } }),
      h("input", { type: "text", placeholder: "Side (e.g. Defenders)", value: draft.side, list: "battle-sides", onchange: (e: Event) => { draft.side = (e.target as HTMLInputElement).value; rerender(); } }),
      h("datalist", { id: "battle-sides" }, ...sides.map((s) => h("option", { value: s })))),
    h("div", { className: "row wrap", style: "margin-top:6px" },
      h("button", { className: "secondary small", title: "Group the selected creature tokens into this unit; the highest CR becomes the commander", onclick: action(() => fromSelection()) }, "From selected tokens"),
      h("button", { className: "secondary small", onclick: () => { draft.members.push({ name: "Soldier", cr: 1 / 8, size: "M", speed: { walk: 30 }, rangeFt: 0, count: 20, role: "soldier" }); rerender(); } }, "Add a creature by hand")),
    h("div", { style: "margin-top:6px" }, searchBox()),
    draft.members.length ? h("div", { className: "dm-list" }, ...draft.members.map(memberRow)) : null,
    h("div", { className: "row wrap", style: "margin-top:6px" }, h("strong", { className: "small" }, "Commander"),
      h("input", { type: "text", value: draft.commander.name, style: "width:9em", onchange: (e: Event) => { draft.commander = { ...draft.commander, name: (e.target as HTMLInputElement).value }; rerender(); } }),
      h("select", { title: "Commander's CR (for a PC or NPC, the GM's estimate)", onchange: (e: Event) => { draft.commander = { ...draft.commander, cr: crValue((e.target as HTMLSelectElement).value) ?? 0 }; rerender(); } },
        ...CR_STEPS.map((c) => h("option", { value: c, selected: c === crLabel(draft.commander.cr) }, `CR ${c}`))),
      h("label", { className: "small" }, "Cha mod ", h("input", { type: "number", className: "num", value: String(draft.commander.cha), onchange: (e: Event) => { draft.commander = { ...draft.commander, cha: Number((e.target as HTMLInputElement).value) || 0 }; rerender(); } }))),
    h("div", { className: "row wrap", style: "margin-top:6px" }, h("strong", { className: "small" }, "Morale"),
      h("label", { className: "small" }, h("input", { type: "radio", name: "moralemode", checked: draft.moraleMode === "factors", onchange: () => { draft.moraleMode = "factors"; rerender(); } }), "from the factors"),
      h("label", { className: "small" }, h("input", { type: "radio", name: "moralemode", checked: draft.moraleMode === "pick", onchange: () => { draft.moraleMode = "pick"; rerender(); } }), "pick a rating")),
    draft.moraleMode === "factors"
      ? h("div", { className: "stack tight small" }, ...MORALE_FACTORS.map((fct) => h("div", { className: "row" },
        h("select", { onchange: (e: Event) => { draft.factors = { ...draft.factors, [fct.key]: Number((e.target as HTMLSelectElement).value) as -1 | 0 | 1 }; rerender(); } },
          h("option", { value: "0", selected: !draft.factors[fct.key] }, "—"), h("option", { value: "-1", selected: draft.factors[fct.key] === -1 }, `− ${fct.worse}`),
          h("option", { value: "1", selected: draft.factors[fct.key] === 1 }, `+ ${fct.better}`)))))
      : h("select", { onchange: (e: Event) => { draft.pick = Number((e.target as HTMLSelectElement).value); rerender(); } },
        ...MORALE_ROWS.map((r) => h("option", { value: String(r), selected: r === draft.pick }, `${fmtBonus(r)} ${MORALE_LABELS[r]}`))),
    h("div", { className: "small", style: "margin-top:6px" }, h("strong", {}, u.name), ` · ${u.side} · `, unitSummary(u),
      ` (morale ${fmtBonus(u.moraleBase)} ${MORALE_LABELS[u.moraleBase] ?? ""} + Cha ${fmtBonus(u.commander.cha)}; initiative 10 + morale + Cha again, as written)`),
    notRanged(u.members).length && u.members.some((m) => m.rangeFt >= 100) ? h("div", { className: "small muted" }, `Not ranged because of: ${notRanged(u.members).join(", ")}.`) : null,
    ...warnings.map((w) => h("div", { className: "small warn" }, w)),
    blocked ? h("div", { className: "small bad" }, blocked) : null,
    h("div", { className: "row wrap", style: "margin-top:6px" },
      draft.editing
        ? h("button", { className: "small", disabled: !draft.members.length, onclick: action(async () => { await writeUnit(draft.editing!, draftUnit(prev)); draft = blankDraft(); await refreshBattle(); }) }, "Save changes")
        : h("button", { className: "small", disabled: !!blocked || !draft.members.length, title: "A new token, one 100 ft square, at the centre of your view", onclick: action(async () => { await placeUnit(u); draft = blankDraft(); note = "Unit placed."; await refreshBattle(); }) }, "Place on map"),
      draft.editing ? null : h("button", { className: "secondary small", disabled: !!blocked || !draft.members.length, title: "The selected token stands for this unit", onclick: action(async () => { await attachToSelection(u); draft = blankDraft(); note = "Unit set on the selected token."; await refreshBattle(); }) }, "Use the selected token"),
      h("button", { className: "secondary small", onclick: () => { draft = blankDraft(); rerender(); } }, draft.editing ? "Cancel" : "Clear")),
    note ? h("div", { className: "small ok" }, note) : null);
}

function editUnit(e: FieldEntry) {
  const u = e.unit;
  draft = {
    editing: e.id, name: u.name, side: u.side, members: u.members.map((m) => ({ ...m, speed: { ...m.speed } })), commander: { ...u.commander },
    moraleMode: u.factors ? "factors" : "pick", factors: { ...(u.factors ?? {}) }, pick: u.moraleBase, image: null,
  };
  rerender();
}

// ------------------------------------------------------------------ the units on the field

const cas: Record<string, { name: string; n: number; cause: string; shape: AreaShape; size: number }> = {};

function casualtyTool(e: FieldEntry): Child {
  const live = e.unit.members.filter((m) => m.count > 0);
  if (!live.length) return null;
  const c = (cas[e.id] ??= { name: live[0]!.name, n: 1, cause: "", shape: "sphere", size: 20 });
  const present = live.find((m) => m.name === c.name)?.count ?? 0;
  return h("details", { className: "small" }, h("summary", {}, "Casualties from characters or spells"),
    h("div", { className: "row wrap", style: "margin-top:4px" },
      h("select", { onchange: (ev: Event) => { c.name = (ev.target as HTMLSelectElement).value; rerender(); } }, ...live.map((m) => h("option", { value: m.name, selected: m.name === c.name }, `${m.name} (${m.count})`))),
      h("input", { type: "number", className: "num", min: 1, value: String(c.n), onchange: (ev: Event) => { c.n = Math.max(0, Math.floor(Number((ev.target as HTMLInputElement).value) || 0)); } }),
      h("input", { type: "text", placeholder: "cause (fireball, the paladin…)", value: c.cause, onchange: (ev: Event) => { c.cause = (ev.target as HTMLInputElement).value; } }),
      h("button", { className: "small", onclick: action(async () => { await casualties(e.id, c.name, c.n, c.cause); await refreshBattle(); }) }, "Remove them")),
    h("div", { className: "row wrap", style: "margin-top:4px" }, "Area of effect: ",
      h("select", { onchange: (ev: Event) => { c.shape = (ev.target as HTMLSelectElement).value as AreaShape; rerender(); } },
        ...(["sphere", "cube", "cone", "line"] as const).map((s) => h("option", { value: s, selected: s === c.shape }, s))),
      h("input", { type: "number", className: "num", value: String(c.size), onchange: (ev: Event) => { c.size = Number((ev.target as HTMLInputElement).value) || 0; rerender(); } }), "ft → ",
      h("button", { className: "secondary small", title: "DMG Targets in Area of Effect: how many creatures it catches. Roll their saves with the Mob panel, then remove the ones killed.", onclick: () => { c.n = targetsInArea(c.shape, c.size, { present }); rerender(); } },
        `about ${targetsInArea(c.shape, c.size, { present })} caught`)),
    h("div", { className: "muted" }, "Creatures killed, or left unable to move or act, come out of the unit and its BR is recalculated (the half-strength check and BR 0 removal follow)."));
}

function unitRow(e: FieldEntry, f: Field, units: TrackerUnit[]): Child {
  const u = e.unit;
  const active = f.battle.turnId === e.id;
  const party = units.filter((x) => x.party);
  const flags = [u.defendUntil !== undefined ? "defending" : "", u.guardRound !== undefined ? "guarding" : "", u.shakenRound !== undefined ? `shaken (round ${u.shakenRound})` : ""].filter(Boolean);
  return h("div", { className: "dm-item", style: active ? "outline:2px solid var(--accent, #6c5ce7)" : "" },
    h("div", { className: "grow" },
      h("div", {}, h("strong", {}, u.name), u.removed ? h("span", { className: "small bad" }, ` ${u.removed.why} (round ${u.removed.round})`) : null,
        flags.length ? h("span", { className: "small warn" }, ` ${flags.join(", ")}`) : null, e.item.visible ? null : h("span", { className: "small muted" }, " hidden")),
      h("div", { className: "small muted" }, unitSummary(u)),
      h("div", { className: "small muted" }, unitMakeup(u)),
      u.characters.length ? h("div", { className: "small" }, "Characters inside: ", u.characters.map((id) => units.find((x) => x.id === id)?.name ?? "(gone)").join(", ")) : null,
      h("div", { className: "row wrap small", style: "margin-top:4px" },
        h("select", { title: "Attach a party member: they act on the unit's turn and its results don't apply to them", onchange: (ev: Event) => {
          const id = (ev.target as HTMLSelectElement).value;
          if (id) void patchUnits([{ id: e.id, patch: { characters: u.characters.includes(id) ? u.characters.filter((x) => x !== id) : [...u.characters, id] } }]).then(refreshBattle).then(rerender);
        } }, h("option", { value: "" }, "characters…"), ...party.map((p) => h("option", { value: p.id }, `${u.characters.includes(p.id) ? "✓ " : ""}${p.name}`))),
        h("select", { title: "House extension: a player who commands this unit (turn notices; sees its BR if allowed below)", onchange: (ev: Event) => {
          const id = (ev.target as HTMLSelectElement).value;
          void patchUnits([{ id: e.id, patch: { commandedBy: id || undefined } }]).then(refreshBattle).then(rerender);
        } }, h("option", { value: "", selected: !u.commandedBy }, "no player commands it"), ...players.map((p) => h("option", { value: p.id, selected: p.id === u.commandedBy }, `commanded by ${p.name}`))),
        h("button", { className: "secondary small", onclick: () => editUnit(e) }, "Edit"),
        u.removed
          ? h("button", { className: "secondary small", onclick: action(async () => { await restore(e.id); await refreshBattle(); }) }, "Bring back")
          : h("button", { className: "secondary small", title: "Take it off the field (routed, surrendered…)", onclick: action(async () => { await removeByHand(e.id, "leaves the battle"); await refreshBattle(); }) }, "Remove"),
        h("button", { className: "icon tiny", title: "Delete the token", onclick: action(async () => { await OBR.scene.items.deleteItems([e.id]); await refreshBattle(); }) }, "✕")),
      u.removed ? null : casualtyTool(e)));
}

// ------------------------------------------------------------------ the active unit's turn

const atk = { target: "", highGround: false, cover: false, mode: "" as "" | RollMode };

function turnPanel(f: Field, units: TrackerUnit[]): Child {
  const b = f.battle;
  const e = f.units.find((x) => x.id === b.turnId);
  if (!e) return h("div", { className: "small warn" }, "No unit is acting: press Next unit.");
  const u = e.unit;
  const shaken = u.shakenRound === b.round;
  const used = b.turn.action;
  const speed = unitSpeed(u.members);
  const mult = used === "dash" ? 2 : used === "disengage" && b.turn.disengaged ? 0.5 : 1;
  const allowed = used === "disengage" && !b.turn.disengaged ? 0 : squaresAllowed(Math.max(speed.walk, speed.fly ?? 0) * mult, f.scale);
  const start = b.turn.startCell;
  const moved = start ? cellDistance(start, e.cell) : 0;
  const enemies = f.units.filter((x) => !x.unit.removed && x.unit.side !== u.side);
  const startAdj = start ? enemies.some((x) => adjacent(x.cell, start)) : false;
  const warn: string[] = [];
  if (moved > allowed) warn.push(`Moved ${moved} square${moved === 1 ? "" : "s"}; it may move ${allowed} (${Math.max(speed.walk, speed.fly ?? 0) * mult} ft at ${f.scale} ft per square).`);
  if (shaken && moved) warn.push("It's shaken: it can't move this turn.");
  if (startAdj && moved && !b.turn.disengaged) warn.push("It started next to an enemy unit: it can't move away without a successful Disengage.");
  // Guard: an enemy that was guarding and is now next to this unit, which wasn't there at the start of the turn.
  const guards = enemies.filter((x) => x.unit.guardRound !== undefined && adjacent(x.cell, e.cell) && !(start && adjacent(x.cell, start)));
  const targets = enemies.map((t) => ({ t, pv: attackPreview(f, e.id, t.id, { highGround: atk.highGround, cover: atk.cover }) }));
  if (!targets.some((x) => x.t.id === atk.target)) atk.target = targets.find((x) => x.pv?.reach.ok)?.t.id ?? "";
  const chosen = targets.find((x) => x.t.id === atk.target);
  const chars = u.characters.map((id) => units.find((x) => x.id === id)?.name).filter(Boolean);
  const btn = (label: string, run: () => Promise<void>, title = "", off = false) => h("button", { className: "small", disabled: !!used || shaken || off, title, onclick: action(async () => { await run(); await refreshBattle(); }) }, label);

  return h("div", { className: "stack tight", style: "margin-top:6px" },
    h("div", {}, h("strong", {}, `Round ${b.round}: ${u.name}`), h("span", { className: "small muted" }, ` · BR ${unitBrNow(u)} · morale ${fmtBonus(unitMoraleOf(u))} · ${moved}/${allowed} squares`)),
    shaken ? h("div", { className: "small bad" }, "Shaken: it can't move or take actions this turn.") : null,
    chars.length ? h("div", { className: "small" }, `Characters act first: ${chars.join(", ")}. Resolve their attacks and spells with the normal rules, take the creatures they kill off the target with its Casualties tool, then the unit acts.`) : null,
    ...warn.map((w) => h("div", { className: "small warn" }, w)),
    ...guards.map((g) => h("div", { className: "row small" }, h("span", { className: "warn grow" }, `${g.unit.name} was guarding and ${u.name} came next to it.`),
      h("button", { className: "small", onclick: action(async () => { await attack(g.id, e.id, { highGround: false, cover: false }, { guard: true }); await refreshBattle(); }) }, `${g.unit.name} attacks now`))),
    used ? h("div", { className: "small ok" }, `Action used: ${used}${used === "disengage" ? (b.turn.disengaged ? " (may move half its speed)" : " (failed: no move)") : ""}.`) : null,
    h("div", { className: "row wrap" },
      h("select", { onchange: (ev: Event) => { atk.target = (ev.target as HTMLSelectElement).value; rerender(); } },
        ...targets.map(({ t, pv }) => h("option", { value: t.id, selected: t.id === atk.target, disabled: !pv?.reach.ok }, `${t.unit.name}${pv?.reach.ok ? ` (${pv.reach.how})` : ` — ${pv?.reach.why}`}`))),
      h("label", { className: "small" }, h("input", { type: "checkbox", checked: atk.highGround, onchange: () => { atk.highGround = !atk.highGround; rerender(); } }), "higher ground"),
      h("label", { className: "small" }, h("input", { type: "checkbox", checked: atk.cover, onchange: () => { atk.cover = !atk.cover; rerender(); } }), "target behind cover"),
      h("select", { title: "Override", onchange: (ev: Event) => { atk.mode = (ev.target as HTMLSelectElement).value as "" | RollMode; rerender(); } },
        h("option", { value: "", selected: !atk.mode }, `as the rules say (${chosen?.pv?.factors.mode ?? "normal"})`),
        ...(["normal", "advantage", "disadvantage"] as const).map((m) => h("option", { value: m, selected: atk.mode === m }, m))),
      btn("Attack", () => attack(e.id, atk.target, { highGround: atk.highGround, cover: atk.cover, mode: atk.mode || undefined }), chosen?.pv?.reach.ok ? "" : "No enemy unit in reach", !chosen?.pv?.reach.ok)),
    chosen?.pv ? h("div", { className: "small muted" }, [...chosen.pv.factors.adv.map((x) => `Advantage: ${x}`), ...chosen.pv.factors.dis.map((x) => `Disadvantage: ${x}`)].join(" · ") || "No Advantage or Disadvantage.") : null,
    h("div", { className: "row wrap" },
      btn("Dash", () => simpleAction(e.id, "dash"), "Double its speed this turn"),
      btn("Defend", () => simpleAction(e.id, "defend"), "Attacks against it have Disadvantage until the end of its next turn"),
      btn("Disengage", () => disengage(e.id), "DC 10 morale check: move half its speed without stopping next to enemies, or lose the action"),
      btn("Guard", () => simpleAction(e.id, "guard"), "Attack the next enemy unit that moves next to it")));
}

// ------------------------------------------------------------------ critical events

const ev = { text: "", success: "", failure: "" };

function eventsPanel(f: Field): Child {
  const b = f.battle;
  const save = (events: CriticalEvent[], line?: string) => saveBattle({ ...b, events, log: line ? [...b.log, { pub: line }].slice(-40) : b.log });
  return h("details", { className: "small", style: "margin-top:6px" }, h("summary", {}, `Critical events${b.events.length ? ` (${b.events.length})` : ""}`),
    h("div", { className: "muted" }, "Side missions for the characters (hold the bridge, kill the enemy commander…). Their outcome changes the battle: apply it with Edit (morale, creatures), Remove, or the high ground and cover toggles."),
    ...b.events.map((x) => h("div", { className: "dm-item" },
      h("div", { className: "grow" }, h("strong", {}, x.text), h("span", { className: x.status === "success" ? "ok" : x.status === "failure" ? "bad" : "muted" }, ` ${x.status}`),
        h("div", { className: "muted" }, `Success: ${x.success || "—"} · Failure: ${x.failure || "—"}`)),
      h("button", { className: "secondary small", onclick: action(() => save(b.events.map((y) => (y.id === x.id ? { ...y, status: "success" } : y)), `Critical event succeeded: ${x.text}. ${x.success}`)) }, "Succeeded"),
      h("button", { className: "secondary small", onclick: action(() => save(b.events.map((y) => (y.id === x.id ? { ...y, status: "failure" } : y)), `Critical event failed: ${x.text}. ${x.failure}`)) }, "Failed"),
      h("button", { className: "icon tiny", onclick: action(() => save(b.events.filter((y) => y.id !== x.id))) }, "✕"))),
    h("div", { className: "row wrap", style: "margin-top:4px" },
      h("input", { type: "text", placeholder: "Event (e.g. Destroy the siege tower)", value: ev.text, onchange: (e: Event) => { ev.text = (e.target as HTMLInputElement).value; } }),
      h("input", { type: "text", placeholder: "If they succeed…", value: ev.success, onchange: (e: Event) => { ev.success = (e.target as HTMLInputElement).value; } }),
      h("input", { type: "text", placeholder: "If they fail…", value: ev.failure, onchange: (e: Event) => { ev.failure = (e.target as HTMLInputElement).value; } }),
      h("button", { className: "small", onclick: action(async () => {
        if (!ev.text.trim()) return;
        await save([...b.events, { id: globalThis.crypto.randomUUID().slice(0, 8), text: ev.text.trim(), success: ev.success.trim(), failure: ev.failure.trim(), status: "open" }]);
        ev.text = ev.success = ev.failure = "";
      }) }, "Add")));
}

// ------------------------------------------------------------------ the panel

export function battlePanel(units: TrackerUnit[]): Child {
  const f = field;
  if (!f) return h("details", { className: "panel" }, h("summary", {}, h("strong", {}, "Mass combat (UA 2017)")), h("div", { className: "small muted" }, "Reading the scene…"));
  const b = f.battle;
  const order = orderOf(f);
  const sides = sideStrength(f.units);
  const live = new Set(f.units.filter((x) => !x.unit.removed).map((x) => x.unit.side));
  const startWhy = f.gridIssue ?? (live.size < 2 ? "Put units on at least two sides." : "");
  const bySide = [...new Set(f.units.map((x) => x.unit.side))];
  return h("details", { className: "panel", open: b.active || f.units.length > 0 }, h("summary", {}, h("strong", {}, b.active ? `Mass combat (round ${b.round})` : `Mass combat${f.units.length ? ` (${f.units.length} units)` : ""}`)),
    h("div", { className: "small muted" }, "Unearthed Arcana: Mass Combat (2017 playtest). Each token is a unit of up to 400 creatures on a 100 ft square, with a Battle Rating from its creatures' CR. Attacks are opposed d20 + BR rolls; morale decides who breaks. House rule: a unit at BR 0 is removed. Players see the results in words, not the numbers."),
    f.gridIssue ? h("div", { className: "small bad", style: "margin-top:4px" }, `${f.gridIssue} (Scene grid settings in Owlbear.) Run the characters' own skirmishes on another scene: this battle waits here.`) : h("div", { className: "small ok" }, `Grid: ${f.scale} ft per square.`),
    builder(f, units),
    ...bySide.map((s) => h("div", { style: "margin-top:6px" },
      h("div", { className: "small" }, h("strong", {}, s), (() => { const x = sides.find((y) => y.side === s); return x ? ` · ${x.units} fighting, BR ${x.br}${x.removed ? `, ${x.removed} lost` : ""}` : ""; })()),
      h("div", { className: "dm-list" }, ...f.units.filter((x) => x.unit.side === s).sort((a, c) => unitInitiativeOf(c.unit) - unitInitiativeOf(a.unit)).map((x) => unitRow(x, f, units))))),
    h("div", { className: "row wrap", style: "margin-top:6px" },
      ...(b.active
        ? [h("button", { className: "secondary small", onclick: action(async () => { await stepTurn("previous"); await refreshBattle(); }) }, "Previous unit"),
          h("button", { className: "small", onclick: action(async () => { await stepTurn("next"); await refreshBattle(); }) }, "Next unit"),
          h("button", { className: "secondary small", onclick: action(async () => { await endBattle(); await refreshBattle(); }) }, "End battle")]
        : [h("button", { className: "small", disabled: !!startWhy, title: startWhy, onclick: action(async () => { await beginBattle(); await refreshBattle(); }) }, "Start battle")]),
      !b.active && startWhy && f.units.length ? h("span", { className: "small warn" }, startWhy) : null,
      h("label", { className: "small", title: "Off: players see the results in words only (dice totals would reveal BR)" }, h("input", { type: "checkbox", checked: b.publicRolls, onchange: action(() => saveBattle({ ...b, publicRolls: !b.publicRolls })) }), "players see the battle's dice"),
      h("label", { className: "small", title: "House extension: a player who commands a unit sees its BR and morale" }, h("input", { type: "checkbox", checked: b.showCommandedBr, onchange: action(() => saveBattle({ ...b, showCommandedBr: !b.showCommandedBr })) }), "commanders see their unit's BR")),
    b.active ? h("div", { className: "small muted" }, `Order: ${order.map((x) => `${x.unit.name} ${unitInitiativeOf(x.unit)}`).join(" → ")}`) : null,
    b.active ? turnPanel(f, units) : null,
    eventsPanel(f),
    b.log.length ? h("div", { className: "small stack tight", style: "margin-top:6px" }, ...b.log.slice(-15).reverse().map((l) => h("div", {}, "• ", l.gm ? `${l.pub ? `${l.pub} ` : ""}(${l.gm})` : l.pub))) : null);
}

