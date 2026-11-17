/** Writes public/hazards/<key>.svg: one picture per DMG hazard and trap (see src/core/hazards.ts). Run: npx tsx scripts/make-hazard-images.ts */
import { mkdirSync, writeFileSync } from "node:fs";
import { HAZARDS } from "../src/core/hazards";

const GLYPH: Record<string, string> = {
  "brown-mold": "M60 120 q20-40 40 0 q20-40 40 0 q-40 30-80 0Z", "green-slime": "M50 70 q50-30 100 0 v40 q-10 30-20 0 q-10 40-30 0 q-10 30-25 0 q-10 30-25 0Z",
  "yellow-mold": "M70 110 a15 15 0 1 1 30 0 a15 15 0 1 1 30 0 a15 15 0 1 1-60 0Z", inferno: "M100 40 q30 40 10 60 q30-10 20 40 q-30 20-60 0 q-10-40 20-40 q-20-30 10-60Z",
  "poisonous-gas": "M50 110 q0-30 30-25 q10-30 40-15 q30-5 30 25 q10 25-20 30 h-60 q-25 0-20-15Z", "quicksand-pit": "M40 100 q30-20 60 0 t60 0 M40 120 q30-20 60 0 t60 0 M40 80 q30-20 60 0 t60 0",
  razorvine: "M40 140 q30-80 60-40 q30 40 60-60 M70 110 l-10-15 M110 95 l10-15 M135 70 l15 0", rockslide: "M50 140 l25-45 l30 15 l25-40 l30 70Z",
  "vicious-vine": "M60 150 q-10-60 40-60 q50 0 40-50 M100 90 q-30 10-20 30", webs: "M100 40 v120 M40 100 h120 M58 58 l84 84 M142 58 l-84 84 M70 100 a30 30 0 0 1 60 0 a30 30 0 0 1-60 0",
  "fireball-fungus": "M60 100 q40-60 80 0Z M95 100 v40 h10 v-40", "river-styx": "M30 90 q35-25 70 0 t70 0 M30 120 q35-25 70 0 t70 0",
  "collapsing-roof": "M40 50 h120 M60 50 l-10 40 M100 50 l10 50 M140 50 l-5 35 M70 130 l15-10 l15 10Z", "falling-net": "M40 50 h120 l-20 90 h-80Z M60 50 l20 90 M100 50 v90 M140 50 l-20 90 M45 80 h110 M52 110 h96",
  "fire-casting-statue": "M80 150 v-50 h40 v50 M75 100 q25-50 50 0 M125 85 l35-15 l-5 25Z", "hidden-pit": "M40 80 h120 v70 h-120Z M40 80 l20 20 h80 l20-20",
  "poisoned-darts": "M40 70 l60 10 M40 100 l60 0 M40 130 l60-10 M100 80 l15 2 M100 100 h15 M100 120 l15-2", "poisoned-needle": "M70 60 h60 v80 h-60Z M100 90 a8 8 0 1 1 0.1 0 M100 98 v20 M130 100 l35-10",
  "rolling-stone": "M100 100 m-45 0 a45 45 0 1 0 90 0 a45 45 0 1 0-90 0 M70 85 q30 10 60-10", "spiked-pit": "M40 80 h120 v70 h-120Z M55 150 l10-30 l10 30 M85 150 l10-30 l10 30 M115 150 l10-30 l10 30",
};

mkdirSync("public/hazards", { recursive: true });
for (const d of HAZARDS) {
  const trap = d.kind === "trap";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
<rect x="4" y="4" width="192" height="192" rx="18" fill="${d.color}" fill-opacity="0.35" stroke="${d.color}" stroke-width="8"${trap ? ' stroke-dasharray="18 10"' : ""}/>
<path d="${GLYPH[d.key] ?? "M60 60 h80 v80 h-80Z"}" fill="none" stroke="#ffffff" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
<path d="${GLYPH[d.key] ?? "M60 60 h80 v80 h-80Z"}" fill="none" stroke="${d.color}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
<text x="100" y="185" font-family="Arial, Helvetica, sans-serif" font-size="${d.name.length > 14 ? 15 : 18}" font-weight="700" fill="#ffffff" stroke="#000000" stroke-width="3" paint-order="stroke" text-anchor="middle">${trap ? "⚠ " : ""}${d.name}</text>
</svg>
`;
  writeFileSync(`public/hazards/${d.key}.svg`, svg);
}
console.log(`wrote ${HAZARDS.length} pictures`);
