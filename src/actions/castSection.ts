/**
 * Action bar → Cast: for an entry with an attack roll, a saving throw or damage (a spell, a breath weapon, a sword),
 * pick the targets (each listed with its distance and whether it's in range, or everyone in a placed area for it),
 * then Cast: attack rolls against each target's AC and damage for each hit; or the damage rolled once and each
 * target's saving throw (creatures' saves by the GM's client, privately; party members roll their own); or damage
 * that just hits. The results go to the GM's Tracker to apply (see core/cast.ts, background/casts.ts).
 */
import OBR, { type Item } from "@owlbear-rodeo/sdk";
import type { ActionItem } from "../core/actions";
import { readAoe } from "../core/aoe";
import { combineModes, editionText, unitName } from "../core/card";
import { attackOutcome, castPlan, type CastRecord, type CastTarget } from "../core/cast";
import { d20Penalty } from "../core/conditions";
import { cryptoRng, fmtMod } from "../core/dice";
import { bandFor, gridFeet, type Measurement, type Reach } from "../core/reach";
import { makeRoll, ROLL_CHANNEL, rollDestination, type RollVisibility } from "../core/rolls";
import type { RollMode } from "../core/schema";
import { ABILITY_NAMES, SHEET_KEY } from "../core/sheet";
import { readUnit } from "../core/unit";
import { placedAreas, unitsInArea } from "../extension/aoeItems";
import { h, type Child } from "../extension/dom";
import { sendRequest } from "../extension/requests";
import { roomSystem } from "../extension/roomSettings";

export interface CastCtx {
  item: Item;
  items: Item[];
  role: "GM" | "PLAYER";
  me: { id: string; name: string };
  visibility: RollVisibility;
  reach: Reach | null;
  render: () => void;
  setNote: (s: string) => void;
  /** Shrinks the action bar to its Cast strip, to see the range on the map (and back). */
  aim?: (on: boolean) => void;
}

interface Candidate { id: string; name: string; feet: number; band: string | null; long: boolean; ac: number; party: boolean }
let cache: { key: string; sig: string; list: Candidate[] } | null = null;
let computing = "";
const picked = new Set<string>();
let pickedFor = "";
/** The last cast's result, shown in the strip (the full panel's note is hidden while aiming). */
let stripNote = "";

const shownName = (i: Item, role: "GM" | "PLAYER") => {
  const u = readUnit(i.metadata)!;
  return role === "PLAYER" && u.state.alias?.trim() ? u.state.alias.trim() : unitName({ name: i.name, label: (i as any).text?.plainText || undefined }, u.sheet, u.state);
};

async function computeTargets(ctx: CastCtx, it: ActionItem, sig: string) {
  const [dpi, scale, measurement] = await Promise.all([OBR.scene.grid.getDpi(), OBR.scene.grid.getScale(), OBR.scene.grid.getMeasurement().catch(() => "CHEBYSHEV")]);
  const fpc = scale.parsed?.multiplier || 5;
  const me = await OBR.scene.items.getItemBounds([ctx.item.id]);
  const list: Candidate[] = [];
  for (const i of ctx.items) {
    if (i.id === ctx.item.id || !(SHEET_KEY in i.metadata) || i.layer !== "CHARACTER" || (ctx.role === "PLAYER" && !i.visible)) continue;
    const u = readUnit(i.metadata);
    if (!u || u.state.conditions.some((c) => c.key === "dead")) continue;
    const b = await OBR.scene.items.getItemBounds([i.id]).catch(() => null);
    if (!b) continue;
    const feet = gridFeet(me, b, dpi, fpc, measurement as Measurement);
    const band = ctx.reach ? bandFor(ctx.reach, feet) : null;
    list.push({ id: i.id, name: shownName(i, ctx.role), feet, band: band?.label ?? null, long: band?.kind === "long", ac: u.sheet.ac, party: u.state.party });
  }
  list.sort((a, b) => a.feet - b.feet);
  cache = { key: it.key, sig, list };
  computing = "";
  ctx.render();
}

/** Everyone in a placed area named for this entry (the action bar's "Place on the map" names it). */
async function pickArea(ctx: CastCtx, it: ActionItem) {
  const areas = (await placedAreas(ctx.items)).areas.filter((a) => (readAoe(a.item.metadata)?.label ?? "").startsWith(it.name));
  if (!areas.length) { ctx.setNote(`No area for ${it.name} on the map: place it first (◎ Place … on the map).`); ctx.render(); return; }
  const dpi = await OBR.scene.grid.getDpi();
  const units = ctx.items.filter((i) => SHEET_KEY in i.metadata && i.layer === "CHARACTER");
  const ids = await unitsInArea(areas.at(-1)!, units, dpi);
  picked.clear();
  for (const id of ids) if (id !== ctx.item.id && cache?.list.some((c) => c.id === id)) picked.add(id);
  ctx.render();
}

async function cast(ctx: CastCtx, it: ActionItem, ev: MouseEvent) {
  const u = readUnit(ctx.item.metadata);
  const plan = castPlan(editionText(it.text, roomSystem().rules));
  if (!u || !plan) return;
  const targets = (cache?.list ?? []).filter((c) => picked.has(c.id));
  if (!targets.length) { ctx.setNote("Pick at least one target."); ctx.render(); return; }
  const by = { id: ctx.me.id, name: ctx.me.name, role: ctx.role };
  const casterName = ctx.visibility === "public" && u.state.alias?.trim() ? u.state.alias.trim() : unitName({ name: ctx.item.name }, u.sheet, u.state);
  const unit = { id: ctx.item.id, name: casterName };
  const roll = async (formula: string, label: string, kind: "attack" | "damage", mode?: RollMode, crit?: boolean) => {
    const msg = makeRoll(formula, label, by, ctx.visibility, { rng: cryptoRng, unit, kind, mode, crit });
    await OBR.broadcast.sendMessage(ROLL_CHANNEL, msg, { destination: rollDestination(msg) });
    return msg;
  };
  const rollDamage = async (crit = false, against?: string) => {
    const out: { amount: number; type?: string }[] = [];
    for (const d of plan.damage) out.push({ amount: (await roll(d.formula, `${it.name} · ${d.type ?? ""} damage${against ? ` vs ${against}` : ""}`.replace(/\s+/g, " "), "damage", undefined, crit)).total, ...(d.type ? { type: d.type } : {}) });
    return out;
  };
  const clicked: RollMode = ev.shiftKey ? "advantage" : ev.ctrlKey || ev.metaKey ? "disadvantage" : "normal";
  const rec: CastRecord = {
    id: globalThis.crypto.randomUUID(), at: new Date().toISOString(), caster: unit, spell: it.name, kind: plan.kind, half: plan.half,
    ...(plan.dc !== undefined ? { dc: plan.dc } : {}), ...(plan.ability ? { ability: plan.ability } : {}), targets: [],
  };
  const lines: string[] = [];
  if (plan.kind === "attack") {
    const penalty = d20Penalty(roomSystem(), u.state);
    for (const t of targets) {
      // Long range: Disadvantage.
      const mode = combineModes(clicked, t.long ? "disadvantage" : undefined);
      const atk = await roll(`1d20${fmtMod((plan.bonus ?? 0) + penalty)}`, `${it.name} · attack vs ${t.name}`, "attack", mode);
      const outcome = attackOutcome(atk.total, atk.natural, t.ac);
      const target: CastTarget = { id: t.id, name: t.name, party: t.party, outcome, roll: atk.total, damage: 0 };
      if (outcome !== "miss" && plan.damage.length) target.rolled = await rollDamage(outcome === "crit", t.name);
      rec.targets.push(target);
      lines.push(`${t.name}: ${outcome === "crit" ? "critical hit" : outcome}${target.rolled ? ` (${target.rolled.reduce((s, p) => s + p.amount, 0)} damage)` : ""}`);
    }
  } else {
    if (plan.damage.length) rec.rolled = await rollDamage();
    for (const t of targets) rec.targets.push({ id: t.id, name: t.name, party: t.party, outcome: plan.kind === "save" ? "awaiting-save" : "auto", damage: 0 });
    const total = rec.rolled?.reduce((s, p) => s + p.amount, 0);
    lines.push(plan.kind === "save"
      ? `${targets.length} target${targets.length === 1 ? "" : "s"} make a DC ${plan.dc} ${ABILITY_NAMES[plan.ability ?? "dex"]} save${total !== undefined ? ` (${total} damage, ${plan.half ? "half" : "none"} on a success)` : ""}: party members roll their own, the GM's Butler rolls the rest`
      : `${total} damage to ${targets.map((t) => t.name).join(", ")}`);
  }
  await sendRequest({ type: "cast", unitId: ctx.item.id, record: rec }, ctx.role);
  ctx.setNote(`${it.name}: ${lines.join("; ")}. The GM applies the damage from the Tracker.`);
  stripNote = `${it.name}: ${lines.join("; ")}.`;
  picked.clear();
  ctx.render();
}

/** The Cast section of an entry's detail, or nothing if casting it at targets means nothing. */
export function castSection(ctx: CastCtx, it: ActionItem): Child {
  if (it.category === "common") return null;
  const plan = castPlan(editionText(it.text, roomSystem().rules));
  if (!plan) return null;
  if (pickedFor !== it.key) { picked.clear(); pickedFor = it.key; }
  const sig = `${it.key}|${ctx.items.filter((i) => SHEET_KEY in i.metadata).map((i) => `${i.id}:${Math.round(i.position.x)},${Math.round(i.position.y)}:${i.visible ? 1 : 0}`).join(";")}`;
  if ((cache?.sig !== sig) && computing !== sig) { computing = sig; void computeTargets(ctx, it, sig).catch(() => { computing = ""; }); }
  const list = cache?.key === it.key ? cache.list : [];
  const what = plan.kind === "attack" ? `Attack roll +${plan.bonus} against each target's AC, damage on a hit`
    : plan.kind === "save" ? `DC ${plan.dc} ${ABILITY_NAMES[plan.ability ?? "dex"]} save for each target${plan.damage.length ? `, damage rolled once (${plan.half ? "half" : "none"} on a success)` : ""}`
      : "Damage to each target";
  const isSpell = it.category === "spell";
  return h("div", { className: "panel tight small stack tight" },
    h("div", {}, h("strong", {}, isSpell ? "Cast it" : "Use it"), ` · ${what}`),
    list.length ? h("div", { className: "row wrap" },
      h("button", { className: "secondary small", onclick: () => { picked.clear(); for (const c of list) if (c.band) picked.add(c.id); ctx.render(); } }, "Everyone in range"),
      h("button", { className: "secondary small", title: "Everyone in the area you placed for it", onclick: () => void pickArea(ctx, it) }, "Everyone in its area"),
      picked.size ? h("button", { className: "secondary small", onclick: () => { picked.clear(); ctx.render(); } }, "Clear") : null) : null,
    list.length
      ? h("div", { className: "dm-list", style: "max-height:160px; overflow:auto" }, ...list.map((c) => h("label", { className: "dm-item" },
        h("span", { className: "row" }, h("input", { type: "checkbox", checked: picked.has(c.id), onchange: () => { if (picked.has(c.id)) picked.delete(c.id); else picked.add(c.id); ctx.render(); } }),
          c.name, c.party ? h("span", { className: "muted" }, " party") : null),
        h("span", { className: c.band ? (c.long ? "warn" : "ok") : "muted" }, `${c.feet} ft · ${c.band ? (c.long ? "long range: Disadvantage" : "in range") : ctx.reach ? "out of range" : "range unknown"}`))))
      : h("div", { className: "muted" }, "Reading who's on the map…"),
    h("div", { className: "row" },
      ctx.aim ? h("button", { className: "secondary", title: "Shrink this window to a strip with the targets and Cast, so you can see the range on the map", onclick: () => ctx.aim!(true) }, "◎ Aim on the map") : null,
      h("button", { disabled: !picked.size, title: plan.kind === "attack" ? "Shift: Advantage · Ctrl/⌘: Disadvantage" : "", onclick: (ev: MouseEvent) => void cast(ctx, it, ev).catch((e) => { ctx.setNote(`Cast failed: ${e instanceof Error ? e.message : String(e)}`); ctx.render(); }) },
        `${isSpell ? "Cast" : "Use"} at ${picked.size || "…"} target${picked.size === 1 ? "" : "s"}`)));
}

/**
 * The Cast strip shown under the shrunk action bar while aiming: the entry, its range, a chip per creature (in range
 * first; tap to target) and Cast. The range stays drawn on the map meanwhile.
 */
export function castStrip(ctx: CastCtx, it: ActionItem): HTMLElement | null {
  if (it.category === "common") return null;
  const plan = castPlan(editionText(it.text, roomSystem().rules));
  if (!plan) return null;
  castSection(ctx, it); // keeps the target list current
  const list = cache?.key === it.key ? cache.list : [];
  const range = ctx.reach ? ctx.reach.bands.map((b) => b.label).join(" · ") : "range unknown";
  const isSpell = it.category === "spell";
  return h("div", { className: "small" },
    h("div", { className: "row between" },
      h("span", {}, h("strong", {}, it.name), ` · ${range}`),
      ctx.aim ? h("button", { className: "secondary small", title: "Back to the full action bar", onclick: () => ctx.aim!(false) }, "▢ Back") : null),
    list.length
      ? h("div", { className: "chips" }, ...list.map((c) => h("button", {
        className: `chip${picked.has(c.id) ? " on" : ""}${c.band ? "" : " out"}`,
        title: `${c.feet} ft · ${c.band ? (c.long ? "long range: Disadvantage" : "in range") : "out of range"}`,
        onclick: () => { if (picked.has(c.id)) picked.delete(c.id); else picked.add(c.id); ctx.render(); },
      }, `${c.name} ${c.feet}ft${c.long ? " (dis)" : ""}`)))
      : h("div", { className: "muted" }, "Reading who's on the map…"),
    stripNote ? h("div", { className: "ok" }, stripNote) : null,
    h("div", { className: "row" },
      h("button", { className: "secondary small", onclick: () => { picked.clear(); stripNote = ""; for (const c of list) if (c.band) picked.add(c.id); ctx.render(); } }, "Everyone in range"),
      h("button", { className: "small", disabled: !picked.size, title: plan.kind === "attack" ? "Shift: Advantage · Ctrl/⌘: Disadvantage" : "",
        onclick: (ev: MouseEvent) => void cast(ctx, it, ev).catch((e) => { ctx.setNote(`Cast failed: ${e instanceof Error ? e.message : String(e)}`); ctx.render(); }) },
        `${isSpell ? "Cast" : "Use"} at ${picked.size || "…"}`)));
}
