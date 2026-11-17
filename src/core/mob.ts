/**
 * Mobs (2024 DMG, chapter 3): resolve many identical monsters' D20 Tests without rolling, with the Mob Results table,
 * use average damage, and estimate how many creatures an area of effect catches (Targets in Area of Effect).
 * Pure functions; the DM Tools tab runs them.
 */

export type MobMode = "normal" | "advantage" | "disadvantage";

/** Mob Results, row by row: roll needed (normal), with Advantage, with Disadvantage, then successes out of 4, 5, 6, 8, 10. */
const ROWS: [number, string, string, number, number, number, number, number][] = [
  [1, "1-4", "1", 4, 5, 6, 8, 10], [2, "5-6", "", 4, 5, 6, 8, 10], [3, "7-8", "2", 4, 5, 5, 7, 9], [4, "9", "", 3, 4, 5, 7, 9],
  [5, "10", "3", 3, 4, 5, 6, 8], [6, "11", "", 3, 4, 5, 6, 8], [7, "12", "4", 3, 4, 4, 6, 7], [8, "13", "5", 3, 3, 4, 5, 7],
  [9, "14", "", 2, 3, 4, 5, 6], [10, "", "6", 2, 3, 3, 4, 6], [11, "15", "7", 2, 3, 3, 4, 5], [12, "16", "", 2, 2, 3, 4, 5],
  [13, "", "8", 2, 2, 2, 3, 4], [14, "17", "9", 1, 2, 2, 3, 4], [15, "18", "10", 1, 2, 2, 2, 3], [16, "", "11", 1, 1, 2, 2, 3],
  [17, "19", "12", 1, 1, 1, 2, 2], [18, "", "13", 1, 1, 1, 1, 2], [19, "20", "14-15", 0, 1, 1, 1, 1], [20, "", "16-17", 0, 0, 0, 0, 1],
];
const DENOMS = [4, 5, 6, 8, 10] as const;

const inRange = (cell: string, n: number) => {
  if (!cell) return false;
  const [a, b] = cell.split("-").map(Number);
  return n >= a! && n <= (b ?? a!);
};

/** The Mob Results row for a roll needed and mode, or null when no roll can succeed (beyond the table). */
export function mobRow(rollNeeded: number, mode: MobMode = "normal"): (typeof ROWS)[number] | null {
  const need = Math.max(1, Math.ceil(rollNeeded));
  if (mode === "normal") return need > 20 ? null : ROWS[need - 1]!;
  const col = mode === "advantage" ? 1 : 2;
  return ROWS.find((r) => inRange(r[col] as string, need)) ?? null;
}

export interface MobResult {
  rollNeeded: number;
  /** The fraction read from the table ("3/8"). */
  fraction: string;
  successes: number;
  failures: number;
}

/**
 * How many of `count` identical monsters succeed: roll needed = target number − bonus (an AC or a save DC), read
 * across the Mob Results table. A column that divides the group evenly is used (e.g. 8 → "out of 8", 12 → "out of 6"
 * twice); otherwise the out-of-10 proportion, rounded.
 */
export function mobResult(count: number, target: number, bonus: number, mode: MobMode = "normal"): MobResult {
  const rollNeeded = target - bonus;
  const n = Math.max(0, Math.floor(count));
  const row = mobRow(rollNeeded, mode);
  if (!row || !n) return { rollNeeded, fraction: row ? "—" : "0", successes: 0, failures: n };
  const per = (d: number) => row[3 + DENOMS.indexOf(d as (typeof DENOMS)[number])] as number;
  const d = [...DENOMS].reverse().find((x) => n % x === 0);
  const successes = d ? per(d) * (n / d) : Math.round((n * per(10)) / 10);
  const shown = d ?? 10;
  return { rollNeeded, fraction: per(shown) === 0 ? "0" : `${per(shown)}/${shown}`, successes, failures: n - successes };
}

/** Average of a dice formula ("2d6+3" → 10, "1d8 + 1d6" → 8): rounded down, as stat blocks print it. */
export function averageOf(formula: string): number {
  const f = formula.replace(/\s+/g, "");
  let total = 0;
  for (const m of f.matchAll(/([+-]?)(\d*)d(\d+)|([+-]?)(\d+)(?![d\d])/gi)) {
    if (m[3]) total += (m[1] === "-" ? -1 : 1) * Number(m[2] || 1) * (Number(m[3]) + 1) / 2;
    else if (m[5]) total += (m[4] === "-" ? -1 : 1) * Number(m[5]);
  }
  return Math.max(0, Math.floor(total));
}

// ------------------------------------------------------------------ Targets in Area of Effect

export type AreaShape = "cone" | "cube" | "sphere" | "line";

/** The table's rows: cone length, cube size, sphere/cylinder radius, line (length × width), creatures caught. */
const AREA_ROWS: { cone: number[]; cube: number[]; sphere: number[]; line: [number, number][]; n: number }[] = [
  { cone: [10], cube: [5, 10], sphere: [5], line: [], n: 1 },
  { cone: [15, 20], cube: [15], sphere: [], line: [[30, 5]], n: 2 },
  { cone: [25], cube: [], sphere: [10], line: [[30, 10], [60, 5]], n: 3 },
  { cone: [], cube: [20], sphere: [], line: [[90, 5], [100, 5]], n: 4 },
  { cone: [30], cube: [], sphere: [], line: [[60, 10], [120, 5]], n: 5 },
  { cone: [35], cube: [25], sphere: [15], line: [], n: 6 },
  { cone: [40], cube: [30], sphere: [], line: [[90, 10], [100, 10]], n: 8 },
  { cone: [45], cube: [], sphere: [], line: [], n: 9 },
  { cone: [50], cube: [35], sphere: [20], line: [[120, 10]], n: 10 },
  { cone: [55], cube: [40], sphere: [], line: [], n: 12 },
  { cone: [60], cube: [45], sphere: [25], line: [], n: 16 },
  { cone: [], cube: [50], sphere: [30], line: [], n: 20 },
];

/**
 * About how many creatures an area catches when there's no map (DMG "Adjudicating Areas of Effect"). Sizes between
 * rows use the nearest smaller listed size. `spread`: −1d3 if the targets are spread out, +1d3 if bunched up (pass the
 * d3 roll). Never more than `present`.
 */
export function targetsInArea(shape: AreaShape, size: number, opts: { width?: number; spread?: "spread" | "bunched"; d3?: number; present?: number } = {}): number {
  let best = 0;
  for (const r of AREA_ROWS) {
    const fits = shape === "line"
      ? r.line.some(([l, w]) => size >= l && (opts.width ?? 5) >= w)
      : (r[shape] as number[]).some((s) => size >= s);
    if (fits) best = Math.max(best, r.n);
  }
  const d3 = Math.min(3, Math.max(1, opts.d3 ?? 2));
  let n = opts.spread === "spread" ? best - d3 : opts.spread === "bunched" ? best + d3 : best;
  n = Math.max(best ? 1 : 0, n);
  return opts.present !== undefined ? Math.min(opts.present, n) : n;
}
