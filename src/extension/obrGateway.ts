import OBR, { buildImage, type Item } from "@owlbear-rodeo/sdk";
import type { ImageItemSpec, SceneGateway, SceneItemLite } from "../core/importer";

/** Thin adapter from the core importer to the official Owlbear Rodeo SDK. */
export const obrGateway: SceneGateway = {
  getRole: () => OBR.player.getRole(),
  async getItems() {
    const items = await OBR.scene.items.getItems();
    return items.map((i: Item): SceneItemLite => ({ id: i.id, type: i.type, layer: i.layer, name: i.name, metadata: i.metadata }));
  },
  getItemBounds: (ids) => OBR.scene.items.getItemBounds(ids),
  async addImages(specs: ImageItemSpec[]) {
    const items = specs.map((s) => {
      let b = buildImage(
        { url: s.image.url, mime: s.image.mime, width: s.image.width, height: s.image.height },
        { dpi: s.grid.dpi, offset: s.grid.offset },
      )
        .id(s.id)
        .name(s.name)
        .layer(s.layer)
        .position(s.position)
        .visible(s.visible)
        .locked(s.locked)
        .metadata(s.metadata);
      if (s.description) b = b.description(s.description);
      if (s.label) b = b.plainText(s.label).textItemType("LABEL");
      return b.build();
    });
    await OBR.scene.items.addItems(items);
  },
  deleteItems: (ids) => OBR.scene.items.deleteItems(ids),
  getSceneMetadata: () => OBR.scene.getMetadata(),
  setSceneMetadata: (u) => OBR.scene.setMetadata(u),
  getRoomMetadata: () => OBR.room.getMetadata(),
  async getGrid() {
    const [dpi, scale, type] = await Promise.all([OBR.scene.grid.getDpi(), OBR.scene.grid.getScale(), OBR.scene.grid.getType()]);
    return { dpi, scale: scale.raw, type };
  },
  setGridScale: (s) => OBR.scene.grid.setScale(s),
  setGridType: (t) => OBR.scene.grid.setType(t),
};
