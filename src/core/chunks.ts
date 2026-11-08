/**
 * Owlbear broadcasts are limited to 16 kB, and a synced D&D Beyond character's sheet alone can be 15–19 kB.
 * Big messages are split into chunks and put back together by the receiver.
 */
export interface Chunk { v: 1; id: string; seq: number; total: number; part: string }

export const CHUNK_CHARS = 12_000;

export function splitMessage(id: string, payload: unknown, size = CHUNK_CHARS): Chunk[] {
  const json = JSON.stringify(payload);
  const total = Math.max(1, Math.ceil(json.length / size));
  return Array.from({ length: total }, (_, seq) => ({ v: 1, id, seq, total, part: json.slice(seq * size, (seq + 1) * size) }));
}

export const isChunk = (x: unknown): x is Chunk => {
  const c = x as Chunk;
  return !!c && c.v === 1 && typeof c.id === "string" && Number.isInteger(c.seq) && Number.isInteger(c.total)
    && c.total >= 1 && c.total <= 64 && c.seq >= 0 && c.seq < c.total && typeof c.part === "string";
};

/** Collects chunks per message id; returns the parsed payload once every chunk has arrived. Stale messages expire. */
export class Assembler {
  private parts = new Map<string, { at: number; got: (string | undefined)[] }>();
  constructor(private maxAgeMs = 60_000, private now: () => number = Date.now) {}

  add(c: Chunk): unknown | undefined {
    this.expire();
    // A dense array: `some`/`includes` must see the missing parts (a sparse array's holes are skipped).
    const entry = this.parts.get(c.id) ?? { at: this.now(), got: Array.from({ length: c.total }, (): string | undefined => undefined) };
    if (entry.got.length !== c.total) return undefined;
    entry.got[c.seq] = c.part;
    this.parts.set(c.id, entry);
    if (entry.got.includes(undefined)) return undefined;
    this.parts.delete(c.id);
    try { return JSON.parse(entry.got.join("")); } catch { return undefined; }
  }

  private expire() {
    const t = this.now();
    for (const [id, e] of this.parts) if (t - e.at > this.maxAgeMs) this.parts.delete(id);
  }
}
