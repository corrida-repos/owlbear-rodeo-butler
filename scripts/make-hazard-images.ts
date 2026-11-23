/**
 * Writes public/hazards/<key>.svg: one top-down map picture per hazard and trap (art in map-art.ts).
 * Run: npx tsx scripts/make-hazard-images.ts, then node scripts/rasterize-hazards.cjs for the .webp files.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { HAZARDS } from "../src/core/hazards";
import { DEFS, MAP_ART, SIZE } from "./map-art";

mkdirSync("public/hazards", { recursive: true });
for (const d of HAZARDS) {
  const art = MAP_ART[d.key];
  if (!art) throw new Error(`No map art for ${d.key} (add it to scripts/map-art.ts)`);
  // On a transparent background, no label (Owlbear shows the item's name).
  writeFileSync(`public/hazards/${d.key}.svg`, `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">\n<defs>${DEFS}</defs>\n${art()}\n</svg>\n`);
}
console.log(`wrote ${HAZARDS.length} pictures`);
