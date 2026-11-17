/**
 * Movable popovers. Every Butler popover gets a thin bar on top: drag its handle to move the window out of the way
 * (it reopens where you let go: Owlbear can't move an open popover), ▁ shrinks it to just the bar and back, ✕ closes
 * it. Each popover remembers where you put it (this browser) and opens there next time; double-click the handle to
 * forget that and use its usual place again.
 *
 * Openers call openPlaced() instead of OBR.popover.open(); popover pages call installPopoverFrame(id, title).
 */
import OBR, { type Popover } from "@owlbear-rodeo/sdk";
import { clampPos, dropPos, estimateCorner, topLeftOf, type Pos } from "../core/placement";
import { store } from "./dom";

const SAVED = (id: string) => `butler.popover.saved.${id}`;   // where the user put it
const AT = (id: string) => `butler.popover.at.${id}`;         // where it is now, when known exactly
const OPTS = (id: string) => `butler.popover.opts.${id}`;     // how it was opened (to reopen it the same way)
const MIN = (id: string) => `butler.popover.min.${id}`;       // full height while shrunk to its bar
const BAR = 28;

const readJson = <T>(k: string): T | null => { try { const v = store.get(k); return v ? JSON.parse(v) as T : null; } catch { return null; } };
const writeJson = (k: string, v: unknown) => store.set(k, v === null ? "" : JSON.stringify(v));

async function viewSize() {
  const [width, height] = await Promise.all([OBR.viewport.getWidth(), OBR.viewport.getHeight()]);
  return { width, height };
}

const atCorner = (pos: Pos) => ({
  anchorReference: "POSITION" as const, anchorPosition: pos,
  anchorOrigin: { horizontal: "LEFT" as const, vertical: "TOP" as const }, transformOrigin: { horizontal: "LEFT" as const, vertical: "TOP" as const },
});

/** Opens a popover where the user last put it, else as asked; remembers how, so the popover can move itself. */
export async function openPlaced(p: Popover) {
  const saved = readJson<Pos>(SAVED(p.id));
  let open: Popover = p;
  if (saved) {
    const view = await viewSize();
    const width = Math.min(p.width, view.width - 8);
    const height = Math.min(p.height, view.height - 8);
    open = { ...p, width, height, anchorElementId: undefined, ...atCorner(clampPos(saved, { width, height }, view)) };
  }
  const { url: _url, ...opts } = open;
  writeJson(OPTS(p.id), opts);
  writeJson(AT(p.id), topLeftOf(open));
  writeJson(MIN(p.id), null);
  await OBR.popover.open(open);
}

/** What a page can do with its frame: a compact strip shown under the bar while shrunk (the action bar's Cast), and
 *  shrinking or restoring the window itself. */
export interface PopoverFrame { setCompact(el: HTMLElement | null): void; minimize(on: boolean): Promise<void>; minimized(): boolean }

/** Adds the move / shrink / close bar to this popover page. */
export function installPopoverFrame(id: string, title: string): PopoverFrame {
  const bar = document.createElement("div");
  bar.className = "pop-bar";
  const grip = document.createElement("div");
  grip.className = "pop-grip";
  grip.title = "Drag to move this window out of the way (it reopens where you let go). Double-click: back to its usual place next time.";
  grip.textContent = `⠿ ${title}`;
  const shrink = document.createElement("button");
  shrink.className = "pop-btn";
  const close = document.createElement("button");
  close.className = "pop-btn";
  close.textContent = "✕";
  close.title = "Close";
  close.onclick = () => void OBR.popover.close(id);
  bar.append(grip, shrink, close);
  const compact = document.createElement("div");
  compact.className = "pop-compact";
  document.body.prepend(bar, compact);
  /** Height while shrunk: the bar, plus the compact strip when there is one. */
  const minHeight = () => BAR + 4 + (compact.childElementCount ? compact.offsetHeight : 0);

  const setShrinkLabel = () => {
    const min = readJson<number>(MIN(id));
    shrink.textContent = min ? "▢" : "▁";
    shrink.title = min ? "Restore the window" : "Shrink to this bar (to see the board)";
    document.body.classList.toggle("pop-minimized", !!min);
  };
  setShrinkLabel();
  const minimize = async (on: boolean) => {
    const min = readJson<number>(MIN(id));
    if (!on && min) { writeJson(MIN(id), null); setShrinkLabel(); await OBR.popover.setHeight(id, min); }
    else if (on && !min) {
      const h = (await OBR.popover.getHeight(id)) ?? readJson<Popover>(OPTS(id))?.height ?? 400;
      writeJson(MIN(id), h); setShrinkLabel(); await OBR.popover.setHeight(id, minHeight());
    }
  };
  shrink.onclick = () => void minimize(!readJson<number>(MIN(id)));

  let start: { x: number; y: number; frame: { x: number; y: number } } | null = null;
  grip.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    start = { x: e.screenX, y: e.screenY, frame: { x: e.screenX - e.clientX, y: e.screenY - e.clientY } };
    grip.setPointerCapture(e.pointerId);
    bar.classList.add("dragging");
  });
  grip.addEventListener("pointermove", (e) => {
    if (!start) return;
    const dx = Math.round(e.screenX - start.x), dy = Math.round(e.screenY - start.y);
    grip.textContent = Math.abs(dx) + Math.abs(dy) > 4 ? `⠿ Let go to move it here (${dx >= 0 ? "→" : "←"} ${Math.abs(dx)}, ${dy >= 0 ? "↓" : "↑"} ${Math.abs(dy)})` : `⠿ ${title}`;
  });
  const end = async (e: PointerEvent, cancelled: boolean) => {
    if (!start) return;
    const s = start;
    start = null;
    bar.classList.remove("dragging");
    grip.textContent = `⠿ ${title}`;
    const delta = { x: e.screenX - s.x, y: e.screenY - s.y };
    if (cancelled || Math.abs(delta.x) + Math.abs(delta.y) <= 4) return;
    const opts = readJson<Omit<Popover, "url">>(OPTS(id));
    const view = await viewSize();
    const width = (await OBR.popover.getWidth(id)) ?? opts?.width ?? window.innerWidth;
    const height = (await OBR.popover.getHeight(id)) ?? opts?.height ?? window.innerHeight;
    const from = readJson<Pos>(AT(id)) ?? estimateCorner(s.frame, { screenX: window.screenX, screenY: window.screenY, outerWidth: window.outerWidth, outerHeight: window.outerHeight }, view);
    const pos = dropPos(from, delta, { width, height }, view);
    writeJson(SAVED(id), pos);
    writeJson(AT(id), pos);
    const next = { ...(opts ?? {}), id, width, height, anchorElementId: undefined, ...atCorner(pos) };
    writeJson(OPTS(id), next);
    await OBR.popover.open({ ...next, url: location.href });
  };
  grip.addEventListener("pointerup", (e) => void end(e, false));
  grip.addEventListener("pointercancel", (e) => void end(e, true));
  grip.addEventListener("dblclick", () => {
    writeJson(SAVED(id), null);
    grip.textContent = "⠿ Back to its usual place next time";
    setTimeout(() => { grip.textContent = `⠿ ${title}`; }, 1800);
  });

  let lastMin = 0;
  return {
    setCompact(el) {
      if (el) compact.replaceChildren(el); else compact.replaceChildren();
      // While shrunk, the window follows the strip's height.
      if (readJson<number>(MIN(id))) {
        const hgt = minHeight();
        if (hgt !== lastMin) { lastMin = hgt; void OBR.popover.setHeight(id, hgt).catch(() => {}); }
      }
    },
    minimize,
    minimized: () => !!readJson<number>(MIN(id)),
  };
}
