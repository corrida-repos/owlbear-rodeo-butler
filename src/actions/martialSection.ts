import type { Item } from "@owlbear-rodeo/sdk";
import { isAttackOption, type ActionItem } from "../core/actions";
import { unitName } from "../core/card";
import { readEncounter } from "../core/encounter";
import { canAdvance, HOLDS, PARTS, readMartial, readMartialQueue, type MartialMove, type Part } from "../core/martial";
import { reachOf } from "../core/reach";
import type { RollMode } from "../core/schema";
import { readUnit } from "../core/unit";
import { h, type Child } from "../extension/dom";
import { sendRequest } from "../extension/requests";

type Op = MartialMove["op"];
const LABELS: Record<Op, string> = {
  shot: "Called Shot", grapple: "Grapple", advance: "Advance Grapple", escape: "Escape Grapple",
  downgrade: "Return to Basic Grapple", release: "Release Grapple", bind: "Bind with Rope", untie: "Remove Rope Binding", rescue: "Break Ally Free", "shoot-ropes": "Shoot the Ropes",
};
const choices = <T extends string>(values: T[], current: T, change: (value: T) => void, label: (value: T) => string, name: string) =>
  h("select", { "aria-label": name, onchange: (e: Event) => change((e.target as HTMLSelectElement).value as T) },
    ...values.map((v) => h("option", { value: v, selected: current === v }, label(v))));

let op: Op = "shot";
let targetId = "";
let allyId = "";
let attack = "";
let part: Part = "leg";
let hold: keyof typeof HOLDS = "choke";
let detail = "";
let mode: RollMode = "normal";
let sending = false;

export function martialSection(ctx: {
  actor: Item; items: Item[]; meta: Record<string, unknown>; actions: ActionItem[];
  role: "GM" | "PLAYER"; render: () => void; note: (message: string) => void;
}): Child {
  const { actor, role, meta, render, note } = ctx;
  const encounter = readEncounter(meta);
  const onTurn = encounter.started && encounter.turnId === actor.id;
  const units = ctx.items.flatMap((item) => {
    if (item.layer !== "CHARACTER" || role === "PLAYER" && !item.visible && item.id !== actor.id) return [];
    const u = readUnit(item.metadata);
    return u ? [{ id: item.id, name: role === "PLAYER" && u.state.alias || unitName(item, u.sheet, u.state), eligible: u.state.inEncounter && u.state.initiative !== null && !u.state.conditions.some((c) => c.key === "dead"), data: readMartial(item.metadata) }] : [];
  });
  const outgoing = (id: string) => units.find((u) => u.id === id)?.data.grapples?.find((g) => g.actor === actor.id);
  const incoming = readMartial(actor.metadata).grapples ?? [];
  const attacks = ctx.actions.filter((a) => a.section === "actions" && isAttackOption(a) && !/\b(?:melee|ranged) spell attack\b/i.test(a.text));
  const targets = (operation: Op) => units.filter((u) => {
    if (operation === "untie" || operation === "shoot-ropes") return !!u.data.binding && u.id !== actor.id;
    if (u.id === actor.id) return false;
    const g = outgoing(u.id);
    if (operation === "grapple") return !g && u.eligible;
    if (operation === "advance") return !!g && canAdvance(g, encounter.round) && !u.data.binding && !u.data.grapples?.some((other) => other.id !== g.id && other.hold);
    if (operation === "bind") return !!g && (g.hold === "body" || g.hold === "arms") && (g.holdRound ?? encounter.round) < encounter.round && !u.data.binding;
    if (operation === "release" || operation === "downgrade") return !!g && (operation === "release" || !!g.hold);
    if (operation === "escape") return incoming.some((x) => x.actor === u.id);
    if (operation === "rescue") return units.some((ally) => ally.id !== actor.id && ally.data.grapples?.some((x) => x.actor === u.id));
    return true;
  });
  const possible: Op[] = onTurn ? ["shot", "grapple", "advance", "bind", "escape", "rescue", "untie", "shoot-ropes", "downgrade", "release"]
    : encounter.started ? ["release"] : ["untie", "shoot-ropes", "release"];
  const rangedAttacks = attacks.filter((a) => reachOf(a)?.bands.some((b) => b.kind === "range" || b.kind === "long"));
  const ops = possible.filter((o) => targets(o).length && (o !== "shot" || attacks.length) && (o !== "shoot-ropes" || rangedAttacks.length));
  if (!ops.includes(op)) op = ops[0] ?? "grapple";
  const candidates = targets(op);
  if (!candidates.some((u) => u.id === targetId)) targetId = candidates[0]?.id ?? "";
  const allies = op === "rescue" ? units.filter((u) => u.id !== actor.id && u.data.grapples?.some((g) => g.actor === targetId)) : [];
  if (!allies.some((u) => u.id === allyId)) allyId = allies[0]?.id ?? "";
  const availableAttacks = op === "shoot-ropes" ? rangedAttacks : attacks;
  if (!availableAttacks.some((a) => a.key === attack)) attack = availableAttacks[0]?.key ?? "";
  const pending = readMartialQueue(meta).some((x) => x.actor === actor.id);
  const needsDetail = op === "shot" && (part === "neck" || part === "arm" || part === "special") || op === "advance" && hold === "steal";
  const text = op === "shot" ? (part === "special" ? PARTS[part][1] : `Once on your turn, attack at AC + 2. ${PARTS[part][1]}`) : op === "advance" ? HOLDS[hold][1]
    : op === "bind" ? "Spend an action and use rope. On success, the binding holds after you release the target."
      : op === "rescue" ? "Spend an action. Make an Athletics check to break the hold on an ally within 5 feet. The grappler must also be within 5 feet."
        : op === "untie" ? "Spend an action within 5 feet of your bound ally."
          : op === "shoot-ropes" ? "Make one ranged weapon attack. A near hit or miss may also threaten your ally."
          : op === "grapple" ? "Replaces one attack. The GM confirms reach, size and a free hand."
            : op === "escape" ? "Spend an action. One success ends this grapple and its advanced hold." : "";
  return h("div", { className: "panel tight small stack tight" },
    h("strong", {}, "Martial house rules"),
    !ops.length ? h("div", { className: "muted" }, "Start your turn in initiative to declare a called shot or grapple.") : null,
    ops.length ? choices(ops, op, (v) => { op = v; detail = ""; render(); }, (v) => LABELS[v], "Martial option") : null,
    ops.length ? choices(candidates.map((u) => u.id), targetId, (v) => { targetId = v; render(); }, (id) => candidates.find((u) => u.id === id)?.name ?? id, "Target") : null,
    op === "rescue" ? choices(allies.map((u) => u.id), allyId, (v) => { allyId = v; render(); }, (id) => allies.find((u) => u.id === id)?.name ?? id, "Held ally") : null,
    op === "shot" || op === "shoot-ropes" ? h("div", { className: "row wrap" },
      choices(availableAttacks.map((a) => a.key), attack, (v) => { attack = v; render(); }, (v) => availableAttacks.find((a) => a.key === v)?.name ?? v, "Weapon attack"),
      op === "shot" ? choices(Object.keys(PARTS) as Part[], part, (v) => { part = v; detail = ""; render(); }, (v) => PARTS[v][0], "Target part") : null,
      choices<RollMode>(["normal", "advantage", "disadvantage"], mode, (v) => { mode = v; render(); }, (v) => ({ normal: "Normal", advantage: "Advantage", disadvantage: "Disadvantage" })[v], "Attack roll mode")) : null,
    op === "advance" ? choices(Object.keys(HOLDS) as (keyof typeof HOLDS)[], hold, (v) => { hold = v; detail = ""; render(); }, (v) => HOLDS[v][0], "Advanced hold") : null,
    op === "shot" || needsDetail ? h("input", {
      value: detail, maxLength: 80, placeholder: op === "advance" ? "Name the loose held item" : "Specify the part, e.g. left arm (optional)",
      oninput: (e: Event) => { detail = (e.target as HTMLInputElement).value; },
    }) : null,
    text && ops.length ? h("div", {}, text) : null,
    pending ? h("div", { className: "muted" }, "Waiting for the GM.") : null,
    ops.length ? h("button", { disabled: sending || pending || !targetId, onclick: async () => {
      const move: MartialMove = op === "shot" ? { op, attack, part, detail, mode } : op === "shoot-ropes" ? { op, attack, mode } : op === "advance" ? { op, hold, detail } : op === "rescue" ? { op, ally: allyId } : { op };
      if ((move.op === "shot" && move.part === "special" || move.op === "advance" && move.hold === "steal") && !detail.trim()) {
        note("Specify the part or item first.");
        render();
        return;
      }
      sending = true;
      render();
      try {
        await sendRequest({ type: "martial", unitId: actor.id, targetId, move, round: encounter.round }, role);
        note("Declaration sent to the GM.");
      } catch (e) {
        note(e instanceof Error ? e.message : String(e));
      } finally {
        sending = false;
        render();
      }
    } }, `Declare ${LABELS[op]}`) : null);
}
