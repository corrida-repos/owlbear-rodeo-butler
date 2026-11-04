/**
 * Builds public/data/monsters.json: a compact search index of every 5etools creature (copies resolved),
 * used by the extension's monster search. Re-run to refresh:  npm run index:build
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { FivetoolsLibrary } from "./lib/fivetools-library";

const lib = await new FivetoolsLibrary(resolve(".cache/5etools"), undefined, (s) => console.log(s)).init();
const typeOf = (t: any): string => (typeof t === "string" ? t : typeof t?.type === "string" ? t.type : Array.isArray(t?.type?.choose) ? t.type.choose.join("/") : "");
const crOf = (cr: any): string => (typeof cr === "string" ? cr : typeof cr?.cr === "string" ? cr.cr : "");

const rows: (string | number)[][] = [];
for (const source of Object.keys(lib.catalog)) {
  for (const raw of (await lib.loadSource(source)).monster ?? []) {
    try {
      const m = (await lib.prepare(raw.name, raw.source)).monster;
      // [name, source, cr, type, size, hasOwnToken(1/0)]
      rows.push([m.name, m.source, crOf(m.cr), typeOf(m.type), (m.size ?? ["M"])[0], m.hasToken ? 1 : 0]);
    } catch (e) {
      console.warn(`skip ${raw.name} (${raw.source}): ${e instanceof Error ? e.message : e}`);
    }
  }
}
const books = Object.fromEntries(Object.values(lib.catalog).map((c) => [c.source, [c.title, c.rules]]));
mkdirSync("public/data", { recursive: true });
const out = { generatedAt: new Date().toISOString(), columns: ["name", "source", "cr", "type", "size", "token"], books, rows };
writeFileSync("public/data/monsters.json", JSON.stringify(out));
console.log(`public/data/monsters.json: ${rows.length} creatures, ${(JSON.stringify(out).length / 1024).toFixed(0)} KB`);
