/** Opening the Wild Shape popover (wildshape.html?id=<itemId>) from the context menu or the unit card. */
import OBR from "@owlbear-rodeo/sdk";
import { BUTLER_NS } from "../core/constants";

export const WILD_POPOVER = `${BUTLER_NS}/wild-shape`;
const W = 400;
const H = 640;

export async function openWildShape(itemId: string, anchorElementId?: string) {
  const url = new URL(`wildshape.html?id=${encodeURIComponent(itemId)}`, location.href).href;
  await OBR.popover.close(WILD_POPOVER).catch(() => {});
  if (anchorElementId) {
    await OBR.popover.open({ id: WILD_POPOVER, url, width: W, height: H, anchorElementId });
    return;
  }
  const vw = await OBR.viewport.getWidth();
  await OBR.popover.open({
    id: WILD_POPOVER, url, width: W, height: H,
    anchorReference: "POSITION", anchorPosition: { left: vw - 500, top: 64 },
    anchorOrigin: { horizontal: "RIGHT", vertical: "TOP" }, transformOrigin: { horizontal: "RIGHT", vertical: "TOP" },
  });
}
