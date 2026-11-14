/** Opening the 0 HP popover (zerohp.html): the 0-HP prompt and death saves for the units this client answers for. */
import OBR from "@owlbear-rodeo/sdk";
import { BUTLER_NS } from "../core/constants";

export const ZERO_HP_POPOVER = `${BUTLER_NS}/zero-hp`;

export async function openZeroHp() {
  const url = new URL("zerohp.html", location.href).href;
  const vw = await OBR.viewport.getWidth();
  await OBR.popover.open({
    id: ZERO_HP_POPOVER, url, width: 380, height: 440,
    anchorReference: "POSITION", anchorPosition: { left: Math.round(vw / 2), top: 64 },
    anchorOrigin: { horizontal: "CENTER", vertical: "TOP" }, transformOrigin: { horizontal: "CENTER", vertical: "TOP" },
  });
}
