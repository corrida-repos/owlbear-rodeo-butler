/**
 * Generates a simple, original test battlemap (forest clearing) as PNG with zero dependencies.
 *   npm run testmap  ->  encounters/wolves-test/forest-clearing.png
 * 20×14 cells at 70 px per cell (1400×980), grid lines drawn so alignment is easy to verify in Owlbear.
 */
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const CELL = 70, COLS = 20, ROWS = 14;
const W = CELL * COLS, H = CELL * ROWS;
const px = new Uint8Array(W * H * 3);

function hash(x: number, y: number) {
  let h = (x * 374761393 + y * 668265263) ^ 0x5bd1e995;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function set(x: number, y: number, r: number, g: number, b: number) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  px[i] = r; px[i + 1] = g; px[i + 2] = b;
}
function disc(cx: number, cy: number, rad: number, col: [number, number, number], jitter = 0) {
  for (let y = Math.floor(cy - rad); y <= cy + rad; y++)
    for (let x = Math.floor(cx - rad); x <= cx + rad; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d <= rad) {
        const n = (hash(x, y) - 0.5) * jitter;
        const shade = 1 - (d / rad) * 0.25;
        set(x, y, Math.max(0, Math.min(255, col[0] * shade + n)), Math.max(0, Math.min(255, col[1] * shade + n)), Math.max(0, Math.min(255, col[2] * shade + n)));
      }
    }
}

// grass
for (let y = 0; y < H; y++)
  for (let x = 0; x < W; x++) {
    const n = hash(x >> 2, y >> 2) * 30;
    set(x, y, 70 + n * 0.5, 115 + n, 55 + n * 0.3);
  }
// dirt path, left to right with a gentle curve
for (let x = 0; x < W; x++) {
  const cy = H * 0.55 + Math.sin(x / 180) * 60;
  for (let y = Math.floor(cy - 45); y < cy + 45; y++) {
    const n = hash(x >> 1, y >> 1) * 25;
    set(x, y, 135 + n, 108 + n, 72 + n * 0.5);
  }
}
// trees around the edges (deterministic)
for (let i = 0; i < 90; i++) {
  const edge = hash(i, 1);
  const t = hash(i, 2);
  const [x, y] =
    edge < 0.3 ? [t * W, hash(i, 3) * 150] :
    edge < 0.6 ? [t * W, H - hash(i, 3) * 150] :
    edge < 0.8 ? [hash(i, 3) * 160, t * H] : [W - hash(i, 3) * 160, t * H];
  const r = 35 + hash(i, 4) * 40;
  disc(x + 6, y + 8, r, [20, 40, 20]); // shadow
  disc(x, y, r, [35, 85, 35], 30);
}
// a few rocks in the clearing
for (const [x, y, r] of [[560, 330, 26], [910, 420, 20], [760, 760, 30], [420, 690, 18]] as const) disc(x, y, r, [120, 120, 115], 20);
// grid lines (dark, 2px) — offset 0,0
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  if (x % CELL < 1 || y % CELL < 1 || x % CELL === CELL - 1 || y % CELL === CELL - 1) {
    const i = (y * W + x) * 3;
    px[i] = px[i]! * 0.55; px[i + 1] = px[i + 1]! * 0.55; px[i + 2] = px[i + 2]! * 0.55;
  }
}

// PNG encode (RGB, filter 0)
const raw = new Uint8Array((W * 3 + 1) * H);
for (let y = 0; y < H; y++) { raw[y * (W * 3 + 1)] = 0; raw.set(px.subarray(y * W * 3, (y + 1) * W * 3), y * (W * 3 + 1) + 1); }
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b: Uint8Array) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type: string, data: Uint8Array) {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  out.set(Buffer.from(type, "ascii"), 4);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length)));
  return out;
}
const ihdr = new Uint8Array(13);
new DataView(ihdr.buffer).setUint32(0, W);
new DataView(ihdr.buffer).setUint32(4, H);
ihdr.set([8, 2, 0, 0, 0], 8);
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", new Uint8Array()),
]);
const out = process.argv[2] ?? "encounters/wolves-test/forest-clearing.png";
writeFileSync(out, png);
console.log(`wrote ${out} (${W}×${H}, ${COLS}×${ROWS} cells @ ${CELL}px, ${(png.length / 1024).toFixed(0)} KB)`);
