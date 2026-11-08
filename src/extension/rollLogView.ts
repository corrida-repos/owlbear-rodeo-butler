/** Roll log panel for the popover (GM and players). */
import type { RollMessage } from "../core/rolls";
import { h, rerender, type Child } from "./dom";
import { onRollLog, readRollLog } from "./rollLog";

let log: RollMessage[] | null = null;
let open = false;

export function renderRollLog(): Child {
  if (!log) {
    log = readRollLog();
    onRollLog((l) => { log = l; rerender(); });
  }
  return h("details", { className: "panel", open, ontoggle: (e: Event) => { open = (e.target as HTMLDetailsElement).open; } },
    h("summary", {}, `Roll log (${log.length})`),
    log.length
      ? h("ul", { className: "plain small log", style: "margin-top:6px" }, ...log.map((m) =>
        h("li", {}, h("strong", {}, String(m.total)), ` ${m.unit?.name ?? m.by.name} · ${m.label}${m.crit ? " (crit)" : ""}`,
          m.natural === 20 ? " · nat 20" : m.natural === 1 ? " · nat 1" : "", m.visibility === "private" ? " · private" : "",
          h("span", { className: "muted" }, ` (${m.by.name}, ${new Date(m.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })})`))))
      : h("div", { className: "small muted" }, "No rolls yet this session. Rolls made from unit cards show here."));
}
