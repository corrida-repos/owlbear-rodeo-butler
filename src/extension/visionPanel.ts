/**
 * "Light & vision" panel: the GM sets the scene's light (bright, dim, dark). In a dim or dark scene, anyone can turn on
 * their Vision HUD: the vision circles (background/vision.ts) and the darkness fog (background/darkness.ts), with a
 * legend. Nothing is drawn while it's off, except that the GM can force the fog on players in a scene.
 */
import OBR from "@owlbear-rodeo/sdk";
import {
  AURA_CHANNEL, AURA_SCOPE_KEY, HUD_KEY, hudOn, lightingUpdate, readAuraScope, readForcedFog, readSceneLight, RING_STYLE, SCENE_LIGHT_TEXT,
  type AuraScope, type RingKind, type SceneLight,
} from "../core/vision";
import { h, store, type Child } from "./dom";

let scene: SceneLight = "bright";
let forced = false;
let subscribed = false;

export const currentSceneLight = () => scene;

/** Call once after OBR.onReady (and again when a scene opens): keeps the scene's light level current. */
export async function initVisionPanel(onChange: () => void) {
  try { const m = await OBR.scene.getMetadata(); scene = readSceneLight(m); forced = readForcedFog(m); } catch { scene = "bright"; }
  if (subscribed) return;
  subscribed = true;
  OBR.scene.onMetadataChange((m) => {
    const next = readSceneLight(m), nextForced = readForcedFog(m);
    if (next !== scene || nextForced !== forced) { scene = next; forced = nextForced; onChange(); }
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

/** GM only: force the darkness fog on players in this scene, even if they haven't turned their Vision HUD on. */
function forceFogControl(): Child {
  return h("label", { className: "small" },
    h("input", { type: "checkbox", checked: forced, onchange: async (e: Event) => {
      const on = (e.target as HTMLInputElement).checked;
      await OBR.scene.setMetadata(lightingUpdate(await OBR.scene.getMetadata(), { forceFog: on })).catch((err) => console.error("[Butler] darkness fog failed", err));
    } }),
    "Force the darkness fog on players in this scene (even with their Vision HUD off), so creatures in the dark stay hidden");
}

/** The panel. `rerender` redraws the page it's on. */
export function visionPanel(role: "GM" | "PLAYER", rerender: () => void): Child {
  const on = hudOn(store.get(HUD_KEY));
  const scope = readAuraScope(store.get(AURA_SCOPE_KEY));
  if (role !== "GM" && scene === "bright") return null;
  const levelBtn = (l: SceneLight, label: string) => h("button", {
    className: scene === l ? "on" : "",
    onclick: async () => OBR.scene.setMetadata(lightingUpdate(await OBR.scene.getMetadata(), { level: l })).catch((e) => console.error("[Butler] scene light failed", e)),
  }, label);
  const scopes: [AuraScope, string][] = role === "GM"
    ? [["selected", "Selected tokens"], ["party", "Party"], ["all", "All units"]]
    : [["selected", "My selected token"], ["party", "Party & my units"]];
  const fogText = role === "GM"
    ? "Darkness fog, see-through: what the party sees (black = heavily obscured, haze = lightly obscured)."
    : "Darkness fog: you see only what your units can (their senses and any light). Black = heavily obscured, haze = lightly obscured.";
  return h("details", { className: "panel", open: scene !== "bright" },
    h("summary", {}, `Light & vision${scene === "bright" ? "" : scene === "dim" ? " · dim light" : " · darkness"}${on && scene !== "bright" ? " · HUD on" : ""}`),
    role === "GM" ? h("div", { className: "seg", style: "margin-top:6px" }, levelBtn("bright", "☀ Bright"), levelBtn("dim", "◐ Dim"), levelBtn("dark", "● Dark")) : null,
    h("div", { className: "small muted", style: "margin-top:4px" }, SCENE_LIGHT_TEXT[scene]),
    scene === "bright"
      ? h("div", { className: "small muted" }, "Set the scene to dim or dark to use the Vision HUD.")
      : h("div", { className: "stack tight", style: "margin-top:6px" },
        h("button", {
          className: on ? "" : "secondary",
          title: "Vision circles and darkness fog on the map, only in this browser",
          onclick: () => setPref(HUD_KEY, on ? "0" : "1", rerender),
        }, on ? "👁 Vision HUD: on (click to hide)" : "👁 Show Vision HUD"),
        !on ? h("div", { className: "small muted" }, role === "PLAYER" && forced
          ? "The GM keeps the darkness fog on in this scene. The HUD adds the vision circles."
          : "Off: nothing is drawn. Turn it on for the vision circles and the darkness fog.") : null,
        on ? h("div", { className: "small" }, fogText) : null,
        on ? h("label", { className: "small row" }, "Circles for",
          h("select", { onchange: (e: Event) => setPref(AURA_SCOPE_KEY, (e.target as HTMLSelectElement).value, rerender) },
            ...scopes.map(([v, label]) => h("option", { value: v, selected: v === scope || (role !== "GM" && scope === "all" && v === "party") }, label)))) : null,
        on ? h("div", { className: "small muted" }, "Lights carried by any unit you can see are always drawn. Light a torch from a unit's card.") : null,
        role === "GM" ? forceFogControl() : null,
        on ? legend() : null));
}
