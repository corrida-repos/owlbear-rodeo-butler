/**
 * Background script: loaded once per client (GM and every player) while the extension is enabled in the room,
 * even when no popover is open. Registers context-menu items and turns roll broadcasts into notifications.
 */
import OBR from "@owlbear-rodeo/sdk";
import { BUTLER_NS } from "../core/constants";
import { canSeeRoll, isRollMessage, ROLL_CHANNEL, rollText } from "../core/rolls";
import { SHEET_KEY } from "../core/sheet";

const CARD_POPOVER = `${BUTLER_NS}/card`;
const icon = new URL("icon.svg", location.href).href;

OBR.onReady(async () => {
  await OBR.contextMenu.create({
    id: `${BUTLER_NS}/view-unit`,
    icons: [{
      icon,
      label: "View unit card",
      // Only Butler units (tokens with a stat block).
      filter: { max: 1, every: [{ key: "layer", value: "CHARACTER" }, { key: "type", value: "IMAGE" }, { key: ["metadata", SHEET_KEY], value: undefined, operator: "!=" }] },
    }],
    onClick: async (ctx, elementId) => {
      const item = ctx.items[0];
      if (!item) return;
      await OBR.popover.open({
        id: CARD_POPOVER,
        url: new URL(`card.html?id=${encodeURIComponent(item.id)}`, location.href).href,
        width: 400,
        height: 560,
        anchorElementId: elementId,
      });
    },
  });

  OBR.broadcast.onMessage(ROLL_CHANNEL, async (event) => {
    const msg = event.data;
    if (!isRollMessage(msg)) return;
    const viewer = { id: OBR.player.id, role: await OBR.player.getRole() };
    if (!canSeeRoll(msg, viewer)) return;
    await OBR.notification.show(rollText(msg), msg.visibility === "private" ? "WARNING" : "INFO");
  });
});
