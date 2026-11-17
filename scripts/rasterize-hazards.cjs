// Renders public/hazards/*.svg to 256×256 PNGs (Owlbear image items). Run after make-hazard-images.ts: node scripts/rasterize-hazards.cjs
const { chromium } = require("playwright");
const fs = require("fs");
(async () => {
  const dir = "public/hazards";
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 256, height: 256 } });
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".svg"))) {
    const svg = fs.readFileSync(`${dir}/${f}`).toString("base64");
    await p.setContent(`<html><body style="margin:0;background:transparent"><img width="256" height="256" src="data:image/svg+xml;base64,${svg}"></body></html>`);
    await p.screenshot({ path: `${dir}/${f.replace(/\.svg$/, ".png")}`, omitBackground: true, clip: { x: 0, y: 0, width: 256, height: 256 } });
  }
  await b.close();
})();
