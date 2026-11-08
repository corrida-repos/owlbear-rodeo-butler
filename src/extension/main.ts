/** Encounter Butler popover: three tabs — Add Creatures, Add Party Members (incl. D&D Beyond sync), Combat. */
import "./devlog";
import OBR from "@owlbear-rodeo/sdk";
import { refreshCombat, renderCombatTab, resetCombatTab } from "./combatTab";
import { h, rerender, setRerender, store, ui, type Child } from "./dom";
import { renderPackageTab, resetPackageTab } from "./packageTab";
import { renderPartyTab, resetPartyTab } from "./partyTab";
import { createRoster } from "./roster";
import { initRoomSettings, onRoomSettings } from "./roomSettings";

type Tab = "creatures" | "party" | "combat";
const TABS: [Tab, string][] = [["creatures", "Add Creatures"], ["party", "Add Party Members"], ["combat", "Combat"]];
const savedTab = store.get("butler.tab");
let tab: Tab = savedTab === "party" || savedTab === "combat" ? savedTab : "creatures";
let sceneReady = true;
let packageOpen = false;

const creatures = createRoster("creature");
const app = document.getElementById("app")!;

function renderCreaturesTab(): Child[] {
  return [
    ...creatures.render(),
    h("details", { className: "panel", open: packageOpen, ontoggle: (e: Event) => { packageOpen = (e.target as HTMLDetailsElement).open; } },
      h("summary", {}, "Prepared encounter (map + positioned creatures in one file)"),
      packageOpen ? h("div", { className: "stack", style: "margin-top:8px" }, ...renderPackageTab()) : null),
  ];
}

function render() {
  const scrollY = app.parentElement ? window.scrollY : 0;
  const focused = document.activeElement as HTMLElement | null;
  const nodes: Child[] = [
    h("nav", { className: "tabs" }, ...TABS.map(([t, label]) =>
      h("button", { className: t === tab ? "on" : "", onclick: () => { tab = t; store.set("butler.tab", t); ui.error = ""; if (t === "combat") refreshCombat(true); rerender(); } }, label))),
  ];
  if (!sceneReady) nodes.push(h("div", { className: "panel warn" }, "Open a scene in Owlbear — this panel updates when it's ready."));
  if (ui.error) nodes.push(h("div", { className: "panel bad" }, ui.error, " ", h("button", { className: "icon", onclick: () => { ui.error = ""; rerender(); } }, "✕")));
  nodes.push(...(tab === "creatures" ? renderCreaturesTab() : tab === "party" ? renderPartyTab() : renderCombatTab()));
  app.replaceChildren(...nodes.filter((n): n is Node | string => !!n));
  window.scrollTo(0, scrollY);
  if (focused && focused !== document.body && focused.isConnected && document.activeElement !== focused) focused.focus();
}
setRerender(render);

if (OBR.isAvailable) {
  OBR.onReady(async () => {
    await initRoomSettings();
    onRoomSettings(() => render());
    sceneReady = await OBR.scene.isReady();
    render();
    OBR.scene.onReadyChange((r) => {
      sceneReady = r;
      if (!r) { resetPackageTab(); resetPartyTab(); resetCombatTab(); }
      else if (tab === "combat") refreshCombat(true);
      render();
    });
    // Combat tab follows the scene live (tokens added, removed, initiative changed…)
    OBR.scene.items.onChange(() => { if (tab === "combat") refreshCombat(); });
  });
} else {
  app.append(h("div", { className: "panel" }, "This page is an Owlbear Rodeo extension. Add ", h("code", {}, new URL("manifest.json", location.href).toString()),
    " in Owlbear → Profile → Extensions → Add Custom Extension."));
}
