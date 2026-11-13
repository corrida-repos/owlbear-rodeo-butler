/** Shared rules options only: sheet entries and room homebrew keep their existing glyphs. */
import type { ActionItem } from "../core/actions";

// Original 24px line icons. Related names in the two rules editions share artwork.
const MAGIC = "M12 3 10 9 4 11 10 13 12 19 14 13 20 11 14 9Z M19 2v4 M17 4h4 M4 17v4 M2 19h4";
const UTILIZE = "M14 4a5 5 0 0 0-6 6L3 15a3 3 0 0 0 4 4l5-5a5 5 0 0 0 6-6l-3 3-3-3 3-3Z";
const POTION = "M9 3h6 M10 3v5l-5 8a4 4 0 0 0 3 5h8a4 4 0 0 0 3-5l-5-8V3 M8 13h8 M10 17h4 M12 15v4";

const MOUNT = "M3 13h12l3-7h3v9l-3 2-1 5 M5 13v9 M13 13v9 M8 13l-1-5 M8 3a1.5 1.5 0 1 0 3 0 1.5 1.5 0 1 0-3 0 M9 6l3 3h4 M9 6v7h3v4";

const PATHS: Readonly<Record<string, string>> = {
  Attack: "M10 14 18 4 21 3 20 6 12 16Z M8 12l6 6 M10 16l-5 5 M3 19l2 2",
  "Cast a Spell": MAGIC,
  Dash: "M14 4a1.5 1.5 0 1 0 3 0 1.5 1.5 0 1 0-3 0 M4 7h5 M2 11h4 M3 15h4 M8 10l4-3 3 5 5 1 M12 7l-1 7-5 6 M11 14l5 2 1 5",
  Disengage: "M12 4H5v16h7 M9 12h12 M17 8l4 4-4 4 M8 7v2",
  Dodge: "M11 3 4 6v6c0 4 7 9 7 9s7-5 7-9V6Z M1 11h6 M4 8l3 3-3 3 M14 8l-4 6h4l-3 4",
  Help: "M3 14l4-4 4 1 3-2 6 5 M3 14l5 6 3-2 M20 14l-7 6-5-5 M7 10V5h4 M20 14l2-3-4-5-4 3 M9 3h4 M11 1v4",
  Hide: "M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12Z M9 9a4 4 0 0 0 6 6 M3 3l18 18",
  Influence: "M4 4h16v11h-8l-5 5v-5H4Z M8 8h8 M8 11h5",
  Magic: MAGIC,
  Ready: "M4 12a8 8 0 1 1 3 6 M4 5v7h7 M12 7v5l3 2 M3 20l2 2 4-4",
  Search: "M16 10a6 6 0 1 1-12 0 6 6 0 1 1 12 0 M14.5 14.5 21 21 M7 10h6 M10 7v6",
  Study: "M12 6C8 3 4 4 2 5v14c3-2 7-1 10 1 3-2 7-3 10-1V5c-3-1-7-2-10 1Z M12 6v14 M5 8l4 1 M5 12l4 1 M15 9l4-1 M15 13l4-1",
  Utilize: UTILIZE,
  "Use an Object": UTILIZE,
  "Escape a Grapple": "M7 6 4 9a4 4 0 0 0 6 6l2-2 M17 18l3-3a4 4 0 0 0-6-6l-2 2 M8 12l3-3 M13 15l3-3 M8 2v3 M4 3l2 3 M16 19v3 M18 18l3 3",
  Stabilize: "M8 3h8v5h5v8h-5v5H8v-5H3V8h5Z M7 12h3l1-2 2 4 1-2h3",
  "Unarmed Strike": "M6 12V8a1.5 1.5 0 0 1 3 0v3-6a1.5 1.5 0 0 1 3 0v6-5a1.5 1.5 0 0 1 3 0v5-3a1.5 1.5 0 0 1 3 0v6l-3 4v3H8v-3l-4-5a1.5 1.5 0 0 1 2-2l3 2",
  Grapple: "M5 5h4l3 4-2 3-4-1-3 3 M19 19h-4l-3-4 2-3 4 1 3-3 M9 11l4 4 M11 9l4 4 M3 2l4 3 M21 22l-4-3",
  Shove: "M3 9h5l3 3-3 3H3 M13 4a1.5 1.5 0 1 0 3 0 1.5 1.5 0 1 0-3 0 M14 7l2 6 4 3 M16 13l-3 7 M15 10l5-2 M3 12h8",
  "Two-Weapon Fighting": "M3 3l7 4-3 3Z M7 10l4 4 M5 12l6-6 M21 3l-7 4 3 3Z M17 10l-4 4 M13 6l6 6 M10 16l-5 5 M14 16l5 5",
  "Opportunity Attack": "M4 3l9 9-3 3-7-9Z M9 12l6 6 M8 17l5-5 M17 20l-3-3 M15 4h6v6 M21 4l-7 7",
  "Equip or Unequip a Weapon": "M11 3l3 2-4 9-3-1Z M5 14l7 3 M8 16l-2 5 M16 5h5l-2-2 M21 5l-2 2 M21 18h-6l2-2 M15 18l2 2",
  "Improvised Weapon": "M4 3h5v5l8 8a3 3 0 0 1-4 4L5 12H3V8h1Z M4 6h5 M13 16l3-3 M17 7l3 3 M20 4v2",
  Move: "M7 2C5 2 4 4 4 6s1 4 3 4 3-2 3-4-1-4-3-4Z M5 13h4v3a2 2 0 0 1-4 0Z M17 6c-2 0-3 2-3 4s1 4 3 4 3-2 3-4-1-4-3-4Z M15 17h4v3a2 2 0 0 1-4 0Z",
  "Drop Prone": "M3 17a2 2 0 1 0 4 0 2 2 0 1 0-4 0 M9 17h7l4-3 M11 17l-2 3 M16 17l5 3 M3 22h18 M13 2v9 M10 8l3 3 3-3",
  "Stand Up": "M7 2a1.5 1.5 0 1 0 3 0 1.5 1.5 0 1 0-3 0 M8 6v7l-3 8 M8 13h5l2 8 M8 8l5 3 M19 14V4 M16 7l3-3 3 3",
  Jump: "M10 3a1.5 1.5 0 1 0 3 0 1.5 1.5 0 1 0-3 0 M11 6l-2 6 5 3 4-1 M9 12l-4 3-2-2 M10 8l6 1 3-3 M5 8 8 6 M2 21h6 M16 21h6 M4 19c2-3 5-3 7-2 M14 17l2 2 1-3",
  Climb: "M15 3a1.5 1.5 0 1 0 3 0 1.5 1.5 0 1 0-3 0 M15 6l-3 6 4 3v6 M12 12l-4 4-2 5 M14 8l5 1V6 M13 8 9 6V3 M21 2v20 M19 11h2 M19 18h2",
  Swim: "M15 7a2 2 0 1 0 4 0 2 2 0 1 0-4 0 M5 12l6-5-4-4H3 M11 7l4 6 M2 16q2-3 5 0t5 0 5 0 5 0 M2 21q2-3 5 0t5 0 5 0 5 0",
  Mount: MOUNT,
  Dismount: MOUNT,
  "Interact with an Object": "M4 21v-6l4-3V7a1.5 1.5 0 0 1 3 0v6l4-1 3 3-2 6Z M15 4h6v6h-6Z M13 7h2 M18 10v2",
  "Drink or Administer a Potion": POTION,
  "Drink a Potion": POTION,
  Speak: "M4 4h16v12h-8l-5 5v-5H4Z M7 9h1 M11 9h1 M15 9h1",
  Disarm: "M12 3l3 2-3 7-3-1Z M7 12l7 3 M10 14l-1 4 M3 7l3 3 M3 13h3 M18 11l3 2 M17 15h4 M4 20l4-1 3 2 4-2",
  Mark: "M20 10a8 8 0 1 1-6-6 M16 11a4 4 0 1 1-4-3 M12 12l9-9 M17 3h4v4",
  Overrun: "M9 3a1.5 1.5 0 1 0 3 0 1.5 1.5 0 1 0-3 0 M10 6l4 5h5 M10 6l-4 4-3-1 M10 8l-1 7-5 6 M9 15l6 1 2 5 M17 3v5 M17 13v3 M17 18v3 M20 9l2 2-2 2",
  "Shove Aside": "M3 6h5l4 4v9 M9 16l3 3 3-3 M16 3a1.5 1.5 0 1 0 3 0 1.5 1.5 0 1 0-3 0 M17 6v7l4 6 M17 13l-3 8 M17 8l4 2",
  Tumble: "M11 3a9 9 0 0 1 9 9 M20 7v5h-5 M4 12a8 8 0 0 0 8 9 M4 17v-5h5 M10 10a2 2 0 1 0 4 0 2 2 0 1 0-4 0 M9 14l4 3 3-4-3-1 M9 14l-1 3",
  "Climb onto a Bigger Creature": "M15 4a2 2 0 1 0 4 0 2 2 0 1 0-4 0 M14 8h6l2 7 M15 8v7l-2 7 M19 15l2 7 M5 8a1.5 1.5 0 1 0 3 0 1.5 1.5 0 1 0-3 0 M6 11l3 3 5-3 M9 14l-2 7 M9 14l3 4 M6 12l-3 5",
};

/** Decorative artwork: the adjacent action name remains the button's accessible label. */
export function commonActionIcon(it: Pick<ActionItem, "section" | "name">): SVGSVGElement | null {
  if (it.section !== "common" || !Object.hasOwn(PATHS, it.name)) return null;
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  for (const [key, value] of Object.entries({
    viewBox: "0 0 24 24", width: "24", height: "24", fill: "none", stroke: "currentColor",
    "stroke-width": "1.6", "stroke-linecap": "round", "stroke-linejoin": "round",
    "aria-hidden": "true", focusable: "false",
  })) svg.setAttribute(key, value);
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", PATHS[it.name]!);
  svg.append(path);
  return svg;
}
