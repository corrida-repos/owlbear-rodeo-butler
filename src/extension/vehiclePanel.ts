/**
 * DM Tools → Chase mode → Vehicles: add vehicles (from presets, every number editable), put units aboard as driver or
 * riders, pick sides, and handle what happens between turns: damage (threshold, mishap threshold), mishaps and their
 * repairs, crashes and running creatures down. The turn-by-turn rules run in background/chase.ts.
 */
import type { ChaseState } from "../core/chase";
import { freeDashes } from "../core/chase";
import { DAMAGE_TYPES } from "../core/objects";
import type { TrackerUnit } from "../core/tracker";
import {
  driverProficient, effectiveDt, effectiveSpeed, mishapByKey, placeUnit, RIDER_LABEL, ridersOf, vehicleFromPreset, vehicleOf, VEHICLE_ENV_LABEL,
  VEHICLE_PRESETS, VEHICLE_TABLES, type RiderAt, type Vehicle, type VehicleEnv,
} from "../core/vehicles";
import { chaseCtx, clearSmoke, crashVehicle, hurtVehicle, ramCreature, repairMishap, rollMishap, saveChase, say, setVehicle, vehicleById, type ChaseCtx } from "./chaseRun";
import { action, h, type Child } from "./dom";
import { roomSystem } from "./roomSettings";

const st = { preset: VEHICLE_PRESETS[0]!.key, name: "" };
const amounts: Record<string, string> = {};
const types: Record<string, string> = {};
const crashFeet: Record<string, string> = {};
const ramTarget: Record<string, string> = {};
const repairer: Record<string, string> = {};
const tools: Record<string, boolean> = {};

const mod = (n: number) => { const m = Math.floor((n - 10) / 2); return m >= 0 ? `+${m}` : `${m}`; };
const newId = () => `v-${globalThis.crypto.randomUUID().slice(0, 8)}`;

/** Runs a rules action against the stored chase and saves it with its log lines. */
const run = (fn: (x: ChaseCtx) => Promise<void>) => action(async () => { const x = await chaseCtx(); await fn(x); await saveChase(x); });

export function vehicleSection(c: ChaseState, units: TrackerUnit[], set: (patch: Partial<ChaseState>) => () => Promise<void>): Child[] {
  const groups = [...new Set(VEHICLE_PRESETS.map((p) => p.group))];
  const setVehicles = (vehicles: Vehicle[]) => set({ vehicles });
  const live = units.filter((u) => !u.dead);
  return [
    h("div", { className: "row wrap", style: "margin-top:6px" },
      h("select", { title: "Which Vehicle Chase Complications table", onchange: (e: Event) => void set({ vehicleEnv: (e.target as HTMLSelectElement).value as VehicleEnv })() },
        ...(Object.keys(VEHICLE_TABLES) as VehicleEnv[]).map((k) => h("option", { value: k, selected: c.vehicleEnv === k }, `${VEHICLE_ENV_LABEL[k]} complications`)))),
    h("div", { className: "row wrap", style: "margin-top:6px" },
      h("select", { onchange: (e: Event) => { st.preset = (e.target as HTMLSelectElement).value; } },
        ...groups.map((g) => h("optgroup", { label: g }, ...VEHICLE_PRESETS.filter((p) => p.group === g).map((p) => h("option", { value: p.key, selected: p.key === st.preset }, p.label))))),
      h("input", { type: "text", placeholder: "Name (optional)", value: st.name, oninput: (e: Event) => { st.name = (e.target as HTMLInputElement).value; } }),
      h("button", { className: "small", onclick: () => { const v = vehicleFromPreset(VEHICLE_PRESETS.find((p) => p.key === st.preset)!, newId(), st.name); st.name = ""; void setVehicles([...c.vehicles, v])(); } }, "Add vehicle")),
    c.vehicles.length ? h("div", { className: "dm-list" }, ...c.vehicles.map((v) => vehicleCard(c, v, units, set))) : h("div", { className: "small muted" }, "No vehicles yet: add one for each side."),
    c.vehicles.length ? h("details", { open: !c.active, style: "margin-top:6px" }, h("summary", { className: "small" }, "Who rides where"),
      h("div", { className: "dm-list" }, ...live.map((u) => {
        const on = vehicleOf(c.vehicles, u.id);
        return h("div", { className: "dm-item" },
          h("span", { className: "grow" }, u.name, u.party ? h("span", { className: "small muted" }, " party") : null),
          h("select", { onchange: (e: Event) => { const to = (e.target as HTMLSelectElement).value || null; void setVehicles(placeUnit(c.vehicles, u.id, to, to && !c.vehicles.find((v) => v.id === to)?.driver ? "driver" : "aboard"))(); } },
            h("option", { value: "", selected: !on }, "not aboard"), ...c.vehicles.map((v) => h("option", { value: v.id, selected: on?.vehicle.id === v.id }, v.name))),
          on ? h("select", { onchange: (e: Event) => void setVehicles(placeUnit(c.vehicles, u.id, on.vehicle.id, (e.target as HTMLSelectElement).value as RiderAt | "driver"))() },
            ...(["driver", "aboard", "inside", "clinging"] as const).map((k) => h("option", { value: k, selected: on.at === k }, RIDER_LABEL[k]))) : null);
      }))) : null,
  ];
}

function vehicleCard(c: ChaseState, v: Vehicle, units: TrackerUnit[], set: (patch: Partial<ChaseState>) => () => Promise<void>): Child {
  const setVehicles = (vehicles: Vehicle[]) => set({ vehicles });
  const rules = roomSystem().rules;
  const name = (id?: string) => units.find((u) => u.id === id)?.name ?? "(gone)";
  const patch = (p: Partial<Vehicle>) => setVehicles(c.vehicles.map((o) => (o.id === v.id ? { ...o, ...p } : o)));
  const driver = units.find((u) => u.id === v.driver);
  const prof = driverProficient(v, driver?.sheet);
  const aboard = ridersOf(v).filter((r) => units.some((u) => u.id === r.id));
  const status = c.escaped.includes(v.id) ? h("span", { className: "small ok" }, " escaped") : v.hp <= 0 ? h("span", { className: "small bad" }, " wrecked") : c.out.includes(v.id) ? h("span", { className: "small bad" }, " out") : null;
  const applyDamage = run(async (x) => {
    const raw = (amounts[v.id] ?? "").trim();
    const n = Math.abs(Number(raw.replace(/^[+-]/, "")));
    if (!raw || !Number.isFinite(n)) return;
    amounts[v.id] = "";
    if (raw.startsWith("+")) { const cur = vehicleById(x, v.id)!; setVehicle(x, { ...cur, hp: Math.min(cur.maxHp, cur.hp + n) }); say(x, `${v.name} is patched up to ${Math.min(cur.maxHp, cur.hp + n)} HP.`); return; }
    await hurtVehicle(x, v.id, n, types[v.id] || undefined, "the GM");
  });
  const num = (label: string, key: "ac" | "maxHp" | "dt" | "mt" | "speed" | "str" | "dex" | "con" | "exhaustion", title?: string) =>
    h("label", { className: "small", title: title ?? "" }, `${label} `, h("input", { type: "number", className: "num", min: 0, value: String(v[key]), onchange: (e: Event) => {
      const val = Math.max(0, Number((e.target as HTMLInputElement).value) || 0);
      void patch(key === "maxHp" ? { maxHp: Math.max(1, val), hp: Math.min(Math.max(1, val), v.hp === v.maxHp ? val : v.hp) } : key === "exhaustion" ? { exhaustion: Math.min(6, val) } : { [key]: val })();
    } }));

  return h("div", { className: "dm-item", style: "flex-direction:column;align-items:stretch" },
    h("div", { className: "row wrap" },
      h("strong", { className: "grow", title: v.basis ?? "" }, v.name), status,
      h("select", { onchange: (e: Event) => void patch({ side: (e.target as HTMLSelectElement).value as Vehicle["side"] })() },
        h("option", { value: "", selected: !v.side }, "not in the chase"), h("option", { value: "quarry", selected: v.side === "quarry" }, "Quarry"), h("option", { value: "pursuer", selected: v.side === "pursuer" }, "Pursuer")),
      v.side === "quarry" ? h("label", { className: "small", title: "The lead pursuer never lost sight of it: its escape check fails" },
        h("input", { type: "checkbox", checked: c.inSight.includes(v.id), onchange: set({ inSight: c.inSight.includes(v.id) ? c.inSight.filter((o) => o !== v.id) : [...c.inSight, v.id] }) }), "in sight") : null,
      h("button", { className: "icon tiny", title: "Remove the vehicle", disabled: c.active && !!v.side, onclick: () => void setVehicles(c.vehicles.filter((o) => o.id !== v.id))() }, "✕")),
    h("div", { className: "small muted" },
      `AC ${v.ac}${v.overturned ? " (attacks have Advantage: it isn't moving)" : ""} · ${v.hp}/${v.maxHp} HP · threshold ${effectiveDt(v) || "—"}${effectiveDt(v) !== v.dt ? ` (${v.dt})` : ""} · mishap ${v.mt || "—"} · Speed ${effectiveSpeed(v, rules)} ft${effectiveSpeed(v, rules) !== v.speed ? ` (${v.speed})` : ""} · Str ${mod(v.str)} Dex ${mod(v.dex)} Con ${mod(v.con)} · Dashes ${v.dashes}/${freeDashes(Math.floor((v.con - 10) / 2))} free${v.exhaustion ? ` · Exhaustion ${v.exhaustion}` : ""}`),
    h("div", { className: "small" },
      driver ? `Driver: ${driver.name} (${prof ? `proficient, +${driver.sheet.proficiencyBonus}` : "not proficient"})` : h("span", { className: "warn" }, "No driver: it fails Dexterity saves and checks, and has no turn in the chase."),
      " ", h("select", { className: "small", title: `Driver proficiency with ${v.terrain === "land" ? "Land" : "Water"} Vehicles`, onchange: (e: Event) => { const s = (e.target as HTMLSelectElement).value; void patch({ proficient: s === "" ? undefined : s === "1" })(); } },
        h("option", { value: "", selected: v.proficient === undefined }, "proficiency from the sheet"), h("option", { value: "1", selected: v.proficient === true }, "proficient"), h("option", { value: "0", selected: v.proficient === false }, "not proficient"))),
    aboard.length > 1 ? h("div", { className: "small muted" }, "Aboard: ", aboard.filter((r) => r.at !== "driver").map((r) => `${name(r.id)} (${RIDER_LABEL[r.at].toLowerCase()})`).join(", ")) : null,
    v.cover ? h("div", { className: "small ok" }, "Three-Quarters Cover against other vehicles until its driver's next turn.") : null,
    v.overturned ? h("div", { className: "row small" }, h("span", { className: "bad" }, "Overturned: dead stop."), h("button", { className: "secondary small", onclick: patch({ overturned: undefined }) }, "Righted")) : null,
    ...v.mishaps.map((k) => {
      const m = mishapByKey(k);
      const rkey = `${v.id}:${k}`;
      return h("div", { className: "row wrap small" }, h("span", { className: "bad", title: m.text }, `⚠ ${m.name}`),
        m.repair ? h("select", { title: "Who repairs it (within reach, not at the helm or a weapon)", onchange: (e: Event) => { repairer[rkey] = (e.target as HTMLSelectElement).value; } },
          h("option", { value: "" }, "repair by…"), ...units.filter((u) => !u.dead).map((u) => h("option", { value: u.id, selected: repairer[rkey] === u.id }, u.name))) : null,
        m.repair ? h("label", { title: "Proficient with the tools used (smith's, carpenter's, tinker's…)" }, h("input", { type: "checkbox", checked: !!tools[rkey], onchange: () => { tools[rkey] = !tools[rkey]; } }), "tools") : null,
        m.repair ? h("button", { className: "secondary small", title: `DC ${m.repair.dc} ${m.repair.ability.toUpperCase()} check, Disadvantage while it moves`, onclick: run(async (x) => { if (repairer[rkey]) await repairMishap(x, v.id, k, repairer[rkey]!, !!tools[rkey]); }) }, "Repair") : null,
        h("button", { className: "icon tiny", title: "End the mishap", onclick: run(async (x) => { const cur = vehicleById(x, v.id)!; setVehicle(x, { ...cur, mishaps: cur.mishaps.filter((o) => o !== k) }); say(x, `${m.name} on ${v.name} ends.`); if (k === "smoke") await clearSmoke(x, cur); }) }, "✕"));
    }),
    h("div", { className: "row wrap" },
      h("input", { type: "text", className: "num", placeholder: "12 / +5", title: "Damage (12) or repair (+5); Enter applies. The damage threshold and mishap threshold apply.", value: amounts[v.id] ?? "",
        oninput: (e: Event) => { amounts[v.id] = (e.target as HTMLInputElement).value; }, onkeydown: (e: KeyboardEvent) => { if (e.key === "Enter") void applyDamage(); } }),
      h("select", { title: "Damage type", onchange: (e: Event) => { types[v.id] = (e.target as HTMLSelectElement).value; } },
        h("option", { value: "" }, "type"), ...DAMAGE_TYPES.map((t) => h("option", { value: t, selected: types[v.id] === t }, t))),
      h("button", { className: "icon tiny", title: "Apply", onclick: applyDamage }, "✓"),
      h("button", { className: "secondary small", title: "Roll on the Mishaps table", onclick: run((x) => rollMishap(x, v.id, "the GM")) }, "Mishap")),
    h("div", { className: "row wrap" },
      h("input", { type: "number", className: "num", min: 0, placeholder: String(v.speed), title: "Feet moved since its last turn", value: crashFeet[v.id] ?? "", oninput: (e: Event) => { crashFeet[v.id] = (e.target as HTMLInputElement).value; } }),
      h("span", { className: "small" }, "ft"),
      h("button", { className: "secondary small", title: "Crash into a wall, another vehicle or anything solid: 1d6 per 10 feet to both, riders DC 15 Strength save for half", onclick: run((x) => crashVehicle(x, v.id, feetOf(v), "something solid")) }, "Crash"),
      h("select", { onchange: (e: Event) => { ramTarget[v.id] = (e.target as HTMLSelectElement).value; } },
        h("option", { value: "" }, "run down…"), ...units.filter((u) => !u.dead && !ridersOf(v).some((r) => r.id === u.id)).map((u) => h("option", { value: u.id, selected: ramTarget[v.id] === u.id }, u.name))),
      h("button", { className: "secondary small", title: "Drive into a creature's space: DC 10 Dexterity save to get clear, else 1d6 per 10 feet", onclick: run(async (x) => { if (ramTarget[v.id]) await ramCreature(x, v.id, ramTarget[v.id]!, feetOf(v)); }) }, "Ram")),
    h("details", {}, h("summary", { className: "small" }, "Edit stats"),
      h("div", { className: "row wrap" },
        h("input", { type: "text", value: v.name, onchange: (e: Event) => void patch({ name: (e.target as HTMLInputElement).value.trim() || v.name })() }),
        h("select", { onchange: (e: Event) => void patch({ terrain: (e.target as HTMLSelectElement).value as Vehicle["terrain"] })() },
          h("option", { value: "land", selected: v.terrain === "land" }, "Land"), h("option", { value: "water", selected: v.terrain === "water" }, "Water"), h("option", { value: "air", selected: v.terrain === "air" }, "Air")),
        h("select", { onchange: (e: Event) => void patch({ size: (e.target as HTMLSelectElement).value as Vehicle["size"] })() },
          ...["M", "L", "H", "G"].map((s) => h("option", { value: s, selected: v.size === s }, { M: "Medium", L: "Large", H: "Huge", G: "Gargantuan" }[s]!))),
        num("AC", "ac"), num("Max HP", "maxHp"), num("Threshold", "dt", "Damage threshold: less damage than this does nothing"), num("Mishap", "mt", "Mishap threshold: this much damage from one source causes a mishap"),
        num("Speed", "speed"), num("Str", "str"), num("Dex", "dex"), num("Con", "con"), num("Exhaustion", "exhaustion", "Vehicular Exhaustion: only repairs remove it (1 hour, DC 15 Intelligence check with spare parts)"),
        h("label", { className: "small" }, h("input", { type: "checkbox", checked: v.weapons, onchange: patch({ weapons: !v.weapons }) }), "has weapons")),
      v.basis ? h("div", { className: "small muted" }, v.basis) : null));
}

const feetOf = (v: Vehicle) => { const n = Number(crashFeet[v.id]); return Number.isFinite(n) && n > 0 ? n : v.speed; };
