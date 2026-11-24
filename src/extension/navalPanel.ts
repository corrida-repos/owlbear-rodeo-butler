/**
 * DM Tools → Ships and sky (room setting "Naval and aerial combat", off by default): ship-to-ship combat with the
 * 5etools stat blocks (Ghosts of Saltmarsh, Acquisitions Incorporated, Astral Adventurer's Guide, Eberron: Forge of the
 * Artificer, the 2024 PHB airship), wind and weather, and creatures in the air. Rules: core/naval.ts; rolls and
 * effects: navalRun.ts; ship turns and falls between turns: background/naval.ts.
 */
import OBR from "@owlbear-rodeo/sdk";
import {
  actionCount, canTurn, COMMANDERS, crashRules, crewPassive, FIRE_DCS, fullSpeedBonus, HEADING_LABEL, isDestroyed, isWrecked, NAVAL_KEY, OFFICER_LABEL,
  OFFICERS, readNaval, shipActions, shipFromPreset, shipInitiativeBonus, shipSpeed, SIZE_LABEL, SKY_RULES, STARTING_DISTANCE, staysAloft, underwaterRules,
  weaponReady, WIND_LABEL, AIRSHIP_RULES, AIRSHIP_CONDITIONS, windRules, type Component, type Heading, type NavalState, type Officer, type Ship, type Wind,
} from "../core/naval";
import { SHIP_PRESETS } from "../core/shipData";
import type { SizeCode } from "../core/sheet";
import type { TrackerUnit } from "../core/tracker";
import { DAMAGE_TYPES } from "../core/objects";
import { fmtMod } from "../core/dice";
import { action, h, rerender, type Child } from "./dom";
import {
  areaCasualties, beginShipTurn, bosunRepairs, callFullSpeed, callTakeAim, crashShip, crewLoss, fireAboard, fireWeapons, haltFall, hurtShip, mending,
  moveShip, mutinyCheck, navalCtx, nsay, overboard, rollShipInitiative, saveNaval, setAloft, setQualityOf, setShip, shipById, shipFalls, startFall,
  useAction, weaponAction, tiltAndRoll, airshipHazard, emergencyRepair, docked, type CrashTarget, type NavalCtx, type ShipTarget,
} from "./navalRun";
import { roomSystem } from "./roomSettings";

let panelOpen = false;
const st = { preset: SHIP_PRESETS.find((p) => p.key.startsWith("sailing-ship"))?.key ?? SHIP_PRESETS[0]!.key, name: "", aloftUnit: "", aloftFt: 30 };
/** Per-ship form fields, kept across re-renders. */
const f: Record<string, string> = {};
const fv = (k: string, d = "") => f[k] ?? d;
const input = (k: string, attrs: Record<string, unknown> = {}) => h("input", { type: "text", value: fv(k), oninput: (e: Event) => { f[k] = (e.target as HTMLInputElement).value; }, ...attrs });

const save = (n: NavalState) => OBR.scene.setMetadata({ [NAVAL_KEY]: n });
const run = (fn: (x: NavalCtx) => Promise<void> | void) => action(async () => { const x = await navalCtx(); await fn(x); await saveNaval(x); });
const newId = () => `s-${globalThis.crypto.randomUUID().slice(0, 8)}`;
const TYPE_GROUP: Record<string, string> = { ship: "Ships and balloons (GoS, AI, PHB 2024)", spelljammer: "Spelljammers (Astral Adventurer's Guide)", airship: "Elemental airships (Eberron: Forge of the Artificer)" };

export function navalPanel(units: TrackerUnit[], meta: Record<string, unknown>): Child {
  const n = readNaval(meta);
  const set = (patch: Partial<NavalState>) => action(() => save({ ...n, ...patch }));
  const rules = roomSystem().rules;
  const aloftCount = Object.keys(n.aloft).length;
  return h("details", { className: "panel", open: panelOpen, ontoggle: (e: Event) => { panelOpen = (e.target as HTMLDetailsElement).open; } },
    h("summary", {}, h("strong", {}, `Ships and sky${n.ships.length || aloftCount ? ` (${[n.ships.length ? `${n.ships.length} ship${n.ships.length > 1 ? "s" : ""}` : "", aloftCount ? `${aloftCount} aloft` : ""].filter(Boolean).join(", ")})` : ""}`)),
    h("div", { className: "small muted" }, "Naval and aerial combat from the books in 5etools: ship stat blocks with components (hull, helm, sails or oars, weapons), crew and officers (Ghosts of Saltmarsh), spelljammers and elemental airships whose crews work stations (Astral Adventurer's Guide, Eberron), crashing, fire aboard and repairs; wind; and creatures in the air, who fall when they're knocked Prone or stopped (PHB, Xanathar's). Crewed ships take their turn when initiative passes their count."),
    h("div", { className: "row wrap", style: "margin-top:6px" },
      h("select", { title: "Wind", onchange: (e: Event) => void set({ wind: (e.target as HTMLSelectElement).value as Wind })() },
        ...(Object.keys(WIND_LABEL) as Wind[]).map((w) => h("option", { value: w, selected: n.wind === w }, WIND_LABEL[w]))),
      h("label", { className: "small" }, h("input", { type: "checkbox", checked: n.underwater, onchange: set({ underwater: !n.underwater }) }), "fighting underwater"),
      h("label", { className: "small", title: "Xanathar's optional rule: a long fall takes time, 500 ft at once and 500 more at the end of each of the creature's turns" }, h("input", { type: "checkbox", checked: n.rateOfFalling, onchange: set({ rateOfFalling: !n.rateOfFalling }) }), "rate of falling"),
      h("label", { className: "small", title: "Xanathar's optional rule: a conscious flier subtracts its fly speed from the distance it fell" }, h("input", { type: "checkbox", checked: n.flierRule, onchange: set({ flierRule: !n.flierRule }) }), "fliers slow their fall"),
      h("label", { className: "small" }, h("input", { type: "checkbox", checked: n.publicRolls, onchange: set({ publicRolls: !n.publicRolls }) }), "players see the rolls")),
    h("details", {}, h("summary", { className: "small" }, "Rules at a glance"),
      h("div", { className: "small stack tight" },
        ...windRules(n.wind, rules).map((l) => h("div", {}, "• ", l)),
        ...(n.underwater ? [h("strong", {}, "Underwater"), ...underwaterRules(rules).map((l) => h("div", {}, "• ", l))] : []),
        h("strong", {}, "The sky"), ...SKY_RULES.map((l) => h("div", {}, "• ", l)),
        h("strong", {}, "Elemental airships (EFA)"), ...AIRSHIP_RULES.map((l) => h("div", {}, "• ", l)),
        ...AIRSHIP_CONDITIONS.map((c) => h("div", {}, `• ${c.text}: encounter at ${c.distance}, navigation DC ${c.dc} (the helm's Wisdom (Survival))`)),
        h("strong", {}, "Starting distance (AAG)"), ...STARTING_DISTANCE.map((d) => h("div", {}, `• ${d.ft.toLocaleString()} ft: ${d.text}`)),
        h("div", {}, "• Boarding: a ship within 5 ft can pull alongside; creatures cross freely until one pulls away. A boarding party that Readied can cross as the ship passes (AAG)."),
        h("div", {}, "• Repairs while berthed: 1 HP per day, 20 gp per HP (shipboard weapons 10 gp); Mending restores 1d8 + modifier, once per hour per target (AAG)."))),
    n.underwater ? h("div", { className: "small warn", style: "margin-top:4px" }, `Underwater: ${underwaterRules(rules).slice(0, 3).join(" ")}`) : null,
    n.wind === "strong" ? h("div", { className: "small warn", style: "margin-top:4px" }, "Strong wind: ranged weapon attacks have Disadvantage (ship weapons too); creatures flying without magic fall at the end of their turn if they're still in the air.") : null,
    addForm(n),
    ...n.ships.map((s) => shipCard(s, n, units)),
    aloftSection(n, units),
    n.log.length ? h("details", { open: true, style: "margin-top:6px" }, h("summary", { className: "small" }, "Log"),
      h("div", { className: "small stack tight" }, ...n.log.slice().reverse().map((l) => h("div", {}, "• ", l))),
      h("button", { className: "secondary small", onclick: set({ log: [] }) }, "Clear log")) : null);
}

function addForm(n: NavalState): Child {
  const types = [...new Set(SHIP_PRESETS.map((p) => p.type))];
  const p = SHIP_PRESETS.find((x) => x.key === st.preset)!;
  return h("div", { className: "stack tight", style: "margin-top:6px" },
    h("div", { className: "row wrap" },
      h("select", { onchange: (e: Event) => { st.preset = (e.target as HTMLSelectElement).value; rerender(); } },
        ...types.map((t) => h("optgroup", { label: TYPE_GROUP[t] ?? t }, ...SHIP_PRESETS.filter((x) => x.type === t).map((x) => h("option", { value: x.key, selected: x.key === st.preset }, `${x.name} (${x.source})`))))),
      h("input", { type: "text", placeholder: "Name (optional)", value: st.name, oninput: (e: Event) => { st.name = (e.target as HTMLInputElement).value; } }),
      h("button", { className: "small", onclick: action(async () => { const s = shipFromPreset(p, newId(), st.name); st.name = ""; await save({ ...n, ships: [...n.ships, s] }); }) }, "Add ship")),
    h("div", { className: "small muted" }, `${SIZE_LABEL[p.size]}${p.dims ? `, ${p.dims}` : ""} · hull AC ${p.hull.ac}, ${p.hull.hp} HP${p.hull.dt ? `, threshold ${p.hull.dt}` : ""} · crew ${p.crew}${p.passengers ? `, ${p.passengers} passengers` : ""}${p.abilities ? ` · Str ${p.abilities.str} Dex ${p.abilities.dex} Con ${p.abilities.con}` : ""} · ${p.thresholds ? "the ship acts on its own initiative" : "the crew work its stations on their turns"}${p.note ? `. ${p.note}` : ""}`));
}

const unitOptions = (units: TrackerUnit[], selected: string | undefined, none: string) =>
  [h("option", { value: "", selected: !selected }, none), ...units.filter((u) => !u.dead).map((u) => h("option", { value: u.id, selected: u.id === selected }, u.name))];

function targetSelect(key: string, s: Ship, n: NavalState, units: TrackerUnit[]): Child {
  const opts: Child[] = [h("option", { value: "" }, "target…")];
  for (const o of n.ships.filter((x) => x.id !== s.id && !isWrecked(x))) {
    opts.push(h("optgroup", { label: o.name }, h("option", { value: `ship:${o.id}:hull`, selected: fv(key) === `ship:${o.id}:hull` }, `${o.name}: hull (AC ${o.hull.ac})`),
      ...o.comps.filter((c) => c.maxHp && !isDestroyed(c)).map((c) => h("option", { value: `ship:${o.id}:${c.id}`, selected: fv(key) === `ship:${o.id}:${c.id}` }, `${o.name}: ${c.name} (AC ${c.ac})`))));
  }
  opts.push(h("optgroup", { label: "Creatures" }, ...units.filter((u) => !u.dead).map((u) => h("option", { value: `unit:${u.id}`, selected: fv(key) === `unit:${u.id}` }, `${u.name} (AC ${u.ac})`))));
  return h("select", { onchange: (e: Event) => { f[key] = (e.target as HTMLSelectElement).value; } }, ...opts);
}
function parseTarget(v: string): ShipTarget | null {
  const [k, id, comp] = v.split(":");
  if (k === "ship" && id) return { kind: "ship", id, comp: comp || "hull" };
  if (k === "unit" && id) return { kind: "unit", id };
  return null;
}
const dist = (k: string) => { const v = Number(fv(k)); return fv(k).trim() && Number.isFinite(v) ? v : undefined; };

function shipCard(s: Ship, n: NavalState, units: TrackerUnit[]): Child {
  const name = (id?: string) => units.find((u) => u.id === id)?.name ?? "(gone)";
  const patch = (p: Partial<Ship>) => action(() => save({ ...n, ships: n.ships.map((o) => (o.id === s.id ? { ...o, ...p } : o)) }));
  const count = actionCount(s);
  const sp = shipSpeed(s, n.wind);
  const initBonus = shipInitiativeBonus(s);
  const actions = count !== null ? shipActions(s) : [];
  const wrecked = isWrecked(s);
  const k = (x: string) => `${s.id}:${x}`;
  const officerOf = (o: Officer) => s.officers[o];
  const commanders = COMMANDERS.map((o) => officerOf(o)).filter((id): id is string => !!id);
  const weapons = s.comps.filter((c) => !c.ram && (c.kind === "weapon" || (c.kind === "station" && c.attacks?.length)));

  const hurtRow = (compId: string) => h("span", { className: "row" },
    input(k(`dmg:${compId}`), { className: "num", placeholder: "dmg / +hp", title: "Damage (12) or repair (+5); Enter applies", onkeydown: (e: KeyboardEvent) => { if (e.key === "Enter") void applyHurt(compId)(); } }),
    h("button", { className: "icon tiny", title: "Apply", onclick: applyHurt(compId) }, "✓"));
  const applyHurt = (compId: string) => run(async (x) => {
    const raw = fv(k(`dmg:${compId}`)).trim();
    const amt = Math.abs(Number(raw.replace(/^[+-]/, "")));
    if (!raw || !Number.isFinite(amt)) return;
    f[k(`dmg:${compId}`)] = "";
    if (raw.startsWith("+")) {
      const cur = shipById(x, s.id)!;
      const next = compId === "hull" ? { ...cur, hull: { ...cur.hull, hp: Math.min(cur.hull.maxHp, cur.hull.hp + amt) } } : { ...cur, comps: cur.comps.map((c) => (c.id === compId ? { ...c, hp: Math.min(c.maxHp, c.hp + amt) } : c)) };
      setShip(x, next);
      nsay(x, `${s.name}'s ${compId === "hull" ? "hull" : s.comps.find((c) => c.id === compId)?.name.toLowerCase()} is repaired by ${amt} HP.`);
      return;
    }
    await hurtShip(x, s.id, compId, amt, fv(k("dtype")) || undefined, "the GM");
  });

  const compLine = (c: Component): Child => {
    const ready = c.load || c.aim ? weaponReady(c) : true;
    const station = count === null && (c.kind === "weapon" || c.kind === "station") && !c.ram && c.attacks?.length;
    return h("div", { className: "row wrap small" },
      h("span", { className: `grow${isDestroyed(c) ? " bad" : ""}`, title: [c.text, c.attacks?.map((a) => a.text).join(" ")].filter(Boolean).join(" ") },
        `${c.name}${c.maxHp ? ` · AC ${c.ac} · ${c.hp}/${c.maxHp} HP${c.dt ? ` (threshold ${c.dt})` : ""}` : ""}${isDestroyed(c) ? " · destroyed" : ""}`,
        c.attacks?.[0] ? ` · ${fmtMod(c.attacks[0].bonus)}, ${c.attacks[0].normal ? `${c.attacks[0].normal}/${c.attacks[0].long ?? c.attacks[0].normal} ft` : `reach ${c.attacks[0].reach} ft`}, ${c.attacks[0].damage.map((d) => `${d.dice} ${d.type}`).join(" + ") || "special"}` : "",
        c.crew ? ` · crew ${c.crew}` : "",
        c.load || c.aim ? ` · loaded ${c.loaded ?? 0}/${c.load ?? 0}, aimed ${c.aimed ?? 0}/${c.aim ?? 0}` : "",
        c.aimAdv !== undefined && c.aimAdv >= s.turn ? h("span", { className: "ok" }, " · Take Aim: Advantage") : null),
      c.maxHp ? hurtRow(c.id) : null,
      station && (c.load || c.aim) && !ready ? h("button", { className: "secondary small", title: "One action loading or aiming it (any crew member at the station)", onclick: run((x) => weaponAction(x, s.id, c.id)) }, (c.loaded ?? 0) < (c.load ?? 0) ? "Load" : "Aim") : null,
      station ? h("button", { className: "secondary small", disabled: !ready || isDestroyed(c), title: "Fire at the target picked below", onclick: run(async (x) => { const t = parseTarget(fv(k("target"))); if (t) await fireWeapons(x, s.id, [c.id], t, dist(k("dist"))); }) }, "Fire") : null);
  };

  return h("div", { className: "dm-item", style: "flex-direction:column;align-items:stretch;margin-top:6px" },
    h("div", { className: "row wrap" },
      h("strong", { className: "grow", title: s.basis ?? "" }, s.name), wrecked ? h("span", { className: "small bad" }, " wrecked") : null,
      h("button", { className: "icon tiny", title: "Remove the ship", onclick: action(() => save({ ...n, ships: n.ships.filter((o) => o.id !== s.id) })) }, "✕")),
    h("div", { className: "small muted" },
      `${SIZE_LABEL[s.size]} · hull AC ${s.hull.ac}, ${s.hull.hp}/${s.hull.maxHp} HP${s.hull.dt ? `, threshold ${s.hull.dt}` : ""} · Speed ${sp.speed} ft${sp.via ? ` (${sp.via}${sp.notes.length ? `: ${sp.notes.join(", ")}` : ""})` : ""}${typeof s.dex === "number" ? ` · Str ${fmtMod(Math.floor(((s.str ?? 10) - 10) / 2))} Dex ${fmtMod(Math.floor((s.dex - 10) / 2))} Con ${fmtMod(Math.floor(((s.con ?? 10) - 10) / 2))}` : ""} · crew ${s.crew}/${s.crewMax}, quality ${fmtMod(s.quality)} (passive Perception ${crewPassive(s)})`),
    !canTurn(s) ? h("div", { className: "small bad" }, "Helm destroyed: it can't turn.") : null,
    s.altitude > 0 && !staysAloft(s) ? h("div", { className: "small bad" }, "It can't maintain altitude.") : null,
    // Turn
    count !== null
      ? h("div", { className: "row wrap" },
        h("label", { className: "small", title: `Dexterity ${fmtMod(initBonus ?? 0)} with crew quality` }, "Init ",
          h("input", { type: "number", className: "num", value: s.initiative ?? "", onchange: (e: Event) => { const v = (e.target as HTMLInputElement).value; void patch({ initiative: v === "" ? undefined : Number(v) })(); } })),
        h("button", { className: "secondary small", onclick: run((x) => rollShipInitiative(x, s.id)) }, `Roll ${fmtMod(initBonus ?? 0)}`),
        h("button", { className: "secondary small", title: "Start its turn now (Butler does this when initiative passes its count)", onclick: run((x) => beginShipTurn(x, s.id)) }, "Start turn"),
        h("span", { className: "small" }, `Actions ${Math.max(0, count - s.used.length)}/${count}`),
        ...actions.filter((a) => a.key !== "move").map((a) => h("button", { className: "small", disabled: s.used.includes(a.key) || s.used.length >= count || wrecked, title: `${a.comps.length} weapon${a.comps.length > 1 ? "s" : ""} at the target picked below`,
          onclick: run(async (x) => { const t = parseTarget(fv(k("target"))); if (!t) { nsay(x, "Pick a target for the ship's weapons first."); return; } if (useAction(x, s.id, a.key, a.label)) await fireWeapons(x, s.id, a.comps.map((c) => c.id), t, dist(k("dist"))); }) }, a.label)))
      : h("div", { className: "small muted" }, "Its crew act at its stations on their own turns (load, aim and fire each weapon); the pilot moves it up to its speed on theirs (AAG)."),
    h("div", { className: "row wrap" },
      h("select", { title: "Heading against the wind", onchange: (e: Event) => void patch({ heading: (e.target as HTMLSelectElement).value as Heading })() },
        ...(Object.keys(HEADING_LABEL) as Heading[]).map((x) => h("option", { value: x, selected: s.heading === x }, HEADING_LABEL[x]))),
      input(k("move"), { className: "num", placeholder: String(sp.speed), title: "Feet moved (blank: its full speed)" }),
      h("button", { className: "small", disabled: wrecked || (count !== null && (s.used.includes("move") || s.used.length >= count)), onclick: run((x) => moveShip(x, s.id, Number(fv(k("move"))) || 0)) }, "Move"),
      fullSpeedBonus(s) ? h("span", { className: "small ok" }, `Full Speed Ahead +${fullSpeedBonus(s)} ft`) : null,
      s.env !== "water" ? h("label", { className: "small", title: "Height above the ground or water (ft)" }, "Altitude ",
        h("input", { type: "number", className: "num", min: 0, step: 10, value: String(s.altitude), onchange: (e: Event) => void patch({ altitude: Math.max(0, Number((e.target as HTMLInputElement).value) || 0) })() })) : null,
      s.type === "airship" ? h("label", { className: "small", title: "Suppressed elemental core (EFA): Fly 5 ft, it still hovers; station actions that need the core can't be used" }, h("input", { type: "checkbox", checked: !!s.coreOff, onchange: patch({ coreOff: !s.coreOff || undefined }) }), "core suppressed") : null),
    // Weapons and target
    weapons.length ? h("div", { className: "row wrap" }, targetSelect(k("target"), s, n, units),
      input(k("dist"), { className: "num", placeholder: "ft", title: "Distance to the target (checks range: long range Disadvantage, minimum range)" }), h("span", { className: "small" }, "ft")) : null,
    h("details", {}, h("summary", { className: "small" }, "Hull and components"),
      h("div", { className: "row wrap small" }, h("span", { className: "grow" }, `Hull · AC ${s.hull.ac} · ${s.hull.hp}/${s.hull.maxHp} HP${s.hull.dt ? ` (threshold ${s.hull.dt})` : ""}`), hurtRow("hull"),
        h("select", { title: "Damage type", onchange: (e: Event) => { f[k("dtype")] = (e.target as HTMLSelectElement).value; } }, h("option", { value: "" }, "type"), ...DAMAGE_TYPES.map((t) => h("option", { value: t, selected: fv(k("dtype")) === t }, t)))),
      ...s.comps.map(compLine)),
    // Officers
    h("details", {}, h("summary", { className: "small" }, `Officers and crew${commanders.length ? ` (${commanders.map(name).join(", ")})` : ""}`),
      h("div", { className: "row wrap" }, ...OFFICERS.filter((o) => o !== "pilot" || s.type !== "ship").map((o) => h("label", { className: "small" }, `${OFFICER_LABEL[o]} `,
        h("select", { onchange: (e: Event) => void patch({ officers: { ...s.officers, [o]: (e.target as HTMLSelectElement).value || undefined } })() }, ...unitOptions(units, officerOf(o), "—"))))),
      h("div", { className: "row wrap" },
        h("select", { title: "Officer acting (captain, first mate or bosun)", onchange: (e: Event) => { f[k("cmd")] = (e.target as HTMLSelectElement).value; } }, h("option", { value: "" }, "officer…"), ...commanders.map((id) => h("option", { value: id, selected: fv(k("cmd")) === id }, name(id)))),
        h("button", { className: "secondary small", title: "Action, on deck: +d6 × 5 ft speed until the end of the ship's next turn (no stacking)", onclick: run(async (x) => { if (fv(k("cmd"))) await callFullSpeed(x, s.id, fv(k("cmd"))); else nsay(x, "Pick the captain, first mate or bosun who gives the order."); }) }, "Full Speed Ahead"),
        h("select", { onchange: (e: Event) => { f[k("aim")] = (e.target as HTMLSelectElement).value; } }, h("option", { value: "" }, "weapon…"), ...weapons.filter((c) => !isDestroyed(c)).map((c) => h("option", { value: c.id, selected: fv(k("aim")) === c.id }, c.name))),
        h("button", { className: "secondary small", title: "Action: a weapon within 10 ft of the officer gets Advantage on its next attack before the end of the ship's next turn", onclick: run((x) => { if (fv(k("cmd")) && fv(k("aim"))) callTakeAim(x, s.id, fv(k("aim")), fv(k("cmd"))); else nsay(x, "Pick the officer and the weapon to Take Aim."); }) }, "Take Aim")),
      h("div", { className: "row wrap" },
        h("label", { className: "small" }, "Crew ", h("input", { type: "number", className: "num", min: 0, value: String(s.crew), onchange: (e: Event) => void run((x) => crewLoss(x, s.id, s.crew - Math.max(0, Number((e.target as HTMLInputElement).value) || 0)))() })),
        h("label", { className: "small", title: "Crew quality: −10 to +10 (starts at +4). Initiative, the crew's checks and passive Perception use it" }, "Quality ", h("input", { type: "number", className: "num", min: -10, max: 10, value: String(s.quality), onchange: (e: Event) => void run((x) => setQualityOf(x, s.id, Number((e.target as HTMLInputElement).value) || 0))() })),
        input(k("spell"), { className: "num", placeholder: "lvl", title: "Level of an area spell (Fireball 3…) that hits the deck" }),
        h("button", { className: "secondary small", title: "Crew caught in an area spell: 1d6 per spell level", onclick: run(async (x) => { const lv = Number(fv(k("spell"))); if (lv > 0) await areaCasualties(x, s.id, lv); }) }, "Spell casualties"),
        s.quality < 0 ? h("button", { className: "secondary small", title: "Once a day while quality is below 0: the captain's Charisma (Intimidation or Persuasion) check + quality", onclick: run((x) => mutinyCheck(x, s.id)) }, "Mutiny check") : null)),
    // Aboard
    h("details", {}, h("summary", { className: "small" }, `Aboard${s.aboard.length ? ` (${s.aboard.map(name).join(", ")})` : ""}`),
      h("div", { className: "row wrap" },
        h("select", { onchange: (e: Event) => { const id = (e.target as HTMLSelectElement).value; if (id) void save({ ...n, ships: n.ships.map((o) => ({ ...o, aboard: o.id === s.id ? [...o.aboard.filter((a) => a !== id), id] : o.aboard.filter((a) => a !== id) })), aloft: Object.fromEntries(Object.entries(n.aloft).filter(([u]) => u !== id)) }); } },
          ...unitOptions(units.filter((u) => !s.aboard.includes(u.id)), undefined, "put aboard…"))),
      ...s.aboard.map((id) => h("div", { className: "row small" }, h("span", { className: "grow" }, name(id)),
        h("button", { className: "secondary small", title: s.altitude > 0 ? `Falls from ${s.altitude} ft` : "Into the water", onclick: run((x) => overboard(x, s.id, id)) }, "Overboard"),
        h("button", { className: "icon tiny", title: "Leaves the ship", onclick: patch({ aboard: s.aboard.filter((a) => a !== id) }) }, "✕")))),
    // Crashes, fire, repairs
    h("details", {}, h("summary", { className: "small" }, "Crash, fire aboard, repairs"),
      h("div", { className: "small muted" }, crashRules(s) === "gos"
        ? "Crash (GoS): nothing happens against something two sizes smaller; otherwise a DC 10 Constitution save or damage by the size of what it hit (a naval ram gives Advantage and takes it), and it stops unless that was smaller. A creature struck makes a Dexterity save (DC 10 + its Strength modifier) against damage by the ship's size. A rammed ship saves like a creature (Butler's ruling)."
        : crashRules(s) === "efa"
        ? "Crash (EFA): no attack roll. A creature in its path can dodge (DC 15 Dexterity save, no damage). Both take damage by the size of what was hit (Medium or smaller 2d10), and it stops against something its size or larger. Everyone aboard makes a DC 10 Strength or Dexterity save: that damage and Prone, or half."
        : "Crash (AAG): the pilot's attack roll (d20 + Proficiency Bonus) against the target's AC; on a hit both take damage by the size of what was hit, and it stops against something Gargantuan or immovable. A ram makes its own attack against an object, ship or Gargantuan creature."),
      h("div", { className: "row wrap" },
        h("select", { onchange: (e: Event) => { f[k("crash")] = (e.target as HTMLSelectElement).value; } },
          h("option", { value: "" }, "crash into…"),
          h("optgroup", { label: "Ships" }, ...n.ships.filter((o) => o.id !== s.id).map((o) => h("option", { value: `ship:${o.id}`, selected: fv(k("crash")) === `ship:${o.id}` }, o.name))),
          h("optgroup", { label: "Creatures" }, ...units.filter((u) => !u.dead && !s.aboard.includes(u.id)).map((u) => h("option", { value: `unit:${u.id}`, selected: fv(k("crash")) === `unit:${u.id}` }, u.name))),
          h("optgroup", { label: "Objects" }, ...(["S", "M", "L", "H", "G"] as SizeCode[]).flatMap((z) => [
            h("option", { value: `obj:${z}`, selected: fv(k("crash")) === `obj:${z}` }, `${SIZE_LABEL[z]} object`),
            h("option", { value: `obj:${z}:fixed`, selected: fv(k("crash")) === `obj:${z}:fixed` }, `${SIZE_LABEL[z]} immovable (reef, cliff, pier)`)]))),
        crashRules(s) === "aag" ? h("label", { className: "small", title: "The GM rules the crash unavoidable: no attack roll" }, h("input", { type: "checkbox", checked: fv(k("sure")) === "1", onchange: (e: Event) => { f[k("sure")] = (e.target as HTMLInputElement).checked ? "1" : ""; } }), "unavoidable") : null,
        h("button", { className: "secondary small", onclick: run(async (x) => {
          const [kind, id, fixed] = fv(k("crash")).split(":");
          const t: CrashTarget | null = kind === "ship" && id ? { kind: "ship", id } : kind === "unit" && id ? { kind: "unit", id } : kind === "obj" && id ? { kind: "object", size: id as SizeCode, ac: fixed ? 17 : 15, immovable: !!fixed } : null;
          if (t) await crashShip(x, s.id, t, fv(k("sure")) === "1");
        }) }, "Crash")),
      h("div", { className: "row wrap" },
        h("select", { title: "How big the fire is", onchange: (e: Event) => { f[k("fire")] = (e.target as HTMLSelectElement).value; } }, ...FIRE_DCS.map((d) => h("option", { value: String(d.dc), selected: fv(k("fire"), "15") === String(d.dc) }, `DC ${d.dc}: ${d.text}`))),
        h("button", { className: "secondary small", title: "Group check every 5 minutes: captain, first mate, bosun, surgeon and the crew (d20 + quality); missing officers fail", onclick: run((x) => fireAboard(x, s.id, Number(fv(k("fire"), "15")))) }, "Fight the fire")),
      h("div", { className: "row wrap" },
        h("button", { className: "secondary small", title: "End of the day: the bosun's Strength (carpenter's tools) check; 15+ heals each damaged part by 1d6 + quality and gets destroyed components working", onclick: run((x) => bosunRepairs(x, s.id)) }, "Bosun's repairs"),
        h("select", { onchange: (e: Event) => { f[k("mend")] = (e.target as HTMLSelectElement).value; } }, h("option", { value: "hull" }, "hull"), ...s.comps.filter((c) => c.maxHp).map((c) => h("option", { value: c.id, selected: fv(k("mend")) === c.id }, c.name))),
        input(k("mendmod"), { className: "num", placeholder: "+3", title: "The caster's spellcasting ability modifier" }),
        h("button", { className: "secondary small", title: "Mending: 1d8 + modifier, once per hour per target (AAG)", onclick: run((x) => mending(x, s.id, fv(k("mend"), "hull"), Number(fv(k("mendmod"))) || 0)) }, "Mending"),
        s.type === "airship" ? h("button", { className: "secondary small", title: "EFA: the pilot spends half the Fly Speed to invert or right the ship; everyone aboard makes a DC 15 Dexterity save or falls", onclick: run((x) => tiltAndRoll(x, s.id)) }, s.inverted ? "Right the ship" : "Tilt and Roll") : null,
        s.type === "airship" ? h("button", { className: "secondary small", title: "EFA Environmental Hazards (d4): turbulence, extreme altitude, lightning storm, strong wind", onclick: run((x) => airshipHazard(x, s.id)) }, "Sky hazard") : null,
        s.altitude > 0 ? h("button", { className: "secondary small", title: "It and everyone aboard fall: 1d6 per 10 ft (at most 20d6)", onclick: run((x) => shipFalls(x, s.id, "it loses altitude")) }, "Falls") : null)),
    s.type === "airship" ? h("div", { className: "row wrap" },
      h("select", { onchange: (e: Event) => { f[k("patch")] = (e.target as HTMLSelectElement).value; } }, h("option", { value: "hull" }, "hull"), ...s.comps.filter((c) => c.maxHp).map((c) => h("option", { value: c.id, selected: fv(k("patch")) === c.id }, c.name))),
      h("select", { onchange: (e: Event) => { f[k("patcher")] = (e.target as HTMLSelectElement).value; } }, ...unitOptions(units, fv(k("patcher")) || undefined, "repaired by…")),
      h("button", { className: "secondary small", title: "EFA: 1 hour and 100+ gp of parts; DC 16 Dexterity (Sleight of Hand) or Intelligence (Arcana) with tools; 2d4 + 2 HP, once per part until the ship docks", onclick: run((x) => { if (fv(k("patcher"))) return emergencyRepair(x, s.id, fv(k("patch"), "hull"), fv(k("patcher"))); nsay(x, "Pick who makes the emergency repair."); }) }, "Emergency repair"),
      h("button", { className: "secondary small", title: "Docked: emergency repairs reset", onclick: run((x) => docked(x, s.id)) }, "Docked"),
      s.inverted ? h("span", { className: "small warn" }, "Upside down") : null) : null,
    s.type === "airship" ? h("div", { className: "small muted" }, s.officers.pilot ? `Pilot: ${name(s.officers.pilot)}. If they're Incapacitated or take no helm action, the ship flies its full speed straight on at the start of their turn.` : "Nobody at the helm: the ship doesn't move (EFA).") : null,
    h("details", {}, h("summary", { className: "small" }, "Edit stats"),
      h("div", { className: "row wrap" },
        h("input", { type: "text", value: s.name, onchange: (e: Event) => void patch({ name: (e.target as HTMLInputElement).value.trim() || s.name })() }),
        ...(["ac", "maxHp", "dt"] as const).map((key) => h("label", { className: "small" }, `${{ ac: "Hull AC", maxHp: "Hull HP", dt: "Threshold" }[key]} `, h("input", { type: "number", className: "num", min: 0, value: String(s.hull[key]),
          onchange: (e: Event) => { const v = Math.max(0, Number((e.target as HTMLInputElement).value) || 0); void patch({ hull: key === "maxHp" ? { ...s.hull, maxHp: Math.max(1, v), hp: Math.min(Math.max(1, v), s.hull.hp === s.hull.maxHp ? v : s.hull.hp) } : { ...s.hull, [key]: v } })(); } }))),
        h("label", { className: "small" }, "Crew max ", h("input", { type: "number", className: "num", min: 0, value: String(s.crewMax), onchange: (e: Event) => void patch({ crewMax: Math.max(0, Number((e.target as HTMLInputElement).value) || 0) })() }))),
      s.basis ? h("div", { className: "small muted" }, s.basis) : null));
}

function aloftSection(n: NavalState, units: TrackerUnit[]): Child {
  const entries = Object.entries(n.aloft);
  const name = (id: string) => units.find((u) => u.id === id)?.name ?? "(gone)";
  const setA = (id: string, a: NavalState["aloft"][string] | null) => action(async () => { const aloft = { ...n.aloft }; if (a && a.ft > 0) aloft[id] = a; else delete aloft[id]; await save({ ...n, aloft }); });
  return h("div", { className: "stack tight", style: "margin-top:8px" },
    h("strong", { className: "small" }, "Creatures in the air"),
    h("div", { className: "small muted" }, "Put flying creatures here with their height. A creature that can't hover falls when it's knocked Prone or its speed drops to 0 (2024: or it's Incapacitated), unless magic holds it up (the Fly spell, a broom); in a strong wind, one flying without magic falls at the end of its turn. A fall deals 1d6 Bludgeoning per 10 ft (at most 20d6) and leaves it Prone."),
    h("div", { className: "row wrap" },
      h("select", { onchange: (e: Event) => { st.aloftUnit = (e.target as HTMLSelectElement).value; } }, ...unitOptions(units.filter((u) => !n.aloft[u.id]), st.aloftUnit, "creature…")),
      h("input", { type: "number", className: "num", min: 5, step: 5, value: String(st.aloftFt), onchange: (e: Event) => { st.aloftFt = Math.max(5, Number((e.target as HTMLInputElement).value) || 5); } }), h("span", { className: "small" }, "ft up"),
      h("button", { className: "small", onclick: action(async () => {
        const u = units.find((x) => x.id === st.aloftUnit);
        if (!u) return;
        // No fly speed on the sheet: it's up there by magic (a spell or an item), so it doesn't drop when Prone.
        await save({ ...n, aloft: { ...n.aloft, [u.id]: { ft: st.aloftFt, ...(!u.sheet.speed.fly ? { magic: true } : {}) } }, ships: n.ships.map((s) => ({ ...s, aboard: s.aboard.filter((a) => a !== u.id) })) });
        st.aloftUnit = "";
      }) }, "In the air")),
    ...entries.map(([id, a]) => {
      const u = units.find((x) => x.id === id);
      return h("div", { className: "row wrap small" },
        h("span", { className: "grow" }, name(id), u?.sheet.speed.fly ? ` (fly ${u.sheet.speed.fly}${u.sheet.speed.hover ? ", hover" : ""})` : "", a.falling ? h("span", { className: "bad" }, ` falling, ${a.falling.fallen} ft so far`) : null),
        h("input", { type: "number", className: "num", min: 0, step: 5, value: String(a.ft), title: "Height (ft)", onchange: (e: Event) => void setA(id, { ...a, ft: Math.max(0, Number((e.target as HTMLInputElement).value) || 0) })() }), "ft",
        h("label", { title: "Held aloft by magic: doesn't fall when Prone or stopped" }, h("input", { type: "checkbox", checked: !!a.magic, onchange: setA(id, { ...a, magic: !a.magic || undefined }) }), "magic"),
        a.falling
          ? h("button", { className: "secondary small", title: "A Prone flier still falling at the start of its turn: half its fly speed stops the fall", disabled: !u?.sheet.speed.fly, onclick: run((x) => haltFall(x, id)) }, "Halt")
          : h("button", { className: "secondary small", title: "It falls now", onclick: run((x) => startFall(x, id, "the GM")) }, "Fall"),
        h("button", { className: "icon tiny", title: "Lands safely", onclick: run((x) => { setAloft(x, id, null); nsay(x, `${name(id)} lands.`); }) }, "✕"));
    }));
}
