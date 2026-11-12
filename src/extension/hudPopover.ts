/**
 * The combat HUD popover (hud.html): a small panel at the bottom left with the player's Reaction marker, and Action /
 * Bonus Action markers on their turn. It stays open while they play (no click-away) for the whole combat.
 */
import OBR from "@owlbear-rodeo/sdk";
import { BUTLER_NS } from "../core/constants";

export const HUD_POPOVER = `${BUTLER_NS}/hud`;
/** Local message to this client's background: hide the HUD for this combat, or show it again. */
export const HUD_CHANNEL = `${BUTLER_NS}/hud`;
export const setHudShown = (show: boolean) => OBR.broadcast.sendMessage(HUD_CHANNEL, { show }, { destination: "LOCAL" });
const W = 250;
const ROW = 64;

/** Opens (or resizes) the HUD for `units` rows. */
export async function openHud(units: number) {
  const vh = await OBR.viewport.getHeight();
  await OBR.popover.open({
    id: HUD_POPOVER, url: new URL("hud.html", location.href).href,
    width: W, height: Math.min(vh - 80, 14 + ROW * Math.max(1, units)),
    anchorReference: "POSITION", anchorPosition: { left: 16, top: vh - 16 },
    anchorOrigin: { horizontal: "LEFT", vertical: "BOTTOM" }, transformOrigin: { horizontal: "LEFT", vertical: "BOTTOM" },
    disableClickAway: true, hidePaper: true,
  });
}

export const closeHud = () => OBR.popover.close(HUD_POPOVER).catch(() => {});
