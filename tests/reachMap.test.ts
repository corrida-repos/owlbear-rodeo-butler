import { beforeEach, describe, expect, it, vi } from "vitest";

// The background page's drawing, against a stand-in for Owlbear: builders record what they're given.
const { local, bounds } = vi.hoisted(() => ({ local: [] as any[], bounds: {} as Record<string, { min: { x: number; y: number }; max: { x: number; y: number } }> }));
vi.mock("@owlbear-rodeo/sdk", () => {
  const builder = () => {
    const o: Record<string, unknown> = {};
    const p: any = new Proxy({}, { get: (_t, k: string) => k === "build" ? () => o : (v: unknown) => { o[k] = v; return p; } });
    return p;
  };
  const box = (b: (typeof bounds)[string]) => ({ ...b, width: b.max.x - b.min.x, height: b.max.y - b.min.y, center: { x: (b.min.x + b.max.x) / 2, y: (b.min.y + b.max.y) / 2 } });
  return {
    buildShape: builder, buildLabel: builder,
    default: {
      scene: {
        grid: { getDpi: async () => 100, getScale: async () => ({ parsed: { multiplier: 5 } }), getMeasurement: async () => "CHEBYSHEV", getType: async () => "SQUARE" },
        items: { getItemBounds: async ([id]: string[]) => box(bounds[id!]!) },
        local: {
          addItems: async (items: any[]) => { local.push(...items); },
          deleteItems: async (ids: string[]) => { for (const id of ids) { const i = local.findIndex((x) => x.id === id); if (i >= 0) local.splice(i, 1); } },
        },
      },
    },
  };
});

const { receiveAim, updateReach } = await import("../src/background/reach");
const { reachOf } = await import("../src/core/reach");
const { BUTLER_NS } = await import("../src/core/constants");

const cell = (x: number, y: number) => ({ min: { x: x * 100, y: y * 100 }, max: { x: x * 100 + 100, y: y * 100 + 100 } });
const token = (id: string, visible = true) => ({ id, layer: "CHARACTER", type: "IMAGE", visible, metadata: {} }) as any;
const ids = () => local.map((i) => i.id).sort();

describe("reach on the map", () => {
  beforeEach(async () => {
    Object.assign(bounds, { me: cell(0, 0), near: cell(2, 0), far: cell(10, 0), hidden: cell(1, 1) });
    receiveAim(null, () => {});
    await updateReach([], "GM");
  });

  it("draws the bands around the unit and rings the creatures in reach, by band; players don't get hidden tokens", async () => {
    const reach = reachOf({ key: "actions:Shortbow", name: "Shortbow", text: "Ranged Attack Roll: +4, range 10/50 ft." })!;
    expect(receiveAim({ unitId: "me", name: "Shortbow", reach }, () => {})).toBe(true);
    const items = [token("me"), token("near"), token("far"), token("hidden", false)];
    await updateReach(items, "PLAYER");
    expect(ids()).toEqual([
      "band/0", "band/0/label", "band/1", "band/1/label", "target/far", "target/far/label", "target/near", "target/near/label",
    ].map((id) => `${BUTLER_NS}/reach/${id}`));
    const label = (id: string) => local.find((i) => i.id.endsWith(`/reach/target/${id}/label`))?.plainText;
    expect(label("near")).toBe("10 ft · in range");
    expect(label("far")).toBe("50 ft · long range: Disadvantage");
    // Chebyshev on a square grid: the bands are squares, from the edge of the unit's space (1 cell + 10 ft = 2 cells on each side).
    const band = local.find((i) => i.id.endsWith("/reach/band/1"));
    expect(band.shapeType).toBe("RECTANGLE");
    expect(band.width).toBe(500);

    // The GM sees the hidden token's ring too.
    await updateReach(items, "GM");
    expect(label("hidden")).toBe("5 ft · in range");

    // Clearing the aim removes everything.
    receiveAim(null, () => {});
    await updateReach(items, "GM");
    expect(local).toEqual([]);
  });
});
