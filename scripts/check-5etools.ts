/**
 * Smoke test: resolve + convert EVERY 5etools creature and validate the unit metadata it would produce.
 *   npm run check:5etools
 */
import { resolve } from "node:path";
import { unitMetadata, unitState } from "../src/core/unit";
import { convertMonster } from "../src/core/fivetools";
import { FivetoolsLibrary } from "./lib/fivetools-library";

const lib = await new FivetoolsLibrary(resolve(".cache/5etools")).init();
let total = 0, copies = 0, ok = 0, advAuto = 0, advCond = 0;
const failures: string[] = [];
const byError = new Map<string, number>();
const sizes: { name: string; bytes: number }[] = [];
for (const source of Object.keys(lib.catalog)) {
  const data = await lib.loadSource(source);
  for (const raw of data.monster ?? []) {
    total++;
    if (raw._copy) copies++;
    try {
      const r = await lib.prepare(raw.name, raw.source);
      const sb = convertMonster(r.monster, { catalogEntry: r.catalogEntry, copyChain: r.copyChain, copyNotes: r.copyNotes });
      const meta = unitMetadata(sb, unitState(sb, { max: sb.hp.max, current: sb.hp.max }, null)); // throws on an invalid sheet
      if (!Number.isFinite(sb.initiative.modifier)) throw new Error("initiative modifier not finite");
      if (sb.initiative.advantage) advAuto++;
      if (sb.initiative.conditional?.length) advCond++;
      sizes.push({ name: `${raw.name} (${raw.source})`, bytes: new TextEncoder().encode(JSON.stringify(meta)).length });
      ok++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      failures.push(`${raw.name} (${raw.source}): ${msg}`);
      const key = msg.replace(/"[^"]*"/g, '"…"').replace(/\(\w+\)/g, "(…)").slice(0, 90);
      byError.set(key, (byError.get(key) ?? 0) + 1);
    }
  }
}
console.log(`creatures ${total} (copies ${copies}) — converted OK ${ok}, failed ${failures.length}`);
console.log(`initiative advantage applied automatically: ${advAuto}; conditional effects flagged: ${advCond}`);
sizes.sort((a, b) => b.bytes - a.bytes);
if (sizes.length) {
  const kb = (b: number) => `${(b / 1024).toFixed(1)} kB`;
  const at = (q: number) => sizes[Math.min(sizes.length - 1, Math.floor(sizes.length * q))]!.bytes;
  console.log(`per-token unit metadata: median ${kb(at(0.5))}, 99th percentile ${kb(at(0.01))}, max ${kb(sizes[0]!.bytes)}; over 16 kB: ${sizes.filter((x) => x.bytes > 16384).length}`);
  for (const x of sizes.slice(0, 5)) console.log(`  ${kb(x.bytes)}  ${x.name}`);
}
for (const [k, n] of [...byError].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`  ${n}× ${k}`);
for (const f of failures.slice(0, 15)) console.log(`  - ${f}`);
process.exit(failures.length ? 1 : 0);
