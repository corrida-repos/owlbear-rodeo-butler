/**
 * Resizes tokens on the map (right-click → Set size): image grid for the footprint, scale back to 1 and a position
 * snapped for it (see core/layout.ts resizeFor). Run by the GM's own picker, and by the primary GM client for a
 * player's request on their own token. The stat block's size is left alone.
 */
import OBR, { type Image, type Item } from "@owlbear-rodeo/sdk";
import { resizeFor, type TokenSize } from "../core/layout";

const isImage = (i: Item): i is Image => i.type === "IMAGE" && !!(i as Image).image && !!(i as Image).grid;

export async function applyTokenSize(ids: string[], size: TokenSize): Promise<number> {
  const tokens = (await OBR.scene.items.getItems(ids)).filter(isImage);
  if (!tokens.length) return 0;
  const plans = new Map(tokens.map((t) => [t.id, resizeFor(t.image, size)]));
  // Snap each token's centre for its new footprint (corners for Large/Gargantuan, cell centres otherwise).
  const positions = new Map<string, { x: number; y: number }>();
  for (const t of tokens) {
    const p = plans.get(t.id)!;
    positions.set(t.id, await OBR.scene.grid.snapPosition(t.position, 1, p.snap === "corners", p.snap === "center"));
  }
  await OBR.scene.items.updateItems(tokens.map((t) => t.id), (drafts) => {
    for (const d of drafts as Image[]) {
      const p = plans.get(d.id)!;
      d.grid = { ...d.grid, dpi: p.grid.dpi, offset: p.grid.offset };
      d.scale = p.scale;
      d.position = positions.get(d.id)!;
    }
  });
  return tokens.length;
}
