/** "Add condition" form shared by the unit card and the multi-unit popover: condition, level, custom name, note, duration. */
import type { Duration } from "../core/conditions";
import type { GameSystem } from "../core/systems";
import { h } from "./dom";

export interface ConditionChoice { key: string; label?: string; note?: string; level?: number; duration: Duration; with?: string }

export function conditionEditor(system: GameSystem, units: { id: string; name: string }[], onAdd: (c: ConditionChoice) => void): HTMLElement {
  const keys = system.conditions.filter((c) => !c.automatic && c.key !== "dead");
  const sel = h("select", {},
    ...keys.map((c) => h("option", { value: c.key }, c.label)),
    h("option", { value: "custom" }, "Custom effect…")) as HTMLSelectElement;
  const level = h("input", { type: "text", inputmode: "numeric", value: "1", className: "lvl", title: "Exhaustion level (1–6)" }) as HTMLInputElement;
  const label = h("input", { type: "text", placeholder: "Effect name (e.g. Hexed, Bless)" }) as HTMLInputElement;
  const note = h("input", { type: "text", placeholder: "Note (optional)" }) as HTMLInputElement;
  const dur = h("select", {},
    h("option", { value: "none" }, "No duration"),
    h("option", { value: "r1" }, "1 round"),
    h("option", { value: "r10" }, "1 minute (10 rounds)"),
    h("option", { value: "rN" }, "N rounds…"),
    ...units.flatMap((u) => [
      h("option", { value: `s:${u.id}` }, `Until the start of ${u.name}'s turn`),
      h("option", { value: `e:${u.id}` }, `Until the end of ${u.name}'s next turn`),
    ])) as HTMLSelectElement;
  // Grappling: who is grappled (required); Grappled: by whom (optional). The other unit gets the linked condition.
  const partner = h("select", {}, h("option", { value: "" }, "—"), ...units.map((u) => h("option", { value: u.id }, u.name))) as HTMLSelectElement;
  const partnerLabel = h("span", {}, "Grappled creature");
  const partnerRow = h("label", { className: "small row" }, partnerLabel, partner);
  const rounds = h("input", { type: "text", inputmode: "numeric", value: "2", className: "lvl", title: "Rounds" }) as HTMLInputElement;
  const levelRow = h("label", { className: "small row" }, "Level", level);
  const labelRow = h("div", {}, label);
  const roundsRow = h("label", { className: "small row" }, "Rounds", rounds);
  const sync = () => {
    levelRow.style.display = sel.value === "exhaustion" ? "" : "none";
    labelRow.style.display = sel.value === "custom" ? "" : "none";
    partnerRow.style.display = sel.value === "grappling" || sel.value === "grappled" ? "" : "none";
    partnerLabel.textContent = sel.value === "grappled" ? "Grappled by" : "Grappled creature";
    roundsRow.style.display = dur.value === "rN" ? "" : "none";
  };
  sel.onchange = sync;
  dur.onchange = sync;
  sync();
  const add = () => {
    const v = dur.value;
    const duration: Duration = v === "none" ? { kind: "none" }
      : v === "r1" ? { kind: "rounds", rounds: 1 } : v === "r10" ? { kind: "rounds", rounds: 10 }
        : v === "rN" ? { kind: "rounds", rounds: Math.max(1, Math.round(Number(rounds.value)) || 1) }
          : { kind: "turn", turnOf: v.slice(2), at: v.startsWith("s:") ? "start" : "end" };
    if (sel.value === "custom" && !label.value.trim()) { label.focus(); return; }
    if (sel.value === "grappling" && !partner.value) { partner.focus(); return; }
    const grapple = sel.value === "grappling" || sel.value === "grappled";
    onAdd({ key: sel.value, label: sel.value === "custom" ? label.value.trim() : undefined, note: note.value.trim() || undefined, level: sel.value === "exhaustion" ? Number(level.value) : undefined, duration,
      ...(grapple && partner.value ? { with: partner.value } : {}) });
    label.value = ""; note.value = "";
  };
  return h("div", { className: "stack tight condeditor" },
    h("div", { className: "row", style: "flex-wrap:nowrap" }, sel, h("button", { onclick: add }, "Add")),
    levelRow, labelRow, partnerRow, note, dur, roundsRow,
    h("div", { className: "small muted" }, "Durations count from the current turn and end on their own, with a notice."));
}
