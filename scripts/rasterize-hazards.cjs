// Renders public/hazards/*.svg to 512×512 WebP pictures with transparency (Owlbear image items; WebP keeps the fog
// and glow of the trap art small). Run after make-hazard-images.ts: node scripts/rasterize-hazards.cjs
const { chromium } = require("playwright");
const fs = require("fs");
(async () => {
  const dir = "public/hazards";
  const b = await chromium.launch();
  const p = await b.newPage();
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".svg"))) {
    const svg = fs.readFileSync(`${dir}/${f}`).toString("base64");
    const data = await p.evaluate(async (src) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = c.height = 512;
      c.getContext("2d").drawImage(img, 0, 0, 512, 512);
      return c.toDataURL("image/webp", 0.86);
    }, `data:image/svg+xml;base64,${svg}`);
    fs.writeFileSync(`${dir}/${f.replace(/\.svg$/, ".webp")}`, Buffer.from(data.split(",")[1], "base64"));
  }
  await b.close();
})();
