/** "Follow the active unit" option, per browser: the background page moves the view to whoever's turn starts. */
import { h, store } from "./dom";

export const followToggle = () => h("label", { className: "small", style: "margin-top:6px" },
  h("input", { type: "checkbox", checked: store.get("butler.followActive") === "1", onchange: (e: Event) => store.set("butler.followActive", (e.target as HTMLInputElement).checked ? "1" : "0") }),
  "Move my view to the unit whose turn starts");
