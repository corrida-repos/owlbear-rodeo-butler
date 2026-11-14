/**
 * The 0-HP pieces shared by the unit card and the 0 HP popover:
 *  - The prompt when a unit drops to 0 HP: Dead, Death saves, Stable or Alive.
 *  - The death save tracker: roll digitally (recorded automatically), or type a d20 rolled at the table, or tick
 *    successes and failures by hand. Clicking the dots corrects the counters.
 * The GM's client writes directly; a player's goes through the GM's client (requests.ts).
 */
import { chooseAtZero, recordDeathSave, setDeathSaves } from "../core/tracker";
import { ZERO_HP_CHOICES, ZERO_HP_HINT, ZERO_HP_LABEL, type DeathSaveOutcome, type ZeroHpChoice } from "../core/hp";
import type { Role, RollMessage } from "../core/rolls";
import type { UnitState } from "../core/sheet";
import { h, type Child } from "./dom";
import { obrGateway } from "./obrGateway";
import { sendRequest } from "./requests";

const OUTCOME_TEXT: Partial<Record<DeathSaveOutcome | "set", string>> = {
  "stable": "Three successes: Stable.",
  "dead": "Three failures: mark as dead?",
  "regain-1-hp": "Natural 20: back up with 1 HP!",
  "two-failures": "Natural 1: two failures.",
};

export async function answerZeroHp(role: Role, unitId: string, choice: ZeroHpChoice) {
  if (role === "GM") await chooseAtZero(obrGateway, unitId, choice);
  else await sendRequest({ type: "zero-hp-choice", unitId, choice });
}

/** A death save's natural d20 (rolled here or at the table): the rules apply (nat 1, nat 20). */
export async function logDeathSave(role: Role, unitId: string, natural: number): Promise<string> {
  if (role !== "GM") { await sendRequest({ type: "death-save", unitId, natural }); return ""; }
  return OUTCOME_TEXT[await recordDeathSave(obrGateway, unitId, natural)] ?? "";
}

export async function setSaves(role: Role, unitId: string, successes: number, failures: number): Promise<string> {
  if (role !== "GM") { await sendRequest({ type: "death-save-set", unitId, successes, failures }); return ""; }
  return OUTCOME_TEXT[await setDeathSaves(obrGateway, unitId, successes, failures)] ?? "";
}

export interface ZeroHpUi {
  unitId: string;
  role: Role;
  /** Feedback (outcome text, or an error) for the page to show. */
  report: (text: string, isError?: boolean) => void;
}

const run = (ui: ZeroHpUi, fn: () => Promise<string | void>) => () => void fn()
  .then((t) => { if (t) ui.report(t); })
  .catch((e) => ui.report(e instanceof Error ? e.message : String(e), true));

/** "Dropped to 0 HP: what happens?" with the four answers. */
export function zeroHpChoicePanel(ui: ZeroHpUi, state: Pick<UnitState, "party">): HTMLElement {
  return h("div", { className: "panel deathsaves stack tight" },
    h("div", {}, h("strong", {}, "Dropped to 0 HP"), h("span", { className: "small muted" }, state.party ? " · on death saves until you choose" : " · what happens to it?")),
    h("div", { className: "zero-choices" }, ...ZERO_HP_CHOICES.map((c) =>
      h("button", { className: c === "dead" ? "danger-bg" : c === "dying" ? "" : "secondary", title: ZERO_HP_HINT[c], onclick: run(ui, () => answerZeroHp(ui.role, ui.unitId, c)) }, ZERO_HP_LABEL[c]))));
}

/**
 * Death save tracker. `roll` makes the digital roll (the page's own roller: advantage, visibility) and returns it;
 * its natural d20 is then recorded.
 */
export function deathSavePanel(ui: ZeroHpUi, state: Pick<UnitState, "deathSaves" | "party">, roll: (ev: MouseEvent) => Promise<RollMessage | null>): HTMLElement {
  const ds = state.deathSaves ?? { successes: 0, failures: 0 };
  const set = (s: number, f: number) => run(ui, () => setSaves(ui.role, ui.unitId, s, f));
  // Click a dot to set the count to it; click the last lit dot to take it back.
  const dots = (n: number, ch: string, kind: "s" | "f") => Array.from({ length: 3 }, (_, i) => {
    const to = n === i + 1 ? i : i + 1;
    return h("button", {
      className: `dot-btn ${i < n ? "on" : ""}`, title: `${kind === "s" ? "Successes" : "Failures"}: set to ${to}`,
      onclick: kind === "s" ? set(to, ds.failures) : set(ds.successes, to),
    }, ch);
  });
  const natural = h("input", { type: "text", inputmode: "numeric", className: "lvl", placeholder: "d20", title: "Rolled at the table? Type the d20 and press Enter: 10+ succeeds, 1 is two failures, 20 is back up with 1 HP" }) as HTMLInputElement;
  natural.onkeydown = (e: KeyboardEvent) => {
    if (e.key !== "Enter") return;
    const n = Number(natural.value.trim());
    if (!Number.isInteger(n) || n < 1 || n > 20) { ui.report("A death save is a d20: type 1 to 20.", true); return; }
    natural.value = "";
    natural.blur();
    run(ui, () => logDeathSave(ui.role, ui.unitId, n))();
  };
  const rollIt = (ev: MouseEvent) => run(ui, async () => {
    const msg = await roll(ev);
    if (!msg || msg.natural === undefined) return;
    return logDeathSave(ui.role, ui.unitId, msg.natural);
  })();
  return h("div", { className: "panel deathsaves stack tight" },
    h("div", { className: "row between" }, h("strong", {}, "Death saves"),
      h("span", { className: "ds-dots" },
        h("span", { className: "ok" }, ...dots(ds.successes, "✓", "s")), "  ",
        h("span", { className: "bad" }, ...dots(ds.failures, "✗", "f")))),
    h("div", { className: "row" },
      h("button", { onclick: rollIt, title: "Roll a d20 and record it: 10+ succeeds · natural 1: two failures · natural 20: back to 1 HP" }, "🎲 Roll death save"),
      h("span", { className: "small muted" }, "or rolled by hand:"), natural),
    h("div", { className: "row" },
      h("span", { className: "small muted" }, "Track by hand:"),
      h("button", { className: "secondary small", disabled: ds.successes >= 3, onclick: set(ds.successes + 1, ds.failures) }, "+1 ✓ success"),
      h("button", { className: "secondary small", disabled: ds.failures >= 3, onclick: set(ds.successes, ds.failures + 1) }, "+1 ✗ failure")),
    ds.failures >= 3
      ? h("div", { className: "row between" }, h("span", { className: "bad" }, "Three failures."),
        h("button", { className: "danger-bg", onclick: run(ui, () => answerZeroHp(ui.role, ui.unitId, "dead")) }, "💀 Mark as dead"))
      : h("div", { className: "row" },
        h("button", { className: "secondary small", title: ZERO_HP_HINT.stable, onclick: run(ui, () => answerZeroHp(ui.role, ui.unitId, "stable")) }, "🛌 Stable"),
        h("button", { className: "secondary small", title: ZERO_HP_HINT.dead, onclick: run(ui, () => answerZeroHp(ui.role, ui.unitId, "dead")) }, "💀 Dead")));
}

/** The card's / popover's 0-HP section: the prompt while pending, otherwise the tracker while making death saves. */
export function zeroHpSection(ui: ZeroHpUi, state: UnitState, dying: boolean, roll: (ev: MouseEvent) => Promise<RollMessage | null>): Child {
  if (state.zeroHpPending && state.hp <= 0) return zeroHpChoicePanel(ui, state);
  return dying ? deathSavePanel(ui, state, roll) : null;
}
