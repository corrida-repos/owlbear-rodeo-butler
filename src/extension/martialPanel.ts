import { HOLDS, PARTS, readMartial, readMartialQueue, type MartialEntry, type Grapple } from "../core/martial";
import { ABILITIES, ABILITY_NAMES } from "../core/sheet";
import type { TrackerUnit } from "../core/tracker";
import { action, h, type Child } from "./dom";
import { sendRequest } from "./requests";
import { roomSettings, roomSystem } from "./roomSettings";

function review(entry: MartialEntry, units: TrackerUnit[], grapples: { held: string; grapple: Grapple }[]): Child {
  const { move } = entry;
  const name = (id: string) => units.find((u) => u.id === id)?.name ?? "Missing token";
  const titles = {
    grapple: "Grapple", escape: "Escape Grapple", release: "Release Grapple", downgrade: "Return to Basic Grapple",
    bind: "Bind with Rope", untie: "Remove Rope Binding", rescue: "Break Ally Free", "shoot-ropes": "Shoot the Ropes",
  };
  const label = move.op === "shot" ? `Called Shot · ${move.detail || PARTS[move.part][0]}`
    : move.op === "advance" ? `${HOLDS[move.hold][0]}${move.detail ? ` · ${move.detail}` : ""}` : titles[move.op];
  const instruction = move.op === "shot" ? "Confirm visibility, the named part, and the attack's ability. Adjust for cover if needed."
    : move.op === "bind" ? "Confirm the grappler has rope available and can use it on this target."
      : move.op === "advance" && move.hold === "steal" ? "Confirm the item is held and unsecured. Update inventory at the table if the steal succeeds."
        : move.op === "advance" ? "Confirm the target's anatomy allows this hold."
          : move.op === "grapple" ? "Confirm the grappler has a free hand." : "";
  const useSave = roomSystem().rules === "2024" && ["grapple", "advance", "bind"].includes(move.op);
  const chooseDefense = useSave || move.op === "escape" || roomSystem().rules === "2014" && ["grapple", "advance", "bind"].includes(move.op);
  const defense = h("select", { "aria-label": "Defender's roll" },
    h("option", { value: "str" }, useSave ? "Strength save" : "Athletics"),
    h("option", { value: "dex" }, useSave ? "Dexterity save" : "Acrobatics")) as HTMLSelectElement;
  const ability = h("select", { "aria-label": "Ability used for the attack" },
    ...ABILITIES.map((a) => h("option", { value: a }, ABILITY_NAMES[a]))) as HTMLSelectElement;
  const actor = units.find((u) => u.id === entry.actor);
  if (actor && actor.sheet.abilities.dex > actor.sheet.abilities.str) ability.value = "dex";
  const modifier = h("input", { type: "number", min: -20, max: 20, step: 1, value: "0", style: "width:4em" }) as HTMLInputElement;
  const partAc = h("input", { type: "number", min: 0, max: 40, step: 1, placeholder: "AC" }) as HTMLInputElement;
  const partHp = h("input", { type: "number", min: 0, max: 9999, step: 1, placeholder: "HP" }) as HTMLInputElement;
  const partImmune = h("input", { type: "text", maxLength: 150, placeholder: "Damage types", }) as HTMLInputElement;
  if (move.op === "shot" && move.part === "special" && /\broper\b/i.test(name(entry.target)) && /tendril|tentacle/i.test(move.detail)) {
    partAc.value = "20";
    partHp.value = "10";
    partImmune.value = "poison, psychic";
  }
  const permanent = h("input", { type: "checkbox" }) as HTMLInputElement;
  const limbs = move.op === "shot" && (move.part === "arm" || move.part === "special") ? grapples.filter((x) => x.grapple.actor === entry.target) : [];
  const holdingLimb = h("select", { "aria-label": "Grapple using this limb" },
    h("option", { value: "" }, "None"),
    ...limbs.map(({ held }) => h("option", { value: held }, name(held)))) as HTMLSelectElement;
  const cannotMaintain = h("input", { type: "checkbox" }) as HTMLInputElement;
  const breathless = h("input", { type: "checkbox" }) as HTMLInputElement;
  return h("div", { className: "dm-item stack tight" },
    h("strong", {}, `${name(entry.actor)} → ${name(entry.target)} · ${label}${move.op === "rescue" ? ` holding ${name(move.ally)}` : ""}`),
    instruction ? h("div", { className: "small muted" }, instruction) : null,
    chooseDefense ? h("label", { className: "row small" }, "Defender’s choice", defense) : null,
    move.op === "shot" && move.part !== "special" ? h("div", { className: "stack tight" },
      h("label", { className: "row small" }, "Attack ability", ability),
      h("label", { className: "row small" }, "AC adjustment", modifier),
      h("label", { className: "row small" }, permanent, "Allow permanent injury on a critical hit and failed save")) : null,
    limbs.length ? h("div", { className: "stack tight" },
      h("label", { className: "row small" }, "Holding this creature with the targeted limb", holdingLimb),
      move.op === "shot" && move.part === "arm" ? h("label", { className: "row small" }, cannotMaintain, "Losing this limb would break its hold") : null) : null,
    move.op === "shoot-ropes" ? h("label", { className: "row small" }, "Cover AC adjustment", modifier) : null,
    move.op === "shot" && move.part === "special" ? h("div", { className: "stack tight" },
      h("label", { className: "row small" }, "Part AC", partAc),
      h("label", { className: "row small" }, "Part max HP", partHp),
      h("label", { className: "row small" }, "Part immunities", partImmune)) : null,
    move.op === "advance" && move.hold === "choke" ? h("label", { className: "row small" }, breathless, "Target doesn’t need to breathe") : null,
    h("div", { className: "row" },
      h("button", { onclick: action(async () => {
        await sendRequest({ type: "martial-review", unitId: entry.actor, entryId: entry.id, options: {
          defense: defense.value as "str" | "dex", ability: ability.value as typeof ABILITIES[number],
          acAdjustment: Number(modifier.value), permanent: permanent.checked, breathless: breathless.checked,
          partAc: Number(partAc.value), partHp: Number(partHp.value), partImmune: partImmune.value, holdingLimb: holdingLimb.value || undefined, cannotMaintain: cannotMaintain.checked,
        } }, "GM");
      }) }, "Approve and resolve"),
      h("button", { className: "secondary", onclick: action(() => sendRequest({
        type: "martial-review", unitId: entry.actor, entryId: entry.id,
      }, "GM")) }, "Dismiss")));
}

function displacementControl(held: TrackerUnit, grappler: TrackerUnit): Child {
  const number = (value: number, label: string) => h("input", { type: "number", value: String(value), "aria-label": label, style: "width:4em" }) as HTMLInputElement;
  const ax = number(0, "Grappler east or west"), ay = number(0, "Grappler south or north");
  const bx = number(0, "Held creature east or west"), by = number(0, "Held creature south or north");
  const dc = number(10, "Strength save DC");
  const canFollow = h("input", { type: "checkbox", checked: true }) as HTMLInputElement;
  return h("details", { className: "stack tight" }, h("summary", {}, `Forced movement · ${grappler.name} holding ${held.name}`),
    h("div", { className: "small muted" }, "Resolve this before moving the tokens. Enter feet east (+) or west (−), then south (+) or north (−)."),
    h("label", { className: "row small" }, grappler.name, ax, ay),
    h("label", { className: "row small" }, held.name, bx, by),
    h("label", { className: "row small" }, "Attack or effect DC", dc),
    h("div", { className: "small muted" }, "For an attack with no listed DC, use 8 + proficiency + the attack’s ability modifier."),
    h("label", { className: "row small" }, canFollow, "Both can move together on a successful save"),
    h("button", { onclick: action(() => sendRequest({
      type: "martial-displace", unitId: grappler.id, heldId: held.id, dc: Number(dc.value), canFollow: canFollow.checked,
      grapplerMove: { x: Number(ax.value), y: Number(ay.value) }, heldMove: { x: Number(bx.value), y: Number(by.value) },
    }, "GM")) }, "Resolve forced movement"));
}

export function martialPanel(meta: Record<string, unknown>, units: TrackerUnit[], items: { id: string; metadata: Record<string, unknown> }[]): Child {
  if (!roomSettings().martialOptions) return null;
  const entries = readMartialQueue(meta);
  const grapples = items.flatMap((i) => (readMartial(i.metadata).grapples ?? []).map((grapple) => ({ held: i.id, grapple })));
  const injuries = items.flatMap((item) => {
    const unit = units.find((u) => u.id === item.id);
    const list = readMartial(item.metadata).injuries;
    return unit && list?.length ? [{ unit, list }] : [];
  });
  const damagedParts = items.flatMap((item) => {
    const unit = units.find((u) => u.id === item.id);
    return unit ? Object.entries(readMartial(item.metadata).parts ?? {}).map(([name, hp]) => ({ unit, name, hp })) : [];
  });
  if (!entries.length && !injuries.length && !damagedParts.length && !grapples.length) return null;
  return h("section", { className: "panel small stack" }, h("h2", {}, "Martial house rules"),
    ...entries.map((entry) => review(entry, units, grapples)),
    ...grapples.map(({ held, grapple }) => {
      const target = units.find((u) => u.id === held), actor = units.find((u) => u.id === grapple.actor);
      return target && actor ? displacementControl(target, actor) : null;
    }),
    ...damagedParts.map(({ unit, name, hp }) => h("div", { className: "row between" }, `${unit.name} · ${name} · ${hp ? `${hp} HP` : "Destroyed"}`,
      h("button", { className: "secondary small", onclick: action(() => sendRequest({
        type: "martial-care", unitId: unit.id, care: "restore-part", injuryId: name,
      }, "GM")) }, "Restore Part"))),
    ...injuries.map(({ unit, list }) => h("div", { className: "stack tight" },
      h("div", { className: "row between" }, h("strong", {}, unit.name),
        list.some((i) => i.rests > 0) ? h("button", { className: "secondary small", onclick: action(() => sendRequest({
          type: "martial-care", unitId: unit.id, care: "rest",
        }, "GM")) }, "Record Long Rest") : null),
      ...list.map((i) => h("div", { className: "row between" },
        unit.state.conditions.find((c) => c.id === i.id)?.label ?? "Injury",
        i.rests ? `${i.rests} long rest${i.rests === 1 ? "" : "s"} left` : "Permanent",
        h("button", { className: "secondary small", onclick: action(() => sendRequest({
          type: "martial-care", unitId: unit.id, care: "restore", injuryId: i.id,
        }, "GM")) }, "Restore"))))));
}
