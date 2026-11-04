/** Tiny DOM + UI-state helpers shared by the tabs. Text is always set via textContent (never parsed as HTML). */

export type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, any> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "className") el.className = v;
    else if (k in el && typeof v !== "string") (el as any)[k] = v;
    else el.setAttribute(k, String(v));
  }
  for (const c of children) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(c));
  return el;
}

export const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
};

let rerenderFn: () => void = () => {};
export const setRerender = (fn: () => void) => { rerenderFn = fn; };
export const rerender = () => rerenderFn();

export const ui = { busy: false, error: "" };
export function setBusy(b: boolean) { ui.busy = b; rerender(); }
export function showError(e: unknown) { ui.error = e instanceof Error ? e.message : String(e); rerender(); }

/** Runs an async UI action with busy state and error display. */
export const action = (fn: () => Promise<void>) => async () => {
  try { ui.error = ""; setBusy(true); await fn(); } catch (e) { showError(e); } finally { setBusy(false); }
};

export function check(level: "ok" | "warn" | "bad", text: string, extra?: Child) {
  const icon = level === "ok" ? "✔" : level === "warn" ? "⚠" : "✖";
  return h("li", {}, h("span", { className: level }, icon), h("span", {}, text, extra ?? null));
}

/** Loads an image (no CORS needed) to learn its pixel size; rejects if it doesn't load. */
export function measure(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const t = setTimeout(() => reject(new Error("timed out after 20 s")), 20000);
    img.onload = () => { clearTimeout(t); resolve({ width: img.naturalWidth, height: img.naturalHeight }); };
    img.onerror = () => { clearTimeout(t); reject(new Error("image failed to load (404, blocked or not an image)")); };
    img.src = url;
  });
}

export const mimeFromUrl = (u: string) =>
  /\.png(\?|$)|output=png/i.test(u) ? "image/png" : /\.jpe?g(\?|$)/i.test(u) ? "image/jpeg" : /\.gif(\?|$)/i.test(u) ? "image/gif" : "image/webp";
