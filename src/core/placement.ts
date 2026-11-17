/**
 * Where a popover sits, in Owlbear's view coordinates (pixels from the view's top-left corner). Owlbear can't move an
 * open popover, so moving one means opening it again at its new top-left corner; these work out that corner from how
 * a popover was opened, from a drag, and keep it inside the view.
 */
export interface Pos { left: number; top: number }
export interface Size { width: number; height: number }

type H = "CENTER" | "LEFT" | "RIGHT";
type V = "BOTTOM" | "CENTER" | "TOP";
export interface PositionedOpen {
  width: number; height: number;
  anchorReference?: "ELEMENT" | "POSITION";
  anchorPosition?: Pos;
  transformOrigin?: { horizontal: H; vertical: V };
}

/** The top-left corner of a popover opened at a position (null when it's anchored to an element). */
export function topLeftOf(p: PositionedOpen): Pos | null {
  if (p.anchorReference !== "POSITION" || !p.anchorPosition) return null;
  const t = p.transformOrigin ?? { horizontal: "LEFT", vertical: "TOP" };
  const dx = t.horizontal === "LEFT" ? 0 : t.horizontal === "CENTER" ? p.width / 2 : p.width;
  const dy = t.vertical === "TOP" ? 0 : t.vertical === "CENTER" ? p.height / 2 : p.height;
  return { left: Math.round(p.anchorPosition.left - dx), top: Math.round(p.anchorPosition.top - dy) };
}

/** Keeps a popover inside the view: fully across, and at least its top bar (`grip` px) down. */
export function clampPos(pos: Pos, size: Size, view: Size, grip = 40): Pos {
  const margin = 4;
  return {
    left: Math.round(Math.min(Math.max(margin, pos.left), Math.max(margin, view.width - size.width - margin))),
    top: Math.round(Math.min(Math.max(margin, pos.top), Math.max(margin, view.height - grip))),
  };
}

/** Where a dragged popover lands: its corner moved by how far the pointer travelled, kept in view. */
export function dropPos(from: Pos, delta: { x: number; y: number }, size: Size, view: Size): Pos {
  return clampPos({ left: from.left + delta.x, top: from.top + delta.y }, size, view);
}

/**
 * The popover's corner estimated from inside it, when it was opened next to a token (so nobody knows exactly where):
 * the frame's place on screen, less where the browser's page area starts on screen.
 */
export function estimateCorner(frameOnScreen: { x: number; y: number }, win: { screenX: number; screenY: number; outerWidth: number; outerHeight: number }, view: Size): Pos {
  const pageLeft = win.screenX + Math.max(0, (win.outerWidth - view.width) / 2);
  const pageTop = win.screenY + Math.max(0, win.outerHeight - view.height);
  return { left: Math.round(frameOnScreen.x - pageLeft), top: Math.round(frameOnScreen.y - pageTop) };
}
