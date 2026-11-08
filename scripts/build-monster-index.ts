/**
 * Builds public/data/monsters.json: a compact search index of every 5etools creature (copies resolved),
 * used by the extension's monster search and its filters (CR, type, environment, size, spellcaster).
 * Re-run to refresh:  npm run index:build
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { encodeEnvs, guessEnvs, normalizeEnvs, type Env } from "../src/core/habitat";
import { FivetoolsLibrary } from "./lib/fivetools-library";

const lib = await new FivetoolsLibrary(resolve(".cache/5etools"), undefined, (s) => console.log(s)).init();
const typeOf = (t: any): string => (typeof t === "string" ? t : typeof t?.type === "string" ? t.type : Array.isArray(t?.type?.choose) ? t.type.choose.join("/") : "");
const crOf = (cr: any): string => (typeof cr === "string" ? cr : typeof cr?.cr === "string" ? cr.cr : "");
const speedOf = (v: any): number => (typeof v === "number" ? v : typeof v?.number === "number" ? v.number : 0);
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s*\(.*?\)\s*/g, " ").trim();
const isCaster = (m: any) => !!m.spellcasting?.length
  || [...(m.trait ?? []), ...(m.action ?? [])].some((e: any) => /spellcasting/i.test(e?.name ?? ""));

interface Pending { row: (string | number)[]; m: any; envs: Env[] | "any" | null }
const pending: Pending[] = [];
const byName = new Map<string, Env[] | "any">();

for (const source of Object.keys(lib.catalog)) {
  for (const raw of (await lib.loadSource(source)).monster ?? []) {
    try {
      const m = (await lib.prepare(raw.name, raw.source)).monster;
      const envs = normalizeEnvs(m.environment);
      if (envs && !byName.has(norm(m.name))) byName.set(norm(m.name), envs);
      // [name, source, cr, type, size, hasOwnToken(1/0), env, spellcaster(1/0)]
      pending.push({ row: [m.name, m.source, crOf(m.cr), typeOf(m.type), (m.size ?? ["M"])[0], m.hasToken ? 1 : 0], m, envs });
    } catch (e) {
      console.warn(`skip ${raw.name} (${raw.source}): ${e instanceof Error ? e.message : e}`);
    }
  }
}

let fromData = 0, fromName = 0, guessed = 0;
const rows = pending.map(({ row, m, envs }) => {
  let cell: string;
  if (envs) { cell = encodeEnvs(envs, false); fromData++; }
  else if (byName.has(norm(m.name))) { cell = encodeEnvs(byName.get(norm(m.name))!, true); fromName++; }
  else {
    cell = encodeEnvs(guessEnvs({
      name: m.name, type: typeOf(m.type),
      speed: { walk: speedOf(m.speed?.walk), swim: speedOf(m.speed?.swim), fly: speedOf(m.speed?.fly), burrow: speedOf(m.speed?.burrow), climb: speedOf(m.speed?.climb) },
      traits: JSON.stringify(m.trait ?? []).slice(0, 4000),
      languages: Array.isArray(m.languages) ? m.languages.join(", ") : undefined,
    }), true);
    guessed++;
  }
  return [...row, cell, isCaster(m) ? 1 : 0];
});

const books = Object.fromEntries(Object.values(lib.catalog).map((c) => [c.source, [c.title, c.rules]]));
mkdirSync("public/data", { recursive: true });
const out = { generatedAt: new Date().toISOString(), columns: ["name", "source", "cr", "type", "size", "token", "env", "caster"], books, rows };
writeFileSync("public/data/monsters.json", JSON.stringify(out));
console.log(`public/data/monsters.json: ${rows.length} creatures, ${(JSON.stringify(out).length / 1024).toFixed(0)} KB`);
console.log(`environments: ${fromData} from 5etools, ${fromName} from the same creature in another book, ${guessed} assigned by rules; spellcasters: ${rows.filter((r) => r[7] === 1).length}`);
