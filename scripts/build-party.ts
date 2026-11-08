/**
 * Converts a D&D Beyond export (saved from the browser, see README "Party sync") into a party package.
 *
 *   npm run party:build -- party/ddb-party-<campaign>.json [--id <slug>] [--out party/<slug>.party.json]
 *
 * Output stays in party/ (git-ignored): character sheets are your players' private data, never published.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { convertDdbCharacter } from "../src/core/ddb";
import { makePartyPackage, validateParty } from "../src/core/party";

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : undefined; };
const src = process.argv[2];
if (!src || src.startsWith("--")) throw new Error("usage: build-party <ddb-export.json> [--id slug] [--out file]");
const exp = JSON.parse(readFileSync(src, "utf8"));
if (exp.schema !== "owlbear-butler/ddb-export@1") throw new Error(`${src} is not a D&D Beyond export (schema ${exp.schema})`);
const slug = arg("id") ?? String(exp.campaign?.name ?? "party").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
if (!exp.partyInventory) console.warn("note: export has no partyInventory; items equipped from the campaign's shared stash won't count.");
const members = exp.characters.map((c: any) => convertDdbCharacter(c, { partyInventory: exp.partyInventory }));
const pkg = makePartyPackage(slug, exp.campaign, exp.fetchedAt, members);
const errs = validateParty(pkg);
if (errs.length) throw new Error(errs.join("\n"));
const out = arg("out") ?? join("party", `${slug}.party.json`);
writeFileSync(out, JSON.stringify(pkg, null, 2));

console.log(`${exp.campaign?.name} → ${out} (${(JSON.stringify(pkg).length / 1024).toFixed(0)} KB, D&D Beyond data from ${exp.fetchedAt})`);
for (const m of members) {
  const f = m.sheet;
  console.log(`  ${m.name.padEnd(22)} ${m.classes.padEnd(22)} HP ${m.hp.current}/${m.hp.max}  AC ${m.ac}  init ${m.initiative.modifier >= 0 ? "+" : ""}${m.initiative.modifier}${m.initiative.advantage ? " (adv)" : ""}  ` +
    `actions ${f.actions.length}, spells ${f.spells.length}, features ${f.traits.length}`);
  for (const fl of m.flags) console.log(`      · ${fl}`);
}
