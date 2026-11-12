/**
 * Difficult terrain: the GM's context-menu entry on drawings (shapes, polygons, freehand) to mark or unmark them as
 * difficult terrain, and the zone outlines the movement tracker checks moves against.
 * A marked drawing gets a dashed outline (and at least a faint fill) so everyone can see the zone; unmarking puts
 * its previous look back.
 */
import OBR, { type Item, type KeyFilter } from "@owlbear-rodeo/sdk";
import { BUTLER_NS } from "../core/constants";
import type { Vec2 } from "../core/grapple";
import { isDifficultTerrain, TERRAIN_KEY, zonePolygon, type TerrainMeta, type ZoneItem } from "../core/terrain";

const ZONE_TYPES: KeyFilter[] = [
  { key: "type", value: "SHAPE", coordinator: "||" },
  { key: "type", value: "CURVE", coordinator: "||" },
  { key: "type", value: "PATH" },
];

type Styled = Item & { style?: { strokeDash?: number[]; strokeWidth?: number; fillOpacity?: number } };

/** Outlines (scene pixels) of every difficult-terrain zone in the scene. */
export async function difficultZones(): Promise<Vec2[][]> {
  const items = await OBR.scene.items.getItems((i) => isDifficultTerrain(i.metadata));
  const polys = await Promise.all(items.map(async (i) => {
    const b = await OBR.scene.items.getItemBounds([i.id]).catch(() => null);
    return zonePolygon(i as unknown as ZoneItem, b ? { minX: b.min.x, minY: b.min.y, maxX: b.max.x, maxY: b.max.y } : undefined);
  }));
  return polys.filter((p): p is Vec2[] => !!p && p.length >= 3);
}

export async function createTerrainMenu(icon: string, notify: (text: string, variant?: "INFO" | "SUCCESS") => unknown) {
  await OBR.contextMenu.create({
    id: `${BUTLER_NS}/terrain`,
    icons: [
      { icon, label: "Mark as difficult terrain", filter: { roles: ["GM"], every: ZONE_TYPES, some: [{ key: ["metadata", TERRAIN_KEY], value: undefined }] } },
      { icon, label: "Remove difficult terrain", filter: { roles: ["GM"], every: ZONE_TYPES } },
    ],
    onClick: async (ctx) => {
      const mark = ctx.items.some((i) => !isDifficultTerrain(i.metadata));
      await OBR.scene.items.updateItems(ctx.items.map((i) => i.id), (drafts) => {
        for (const d of drafts as Styled[]) {
          const style = d.style;
          if (mark) {
            if (isDifficultTerrain(d.metadata)) continue;
            const meta: TerrainMeta = { difficult: true, ...(style ? { style: { strokeDash: style.strokeDash ?? [], fillOpacity: style.fillOpacity ?? 0 } } : {}) };
            d.metadata[TERRAIN_KEY] = meta;
            if (style) {
              const w = Math.max(2, style.strokeWidth ?? 5);
              style.strokeDash = [w * 3, w * 2];
              style.fillOpacity = Math.max(0.2, style.fillOpacity ?? 0);
            }
          } else {
            const prev = (d.metadata[TERRAIN_KEY] as TerrainMeta | undefined)?.style;
            if (style && prev) { style.strokeDash = prev.strokeDash ?? []; style.fillOpacity = prev.fillOpacity ?? style.fillOpacity; }
            delete d.metadata[TERRAIN_KEY];
          }
        }
      });
      const n = ctx.items.length;
      await notify(mark
        ? `Marked ${n} zone${n === 1 ? "" : "s"} as difficult terrain: each foot moved through it costs 1 extra foot.`
        : `${n} zone${n === 1 ? " is" : "s are"} no longer difficult terrain.`, mark ? "SUCCESS" : "INFO");
    },
  });
}
