/** Opening the unit card popover from any extension page (context menu, popover lists, tracker). */
import OBR from "@owlbear-rodeo/sdk";
import { BUTLER_NS } from "../core/constants";

export const CARD_POPOVER = `${BUTLER_NS}/card`;
const CARD_W = 420;
const CARD_H = 680;

/** Opens the card for `itemId`: next to `anchorElementId` (context menu) or at the right edge of the view. */
export async function openCard(itemId: string, anchorElementId?: string) {
  const url = new URL(`card.html?id=${encodeURIComponent(itemId)}`, location.href).href;
  await OBR.popover.close(CARD_POPOVER).catch(() => {});
  if (anchorElementId) {
    await OBR.popover.open({ id: CARD_POPOVER, url, width: CARD_W, height: CARD_H, anchorElementId });
    return;
  }
  const vw = await OBR.viewport.getWidth();
  await OBR.popover.open({
    id: CARD_POPOVER, url, width: CARD_W, height: CARD_H,
    anchorReference: "POSITION", anchorPosition: { left: vw - 70, top: 64 },
    anchorOrigin: { horizontal: "RIGHT", vertical: "TOP" }, transformOrigin: { horizontal: "RIGHT", vertical: "TOP" },
  });
}
