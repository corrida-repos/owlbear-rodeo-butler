/**
 * Builds an encounter package from a source spec.
 *
 *   npm run encounter:build -- encounters/<id>/encounter.source.json [options]
 *
 * Options
 *   --out <dir>        output dir (default: public/encounters/<id>)
 *   --base <url>       public URL of the output dir; asset URLs become absolute (needed if you paste/upload the JSON)
 *   --seed <n>         deterministic rolls (tests only; omit for real games)
 *   --data <dir>       read 5etools data (bestiary/*.json, books.json, adventures.json) from a local folder
 *   --offline          skip network checks of token URLs
 *
 * Writes <out>/encounter.json (+ copies local map/token files into <out>/assets/).
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { buildPackage, type EncounterSource } from "../src/core/builder";
import { cryptoRng, describeInitiative, seededRng } from "../src/core/dice";
import { validatePackage, type ImageRef } from "../src/core/schema";
import { FivetoolsLibrary } from "./lib/fivetools-library";
import { imageSize } from "./lib/image-size";

type SourceInput = Omit<EncounterSource, "map"> & {
  map: Omit<EncounterSource["map"], "image" | "width" | "height"> & { image?: ImageRef; file?: string; width?: number; height?: number };
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function urlExists(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, { method: "HEAD" });
    return r.ok;
  } catch {
    return false;
  }
}

async function main() {
  const srcPath = process.argv[2];
  if (!srcPath || srcPath.startsWith("--")) throw new Error("usage: build-encounter <encounter.source.json> [--out dir] [--base url] [--seed n]");
  const srcDir = dirname(resolve(srcPath));
  const input: SourceInput = JSON.parse(readFileSync(srcPath, "utf8"));
  const outDir = resolve(arg("out") ?? join("public", "encounters", input.id));
  const base = arg("base");
  const seed = arg("seed");
  const offline = process.argv.includes("--offline");
  mkdirSync(join(outDir, "assets"), { recursive: true });

  const assetUrl = (file: string) => (base ? new URL(`assets/${file}`, base.endsWith("/") ? base : `${base}/`).toString() : `assets/${file}`);

  // ---- map: copy local file and read its pixel size
  let mapImage = input.map.image;
  let { width, height } = input.map;
  if (input.map.file) {
    const p = resolve(srcDir, input.map.file);
    const bytes = readFileSync(p);
    const size = imageSize(bytes);
    width = size.width;
    height = size.height;
    copyFileSync(p, join(outDir, "assets", basename(p)));
    mapImage = { kind: "url", url: assetUrl(basename(p)), width, height, mime: size.mime };
  }
  if (!mapImage || !width || !height) throw new Error("map needs either `file`, or `image` + `width` + `height`");

  // ---- local token files
  for (const g of input.groups) {
    if (g.token !== "fivetools" && g.token.kind === "url" && !/^[a-z]+:/i.test(g.token.url)) {
      const p = resolve(srcDir, g.token.url);
      const size = imageSize(readFileSync(p));
      copyFileSync(p, join(outDir, "assets", basename(p)));
      Object.assign(g.token, { url: assetUrl(basename(p)), width: size.width, height: size.height, mime: size.mime });
    }
  }

  // ---- 5etools data: any book in 5etools' index; copies resolved across books
  const lib = await new FivetoolsLibrary(resolve(".cache/5etools"), arg("data"), (s) => console.log(s)).init();
  for (const g of input.groups) {
    if ("fivetools" in g.statblock) await lib.prepare(g.statblock.fivetools.name, g.statblock.fivetools.source);
  }

  const pkg = buildPackage(
    { ...input, map: { ...input.map, image: mapImage, width, height } },
    { fivetools: lib.get, rng: seed ? seededRng(Number(seed)) : cryptoRng },
  );

  // ---- pick the first reachable image: own token → own art → base creature's token/art
  if (!offline) {
    for (const [key, a] of Object.entries(pkg.assets)) {
      if (a.image.kind !== "url" || !/^https:/.test(a.image.url)) { delete a.candidates; continue; }
      if (base && a.image.url.startsWith(base)) { delete a.candidates; continue; } // our own output; reachable once deployed
      const candidates = a.candidates ?? [a.image.url];
      let found: string | null = null;
      for (const c of candidates) if (await urlExists(c)) { found = c; break; }
      delete a.candidates;
      if (!found) { pkg.warnings.push(`${key}: no reachable image (tried ${candidates.length}). Provide artwork or pick from the Owlbear library.`); continue; }
      if (found !== candidates[0]) {
        const isToken = /\/tokens\//.test(found);
        const isBase = candidates.indexOf(found) >= 2;
        a.credit = `${a.credit} (${isBase ? "base creature's " : ""}${isToken ? "token" : "full artwork"})`;
        pkg.warnings.push(`${key}: no own 5etools token; using the ${isBase ? "base creature's " : ""}${isToken ? "token" : "full book artwork (not circular)"} instead.`);
      }
      a.image.url = found;
    }
  } else for (const a of Object.values(pkg.assets)) delete a.candidates;

  const v = validatePackage(pkg);
  if (!v.ok) throw new Error(`built package is invalid:\n${v.errors.join("\n")}`);
  const outFile = join(outDir, "encounter.json");
  writeFileSync(outFile, JSON.stringify(pkg, null, 2));

  // ---- summary
  console.log(`\n${pkg.title}  →  ${outFile}`);
  console.log(`map: ${pkg.map.name} ${pkg.map.width}×${pkg.map.height}px, ${pkg.map.grid.cols}×${pkg.map.grid.rows} cells @ ${pkg.map.grid.cellPx}px, ${pkg.map.grid.scale}`);
  for (const c of pkg.creatures) {
    const sb = pkg.statblocks[c.statblock]!;
    console.log(`  ${c.name.padEnd(18)} HP ${String(c.hp.max).padStart(3)} (${c.hp.method})  init ${describeInitiative(c.initiative!)}  @(${c.cell.x},${c.cell.y})  [${sb.source.provenance} ${sb.source.book ?? ""} p.${sb.source.page ?? "?"}]`);
  }
  for (const [k, sb] of Object.entries(pkg.statblocks)) {
    console.log(`  ${k}: initiative ${sb.initiative.reasons.join("; ")}`);
    for (const f of sb.flags) console.log(`    flag: ${f}`);
  }
  for (const a of pkg.assumptions) console.log(`  assumption: ${a}`);
  for (const w of [...pkg.warnings, ...v.warnings]) console.log(`  WARNING: ${w}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
