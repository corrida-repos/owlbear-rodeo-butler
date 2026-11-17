import { describe, expect, it } from "vitest";
import { clampPos, dropPos, estimateCorner, topLeftOf } from "../src/core/placement";

describe("movable popovers: where a popover sits", () => {
  it("works out the top-left corner from how it was opened", () => {
    // The action bar: docked bottom-centre.
    expect(topLeftOf({ width: 600, height: 460, anchorReference: "POSITION", anchorPosition: { left: 800, top: 888 }, transformOrigin: { horizontal: "CENTER", vertical: "BOTTOM" } }))
      .toEqual({ left: 500, top: 428 });
    // The card: top-right.
    expect(topLeftOf({ width: 420, height: 680, anchorReference: "POSITION", anchorPosition: { left: 1530, top: 64 }, transformOrigin: { horizontal: "RIGHT", vertical: "TOP" } }))
      .toEqual({ left: 1110, top: 64 });
    expect(topLeftOf({ width: 300, height: 300 })).toBeNull(); // next to a token: unknown
  });
  it("moves by the drag and stays in view", () => {
    const view = { width: 1600, height: 900 };
    expect(dropPos({ left: 500, top: 428 }, { x: -300, y: -350 }, { width: 600, height: 460 }, view)).toEqual({ left: 200, top: 78 });
    expect(dropPos({ left: 500, top: 428 }, { x: 2000, y: 2000 }, { width: 600, height: 460 }, view)).toEqual({ left: 996, top: 860 });
    expect(clampPos({ left: -50, top: -20 }, { width: 300, height: 300 }, view)).toEqual({ left: 4, top: 4 });
  });
  it("estimates the corner from inside the frame", () => {
    expect(estimateCorner({ x: 1100, y: 400 }, { screenX: 0, screenY: 0, outerWidth: 1600, outerHeight: 980 }, { width: 1600, height: 900 })).toEqual({ left: 1100, top: 320 });
  });
});
