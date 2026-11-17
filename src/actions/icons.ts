/** Shared rules options only: sheet entries and room homebrew keep their existing glyphs. */
import type { ActionItem } from "../core/actions";
import { ICON_PATHS, type IconName } from "./iconPaths";

interface IconPart { icon: IconName; transform?: string }
type Icon = IconName | readonly IconPart[];

// Large, recognizable silhouettes stay legible in the small menu tiles. A small direction marker distinguishes
// a weapon swap, a dropped weapon, a reaction attack, and mounting versus dismounting.
const weaponWith = (icon: IconName): Icon => [
  { icon: "sword", transform: "translate(-8 0) scale(.78)" },
  { icon, transform: "translate(140 140) scale(.42)" },
];
const mountWith = (icon: IconName): Icon => [
  { icon: "horse", transform: "scale(.8)" },
  { icon, transform: "translate(156 132) scale(.38)" },
];

const ICONS: Readonly<Record<string, Icon>> = {
  Attack: "sword",
  "Cast a Spell": "magic-wand",
  Dash: "person-simple-run",
  Disengage: "sign-out",
  Dodge: "shield",
  Help: "hand-heart",
  Hide: "eye-slash",
  Influence: "megaphone",
  Magic: "magic-wand",
  Ready: "hourglass-simple",
  Search: "magnifying-glass",
  Study: "book-open-text",
  Utilize: "wrench",
  "Use an Object": "wrench",
  "Don or Doff a Shield": "shield-plus",
  "Escape a Grapple": "link-simple-break",
  Stabilize: "first-aid",
  "Unarmed Strike": "hand-fist",
  Grapple: "link-simple",
  Shove: "hand-palm",
  "Two-Weapon Fighting": [
    { icon: "sword", transform: "translate(-40 24) scale(.8) rotate(-45 128 128)" },
    { icon: "sword", transform: "translate(84 24) scale(.8) rotate(-45 128 128)" },
  ],
  "Opportunity Attack": weaponWith("arrow-u-up-right"),
  "Equip or Unequip a Weapon": weaponWith("arrows-left-right"),
  "Improvised Weapon": "hammer",
  Move: "footprints",
  "Drop Prone": "arrow-fat-line-down",
  "Stand Up": "arrow-fat-up",
  Jump: "arrow-arc-right",
  Climb: "ladder-simple",
  Swim: "person-simple-swim",
  Mount: mountWith("arrow-up"),
  Dismount: mountWith("arrow-down"),
  "Interact with an Object": "hand-tap",
  "Drink or Administer a Potion": "flask",
  "Drink a Potion": "flask",
  Speak: "chat-circle-dots",
  Disarm: weaponWith("arrow-down"),
  Mark: "target",
  Overrun: "arrow-fat-lines-right",
  "Shove Aside": "arrow-bend-down-right",
  Tumble: "arrows-clockwise",
  "Climb onto a Bigger Creature": "hand-grabbing",
};

/** Decorative artwork: the adjacent action name remains the button's accessible label. */
export function commonActionIcon(it: Pick<ActionItem, "section" | "name" | "under">): SVGSVGElement | null {
  if (it.section !== "common") return null;
  // Skill variants use their parent option's symbol (e.g. Search → Perception), rather than a generic hexagon.
  const name = Object.hasOwn(ICONS, it.name) ? it.name : it.under?.replace(/^common:/, "");
  if (!name || !Object.hasOwn(ICONS, name)) return null;
  const icon = ICONS[name]!;
  const parts: readonly IconPart[] = typeof icon === "string" ? [{ icon }] : icon;
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  for (const [key, value] of Object.entries({
    viewBox: "0 0 256 256", width: "28", height: "28", fill: "currentColor",
    "aria-hidden": "true", focusable: "false",
  })) svg.setAttribute(key, value);
  for (const part of parts) {
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", ICON_PATHS[part.icon]);
    if (part.transform) path.setAttribute("transform", part.transform);
    svg.append(path);
  }
  return svg;
}
