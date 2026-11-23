/**
 * Top-down map art for every trap (see src/core/hazards.ts): what the trap looks like seen from above on a battle map,
 * on a transparent background, covering its area (512 px for the whole area). Used by make-hazard-images.ts.
 */

export const SIZE = 512;
let uid = 0;
const id = (p: string) => `${p}${++uid}`;

// ---------- shared definitions (included in every picture)
export const DEFS = `
<radialGradient id="hole" cx="50%" cy="50%" r="60%"><stop offset="0" stop-color="#050404"/><stop offset="0.6" stop-color="#110d0b"/><stop offset="1" stop-color="#2c241e"/></radialGradient>
<linearGradient id="iron" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9aa3ab"/><stop offset="0.45" stop-color="#5b636b"/><stop offset="1" stop-color="#2a2f34"/></linearGradient>
<linearGradient id="rust" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8f8a84"/><stop offset="0.5" stop-color="#5e5048"/><stop offset="1" stop-color="#3a2a22"/></linearGradient>
<linearGradient id="wood" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a87444"/><stop offset="1" stop-color="#6b4220"/></linearGradient>
<linearGradient id="woodH" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#a87444"/><stop offset="1" stop-color="#6b4220"/></linearGradient>
<linearGradient id="stone" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#b3ada2"/><stop offset="1" stop-color="#6f695f"/></linearGradient>
<linearGradient id="slab" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#a49d91"/><stop offset="1" stop-color="#7b7469"/></linearGradient>
<radialGradient id="ball" cx="35%" cy="32%" r="70%"><stop offset="0" stop-color="#d8d2c6"/><stop offset="0.5" stop-color="#8f887c"/><stop offset="1" stop-color="#3b362f"/></radialGradient>
<radialGradient id="steelBall" cx="35%" cy="30%" r="72%"><stop offset="0" stop-color="#f4f7fa"/><stop offset="0.35" stop-color="#9aa4ad"/><stop offset="1" stop-color="#1e2328"/></radialGradient>
<radialGradient id="spike" cx="40%" cy="38%" r="60%"><stop offset="0" stop-color="#e6e2da"/><stop offset="0.4" stop-color="#8c8478"/><stop offset="1" stop-color="#2a2622"/></radialGradient>
<radialGradient id="silver" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#ffffff"/><stop offset="0.5" stop-color="#c3c9cf"/><stop offset="1" stop-color="#6c747c"/></radialGradient>
<radialGradient id="ruby" cx="40%" cy="35%" r="65%"><stop offset="0" stop-color="#ff8a8a"/><stop offset="1" stop-color="#8a0010"/></radialGradient>
<filter id="rough" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="3" seed="7"/><feDisplacementMap in="SourceGraphic" scale="14"/></filter>
<filter id="rough2" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency="0.08" numOctaves="2" seed="2"/><feDisplacementMap in="SourceGraphic" scale="6"/></filter>
<filter id="grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="5" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.35 0" result="a"/><feComposite in="a" in2="SourceGraphic" operator="in" result="g"/><feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="g"/></feMerge></filter>
<filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="4" dy="6" stdDeviation="5" flood-color="#000" flood-opacity="0.55"/></filter>
<filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<filter id="blur8"><feGaussianBlur stdDeviation="8"/></filter>
<filter id="blur3"><feGaussianBlur stdDeviation="3"/></filter>
<radialGradient id="fadeMask" cx="50%" cy="50%" r="50%"><stop offset="0.55" stop-color="#fff"/><stop offset="1" stop-color="#000"/></radialGradient>
<mask id="fade"><rect width="${SIZE}" height="${SIZE}" fill="url(#fadeMask)"/></mask>
`;

// ---------- building blocks
const rnd = (seed: number) => () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

/** Coloured mist over the whole area, fading out at the edges. */
export function fog(color: [number, number, number], opacity = 1, freq = 0.012, seed = 3) {
  const f = id("fog");
  const [r, g, b] = color.map((c) => c / 255) as [number, number, number];
  return `<filter id="${f}" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="4" seed="${seed}"/>
<feColorMatrix type="matrix" values="0 0 0 0 ${r}  0 0 0 0 ${g}  0 0 0 0 ${b}  0 0 0 ${1.6 * opacity} ${-0.45 * opacity}"/></filter>
<rect width="${SIZE}" height="${SIZE}" filter="url(#${f})" mask="url(#fade)"/>`;
}

/** A soft radial glow (light, heat, magic) centred in the area. */
export function aura(color: string, opacity = 0.5, r = 0.5) {
  const g = id("aura");
  return `<radialGradient id="${g}" cx="50%" cy="50%" r="${r * 100}%"><stop offset="0" stop-color="${color}" stop-opacity="${opacity}"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient>
<rect width="${SIZE}" height="${SIZE}" fill="url(#${g})"/>`;
}

/** An open pit seen from above: rough stone rim, walls falling away into darkness. */
export function pit(x: number, y: number, w: number, h: number, inner = 26) {
  return `<g filter="url(#shadow)"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="url(#stone)" filter="url(#rough)"/></g>
<rect x="${x + 14}" y="${y + 14}" width="${w - 28}" height="${h - 28}" rx="6" fill="#3a3029" filter="url(#rough2)"/>
<polygon points="${x + 14},${y + 14} ${x + w - 14},${y + 14} ${x + w - 14 - inner},${y + 14 + inner} ${x + 14 + inner},${y + 14 + inner}" fill="#5a4c40" opacity="0.9"/>
<polygon points="${x + 14},${y + 14} ${x + 14 + inner},${y + 14 + inner} ${x + 14 + inner},${y + h - 14 - inner} ${x + 14},${y + h - 14}" fill="#4a3e34" opacity="0.9"/>
<rect x="${x + 14 + inner}" y="${y + 14 + inner}" width="${w - 28 - 2 * inner}" height="${h - 28 - 2 * inner}" fill="url(#hole)"/>`;
}

/** Spikes at the bottom of a pit: a grid of cones seen from above. */
export function spikes(x: number, y: number, w: number, h: number, step = 34, seed = 11) {
  const r = rnd(seed);
  let s = "";
  for (let yy = y + step / 2; yy < y + h; yy += step) for (let xx = x + step / 2; xx < x + w; xx += step) {
    const cx = xx + (r() - 0.5) * 10, cy = yy + (r() - 0.5) * 10, rad = step * (0.26 + r() * 0.08);
    s += `<circle cx="${cx}" cy="${cy}" r="${rad}" fill="url(#spike)"/><circle cx="${cx - rad * 0.2}" cy="${cy - rad * 0.2}" r="${rad * 0.18}" fill="#f4f1ea"/>`;
  }
  return s;
}

/** A flagstone pressure plate, slightly proud of the floor, with an optional engraved glyph. */
export function plate(cx: number, cy: number, s: number, glyph = "") {
  const x = cx - s / 2, y = cy - s / 2;
  return `<g filter="url(#shadow)"><rect x="${x}" y="${y}" width="${s}" height="${s}" rx="6" fill="url(#slab)" filter="url(#grain)"/></g>
<rect x="${x}" y="${y}" width="${s}" height="${s}" rx="6" fill="none" stroke="#3e3933" stroke-width="5"/>
<rect x="${x + 7}" y="${y + 7}" width="${s - 14}" height="${s - 14}" rx="4" fill="none" stroke="#d6cfc2" stroke-opacity="0.5" stroke-width="3"/>
${glyph}`;
}

/** A taut trip wire between two pegs. */
export function wire(x1: number, y1: number, x2: number, y2: number) {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#000" stroke-opacity="0.35" stroke-width="5" transform="translate(3 5)"/>
<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#d9d2c0" stroke-width="3"/>
${[[x1, y1], [x2, y2]].map(([a, b]) => `<circle cx="${a}" cy="${b}" r="11" fill="url(#iron)" stroke="#1d2024" stroke-width="3" filter="url(#shadow)"/>`).join("")}`;
}

/** A rope net with knots and corner weights. */
export function net(x: number, y: number, w: number, h: number, step = 42) {
  let s = "";
  const sag = (a: number) => Math.sin(a) * 6;
  for (let i = 0; i <= Math.round(w / step); i++) { const xx = x + i * (w / Math.round(w / step)); s += `<path d="M${xx} ${y} Q${xx + sag(i)} ${y + h / 2} ${xx} ${y + h}"/>`; }
  for (let j = 0; j <= Math.round(h / step); j++) { const yy = y + j * (h / Math.round(h / step)); s += `<path d="M${x} ${yy} Q${x + w / 2} ${yy + sag(j)} ${x + w} ${yy}"/>`; }
  let knots = "";
  for (let i = 0; i <= Math.round(w / step); i++) for (let j = 0; j <= Math.round(h / step); j++) knots += `<circle cx="${x + i * (w / Math.round(w / step))}" cy="${y + j * (h / Math.round(h / step))}" r="5"/>`;
  const weights = [[x, y], [x + w, y], [x, y + h], [x + w, y + h]].map(([a, b]) => `<circle cx="${a}" cy="${b}" r="17" fill="url(#ball)" stroke="#2b2622" stroke-width="3"/>`).join("");
  return `<g fill="none" stroke="#000" stroke-opacity="0.4" stroke-width="9" transform="translate(4 6)">${s}</g>
<g fill="none" stroke="#b9a37a" stroke-width="6" stroke-linecap="round">${s}</g>
<g fill="none" stroke="#e0cfa6" stroke-width="2" stroke-linecap="round" opacity="0.7">${s}</g>
<g fill="#8a7450">${knots}</g><g filter="url(#shadow)">${weights}</g>`;
}

/** A sphere seen from above. */
export function sphere(cx: number, cy: number, r: number, fill = "url(#ball)", detail = "") {
  return `<ellipse cx="${cx + r * 0.18}" cy="${cy + r * 0.25}" rx="${r * 1.02}" ry="${r * 0.98}" fill="#000" opacity="0.45" filter="url(#blur8)"/>
<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"/>${detail}`;
}

/** A gear (cog) seen from above. */
export function gear(cx: number, cy: number, r: number, teeth: number, rot = 0, fill = "url(#rust)") {
  const pts: string[] = [];
  for (let i = 0; i < teeth * 2; i++) {
    const a1 = ((i - 0.3) / (teeth * 2)) * Math.PI * 2 + rot, a2 = ((i + 0.3) / (teeth * 2)) * Math.PI * 2 + rot;
    const rr = i % 2 ? r * 0.82 : r;
    pts.push(`${cx + Math.cos(a1) * rr},${cy + Math.sin(a1) * rr}`, `${cx + Math.cos(a2) * rr},${cy + Math.sin(a2) * rr}`);
  }
  return `<polygon points="${pts.join(" ")}" fill="${fill}" stroke="#1d1a17" stroke-width="3"/>
<circle cx="${cx}" cy="${cy}" r="${r * 0.55}" fill="none" stroke="#2a2420" stroke-width="4"/>
${[0, 1, 2, 3, 4].map((k) => { const a = (k / 5) * Math.PI * 2 + rot; return `<circle cx="${cx + Math.cos(a) * r * 0.36}" cy="${cy + Math.sin(a) * r * 0.36}" r="${r * 0.1}" fill="#1a1512"/>`; }).join("")}
<circle cx="${cx}" cy="${cy}" r="${r * 0.15}" fill="#8f877e" stroke="#1d1a17" stroke-width="3"/>`;
}

/** A chest seen from above, lock towards the bottom. */
export function chest(cx: number, cy: number, w: number, h: number) {
  const x = cx - w / 2, y = cy - h / 2;
  let planks = "";
  for (let i = 1; i < 4; i++) planks += `<line x1="${x}" y1="${y + (h * i) / 4}" x2="${x + w}" y2="${y + (h * i) / 4}" stroke="#4a2c14" stroke-width="3"/>`;
  return `<g filter="url(#shadow)"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="url(#wood)" filter="url(#grain)"/></g>${planks}
<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="none" stroke="#3a220f" stroke-width="5"/>
${[x + w * 0.18, x + w * 0.82].map((bx) => `<rect x="${bx - 12}" y="${y - 2}" width="24" height="${h + 4}" fill="url(#iron)" stroke="#1d2024" stroke-width="2"/>`).join("")}
<rect x="${cx - 26}" y="${y + h - 46}" width="52" height="54" rx="6" fill="url(#iron)" stroke="#1d2024" stroke-width="3"/>
<circle cx="${cx}" cy="${y + h - 26}" r="7" fill="#111"/><rect x="${cx - 3}" y="${y + h - 24}" width="6" height="14" fill="#111"/>`;
}

/** Scattered rubble chunks. */
export function rubble(x: number, y: number, w: number, h: number, n: number, seed = 5, scale = 1) {
  const r = rnd(seed);
  let s = "";
  for (let i = 0; i < n; i++) {
    const cx = x + r() * w, cy = y + r() * h, rad = (8 + r() * 22) * scale;
    const pts = Array.from({ length: 6 }, (_, k) => { const a = (k / 6) * Math.PI * 2 + r(); const rr = rad * (0.7 + r() * 0.5); return `${cx + Math.cos(a) * rr},${cy + Math.sin(a) * rr}`; }).join(" ");
    s += `<polygon points="${pts}" fill="url(#stone)" stroke="#3e3830" stroke-width="2"/>`;
  }
  return `<g filter="url(#shadow)">${s}</g>`;
}

/** A painted rune circle (magic traps). */
export function runeCircle(cx: number, cy: number, r: number, color: string, glyph = "") {
  let ticks = "";
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    ticks += `<path d="M${cx + Math.cos(a) * r * 0.84} ${cy + Math.sin(a) * r * 0.84} l${Math.cos(a + 1) * 8} ${Math.sin(a + 1) * 8} l${Math.cos(a) * 8} ${Math.sin(a) * 8}"/>`;
  }
  return `<g fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round" filter="url(#glow)" opacity="0.9">
<circle cx="${cx}" cy="${cy}" r="${r}"/><circle cx="${cx}" cy="${cy}" r="${r * 0.72}" stroke-width="2"/>${ticks}${glyph}</g>`;
}

const flame = (cx: number, cy: number, s: number, fill = "#ff7a1a") =>
  `<path d="M${cx} ${cy - s} C${cx + s * 0.7} ${cy - s * 0.3} ${cx + s * 0.6} ${cy + s * 0.6} ${cx} ${cy + s * 0.7} C${cx - s * 0.6} ${cy + s * 0.6} ${cx - s * 0.7} ${cy - s * 0.1} ${cx - s * 0.2} ${cy - s * 0.4} C${cx - s * 0.1} ${cy - s * 0.1} ${cx + s * 0.1} ${cy - s * 0.3} ${cx} ${cy - s}Z" fill="${fill}"/>`;

const dart = (x: number, y: number, a: number) =>
  `<g transform="translate(${x} ${y}) rotate(${a}) scale(1.8)" filter="url(#shadow)"><line x1="-26" y1="0" x2="20" y2="0" stroke="#5a3c22" stroke-width="5"/><path d="M20 -5 L36 0 L20 5Z" fill="#6fbf3a" stroke="#2e5a14" stroke-width="2"/><path d="M-26 0 l-10 -8 h10 Z M-26 0 l-10 8 h10Z" fill="#d8d0c0"/></g>`;

const hinge = (x: number, y: number) => `<rect x="${x}" y="${y}" width="30" height="14" rx="3" fill="url(#iron)" stroke="#1d2024" stroke-width="2"/>`;

/** A flagstone trapdoor flush with the floor, with a dark seam around it. */
function trapdoor(x: number, y: number, w: number, h: number) {
  let slabs = "";
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) slabs += `<rect x="${x + 10 + (i * (w - 20)) / 2}" y="${y + 10 + (j * (h - 20)) / 2}" width="${(w - 20) / 2 - 6}" height="${(h - 20) / 2 - 6}" rx="4" fill="url(#slab)" stroke="#4d473f" stroke-width="3" filter="url(#grain)"/>`;
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="#120e0b"/><rect x="${x + 6}" y="${y + 6}" width="${w - 12}" height="${h - 12}" rx="4" fill="#3b352e"/>${slabs}`;
}

const serpent = (cx: number, cy: number, r: number, rot: number) => `<g transform="translate(${cx} ${cy}) rotate(${rot})" filter="url(#shadow)">
<circle r="${r}" fill="#6d7b5a" stroke="#2c3322" stroke-width="4"/><path d="M0 0 m-${r * 0.7} 0 a${r * 0.7} ${r * 0.7} 0 1 1 ${r * 1.4} 0 a${r * 0.5} ${r * 0.5} 0 1 1 -${r} 0 a${r * 0.3} ${r * 0.3} 0 1 1 ${r * 0.6} 0" fill="none" stroke="#3f4a30" stroke-width="${r * 0.18}"/>
<path d="M${r * 0.2} -${r * 0.15} q${r * 0.5} -${r * 0.9} ${r * 0.9} -${r * 0.5} q0 ${r * 0.4} -${r * 0.5} ${r * 0.45}Z" fill="#7f8e69" stroke="#2c3322" stroke-width="3"/>
<circle cx="${r * 0.82}" cy="-${r * 0.66}" r="${r * 0.08}" fill="url(#ruby)"/><circle cx="${r * 0.98}" cy="-${r * 0.5}" r="${r * 0.08}" fill="url(#ruby)"/></g>`;

/** A heavy crossbow seen from above, pointing down (rotate to aim). */
const crossbow = (x: number, y: number, rot: number) => `<g transform="translate(${x} ${y}) rotate(${rot})" filter="url(#shadow)">
<rect x="-14" y="-90" width="28" height="150" rx="8" fill="url(#wood)" stroke="#3a220f" stroke-width="4"/>
<path d="M-95 20 Q0 -10 95 20" fill="none" stroke="#3b3f44" stroke-width="16" stroke-linecap="round"/><path d="M-95 20 Q0 -10 95 20" fill="none" stroke="#9aa3ab" stroke-width="6" stroke-linecap="round"/>
<path d="M-92 24 L0 -40 L92 24" fill="none" stroke="#e8e0c8" stroke-width="3"/>
<rect x="-5" y="-40" width="10" height="110" fill="#5a3c22"/><path d="M-10 70 L0 96 L10 70Z" fill="#c4cad0" stroke="#2a2f34" stroke-width="2"/>
<rect x="-20" y="-60" width="40" height="18" rx="4" fill="url(#iron)" stroke="#1d2024" stroke-width="2"/></g>`;

// ---------- the pictures: key → SVG body in a 512 × 512 area
const C = SIZE / 2;

const statuePlate = plate(C, C, 380, `<g fill="none" stroke="#5a1a0a" stroke-width="10" stroke-linecap="round" opacity="0.85">${flame(C, C + 10, 110, "none").replace('fill="none"', 'fill="none"')}</g>${flame(C, C + 10, 110, "#c2410c").replace("/>", ' opacity="0.55"/>')}
<path d="M80 470 q60 -30 120 -10 M330 60 q50 20 110 0" stroke="#1a1410" stroke-opacity="0.45" stroke-width="18" fill="none" filter="url(#blur3)"/>`);

const coveredPit = `${pit(28, 28, 456, 456, 30)}
<path d="M60 60 L452 64 L448 300 Q330 360 260 300 Q180 250 70 330Z" fill="#9c8a62" stroke="#5e5034" stroke-width="5" filter="url(#rough2)"/>
<path d="M60 60 L452 64 L448 300 Q330 360 260 300 Q180 250 70 330Z" fill="none" stroke="#c9b688" stroke-width="2" stroke-dasharray="6 10"/>
${rubble(80, 80, 340, 200, 10, 3, 0.5).replace(/url\(#stone\)/g, "#6b7a3a")}
<path d="M120 360 l40 30 M300 380 l-30 40 M400 340 l20 50" stroke="#9c8a62" stroke-width="8" stroke-linecap="round"/>`;

const fullPit = (withSpikes: boolean) => `${pit(20, 20, 472, 472, 34)}${withSpikes ? spikes(88, 88, 336, 336, 42) : ""}`;

export const TRAP_ART: Record<string, () => string> = {
  // ---- pits
  "hidden-pit": () => `${trapdoor(40, 40, 432, 432)}${hinge(120, 34)}${hinge(362, 34)}<path d="M40 472 h432" stroke="#000" stroke-width="10" opacity="0.6"/>`,
  "hidden-pit-2014": () => TRAP_ART["hidden-pit"]!(),
  "locking-pit": () => `${trapdoor(40, 40, 432, 432)}${hinge(120, 34)}${hinge(362, 34)}
<g filter="url(#shadow)"><path d="M210 40 q12 -20 24 0 q12 -20 24 0 q12 -20 24 0 q12 -20 24 0" fill="none" stroke="#9aa3ab" stroke-width="7"/></g>
<rect x="236" y="440" width="40" height="22" rx="4" fill="url(#iron)" stroke="#1d2024" stroke-width="3"/>`,
  "simple-pit": () => coveredPit,
  "pit-trap": () => `${coveredPit}<path d="M28 28 h456 v456 h-456Z" fill="none" stroke="#c9b688" stroke-opacity="0.35" stroke-width="18"/>`,
  "spiked-pit": () => fullPit(true),
  "spiked-pit-2014": () => fullPit(true),

  // ---- falling things
  "collapsing-roof": () => `${aura("#000", 0.35, 0.55)}
<g fill="none" stroke="#2a221c" stroke-width="5" stroke-linecap="round" opacity="0.8"><path d="M100 120 l60 50 l-10 60 l70 40 M300 90 l-20 80 l60 40 l10 70 M140 380 l80 -40 l60 30 l90 -20"/></g>
${rubble(70, 90, 370, 330, 22, 9)}<g filter="url(#shadow)"><rect x="60" y="220" width="200" height="34" rx="4" fill="url(#woodH)" stroke="#3a220f" stroke-width="3" transform="rotate(-18 160 237)"/>
<rect x="270" y="300" width="170" height="30" rx="4" fill="url(#woodH)" stroke="#3a220f" stroke-width="3" transform="rotate(24 355 315)"/></g>${wire(30, 470, 482, 470)}`,
  "collapsing-roof-2014": () => TRAP_ART["collapsing-roof"]!(),
  "falling-net": () => `${net(40, 40, 432, 432)}${wire(20, 490, 492, 490)}`,
  "falling-net-2014": () => TRAP_ART["falling-net"]!(),
  "net-trap": () => `${net(40, 40, 432, 432)}${wire(20, C, 492, C)}<g transform="translate(440 70)" filter="url(#shadow)"><path d="M-26 20 q0 -46 26 -46 q26 0 26 46Z" fill="#c8a24a" stroke="#6b5317" stroke-width="4"/><circle cy="24" r="7" fill="#6b5317"/></g>`,
  "falling-portcullis": () => `${plate(C, C, 300)}
<g filter="url(#shadow)">${[0, 1, 2, 3, 4, 5, 6].map((i) => `<rect x="${40 + i * 72}" y="10" width="16" height="92" rx="3" fill="url(#iron)" stroke="#1d2024" stroke-width="2"/><path d="M${40 + i * 72} 102 l8 22 l8 -22Z" fill="#7d858c"/>`).join("")}
<rect x="20" y="30" width="472" height="16" rx="3" fill="url(#iron)" stroke="#1d2024" stroke-width="2"/><rect x="20" y="70" width="472" height="16" rx="3" fill="url(#iron)" stroke="#1d2024" stroke-width="2"/></g>`,

  // ---- pressure plates and darts
  "poisoned-darts": () => `${plate(C, C, 340)}
${[[70, 80], [440, 90], [60, 430], [450, 420], [C, 40], [C, 472]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="9" fill="#0b0908" stroke="#4d473f" stroke-width="3"/>`).join("")}
${dart(150, 150, 30)}${dart(360, 200, 160)}${dart(200, 360, -40)}${dart(330, 350, 200)}`,
  "poison-darts": () => TRAP_ART["poisoned-darts"]!(),
  "fire-casting-statue": () => statuePlate,
  "fire-breathing-statue": () => statuePlate,
  "fiery-blast-trap": () => `<circle cx="${C}" cy="${C}" r="240" fill="#1b120c" opacity="0.5" filter="url(#blur8)"/>
<g filter="url(#shadow)"><circle cx="${C}" cy="${C}" r="210" fill="#8a3b12" stroke="#3a1a08" stroke-width="8"/></g>
${Array.from({ length: 16 }, (_, i) => { const a = (i / 16) * 360; return `<path d="M${C} ${C} L${C + 200} ${C - 40} A204 204 0 0 1 ${C + 200} ${C + 40}Z" fill="${i % 2 ? "#c9581b" : "#e9a23b"}" stroke="#3a1a08" stroke-width="3" transform="rotate(${a} ${C} ${C})"/>`; }).join("")}
<circle cx="${C}" cy="${C}" r="110" fill="#f3d27a" stroke="#3a1a08" stroke-width="6"/>${flame(C, C + 10, 80, "#d4380d")}${flame(C, C + 30, 40, "#ffcf3f")}
<circle cx="${C}" cy="${C}" r="210" fill="none" stroke="#e6d3b0" stroke-width="5" stroke-dasharray="14 10"/>
<g fill="#2a1d14" opacity="0.5" filter="url(#blur3)"><ellipse cx="120" cy="140" rx="60" ry="30"/><ellipse cx="390" cy="380" rx="70" ry="34"/></g>`,
  "scything-blade-trap": () => `<rect x="${C - 30}" y="0" width="60" height="512" fill="#0b0908" opacity="0.85" rx="6"/>
<path d="M${C} 0 v512" stroke="#3a3029" stroke-width="4"/>
<g filter="url(#shadow)"><path d="M${C - 14} 80 C${C + 190} 140 ${C + 190} 360 ${C - 14} 430 C${C + 110} 340 ${C + 110} 170 ${C - 14} 80Z" fill="url(#iron)" stroke="#1d2024" stroke-width="4"/>
<path d="M${C - 10} 90 C${C + 175} 150 ${C + 175} 350 ${C - 10} 420" fill="none" stroke="#eef2f5" stroke-width="3"/></g>
<path d="M${C - 60} 120 a200 200 0 0 0 0 270" stroke="#b71c1c" stroke-opacity="0.5" stroke-width="10" fill="none" stroke-dasharray="4 18" stroke-linecap="round"/>
<g transform="translate(70 440)" filter="url(#shadow)"><rect x="-26" y="-12" width="52" height="24" rx="5" fill="url(#iron)"/><line x1="0" y1="0" x2="34" y2="-70" stroke="#5b636b" stroke-width="10" stroke-linecap="round"/><circle cx="34" cy="-70" r="12" fill="#b71c1c"/></g>`,
  "bear-trap": () => `${plate(C, C, 420).replace(/url\(#slab\)/, "#6b5b45")}
<line x1="${C}" y1="${C}" x2="460" y2="460" stroke="#3b3f44" stroke-width="10" stroke-dasharray="16 6"/><circle cx="460" cy="460" r="16" fill="url(#iron)" stroke="#1d2024" stroke-width="3"/>
<g filter="url(#shadow)"><circle cx="${C}" cy="${C}" r="170" fill="none" stroke="url(#iron)" stroke-width="24"/>
${Array.from({ length: 22 }, (_, i) => { const a = (i / 22) * Math.PI * 2; const x = C + Math.cos(a) * 158, y = C + Math.sin(a) * 158; return `<path d="M${x + Math.cos(a + 1.57) * 12} ${y + Math.sin(a + 1.57) * 12} L${C + Math.cos(a) * 118} ${C + Math.sin(a) * 118} L${x - Math.cos(a + 1.57) * 12} ${y - Math.sin(a + 1.57) * 12}Z" fill="#c4cad0" stroke="#2a2f34" stroke-width="2"/>`; }).join("")}
<rect x="${C - 190}" y="${C - 14}" width="380" height="28" rx="10" fill="url(#iron)" stroke="#1d2024" stroke-width="3"/>
<circle cx="${C}" cy="${C}" r="54" fill="url(#iron)" stroke="#1d2024" stroke-width="4"/><circle cx="${C}" cy="${C}" r="30" fill="#4a4f55"/></g>`,
  "crossbow-trap": () => `${crossbow(150, 120, 0)}${crossbow(362, 120, 0)}${wire(30, 330, 482, 330)}`,

  // ---- needles
  "poisoned-needle": () => `${chest(C, C - 10, 400, 300)}<g filter="url(#glow)"><line x1="${C}" y1="${C + 150}" x2="${C}" y2="${C + 215}" stroke="#e8edf0" stroke-width="5"/><circle cx="${C}" cy="${C + 222}" r="8" fill="#76e04a"/></g>`,
  "poison-needle": () => TRAP_ART["poisoned-needle"]!(),
  "poison-needle-trap": () => TRAP_ART["poisoned-needle"]!(),

  // ---- rolling spheres
  "rolling-stone": () => `${plate(110, 400, 120)}${sphere(300, 230, 190, "url(#ball)", `<g fill="none" stroke="#3a342c" stroke-width="5" opacity="0.7"><path d="M200 140 q60 40 40 120 M330 330 q40 -40 110 -30 M380 110 l-30 60"/></g>`)}
<g stroke="#ffffff" stroke-opacity="0.35" stroke-width="8" stroke-linecap="round"><path d="M40 160 h70 M30 230 h80 M40 300 h70"/></g>`,
  "rolling-sphere": () => TRAP_ART["rolling-stone"]!(),
  "sphere-of-crushing-doom": () => `${sphere(C, C, 230, "url(#steelBall)", Array.from({ length: 12 }, (_, i) => { const a = (i / 12) * Math.PI * 2; return `<circle cx="${C + Math.cos(a) * 170}" cy="${C + Math.sin(a) * 170}" r="9" fill="#2d3339" stroke="#c9d1d8" stroke-width="2"/>`; }).join("") + `<circle cx="${C}" cy="${C}" r="170" fill="none" stroke="#2d3339" stroke-width="4"/>`)}`,

  // ---- magic
  "sphere-of-annihilation": () => `<g filter="url(#shadow)"><path d="M60 40 h392 l-30 420 q-166 40 -332 0Z" fill="url(#stone)" stroke="#4d473f" stroke-width="6" filter="url(#rough2)"/></g>
<g fill="#3e3830"><ellipse cx="180" cy="170" rx="44" ry="22"/><ellipse cx="332" cy="170" rx="44" ry="22"/><path d="M256 190 l-26 90 h52Z" opacity="0.7"/></g>
<path d="M120 120 q60 -40 120 0 M272 120 q60 -40 120 0" stroke="#3e3830" stroke-width="12" fill="none" stroke-linecap="round"/>
<circle cx="${C}" cy="360" r="78" fill="#000" stroke="#4d473f" stroke-width="10"/><circle cx="${C}" cy="360" r="74" fill="none" stroke="#6a1b9a" stroke-opacity="0.6" stroke-width="6" filter="url(#glow)"/>`,
  "sleep-of-ages-trap": () => `${aura("#7c83ff", 0.45, 0.5)}${fog([150, 160, 255], 0.6, 0.02, 9)}${plate(C, C, 70)}
${runeCircle(C, C, 120, "#c5caff", `<path d="M${C - 30} ${C - 30} h26 l-26 26 h26 M${C + 6} ${C - 2} h20 l-20 20 h20"/>`)}`,
  "path-of-blades": () => `${([[150, 150], [362, 150], [150, 362], [362, 362]] as const).map(([x, y], k) => `<circle cx="${x}" cy="${y}" r="104" fill="none" stroke="#0b0908" stroke-width="10" opacity="0.8"/><circle cx="${x}" cy="${y}" r="98" fill="#000" opacity="0.18"/>
<g transform="rotate(${k * 37} ${x} ${y})" filter="url(#shadow)">${[0, 1, 2, 3].map((i) => `<path d="M${x} ${y} L${x + 90} ${y - 20} Q${x + 98} ${y} ${x + 90} ${y + 10}Z" fill="url(#iron)" stroke="#1d2024" stroke-width="2" transform="rotate(${i * 90} ${x} ${y})"/>`).join("")}<circle cx="${x}" cy="${y}" r="16" fill="#3b3f44" stroke="#c4cad0" stroke-width="3"/></g>`).join("")}
<path d="M140 250 a120 120 0 0 1 230 0" fill="none" stroke="#b71c1c" stroke-opacity="0.4" stroke-width="8" stroke-dasharray="4 16" stroke-linecap="round"/>`,
  "poisoned-tempest": () => `${fog([120, 210, 80], 0.9, 0.01, 4)}${fog([90, 170, 60], 0.6, 0.025, 8)}
${serpent(70, 70, 50, 45)}${serpent(442, 70, 50, 135)}${serpent(70, 442, 50, -45)}${serpent(442, 442, 50, -135)}
<g fill="#5b636b" opacity="0.9">${([[C, 6], [C, 506], [6, C], [506, C]] as const).map(([x, y]) => `<rect x="${x - 22}" y="${y - 6}" width="44" height="12" rx="3" transform="rotate(${x === C ? 0 : 90} ${x} ${y})"/>`).join("")}</g>`,
  "danse-macabre": () => `${aura("#9fd8ff", 0.35, 0.5)}${fog([180, 220, 255], 0.5, 0.018, 12)}
<g filter="url(#shadow)" transform="translate(${C} ${C}) rotate(-20)"><path d="M-30 -90 Q60 -100 70 -20 Q80 60 -10 100 L-40 95 Q-10 20 -30 -90Z" fill="url(#wood)" stroke="#3a220f" stroke-width="5"/>
${[0, 1, 2, 3, 4, 5].map((i) => `<line x1="${-24 + i * 6}" y1="${-84 + i * 4}" x2="${-30 + i * 14}" y2="${90 - i * 6}" stroke="#e8e0c8" stroke-width="2"/>`).join("")}</g>
<g fill="#e3f4ff" opacity="0.75" filter="url(#glow)">${[[120, 140, -10], [380, 120, 15], [400, 370, -5], [130, 390, 10], [C, 70, 0]].map(([x, y, r]) => `<g transform="translate(${x} ${y}) rotate(${r})"><ellipse cx="0" cy="18" rx="11" ry="8"/><rect x="9" y="-22" width="4" height="40"/><path d="M13 -22 q16 6 12 22 q-2 -12 -12 -12Z"/></g>`).join("")}</g>`,
  "faceless-malice": () => `${aura("#d7c6ff", 0.3, 0.6)}${fog([220, 210, 240], 0.45, 0.02, 21)}
<g filter="url(#shadow)"><rect x="126" y="14" width="260" height="60" rx="12" fill="#c9a24a" stroke="#5e4512" stroke-width="5"/><rect x="146" y="26" width="220" height="36" rx="8" fill="url(#silver)"/>
${[146, 366].map((x) => `<circle cx="${x}" cy="44" r="16" fill="#d9b55a" stroke="#5e4512" stroke-width="4"/>`).join("")}</g>
<ellipse cx="${C}" cy="300" rx="70" ry="90" fill="#f2ecff" opacity="0.25" filter="url(#blur8)"/>`,
  "icon-of-the-lower-aerial-kingdoms": () => `${aura("#ff7043", 0.4, 0.5)}${fog([255, 140, 90], 0.35, 0.02, 31)}
<g filter="url(#shadow)"><rect x="${C - 60}" y="${C - 60}" width="120" height="120" rx="10" fill="url(#stone)" stroke="#4d473f" stroke-width="5"/>
<g transform="translate(${C} ${C})" fill="#3a2a2a" stroke="#120808" stroke-width="3">${[-50, -20, 20, 50].map((a) => `<path d="M0 0 L${Math.sin((a * Math.PI) / 180) * 120} ${-Math.cos((a * Math.PI) / 180) * 30 - 40} L${Math.sin((a * Math.PI) / 180) * 70} 10Z" transform="rotate(${a > 0 ? 15 : -15})"/>`).join("")}
<ellipse rx="18" ry="34"/><circle cy="-36" r="14"/><path d="M0 -50 l8 -16 l-16 0Z" fill="#8a6a2a"/><circle cx="-5" cy="-38" r="3" fill="#ff5a3a"/><circle cx="5" cy="-38" r="3" fill="#ff5a3a"/></g></g>`,
  "morbid-memory": () => `${aura("#6a5acd", 0.3, 0.55)}${fog([170, 150, 220], 0.7, 0.014, 17)}
<g fill="#e8e2ff" opacity="0.28" filter="url(#blur3)">${([[150, 200], [330, 170], [250, 340]] as const).map(([x, y]) => `<circle cx="${x}" cy="${y}" r="22"/><path d="M${x - 30} ${y + 20} q30 -10 60 0 l10 90 q-40 20 -80 0Z"/>`).join("")}</g>`,
  "death-fog-trap": () => `${fog([150, 210, 90], 1, 0.011, 41)}${fog([110, 170, 60], 0.7, 0.03, 42)}`,

  // ---- trap rooms
  "balance-and-ruin": () => `<rect x="0" y="40" width="512" height="432" fill="#120d0a"/>
${gear(90, 120, 90, 12, 0.2)}${gear(250, 170, 80, 10, 0.5)}${gear(410, 110, 95, 13, 0.1)}${gear(120, 380, 100, 14, 0.4)}${gear(300, 380, 70, 9, 0.2)}${gear(440, 360, 85, 11, 0.6)}
<g fill="#7a1010" opacity="0.5"><ellipse cx="250" cy="200" rx="30" ry="12"/><ellipse cx="120" cy="400" rx="24" ry="10"/></g>
<rect x="0" y="0" width="512" height="40" fill="url(#iron)"/><rect x="0" y="472" width="512" height="40" fill="url(#iron)"/>
<g filter="url(#shadow)"><rect x="0" y="${C - 22}" width="512" height="44" fill="url(#woodH)" stroke="#3a220f" stroke-width="4"/>
<circle cx="${C}" cy="${C}" r="36" fill="url(#stone)" stroke="#4d473f" stroke-width="5"/></g>`,
  "surface-of-the-sun": () => `${aura("#ffd54f", 0.65, 0.6)}${aura("#ff8f00", 0.35, 0.35)}
${[170, 342].map((x) => `<rect x="${x - 12}" y="0" width="24" height="512" fill="#8d4a2a" stroke="#4a2414" stroke-width="3"/>`).join("")}
<g stroke="#4f7a28" stroke-width="7" fill="none" stroke-linecap="round" opacity="0.85">${[0, 512].map((x) => `<path d="M${x} 20 q${x ? -30 : 30} 60 0 120 t0 120 t0 120 t0 120"/>`).join("")}</g>
<g transform="translate(${C} 70)" filter="url(#shadow)"><circle r="40" fill="url(#stone)" stroke="#4d473f" stroke-width="4"/>${[0, 1, 2, 3].map((i) => `<path d="M0 0 q30 -20 34 0" stroke="#5b4a2a" stroke-width="8" fill="none" transform="rotate(${i * 90 + 45})"/>`).join("")}<circle r="22" fill="url(#silver)"/></g>
<g transform="translate(426 70) rotate(90)" filter="url(#shadow)"><circle cx="-40" r="20" fill="none" stroke="#e0b030" stroke-width="10"/><rect x="-22" y="-6" width="80" height="12" fill="#e0b030"/><rect x="40" y="0" width="12" height="22" fill="#e0b030"/></g>
<g transform="translate(86 440)" filter="url(#shadow)"><circle r="40" fill="#e8e0d0" stroke="#5a5040" stroke-width="4"/><circle cx="-13" cy="-6" r="9" fill="#2a2420"/><circle cx="13" cy="-6" r="9" fill="#2a2420"/><path d="M-4 14 h8 v12 h-8Z" fill="#2a2420"/></g>`,
  "test-of-the-empty-moon": () => `<g filter="url(#shadow)"><circle cx="${C}" cy="${C}" r="220" fill="url(#silver)" stroke="#4d555c" stroke-width="8"/></g>
${[180, 130, 80].map((r, i) => `<circle cx="${C}" cy="${C}" r="${r}" fill="none" stroke="#7d868e" stroke-opacity="${0.5 - i * 0.1}" stroke-width="4"/>`).join("")}
<circle cx="${C}" cy="${C}" r="60" fill="#8e979f" opacity="0.6"/>
${[0, 90, 180, 270].map((a) => `<rect x="${C - 14}" y="0" width="28" height="40" fill="#5a544b" transform="rotate(${a} ${C} ${C})"/>`).join("")}
<path d="M300 150 a50 50 0 1 0 0 100 a62 62 0 0 1 0 -100Z" fill="#fff8d0" opacity="0.6" filter="url(#glow)"/>`,
  "phase-transference-emitter": () => `<circle cx="${C}" cy="${C}" r="230" fill="#0f2430" opacity="0.6"/>
${Array.from({ length: 10 }, (_, i) => { const a = (i / 10) * Math.PI * 2; const x = C + Math.cos(a) * 190, y = C + Math.sin(a) * 190; return `<line x1="${C}" y1="${C}" x2="${x}" y2="${y}" stroke="#222" stroke-width="10"/><g filter="url(#shadow)"><circle cx="${x}" cy="${y}" r="30" fill="url(#iron)" stroke="#1d2024" stroke-width="3"/>${[18, 11].map((r) => `<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="#c77d2a" stroke-width="4"/>`).join("")}</g>`; }).join("")}
<g fill="none" stroke="#9fe8ff" stroke-width="4" filter="url(#glow)"><path d="M${C + 190} ${C} l-30 20 l20 15 l-40 25"/><path d="M${C - 150} ${C - 110} l20 30 l-20 10 l30 30"/><path d="M${C - 30} ${C + 185} l10 -30 l-20 -10 l15 -35"/></g>
<g filter="url(#shadow)"><circle cx="${C}" cy="${C}" r="80" fill="url(#steelBall)" stroke="#1d2024" stroke-width="5"/><circle cx="${C}" cy="${C}" r="34" fill="#0b1a22" stroke="#7fe0ff" stroke-width="5" filter="url(#glow)"/></g>`,
};
