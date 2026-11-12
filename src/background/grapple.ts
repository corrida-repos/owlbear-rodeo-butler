/**
 * Grappling on the map:
 *  - (primary GM client) a grappled token that isn't next to its grappler, because the grappler moved away or
 *    someone moved the grappled token, is put back on the nearest free spot next to the grappler;
 *  - (every client) the grappler's badge shows "+2 AC" while the active unit's line of attack to it passes through
 *    the creature it's grappling.
 * Square grids only: on hex grids nothing is moved.
 */
import OBR from "@owlbear-rodeo/sdk";
import { adjacentSpot, centre, GRAPPLE_AC_BONUS, grappledBy, intercepts, type Box } from "../core/grapple";
import type { UnitState } from "../core/sheet";

interface U { id: string; state: Pick<UnitState, "conditions"> }

async function box(id: string): Promise<Box | null> {
  const b = await OBR.scene.items.getItemBounds([id]).catch(() => null);
  return b ? { minX: b.min.x, minY: b.min.y, maxX: b.max.x, maxY: b.max.y } : null;
}

const pairs = (units: U[]) => {
  const ids = new Set(units.map((u) => u.id));
  return units.flatMap((u) => grappledBy(u.state).filter((t) => t !== u.id && ids.has(t)).map((t) => ({ grappler: u.id, target: t })));
};

/** Moves grappled tokens back next to their grappler. Returns how many were moved. */
export async function keepGrappledAdjacent(units: U[]): Promise<number> {
  const ps = pairs(units);
  if (!ps.length || (await OBR.scene.grid.getType()) !== "SQUARE") return 0;
  const cell = await OBR.scene.grid.getDpi();
  const moves = new Map<string, { dx: number; dy: number }>();
  let others: Map<string, Box> | null = null;
  for (const p of ps) {
    if (moves.has(p.target)) continue; // held by two grapplers: the first one wins this pass
    const [g, t] = await Promise.all([box(p.grappler), box(p.target)]);
    if (!g || !t) continue;
    if (!adjacentSpot(g, t, cell)) continue; // already adjacent
    // Only now look up every other token's space, to avoid putting it on top of one.
    if (!others) {
      others = new Map();
      for (const u of units) { const b = await box(u.id); if (b) others.set(u.id, b); }
    }
    const occupied = [...others].filter(([id]) => id !== p.target && id !== p.grappler).map(([, b]) => b);
    const spot = adjacentSpot(g, t, cell, occupied);
    if (!spot) continue;
    const c = centre(t);
    // Already on the chosen spot (an odd-sized token that never counts as touching): don't move it again and again.
    if (Math.abs(spot.x - c.x) < 1 && Math.abs(spot.y - c.y) < 1) continue;
    moves.set(p.target, { dx: spot.x - c.x, dy: spot.y - c.y });
    const moved = { minX: t.minX + spot.x - c.x, minY: t.minY + spot.y - c.y, maxX: t.maxX + spot.x - c.x, maxY: t.maxY + spot.y - c.y };
    others.set(p.target, moved);
  }
  if (!moves.size) return 0;
  await OBR.scene.items.updateItems([...moves.keys()], (drafts) => {
    for (const d of drafts) { const m = moves.get(d.id)!; d.position = { x: d.position.x + m.dx, y: d.position.y + m.dy }; }
  });
  return moves.size;
}

/** Badge texts for grapplers covered by the creature they hold against the active unit: unit id → ["+2 AC"]. */
export async function grappleCoverBadges(units: U[], activeId: string | null): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (!activeId) return out;
  const ps = pairs(units).filter((p) => p.grappler !== activeId && p.target !== activeId);
  if (!ps.length) return out;
  const [attacker, cell] = await Promise.all([box(activeId), OBR.scene.grid.getDpi()]);
  if (!attacker) return out;
  for (const p of ps) {
    if (out.has(p.grappler)) continue;
    const [g, t] = await Promise.all([box(p.grappler), box(p.target)]);
    if (g && t && intercepts(centre(attacker), centre(g), t, cell * 0.1)) out.set(p.grappler, [`+${GRAPPLE_AC_BONUS} AC`]);
  }
  return out;
}
