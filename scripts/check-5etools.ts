/**
 * Smoke test: resolve + convert EVERY 5etools creature and validate the Forge metadata it would produce.
 *   npm run check:5etools
 */
import { resolve } from "node:path";
import { FORGE_DEFAULT_DND5E } from "../src/core/constants";
import { buildForgeMetadata, validateForgeMetadata } from "../src/core/forge";
import { convertMonster } from "../src/core/fivetools";
import { FivetoolsLibrary } from "./lib/fivetools-library";

const lib = await new FivetoolsLibrary(resolve(".cache/5etools")).init();
let total = 0, copies = 0, ok = 0, advAuto = 0, advCond = 0;
const failures: string[] = [];
const byError = new Map<string, number>();
for (const source of Object.keys(lib.catalog)) {
  const data = await lib.loadSource(source);
  for (const raw of data.monster ?? []) {
    total++;
    if (raw._copy) copies++;
    try {
      const r = await lib.prepare(raw.name, raw.source);
      const sb = convertMonster(r.monster, { catalogEntry: r.catalogEntry, copyChain: r.copyChain, copyNotes: r.copyNotes });
      let n = 0;
      const meta = buildForgeMetadata(
        { key: "k", name: sb.name, statblock: "s", token: "t", cell: { x: 0, y: 0 }, hp: { max: sb.hp.average, current: sb.hp.average, method: "average" }, initiative: null },
        sb, { total: 10 } as any, () => `id${n++}`,
      );
      const errs = validateForgeMetadata(meta, FORGE_DEFAULT_DND5E);
      if (errs.length) throw new Error(`forge: ${errs[0]}`);
      if (!Number.isFinite(sb.initiative.modifier)) throw new Error("initiative modifier not finite");
      if (sb.initiative.advantage) advAuto++;
      if (sb.initiative.conditional?.length) advCond++;
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
for (const [k, n] of [...byError].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`  ${n}× ${k}`);
for (const f of failures.slice(0, 15)) console.log(`  - ${f}`);
process.exit(failures.length ? 1 : 0);
