/**
 * Dev-only log relay: in `npm run dev`, every extension page (popover, background, card) forwards its console
 * output and uncaught errors to the Vite server, which appends them to `.cache/devlog.txt`. Owlbear loads these
 * pages in cross-origin iframes, so this is the easy way to see what they log. Does nothing in production builds.
 */
import OBR from "@owlbear-rodeo/sdk";

let PAGE = location.pathname.split("/").pop() || "page";

function send(level: string, args: unknown[]) {
  const text = args.map((a) => {
    if (a instanceof Error) return `${a.message}\n${a.stack ?? ""}`;
    if (typeof a === "string") return a;
    try { return JSON.stringify(a); } catch { return String(a); }
  }).join(" ");
  void fetch("/owlbear-rodeo-butler/__devlog", {
    method: "POST",
    body: JSON.stringify({ page: PAGE, level, text }),
    keepalive: true,
  }).catch(() => {});
}

if (import.meta.env.DEV) {
  for (const level of ["log", "info", "warn", "error"] as const) {
    const orig = console[level].bind(console);
    console[level] = (...args: unknown[]) => { orig(...args); send(level, args); };
  }
  addEventListener("error", (e) => send("uncaught", [e.error ?? e.message]));
  addEventListener("unhandledrejection", (e) => send("unhandled", [e.reason]));
  // Tag lines with who this client is, so GM and player logs can be told apart.
  OBR.onReady(async () => {
    const [role, name] = await Promise.all([OBR.player.getRole(), OBR.player.getName()]);
    PAGE = `${PAGE} ${role}:${name}:${OBR.player.id.slice(0, 4)}`;
    send("info", ["ready"]);
  });
}

export {};
