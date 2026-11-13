/**
 * "Light & vision" panel: the GM sets the scene's light (bright, dim, dark); everyone can turn on the auras the
 * background page draws (background/vision.ts) and read the legend of what each circle means. In a dim or dark scene
 * players get the darkness fog (background/darkness.ts); the GM can turn it off or preview it.
 */
import OBR from "@owlbear-rodeo/sdk";
import {
  AURA_CHANNEL, AURA_ON_KEY, AURA_SCOPE_KEY, lightingUpdate, readAuraScope, readDarknessFog, readSceneLight, RING_STYLE, SCENE_LIGHT_TEXT,
  type AuraScope, type RingKind, type SceneLight,
} from "../core/vision";
import { DARKNESS_PREVIEW_KEY } from "../core/darkness";
import { h, store, type Child } from "./dom";

let scene: SceneLight = "bright";
let fog = true;
let subscribed = false;

export const currentSceneLight = () => scene;

/** Call once after OBR.onReady (and again when a scene opens): keeps the scene's light level current. */
export async function initVisionPanel(onChange: () => void) {
  try { const m = await OBR.scene.getMetadata(); scene = readSceneLight(m); fog = readDarknessFog(m); } catch { scene = "bright"; }
  if (subscribed) return;
  subscribed = true;
  OBR.scene.onMetadataChange((m) => {
    const next = readSceneLight(m), nextFog = readDarknessFog(m);
    if (next !== scene || nextFog !== fog) { scene = next; fog = nextFog; onChange(); }
  });
}

function setPref(key: string, value: string, rerender: () => void) {
  store.set(key, value);
  // The background page redraws on this (the storage event alone isn't guaranteed across Owlbear's frames).
  void OBR.broadcast.sendMessage(AURA_CHANNEL, { key, value }, { destination: "LOCAL" }).catch(() => {});
  rerender();
}

const swatch = (k: RingKind) => {
  const st = RING_STYLE[k];
  return h("span", { className: "swatch", style: `border:2px ${st.dash ? "dashed" : "solid"} ${st.color};background:${st.fill ? `${st.color}55` : "transparent"}` });
};
const legendRow = (k: RingKind, text?: string) => h("li", {}, swatch(k), h("strong", {}, `${RING_STYLE[k].name}: `), text ?? RING_STYLE[k].meaning);

function legend(): Child {
  const outside = scene === "dark"
    ? "Outside every light: darkness, heavily obscured. A creature looking into it is effectively Blinded unless a sense below reaches."
    : "Outside bright light: dim light, lightly obscured (disadvantage on Wisdom (Perception) checks that rely on sight).";
  return h("ul", { className: "plain small legend" },
    h("li", {}, h("span", { className: "swatch", style: `background:${scene === "dark" ? "#000" : "#777"}` }), outside),
    legendRow("bright"),
    scene === "dark" ? legendRow("dim") : null,
    legendRow("darkvision", scene === "dark"
      ? "inside, this creature sees darkness as dim light (lightly obscured) and dim light as bright (clear)"
      : "inside, this creature sees the dim light as bright: clear"),
    legendRow("devilsSight"), legendRow("truesight"), legendRow("blindsight"), legendRow("tremorsense"),
    h("li", { className: "muted" }, "Ranges count from the edge of the creature's space. Walls and magical darkness aren't drawn: judge those at the table."));
}

/** The darkness fog: on for players unless the GM turns it off; the GM can preview it see-through. */
function fogControls(role: "GM" | "PLAYER", rerender: () => void): Child {
  const what = scene === "dark"
    ? "black where none of their units can see, a haze where it's only lightly obscured"
    : "a haze over everything their units don't see clearly";
  if (role !== "GM") {
    return fog ? h("div", { className: "small" }, `Darkness covers the map: you see only what your units can (their darkvision and other senses, and any light). Black is heavily obscured, the haze lightly obscured.`) : null;
  }
  return h("div", { className: "stack tight" },
    h("label", { className: "small" },
      h("input", { type: "checkbox", checked: fog, onchange: async (e: Event) => {
        const on = (e.target as HTMLInputElement).checked;
        await OBR.scene.setMetadata(lightingUpdate(await OBR.scene.getMetadata(), { fog: on })).catch((err) => console.error("[Butler] darkness fog failed", err));
      } }),
      `Darkness fog for players: ${what}. Each player sees through their own units' senses and every light.`),
    fog ? h("label", { className: "small" },
      h("input", { type: "checkbox", checked: store.get(DARKNESS_PREVIEW_KEY) === "1", onchange: (e: Event) => setPref(DARKNESS_PREVIEW_KEY, (e.target as HTMLInputElement).checked ? "1" : "0", rerender) }),
      "Preview it see-through (what the party sees; only in this browser)") : null);
}

/** The panel. `rerender` redraws the page it's on. */
export function visionPanel(role: "GM" | "PLAYER", rerender: () => void): Child {
  const on = store.get(AURA_ON_KEY) === "1";
  const scope = readAuraScope(store.get(AURA_SCOPE_KEY));
  if (role !== "GM" && scene === "bright") return null;
  const levelBtn = (l: SceneLight, label: string) => h("button", {
    className: scene === l ? "on" : "",
    onclick: async () => OBR.scene.setMetadata(lightingUpdate(await OBR.scene.getMetadata(), { level: l })).catch((e) => console.error("[Butler] scene light failed", e)),
  }, label);
  const scopes: [AuraScope, string][] = role === "GM"
    ? [["selected", "Selected tokens"], ["party", "Party"], ["all", "All units"]]
    : [["selected", "My selected token"], ["party", "Party & my units"]];
  return h("details", { className: "panel", open: scene !== "bright" },
    h("summary", {}, `Light & vision${scene === "bright" ? "" : scene === "dim" ? " · dim light" : " · darkness"}`),
    role === "GM" ? h("div", { className: "seg", style: "margin-top:6px" }, levelBtn("bright", "☀ Bright"), levelBtn("dim", "◐ Dim"), levelBtn("dark", "● Dark")) : null,
    h("div", { className: "small muted", style: "margin-top:4px" }, SCENE_LIGHT_TEXT[scene]),
    scene === "bright"
      ? h("div", { className: "small muted" }, "Set the scene to dim or dark for darkness fog and light & vision auras.")
      : h("div", { className: "stack tight", style: "margin-top:6px" },
        fogControls(role, rerender),
        h("label", { className: "small" },
          h("input", { type: "checkbox", checked: on, onchange: (e: Event) => setPref(AURA_ON_KEY, (e.target as HTMLInputElement).checked ? "1" : "0", rerender) }),
          "Show light & vision auras on the map (only in this browser)"),
        on ? h("label", { className: "small row" }, "Senses for",
          h("select", { onchange: (e: Event) => setPref(AURA_SCOPE_KEY, (e.target as HTMLSelectElement).value, rerender) },
            ...scopes.map(([v, label]) => h("option", { value: v, selected: v === scope || (role !== "GM" && scope === "all" && v === "party") }, label)))) : null,
        on ? h("div", { className: "small muted" }, "Lights carried by any unit you can see are always drawn. Light a torch from a unit's card.") : null,
        legend()));
}
