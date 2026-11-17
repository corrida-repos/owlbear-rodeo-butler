/**
 * DM Tools → Mob rolls (2024 DMG "Mobs"): many identical monsters attack one target or make the same saving throw,
 * resolved with the Mob Results table and average damage instead of rolling each die; plus the Targets in Area of
 * Effect estimate for fights without a map.
 */
import { attackProfile } from "../core/actions";
import { damageAgainst, hitAgainst } from "../core/defenses";
import { DAMAGE_TYPES } from "../core/objects";
import { averageOf, mobResult, targetsInArea, type AreaShape, type MobMode } from "../core/mob";
import { ABILITIES, ABILITY_NAMES, saveBonus, type Ability } from "../core/sheet";
import { changeHp, type TrackerUnit } from "../core/tracker";
import { action, h, rerender, type Child } from "./dom";
import { obrGateway } from "./obrGateway";
import { roomSettings, roomSystem } from "./roomSettings";

interface MobUi {
  group: string; count: number | null; kind: "attack" | "save"; actionName: string; targetId: string; ac: number | null;
  mode: MobMode; ability: Ability; dc: number; damage: string; dtype: string; half: boolean;
  areaShape: AreaShape; areaSize: number; areaWidth: number; spread: "" | "spread" | "bunched"; d3: number;
}
const st: MobUi = { group: "", count: null, kind: "attack", actionName: "", targetId: "", ac: null, mode: "normal", ability: "dex", dc: 13, damage: "", dtype: "", half: true,
  areaShape: "sphere", areaSize: 20, areaWidth: 5, spread: "", d3: 2 };
let last = "";

/** Identical monsters: non-party, not dead, grouped by stat block name. */
export function mobGroups(units: TrackerUnit[]): Map<string, TrackerUnit[]> {
  const g = new Map<string, TrackerUnit[]>();
  for (const u of units) if (!u.party && !u.dead && u.hp > 0) g.set(u.sheet.name, [...(g.get(u.sheet.name) ?? []), u]);
  return g;
}

const num = (v: string, d: number) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const sel = (value: string, options: [string, string][], on: (v: string) => void) =>
  h("select", { onchange: (e: Event) => { on((e.target as HTMLSelectElement).value); rerender(); } },
    ...options.map(([v, l]) => h("option", { value: v, selected: v === value }, l)));

export function mobPanel(units: TrackerUnit[]): Child {
  const groups = mobGroups(units);
  const names = [...groups.keys()].sort();
  if (!names.includes(st.group)) st.group = names.find((n) => groups.get(n)!.length > 1) ?? names[0] ?? "";
  const members = groups.get(st.group) ?? [];
  const count = Math.min(st.count ?? members.length, members.length || (st.count ?? 0));
  const sheet = members[0]?.sheet;
  const attacks = (sheet?.actions ?? []).map((a) => ({ a, p: attackProfile(a.text) })).filter((x) => x.p.bonus !== undefined);
  if (!attacks.some((x) => x.a.name === st.actionName)) st.actionName = attacks[0]?.a.name ?? "";
  const atk = attacks.find((x) => x.a.name === st.actionName);
  const target = units.find((u) => u.id === st.targetId);
  const ac = st.ac ?? target?.ac ?? 15;
  const body: Child[] = [];

  body.push(h("div", { className: "row wrap" },
    h("label", { className: "small" }, "Monsters ", sel(st.group, names.map((n) => [n, `${n} (${groups.get(n)!.length})`]), (v) => { st.group = v; st.count = null; })),
    h("label", { className: "small" }, "How many ", h("input", { type: "number", min: 1, className: "num", value: String(count || ""), onchange: (e: Event) => { st.count = Math.max(1, num((e.target as HTMLInputElement).value, 1)); rerender(); } })),
    h("label", { className: "small" }, "Roll ", sel(st.kind, [["attack", "Attack rolls"], ["save", "Saving throws"]], (v) => { st.kind = v as MobUi["kind"]; })),
    h("label", { className: "small" }, "", sel(st.mode, [["normal", "Normal"], ["advantage", "All with Advantage"], ["disadvantage", "All with Disadvantage"]], (v) => { st.mode = v as MobMode; }))));

  if (!members.length) body.push(h("div", { className: "small muted" }, "No living creatures in the scene yet."));
  else if (st.kind === "attack") {
    const dmg = atk?.p.damage ?? [];
    const avg = dmg.reduce((s, d) => s + averageOf(d.formula), 0);
    const r = mobResult(count, ac, atk?.p.bonus ?? 0, st.mode);
    body.push(h("div", { className: "row wrap" },
      h("label", { className: "small" }, "Attack ", attacks.length ? sel(st.actionName, attacks.map((x) => [x.a.name, `${x.a.name} (+${x.p.bonus})`]), (v) => { st.actionName = v; }) : h("span", { className: "muted" }, "no attack on the stat block")),
      h("label", { className: "small" }, "Target ", sel(st.targetId, [["", "(type an AC)"], ...units.filter((u) => !u.dead && u.sheet.name !== st.group).map((u): [string, string] => [u.id, `${u.name} (AC ${u.ac})`])], (v) => { st.targetId = v; st.ac = null; })),
      h("label", { className: "small" }, "AC ", h("input", { type: "number", className: "num", value: String(ac), onchange: (e: Event) => { st.ac = num((e.target as HTMLInputElement).value, 15); rerender(); } }))));
    if (atk) {
      // Each hit is its own instance: the target's defenses apply per hit, type by type.
      const perHit = target ? hitAgainst(target.sheet.defenses, dmg.map((d) => ({ amount: averageOf(d.formula), type: d.type }))) : { amount: avg, notes: [] as string[] };
      const total = r.successes * perHit.amount;
      body.push(h("div", { className: "panel tight" },
        h("div", {}, h("strong", {}, `${r.successes} of ${count} hit`), ` · roll needed ${r.rollNeeded} (AC ${ac} − ${atk.p.bonus}) · table: ${r.fraction}`),
        h("div", { className: "small" }, dmg.length ? `Average damage ${avg} per hit (${dmg.map((d) => `${d.formula}${d.type ? ` ${d.type}` : ""}`).join(" + ")}) → ${total} damage${perHit.notes.length ? ` (${perHit.amount} per hit after ${perHit.notes.join("; ")})` : ""}` : "No damage dice on this attack."),
        target && total > 0 ? h("button", { className: "small", onclick: action(async () => {
          await changeHp(obrGateway, [target.id], { kind: "damage", amount: total }, { autoDeadAtZero: roomSettings().autoDeadAtZero, system: roomSystem() });
          last = `${target.name} took ${total} damage from ${r.successes} ${st.group} hits.`;
        }) }, `Apply ${total} damage to ${target.name}`) : null));
    }
  } else {
    const bonus = sheet ? saveBonus(sheet, st.ability) : 0;
    const r = mobResult(count, st.dc, bonus, st.mode);
    const dmg = st.damage.trim() ? (/d/i.test(st.damage) ? averageOf(st.damage) : Math.max(0, Math.floor(num(st.damage, 0)))) : 0;
    const defs = sheet?.defenses;
    const full = st.dtype ? damageAgainst(defs, dmg, st.dtype) : { amount: dmg, note: "" };
    const halfDmg = st.dtype ? damageAgainst(defs, Math.floor(dmg / 2), st.dtype).amount : Math.floor(dmg / 2);
    const failed = members.slice(0, count).slice(0, r.failures), saved = members.slice(0, count).slice(r.failures);
    body.push(h("div", { className: "row wrap" },
      h("label", { className: "small" }, "Save ", sel(st.ability, ABILITIES.map((a) => [a, `${ABILITY_NAMES[a]} (${bonus >= 0 && a === st.ability ? "+" : ""}${a === st.ability ? bonus : saveBonus(sheet!, a)})`]), (v) => { st.ability = v as Ability; })),
      h("label", { className: "small" }, "DC ", h("input", { type: "number", className: "num", value: String(st.dc), onchange: (e: Event) => { st.dc = num((e.target as HTMLInputElement).value, 13); rerender(); } })),
      h("label", { className: "small" }, "Damage ", h("input", { type: "text", className: "num", placeholder: "28 or 8d6", value: st.damage, onchange: (e: Event) => { st.damage = (e.target as HTMLInputElement).value; rerender(); } })),
      h("select", { title: "Damage type (applies the monsters' Resistances, Vulnerabilities and Immunities)", onchange: (e: Event) => { st.dtype = (e.target as HTMLSelectElement).value; rerender(); } },
        h("option", { value: "" }, "type"), ...DAMAGE_TYPES.map((t) => h("option", { value: t, selected: st.dtype === t }, t))),
      h("label", { className: "small" }, h("input", { type: "checkbox", checked: st.half, onchange: (e: Event) => { st.half = (e.target as HTMLInputElement).checked; rerender(); } }), "half on a success")));
    body.push(h("div", { className: "panel tight" },
      h("div", {}, h("strong", {}, `${r.successes} of ${count} succeed`), ` · roll needed ${r.rollNeeded} (DC ${st.dc} − ${bonus}) · table: ${r.fraction}`),
      dmg ? h("div", { className: "small" }, `${r.failures} take ${full.amount}${st.half ? `, ${r.successes} take ${halfDmg}` : ", the rest take none"}${/d/i.test(st.damage) ? ` (average of ${st.damage})` : ""}${full.note ? ` · ${full.note}` : ""}.`) : null,
      dmg ? h("button", { className: "small", onclick: action(async () => {
        const opts = { autoDeadAtZero: roomSettings().autoDeadAtZero, system: roomSystem() };
        if (failed.length && full.amount) await changeHp(obrGateway, failed.map((u) => u.id), { kind: "damage", amount: full.amount }, opts);
        if (st.half && saved.length && halfDmg) await changeHp(obrGateway, saved.map((u) => u.id), { kind: "damage", amount: halfDmg }, opts);
        last = `Applied: ${failed.map((u) => u.name).join(", ") || "nobody"} failed${st.half && saved.length ? `; ${saved.map((u) => u.name).join(", ")} took half` : ""}.`;
      }) }, "Apply to the group") : null));
  }
  if (last) body.push(h("div", { className: "small ok" }, last));

  const n = targetsInArea(st.areaShape, st.areaSize, { width: st.areaWidth, spread: st.spread || undefined, d3: st.d3, present: members.length || undefined });
  body.push(h("details", { className: "small", style: "margin-top:6px" }, h("summary", {}, "Targets in an area (no map)"),
    h("div", { className: "row wrap", style: "margin-top:4px" },
      sel(st.areaShape, [["sphere", "Sphere / Cylinder (radius)"], ["cube", "Cube / Square"], ["cone", "Cone"], ["line", "Line"]], (v) => { st.areaShape = v as AreaShape; }),
      h("input", { type: "number", className: "num", value: String(st.areaSize), title: "Size in feet (radius, side, length)", onchange: (e: Event) => { st.areaSize = num((e.target as HTMLInputElement).value, 20); rerender(); } }), "ft",
      st.areaShape === "line" ? h("label", {}, " wide ", h("input", { type: "number", className: "num", value: String(st.areaWidth), onchange: (e: Event) => { st.areaWidth = num((e.target as HTMLInputElement).value, 5); rerender(); } })) : null,
      sel(st.spread, [["", "as usual"], ["spread", "spread out (−1d3)"], ["bunched", "bunched up (+1d3)"]], (v) => { st.spread = v as MobUi["spread"]; st.d3 = 1 + Math.floor(Math.random() * 3); })),
    h("div", {}, h("strong", {}, `About ${n} creature${n === 1 ? "" : "s"}`), st.spread ? ` (1d3 rolled ${st.d3})` : "", members.length ? ` of the ${members.length} ${st.group}` : "", ". Your judgment wins: crowded targets can all be caught.")));

  return h("details", { className: "panel", open: true }, h("summary", {}, h("strong", {}, "Mob rolls")),
    h("div", { className: "small muted" }, "Many identical monsters: the DMG's Mob Results table gives how many succeed without rolling, and damage uses the stat block's average."),
    ...body);
}
