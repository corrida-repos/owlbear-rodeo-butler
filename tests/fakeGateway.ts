import { mergePatch, type ImageItemSpec, type SceneGateway, type SceneItemLite } from "../src/core/importer";

export interface FakeItem extends SceneItemLite {
  spec?: ImageItemSpec;
  position: { x: number; y: number };
  size: { w: number; h: number };
}

/** In-memory stand-in for an Owlbear scene; mirrors the parts of the SDK the importer uses. */
export class FakeScene implements SceneGateway {
  items: FakeItem[] = [];
  sceneMeta: Record<string, unknown> = {};
  roomMeta: Record<string, unknown> = {};
  grid = { dpi: 150, scale: "5ft", type: "SQUARE" };
  role: "GM" | "PLAYER" = "GM";
  failAddOnCall: number | null = null;
  private addCalls = 0;

  async getRole() { return this.role; }
  async getItems() { return this.items.map((i) => ({ ...i, metadata: structuredClone(i.metadata) })); }
  async getItemBounds(ids: string[]) {
    const sel = this.items.filter((i) => ids.includes(i.id));
    return {
      min: { x: Math.min(...sel.map((i) => i.position.x)), y: Math.min(...sel.map((i) => i.position.y)) },
      max: { x: Math.max(...sel.map((i) => i.position.x + i.size.w)), y: Math.max(...sel.map((i) => i.position.y + i.size.h)) },
    };
  }
  async addImages(specs: ImageItemSpec[]) {
    this.addCalls++;
    if (this.failAddOnCall === this.addCalls) throw new Error("simulated network failure");
    for (const s of specs) {
      // Same JSON round-trip OBR does: metadata must be serialisable.
      const metadata = JSON.parse(JSON.stringify(s.metadata));
      const k = this.grid.dpi / s.grid.dpi;
      this.items.push({
        id: s.id, type: "IMAGE", layer: s.layer, name: s.name, label: s.label, image: { ...s.image }, grid: { dpi: s.grid.dpi, offset: { ...s.grid.offset } }, metadata, spec: s,
        position: { x: s.position.x - s.grid.offset.x * k, y: s.position.y - s.grid.offset.y * k },
        size: { w: s.image.width * k, h: s.image.height * k },
      });
    }
  }
  async deleteItems(ids: string[]) { this.items = this.items.filter((i) => !ids.includes(i.id)); }
  async updateImages(updates: { id: string; image: any; grid: { dpi: number; offset: { x: number; y: number } } }[]) {
    for (const u of updates) {
      const it = this.items.find((i) => i.id === u.id);
      if (it) { it.image = { ...u.image }; it.grid = { dpi: u.grid.dpi, offset: { ...u.grid.offset } }; it.spec = it.spec ? { ...it.spec, image: u.image, grid: u.grid } : it.spec; }
    }
  }
  async updateMetadata(updates: { id: string; metadata: Record<string, unknown> }[]) {
    for (const u of updates) {
      const it = this.items.find((i) => i.id === u.id);
      if (it) it.metadata = { ...it.metadata, ...JSON.parse(JSON.stringify(u.metadata)) };
    }
  }
  async patchMetadata(updates: { id: string; key: string; patch: Record<string, unknown> }[]) {
    for (const u of updates) {
      const it = this.items.find((i) => i.id === u.id);
      if (!it) continue;
      it.metadata = { ...it.metadata, [u.key]: mergePatch(it.metadata[u.key], u.patch) };
    }
  }
  async setVisible(ids: string[], visible: boolean) { for (const it of this.items) if (ids.includes(it.id)) it.visible = visible; }
  async getSceneMetadata() { return structuredClone(this.sceneMeta); }
  async setSceneMetadata(u: Record<string, unknown>) { this.sceneMeta = { ...this.sceneMeta, ...u }; }
  async getRoomMetadata() { return structuredClone(this.roomMeta); }
  async getGrid() { return { ...this.grid }; }
  async setGridScale(s: string) { this.grid.scale = s; }
  async setGridType(t: "SQUARE") { this.grid.type = t; }
}
