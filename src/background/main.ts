/**
 * Background script: loaded once per client (GM and every player) while the extension is enabled in the room,
 * even when no popover is open. Registers context-menu items and turns roll broadcasts into notifications and
 * entries in this browser's roll log.
 */
import "../extension/devlog";
import OBR from "@owlbear-rodeo/sdk";
import { BUTLER_NS } from "../core/constants";
import { canSeeRoll, isRollMessage, ROLL_CHANNEL, rollText } from "../core/rolls";
import { SHEET_KEY } from "../core/sheet";
import { openCard } from "../extension/cardPopover";
import { pushRollLog } from "../extension/rollLog";

const icon = new URL("icon.svg", location.href).href;

OBR.onReady(async () => {
  // Players can only select tokens they own, so for them this shows on their own units only.
  await OBR.contextMenu.create({
    id: `${BUTLER_NS}/view-unit`,
    icons: [{
      icon,
      label: "View unit card",
      filter: { max: 1, every: [{ key: "layer", value: "CHARACTER" }, { key: "type", value: "IMAGE" }, { key: ["metadata", SHEET_KEY], value: undefined, operator: "!=" }] },
    }],
    onClick: async (ctx, elementId) => {
      const item = ctx.items[0];
      if (item) await openCard(item.id, elementId);
    },
  });

  OBR.broadcast.onMessage(ROLL_CHANNEL, async (event) => {
    const msg = event.data;
    if (!isRollMessage(msg)) { console.warn("[Butler] ignored malformed roll message", msg); return; }
    const viewer = { id: OBR.player.id, role: await OBR.player.getRole() };
    if (!canSeeRoll(msg, viewer)) return;
    pushRollLog(msg);
    try {
      await OBR.notification.show(rollText(msg), msg.visibility === "private" ? "WARNING" : msg.natural === 20 ? "SUCCESS" : "INFO");
    } catch (e) {
      console.error("[Butler] notification failed", e);
    }
  });
});
