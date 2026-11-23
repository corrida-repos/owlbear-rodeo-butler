/** Writes public/hazards/<key>.svg: one picture per hazard and trap (see src/core/hazards.ts). Run: npx tsx scripts/make-hazard-images.ts */
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
const PIT = "M40 80 h120 v70 h-120Z M40 80 l20 20 h80 l20-20";
const NET = "M40 50 h120 l-20 90 h-80Z M60 50 l20 90 M100 50 v90 M140 50 l-20 90 M45 80 h110 M52 110 h96";
const SPIKES = "M40 80 h120 v70 h-120Z M55 150 l10-30 l10 30 M85 150 l10-30 l10 30 M115 150 l10-30 l10 30";
const SPHERE = "M100 100 m-45 0 a45 45 0 1 0 90 0 a45 45 0 1 0-90 0 M70 85 q30 10 60-10";
const GAS = "M50 110 q0-30 30-25 q10-30 40-15 q30-5 30 25 q10 25-20 30 h-60 q-25 0-20-15Z";
const EYE = "M40 100 q60-60 120 0 q-60 60-120 0Z M100 100 m-14 0 a14 14 0 1 0 28 0 a14 14 0 1 0-28 0";
Object.assign(GLYPH, {
  "collapsing-roof-2014": GLYPH["collapsing-roof"], "falling-net-2014": NET, "net-trap": NET,
  "fire-breathing-statue": GLYPH["fire-casting-statue"], "simple-pit": "M40 80 h120 v70 h-120Z M45 80 q55 25 110 0",
  "hidden-pit-2014": PIT, "locking-pit": "M40 80 h120 v70 h-120Z M40 80 h120 M95 65 h10 v15 h-10Z", "spiked-pit-2014": SPIKES, "pit-trap": PIT,
  "poison-darts": GLYPH["poisoned-darts"], "poison-needle": GLYPH["poisoned-needle"], "poison-needle-trap": GLYPH["poisoned-needle"],
  "rolling-sphere": SPHERE, "sphere-of-crushing-doom": SPHERE, "sphere-of-annihilation": "M100 100 m-45 0 a45 45 0 1 0 90 0 a45 45 0 1 0-90 0 M100 100 m-20 0 a20 20 0 1 0 40 0 a20 20 0 1 0-40 0",
  "bear-trap": "M45 120 q55-80 110 0 M45 120 h110 M60 120 l8-18 l8 18 M84 120 l8-22 l8 22 M108 120 l8-22 l8 22 M132 120 l8-18",
  "crossbow-trap": "M50 100 h100 M70 70 q-20 30 0 60 M70 70 l60 30 l-60 30 M150 100 l-12-8 M150 100 l-12 8",
  "falling-portcullis": "M50 50 v100 M80 50 v100 M110 50 v100 M140 50 v100 M45 75 h100 M45 115 h100",
  "fiery-blast-trap": GLYPH.inferno, "scything-blade-trap": "M60 50 v30 M60 80 q60 0 80 60 q-50-20-80-60Z",
  "sleep-of-ages-trap": "M70 70 h30 l-30 30 h30 M110 100 h20 l-20 20 h20 M130 55 h15 l-15 15 h15",
  "path-of-blades": "M100 100 m-40 0 a40 40 0 1 0 80 0 a40 40 0 1 0-80 0 M100 60 v80 M60 100 h80 M72 72 l56 56 M128 72 l-56 56",
  "poisoned-tempest": "M60 70 q40-30 80 0 q-60 0-40 30 q40 10 20 40 M40 120 q30 20 60 0", "death-fog-trap": GAS,
  "danse-macabre": "M80 60 v60 a12 12 0 1 1-8-11 M80 60 l40-10 v55 a12 12 0 1 1-8-11",
  "faceless-malice": "M70 50 h60 v100 h-60Z M85 85 h30 M85 110 h30", "icon-of-the-lower-aerial-kingdoms": "M100 70 v70 M100 90 l-50-30 M100 90 l50-30 M100 110 l-45-10 M100 110 l45-10",
  "morbid-memory": EYE, "balance-and-ruin": "M30 80 h140 M100 80 l-10 20 h20Z M60 150 a15 15 0 1 1 0.1 0 M110 150 a15 15 0 1 1 0.1 0",
  "surface-of-the-sun": "M100 100 m-25 0 a25 25 0 1 0 50 0 a25 25 0 1 0-50 0 M100 45 v15 M100 140 v15 M45 100 h15 M140 100 h15 M62 62 l10 10 M128 128 l10 10 M138 62 l-10 10 M72 128 l-10 10",
  "test-of-the-empty-moon": "M120 55 a45 45 0 1 0 0 90 a55 55 0 0 1 0-90Z", "phase-transference-emitter": "M60 150 h80 M80 150 v-60 h40 v60 M100 90 v-30 M85 45 l15 15 l15-15 M70 70 l-15-10 M130 70 l15-10",
});

/** Shorter picture labels for names that don't fit. */
const SHORT: Record<string, string> = { "phase-transference-emitter": "Phase Emitter" };

mkdirSync("public/hazards", { recursive: true });
for (const d of HAZARDS) {
  const trap = d.kind === "trap";
  const label = SHORT[d.key] ?? d.name;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
<rect x="4" y="4" width="192" height="192" rx="18" fill="${d.color}" fill-opacity="0.35" stroke="${d.color}" stroke-width="8"${trap ? ' stroke-dasharray="18 10"' : ""}/>
<path d="${GLYPH[d.key] ?? "M60 60 h80 v80 h-80Z"}" fill="none" stroke="#ffffff" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
<path d="${GLYPH[d.key] ?? "M60 60 h80 v80 h-80Z"}" fill="none" stroke="${d.color}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
<text x="100" y="185" font-family="Arial, Helvetica, sans-serif" font-size="${label.length > 30 ? 10 : label.length > 22 ? 12 : label.length > 14 ? 15 : 18}" font-weight="700" fill="#ffffff" stroke="#000000" stroke-width="3" paint-order="stroke" text-anchor="middle">${trap ? "⚠ " : ""}${label}</text>
</svg>
`;
  writeFileSync(`public/hazards/${d.key}.svg`, svg);
}
console.log(`wrote ${HAZARDS.length} pictures`);
