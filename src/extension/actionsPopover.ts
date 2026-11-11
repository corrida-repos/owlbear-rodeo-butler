/** Opening the action bar popover (actions.html?id=<itemId>): docked at the bottom centre of the view, like a hotbar. */
import OBR from "@owlbear-rodeo/sdk";
import { BUTLER_NS } from "../core/constants";

export const ACTIONS_POPOVER = `${BUTLER_NS}/actions`;
const W = 600;
const H = 460;

export async function openActions(itemId: string) {
  const url = new URL(`actions.html?id=${encodeURIComponent(itemId)}`, location.href).href;
  await OBR.popover.close(ACTIONS_POPOVER).catch(() => {});
  const [vw, vh] = await Promise.all([OBR.viewport.getWidth(), OBR.viewport.getHeight()]);
  await OBR.popover.open({
    id: ACTIONS_POPOVER, url, width: Math.min(W, vw - 24), height: Math.min(H, vh - 80),
    anchorReference: "POSITION", anchorPosition: { left: Math.round(vw / 2), top: vh - 12 },
    anchorOrigin: { horizontal: "CENTER", vertical: "BOTTOM" }, transformOrigin: { horizontal: "CENTER", vertical: "BOTTOM" },
  });
}
