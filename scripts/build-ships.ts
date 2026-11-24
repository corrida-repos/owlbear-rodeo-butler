/**
 * Writes src/core/shipData.ts: the stat blocks of every ship and airship in 5etools `vehicles.json` that has hull
 * statistics (Ghosts of Saltmarsh ships, the Acquisitions Incorporated battle balloon and mechanical beholder, the
 * Astral Adventurer's Guide spelljammers, the Eberron: Forge of the Artificer elemental airships), plus the 2024
 * Player's Handbook airship (from its Airborne and Waterborne Vehicles table).
 * Usage: download data/vehicles.json from the 5etools mirror, then
 *   npx tsx scripts/build-ships.ts <path/to/vehicles.json>
 */
import { readFileSync, writeFileSync } from "node:fs";

const file = process.argv[2];
if (!file) throw new Error("Pass the path of the 5etools vehicles.json.");

type Raw = Record<string, any>;
const clean = (s: string) => s
  .replace(/\{@atkr? ([^}]*)\}/g, (_m, k: string) => ({ rw: "Ranged Weapon Attack:", mw: "Melee Weapon Attack:", rs: "Ranged Spell Attack:", ms: "Melee Spell Attack:", g: "" } as Record<string, string>)[k] ?? "Attack:")
  .replace(/\{@hit (\d+)\}/g, "+$1").replace(/\{@h\}/g, "Hit: ").replace(/\{@m\}/g, "Miss: ")
  .replace(/\{@dc (\d+)\}/g, "DC $1").replace(/\{@\w+ ([^{}|]*)(\|[^{}]*)?\}/g, "$1").replace(/\s+/g, " ").trim();

function flat(e: unknown): string[] {
  if (typeof e === "string") return [e];
  if (Array.isArray(e)) return e.flatMap(flat);
  if (e && typeof e === "object") {
    const o = e as Raw;
    const inner = [...flat(o.entries ?? []), ...flat(o.items ?? []), ...flat(o.entry ?? [])];
    return o.name && o.type !== "list" ? [`${o.name}. ${inner.join(" ")}`] : inner;
  }
  return [];
}
const text = (e: unknown) => clean(flat(e).join(" "));
const num = (s: string) => Number(s.replace(/,/g, ""));

interface Attack { name: string; bonus: number; reach?: number; normal?: number; long?: number; min?: number; damage: { dice: string; type: string }[]; text: string }

/** "{@atk rw} {@hit 6} to hit, range 120/480 ft. (can't hit targets within 60 ft. of it), one target. {@h}16 ({@damage 3d10}) piercing damage." */
function attackOf(name: string, raw: string): Attack | null {
  const m = /\{@atkr? \w+\}\s*\{@hit (\d+)\}(?: to hit)?,?\s*(range|reach) ([\d,]+)(?:\/([\d,]+))? f(?:ee)?t\.?/.exec(raw);
  if (!m) return null;
  const min = /can't hit targets within (\d+) f(?:ee)?t/.exec(raw);
  const hit = raw.split(/\{@h\}/)[1] ?? "";
  // Only the damage that opens the Hit: clause ("16 (3d10) piercing damage and 22 (4d10) fire damage"), not what a miss splashes.
  const lead = /^\s*\d+ \(\{@damage [^}]+\}\) \w+ damage(?:,? (?:and|plus) \d+ \(\{@damage [^}]+\}\) \w+ damage)*/i.exec(hit)?.[0] ?? "";
  const damage = [...lead.matchAll(/\d+ \(\{@damage ([^}]+)\}\) (\w+) damage/gi)].map((d) => ({ dice: d[1]!.replace(/\s+/g, ""), type: d[2]![0]!.toUpperCase() + d[2]!.slice(1).toLowerCase() }));
  const a: Attack = { name, bonus: Number(m[1]), damage, text: clean(raw) };
  if (m[2] === "reach") a.reach = num(m[3]!);
  else { a.normal = num(m[3]!); if (m[4]) a.long = num(m[4]); }
  if (min) a.min = Number(min[1]);
  return a;
}

/** "45 ft.; 15 ft. while sailing into the wind; 60 ft. while sailing with the wind." */
function speedOf(raw: string) {
  const first = /(\d+) ft/.exec(raw);
  const into = /(\d+) ft\.? while \w+ into the wind/.exec(raw);
  const withW = /(\d+) ft\.? while \w+ with the wind/.exec(raw);
  const crew = /requires at least (\d+) crew/.exec(raw);
  return { normal: first ? Number(first[1]) : 0, ...(into ? { into: Number(into[1]) } : {}), ...(withW ? { with: Number(withW[1]) } : {}), ...(crew ? { minCrew: Number(crew[1]) } : {}) };
}

const SIZE_BY_FT = (ft: number) => (ft >= 20 ? "G" : ft >= 15 ? "H" : ft >= 10 ? "L" : "M");
/** Elemental airships have no dimensions: Butler's estimate from their crew and passengers. */
const EFA_SIZE: Record<string, string> = { "Lyrandar Skyskiff": "H", "Strider Airship": "G", "Lyrandar Air Cruiser": "G" };

const out: Raw[] = [];
const vehicles: Raw[] = JSON.parse(readFileSync(file, "utf8")).vehicle;
for (const v of vehicles) {
  if (!["SHIP", "SPELLJAMMER", "ELEMENTAL_AIRSHIP"].includes(v.vehicleType) || !v.hull) continue;
  const dims: string[] = v.dimensions ?? [];
  const longest = Math.max(0, ...dims.map((d) => Number(String(d).replace(/[^\d.]/g, "")) || 0));
  const size = v.size ?? EFA_SIZE[v.name] ?? SIZE_BY_FT(longest);
  const env = (v.terrain as string[]).map((t) => (t === "sea" ? "water" : t)).filter((t) => ["water", "air", "space"].includes(t));
  const comps: Raw[] = [];
  for (const c of v.control ?? []) comps.push({ kind: "control", name: c.name, ac: c.ac, hp: c.hp, ...(c.dt ? { dt: c.dt } : {}), text: text(c.entries) });
  for (const c of v.movement ?? []) {
    const sp = c.speed?.[0];
    const raw = flat(sp?.entries ?? []).join(" ");
    const per = /-(\d+) ft\. speed per (\d+) damage/.exec(c.hpNote ?? "");
    comps.push({
      kind: "movement", name: c.name, ac: c.ac, hp: c.hp, ...(c.dt ? { dt: c.dt } : {}), mode: sp?.mode ?? "water", speed: speedOf(raw),
      ...(per ? { per: { ft: Number(per[1]), dmg: Number(per[2]) } } : {}), ...(c.isControl ? { isControl: true } : {}), text: clean(raw),
    });
  }
  // Spelljammers and elemental airships fly by their helm: a movement entry with the ship's Fly Speed (no hit points of its own).
  if (!v.movement && v.speed) {
    const fly = typeof v.speed.fly === "object" ? v.speed.fly.number : v.speed.fly;
    if (fly) comps.push({ kind: "movement", name: v.vehicleType === "SPELLJAMMER" ? "Spelljamming helm" : "Elemental core", mode: "air", speed: { normal: fly }, text: `Fly ${fly} ft.${v.speed.canHover ? " (hover)" : ""}` });
  }
  // EFA "Breaking the Elemental Core": the Khyber dragonshard (AC 17, HP 10, immune to Piercing, Poison, Psychic, Slashing).
  if (v.vehicleType === "ELEMENTAL_AIRSHIP") comps.push({ kind: "control", name: "Elemental core shard", ac: 17, hp: 10, immune: ["Piercing", "Poison", "Psychic", "Slashing"],
    text: "The Khyber dragonshard holding the bound elemental. If it's broken, the ship ceases to move (it still hovers if airborne) and station actions that require the elemental core are disabled. Usually guarded in a fortified chamber." });
  for (const s of v.station ?? []) {
    const attacks = (s.action ?? []).map((a: Raw) => attackOf(a.name, flat(a.entries).join(" "))).filter(Boolean);
    comps.push({ kind: "station", name: s.name, ac: s.ac, hp: s.hp, crew: s.crew, text: text([...(s.entries ?? []), ...(s.action ?? [])]), ...(attacks.length ? { attacks } : {}) });
  }
  for (const w of v.weapon ?? []) {
    const entries = flat(w.entries ?? []).join(" ");
    const actions: Raw[] = w.action ?? [];
    const attacks = actions.length
      ? actions.map((a) => attackOf(a.name, flat(a.entries).join(" "))).filter(Boolean)
      : [attackOf(w.name.replace(/s$/, ""), entries)].filter(Boolean);
    const load = /takes (\d+) actions? to load/.exec(entries);
    const aim = /(\d+) actions? to aim/.exec(entries);
    comps.push({
      kind: "weapon", name: w.name, ...(w.ac ? { ac: w.ac } : {}), ...(w.hp ? { hp: w.hp } : {}), ...(w.dt ? { dt: w.dt } : {}), ...(w.count > 1 ? { count: w.count } : {}), ...(w.crew ? { crew: w.crew } : {}),
      ...(load ? { load: Number(load[1]) } : {}), ...(aim ? { aim: Number(aim[1]) } : {}), ...(/\bram\b/i.test(w.name) ? { ram: true } : {}),
      ...(attacks.length ? { attacks } : {}), text: text([...(w.entries ?? []), ...actions]),
    });
  }
  const t = v.actionThresholds as Record<string, number> | undefined;
  const thresholds = t ? Object.keys(t).map(Number).filter((n) => n > 0).sort((a, b) => a - b).map((n) => t[String(n)]!) : undefined;
  const hover = !!v.speed?.canHover || /\(hover\)/.test(JSON.stringify(v.movement ?? ""));
  out.push({
    key: `${v.name}|${v.source}`.toLowerCase().replace(/[^a-z0-9|]+/g, "-"), name: v.name, source: v.source, page: v.page,
    type: v.vehicleType === "SHIP" ? "ship" : v.vehicleType === "SPELLJAMMER" ? "spelljammer" : "airship",
    env: env.length ? env : ["water"], size, ...(dims.length ? { dims: dims.join(" by ") } : {}),
    crew: v.capCrew ?? 0, ...(v.capPassenger ? { passengers: v.capPassenger } : {}),
    ...(typeof v.str === "number" ? { abilities: { str: v.str, dex: v.dex, con: v.con } } : {}),
    hull: { ac: v.hull.ac, hp: v.hull.hp, ...(v.hull.dt ? { dt: v.hull.dt } : {}) },
    ...(hover ? { hover: true } : {}), ...(thresholds ? { thresholds } : {}),
    ...(v.action ? { actions: text(v.action) } : {}),
    components: comps,
  });
}
// The 2024 PHB airship: its table gives AC, HP, crew and travel pace only (8 mph = 80 ft per round). Butler's estimate for the rest.
out.push({
  key: "airship|xphb", name: "Airship", source: "XPHB", type: "ship", env: ["air"], size: "G", crew: 10, passengers: 20,
  hull: { ac: 13, hp: 300 }, components: [{ kind: "movement", name: "Propulsion", mode: "air", speed: { normal: 80 }, text: "Fly 80 ft. (8 mph on the Airborne and Waterborne Vehicles table)" }],
  note: "The 2024 PHB gives only AC, HP, crew and speed: it has no ability scores or components (Butler: one action per turn, needs at least one crew).", thresholds: [1],
});
out.sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));

writeFileSync("src/core/shipData.ts", `/**
 * Ship and airship stat blocks from 5etools vehicles.json (GoS, AI, AAG, EFA) and the 2024 PHB airship. Generated by
 * scripts/build-ships.ts; don't edit by hand. Rules that use them: core/naval.ts.
 */
import type { ShipPreset } from "./naval";

export const SHIP_PRESETS: ShipPreset[] = ${JSON.stringify(out, null, 1).replace(/\n\s*/g, " ")};
`.replace(/\}, \{ "key"/g, "},\n  { \"key\""));
console.log(`${out.length} ships`);
