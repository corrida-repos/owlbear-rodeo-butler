/**
 * Generates the generic party placeholder token (public/tokens/party-placeholder.png), used when a
 * D&D Beyond avatar can't be drawn by Owlbear (no CORS). Replace it in Owlbear via right-click → Replace Image.
 *   npx tsx scripts/make-placeholder-token.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { encodePng } from "./lib/png";

const S = 256, c = S / 2;
const px = new Uint8Array(S * S * 4);
const put = (x: number, y: number, r: number, g: number, b: number, a = 255) => { const i = (y * S + x) * 4; px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a; };
for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
  const d = Math.hypot(x + 0.5 - c, y + 0.5 - c);
  if (d > c - 1) continue; // transparent outside the disc
  if (d > c - 12) { put(x, y, 157, 153, 255); continue; } // ring (Forge purple)
  const t = y / S;
  let [r, g, b] = [40 + 30 * t, 46 + 30 * t, 70 + 40 * t]; // background gradient
  const head = Math.hypot(x - c, y - 100) < 38;
  const shoulders = y > 140 && ((x - c) / 78) ** 2 + ((y - 230) / 90) ** 2 < 1;
  if (head || shoulders) [r, g, b] = [205, 205, 220];
  put(x, y, r, g, b);
}
mkdirSync("public/tokens", { recursive: true });
writeFileSync("public/tokens/party-placeholder.png", encodePng(px, S, S, 4));
console.log("wrote public/tokens/party-placeholder.png");
