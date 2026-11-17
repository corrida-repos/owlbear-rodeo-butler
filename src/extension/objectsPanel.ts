/**
 * DM Tools → Objects: walls, doors, cover and siege engines that take damage but have no token or initiative.
 * Stats come from the rules (see core/objects.ts); the list lives in scene metadata.
 */
import OBR from "@owlbear-rodeo/sdk";
import {
  COVER_BONUS, coverHit, DAMAGE_TYPES, hitObject, improvisedObject, isDestroyed, makeObjects, OBJECT_PRESETS, OBJECT_SIZES, OBJECTS_KEY,
  readObjects, SUBSTANCES, type CoverDegree, type DamageType, type ObjectSize, type SceneObject,
} from "../core/objects";
import { action, h, rerender, type Child } from "./dom";

const st = {
  mode: "preset" as "preset" | "custom", preset: OBJECT_PRESETS[0]!.key, substance: "stone", size: "M" as ObjectSize, resilient: true, name: "", threshold: 0, count: 1,
  coverId: "", attack: 15, targetAc: 15, cover: "half" as CoverDegree,
};
const amounts: Record<string, string> = {};
const types: Record<string, string> = {};
let log = "";

const save = (list: SceneObject[]) => OBR.scene.setMetadata({ [OBJECTS_KEY]: list.length ? list : undefined });
const newId = () => globalThis.crypto.randomUUID().slice(0, 8);

function addForm(list: SceneObject[]): Child {
  const groups = [...new Set(OBJECT_PRESETS.map((p) => p.group))];
  const preview = st.mode === "preset" ? OBJECT_PRESETS.find((p) => p.key === st.preset)!.stats : improvisedObject(st.substance, st.size, st.resilient, { name: st.name, threshold: st.threshold });
  const sections = st.mode === "custom" ? improvisedObject(st.substance, st.size, st.resilient).sections : 1;
  return h("div", { className: "stack tight", style: "margin-top:6px" },
    h("div", { className: "row" },
      h("label", { className: "small" }, h("input", { type: "radio", name: "objmode", checked: st.mode === "preset", onchange: () => { st.mode = "preset"; rerender(); } }), "From the books"),
      h("label", { className: "small" }, h("input", { type: "radio", name: "objmode", checked: st.mode === "custom", onchange: () => { st.mode = "custom"; rerender(); } }), "Any object (material and size)")),
    st.mode === "preset"
      ? h("select", { onchange: (e: Event) => { st.preset = (e.target as HTMLSelectElement).value; rerender(); } },
        ...groups.map((g) => h("optgroup", { label: g }, ...OBJECT_PRESETS.filter((p) => p.group === g).map((p) => h("option", { value: p.key, selected: p.key === st.preset }, p.label)))))
      : h("div", { className: "row wrap" },
        h("input", { type: "text", placeholder: "Name (e.g. Stone pillar)", value: st.name, onchange: (e: Event) => { st.name = (e.target as HTMLInputElement).value; rerender(); } }),
        h("select", { onchange: (e: Event) => { st.substance = (e.target as HTMLSelectElement).value; rerender(); } },
          ...SUBSTANCES.map((s) => h("option", { value: s.key, selected: s.key === st.substance }, `${s.label} (AC ${s.ac})`))),
        h("select", { onchange: (e: Event) => { st.size = (e.target as HTMLSelectElement).value as ObjectSize; rerender(); } },
          ...OBJECT_SIZES.map((s) => h("option", { value: s.key, selected: s.key === st.size }, s.label))),
        h("select", { onchange: (e: Event) => { st.resilient = (e.target as HTMLSelectElement).value === "1"; rerender(); } },
          h("option", { value: "1", selected: st.resilient }, "Resilient"), h("option", { value: "0", selected: !st.resilient }, "Fragile")),
        h("label", { className: "small", title: "Big objects like castle walls: a hit dealing less than this does nothing" }, "Threshold ",
          h("input", { type: "number", className: "num", min: 0, value: String(st.threshold || ""), onchange: (e: Event) => { st.threshold = Math.max(0, Number((e.target as HTMLInputElement).value) || 0); rerender(); } }))),
    h("div", { className: "row" },
      h("span", { className: "small" }, `AC ${preview.ac || "—"} · HP ${preview.immune.includes("all") ? "—" : preview.maxHp}${sections > 1 ? ` per section (${sections} sections)` : ""} · ${preview.basis}`),
      h("label", { className: "small" }, "× ", h("input", { type: "number", className: "num", min: 1, value: String(st.count), onchange: (e: Event) => { st.count = Math.max(1, Number((e.target as HTMLInputElement).value) || 1); } })),
      h("button", { className: "small", onclick: action(async () => {
        const stats = st.mode === "preset" ? OBJECT_PRESETS.find((p) => p.key === st.preset)!.stats : improvisedObject(st.substance, st.size, st.resilient, { name: st.name, threshold: st.threshold });
        await save([...list, ...makeObjects(stats, newId, st.count)]);
      }) }, "Add")));
}

function objectRow(o: SceneObject, list: SceneObject[]): Child {
  const apply = action(async () => {
    const raw = (amounts[o.id] ?? "").trim();
    // "12" or "-12" = damage; "+12" = repair.
    const n = Math.abs(Number(raw.replace(/^[+-]/, "")));
    if (!raw || !Number.isFinite(n)) return;
    const amount = raw.startsWith("+") ? -n : n;
    const type = (types[o.id] || undefined) as DamageType | undefined;
    const { object, hit } = hitObject(o, amount, type);
    amounts[o.id] = "";
    log = amount < 0 ? `${o.name} repaired to ${object.hp} HP.` : `${o.name} takes ${hit.applied}${type ? ` ${type}` : ""} damage${hit.why ? ` (${hit.why})` : ""}${isDestroyed(object) ? `: destroyed.` : `: ${object.hp}/${o.maxHp} HP.`}`;
    await save(list.map((x) => (x.id === o.id ? object : x)));
  });
  const defenses = [o.immune.length ? `Immune ${o.immune.includes("all") ? "to all damage" : o.immune.join(", ")}` : "", o.vulnerable.length ? `Vulnerable ${o.vulnerable.join(", ")}` : "", o.resist.length ? `Resist ${o.resist.join(", ")}` : "", o.threshold ? `threshold ${o.threshold}` : ""].filter(Boolean).join(" · ");
  return h("div", { className: "dm-item" },
    h("div", { className: "grow" },
      h("div", {}, h("strong", {}, o.name), isDestroyed(o) && !o.immune.includes("all") ? h("span", { className: "bad small" }, " destroyed") : null),
      h("div", { className: "small muted", title: o.basis }, `AC ${o.ac || "—"} · ${o.immune.includes("all") ? "can't be damaged" : `${o.hp}/${o.maxHp} HP`}${defenses ? ` · ${defenses}` : ""}`)),
    h("input", { type: "text", className: "num", placeholder: "12 / +5", title: "Damage (12) or repair (+5); Enter applies", value: amounts[o.id] ?? "",
      oninput: (e: Event) => { amounts[o.id] = (e.target as HTMLInputElement).value; }, onkeydown: (e: KeyboardEvent) => { if (e.key === "Enter") void apply(); } }),
    h("select", { title: "Damage type", onchange: (e: Event) => { types[o.id] = (e.target as HTMLSelectElement).value; } },
      h("option", { value: "" }, "type"), ...DAMAGE_TYPES.map((t) => h("option", { value: t, selected: types[o.id] === t }, t))),
    h("button", { className: "icon tiny", title: "Apply", onclick: apply }, "✓"),
    h("button", { className: "icon tiny", title: "Remove", onclick: action(() => save(list.filter((x) => x.id !== o.id))) }, "✕"));
}

function coverCheck(list: SceneObject[]): Child {
  const coverObj = list.find((o) => o.id === st.coverId);
  const r = coverHit(st.attack, st.targetAc, st.cover, coverObj?.ac);
  const n = (k: "attack" | "targetAc") => h("input", { type: "number", className: "num", value: String(st[k]), onchange: (e: Event) => { st[k] = Number((e.target as HTMLInputElement).value) || 0; rerender(); } });
  return h("details", { className: "small", style: "margin-top:6px" }, h("summary", {}, "Did the cover take the hit? (optional rule)"),
    h("div", { className: "row wrap", style: "margin-top:4px" },
      "Attack total ", n("attack"), " target AC ", n("targetAc"),
      h("select", { onchange: (e: Event) => { st.cover = (e.target as HTMLSelectElement).value as CoverDegree; rerender(); } },
        h("option", { value: "half", selected: st.cover === "half" }, `Half Cover (+${COVER_BONUS.half})`),
        h("option", { value: "three-quarters", selected: st.cover === "three-quarters" }, `Three-Quarters Cover (+${COVER_BONUS["three-quarters"]})`)),
      h("select", { onchange: (e: Event) => { st.coverId = (e.target as HTMLSelectElement).value; rerender(); } },
        h("option", { value: "" }, "cover object (optional)"), ...list.map((o) => h("option", { value: o.id, selected: o.id === st.coverId }, `${o.name} (AC ${o.ac})`)))),
    h("div", { style: "margin-top:4px" }, h("strong", {}, r === "target" ? "Hits the target." : r === "cover" ? `Misses the target only because of the cover: the cover is hit${coverObj ? ` (${coverObj.name}): roll damage and enter it on its row` : ""}.` : "Misses.")),
    h("div", { className: "muted" }, "2014 DMG optional rule: an attack that misses only because of the cover's AC bonus hits the cover instead (if the attack also meets the cover's AC)."));
}

export function objectsPanel(meta: Record<string, unknown>): Child {
  const list = readObjects(meta);
  return h("details", { className: "panel" }, h("summary", {}, h("strong", {}, `Objects${list.length ? ` (${list.length})` : ""}`)),
    h("div", { className: "small muted" }, "Walls, doors, cover and siege engines that can be damaged, with no token or initiative. AC and HP follow the rules: Object AC by material, Object HP by size (Huge and Gargantuan tracked as Large sections), Immunity to Poison and Psychic."),
    addForm(list),
    list.length ? h("div", { className: "dm-list" }, ...list.map((o) => objectRow(o, list))) : null,
    log ? h("div", { className: "small ok", style: "margin-top:4px" }, log) : null,
    coverCheck(list));
}
