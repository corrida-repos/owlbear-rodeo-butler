/**
 * Encounter Butler popover.
 *  GM: three tabs — Add Creatures, Add Party Members (incl. D&D Beyond sync), Combat.
 *  Player: their own units (cards to roll from) and the roll log.
 */
import "./devlog";
import OBR from "@owlbear-rodeo/sdk";
import { refreshCombat, renderCombatTab, resetCombatTab } from "./combatTab";
import { h, rerender, setRerender, store, ui, type Child } from "./dom";
import { renderPackageTab, resetPackageTab } from "./packageTab";
import { renderPartyTab, resetPartyTab } from "./partyTab";
import { initPlayerItems, renderPlayerView } from "./playerView";
import { createRoster } from "./roster";
import { refreshTracker, renderTrackerTab, resetTrackerTab } from "./trackerTab";
import { initRoomSettings, onRoomSettings } from "./roomSettings";

type Tab = "tracker" | "creatures" | "party" | "combat";
const TABS: [Tab, string][] = [["tracker", "Tracker"], ["creatures", "Add Creatures"], ["party", "Add Party"], ["combat", "Combat"]];
const savedTab = store.get("butler.tab");
let tab: Tab = savedTab === "party" || savedTab === "combat" || savedTab === "creatures" ? savedTab : "tracker";
let sceneReady = true;
let packageOpen = false;
let role: "GM" | "PLAYER" | null = null;

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
  if (role === "PLAYER") {
    const nodes: Child[] = [];
    if (!sceneReady) nodes.push(h("div", { className: "panel warn" }, "Waiting for the GM to open a scene."));
    else nodes.push(...renderPlayerView(OBR.player.id));
    app.replaceChildren(...nodes.filter((n): n is Node | string => !!n));
    window.scrollTo(0, scrollY);
    return;
  }
  const nodes: Child[] = [
    h("nav", { className: "tabs" }, ...TABS.map(([t, label]) =>
      h("button", { className: t === tab ? "on" : "", onclick: () => { tab = t; store.set("butler.tab", t); ui.error = ""; if (t === "combat") refreshCombat(true); if (t === "tracker") refreshTracker(true); rerender(); } }, label))),
  ];
  if (!sceneReady) nodes.push(h("div", { className: "panel warn" }, "Open a scene in Owlbear — this panel updates when it's ready."));
  if (ui.error) nodes.push(h("div", { className: "panel bad" }, ui.error, " ", h("button", { className: "icon", onclick: () => { ui.error = ""; rerender(); } }, "✕")));
  nodes.push(...(tab === "tracker" ? renderTrackerTab() : tab === "creatures" ? renderCreaturesTab() : tab === "party" ? renderPartyTab() : renderCombatTab()));
  app.replaceChildren(...nodes.filter((n): n is Node | string => !!n));
  window.scrollTo(0, scrollY);
  if (focused && focused !== document.body && focused.isConnected && document.activeElement !== focused) focused.focus();
}
setRerender(render);

if (OBR.isAvailable) {
  OBR.onReady(async () => {
    await initRoomSettings();
    onRoomSettings(() => render());
    role = await OBR.player.getRole();
    OBR.player.onChange((p) => { if (p.role !== role) { role = p.role; render(); } });
    sceneReady = await OBR.scene.isReady();
    if (role === "PLAYER" && sceneReady) await initPlayerItems(() => render());
    render();
    OBR.scene.onReadyChange((r) => {
      sceneReady = r;
      if (!r) { resetPackageTab(); resetPartyTab(); resetCombatTab(); resetTrackerTab(); }
      else if (tab === "tracker") refreshTracker(true);
      else if (role === "PLAYER") void initPlayerItems(() => render()).then(render);
      else if (tab === "combat") refreshCombat(true);
      render();
    });
    // Combat tab follows the scene live (tokens added, removed, initiative changed…)
    OBR.scene.items.onChange(() => { if (tab === "combat") refreshCombat(); if (tab === "tracker") refreshTracker(); });
    OBR.scene.onMetadataChange(() => { if (tab === "tracker") refreshTracker(); });
  });
} else {
  app.append(h("div", { className: "panel" }, "This page is an Owlbear Rodeo extension. Add ", h("code", {}, new URL("manifest.json", location.href).toString()),
    " in Owlbear → Profile → Extensions → Add Custom Extension."));
}
