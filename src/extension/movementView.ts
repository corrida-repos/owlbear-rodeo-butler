/** "Moved 20 / 30 ft" for the active unit, with Dash and Rewind (sent to the primary GM client, which applies them). */
import { speedPenalty } from "../core/conditions";
import { movedFeet, readMovement, speedLimit } from "../core/movement";
import type { TrackerUnit } from "../core/tracker";
import { h, showError, type Child } from "./dom";
import { sendRequest } from "./requests";
import { roomSystem } from "./roomSettings";

export function movementInfo(sceneMeta: Record<string, unknown>, u: Pick<TrackerUnit, "id" | "sheet" | "state">, role: "GM" | "PLAYER"): Child {
  const m = readMovement(sceneMeta);
  if (!m || m.unitId !== u.id) return null;
  const limit = speedLimit(u.sheet, { dash: m.dash, penalty: speedPenalty(roomSystem(), u.state) });
  const moved = movedFeet(m);
  const over = moved > limit;
  // Rewind / Dash always go through the primary GM client's background (it owns the movement record).
  const doRewind = () => sendRequest({ type: "rewind", unitId: u.id }, role).catch(showError);
  const toggleDash = () => sendRequest({ type: "dash", unitId: u.id, on: !m.dash }, role).catch(showError);
  return h("div", { className: `movebar small${over ? " over" : ""}` },
    h("span", {}, `Moved ${moved} / ${limit} ft`),
    h("label", { className: "row", title: "Dash doubles this turn's movement" }, h("input", { type: "checkbox", checked: m.dash, onchange: () => void toggleDash() }), "Dash"),
    h("button", { className: "icon tiny", disabled: !m.segments.length, title: "Move back to the last 5 ft point of this turn's path", onclick: () => void doRewind() }, "↶ Rewind"));
}
