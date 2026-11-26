/**
 * Encounter Butler popover.
 *  GM: Tracker, Encounter, Party, Tools and Settings.
 *  Player: their own units (cards to roll from) and the roll log.
 */
import "./devlog";
import OBR from "@owlbear-rodeo/sdk";
import { refreshCombat, renderCombatTab, renderSettings, resetCombatTab } from "./combatTab";
import { refreshDmTab, renderDmTab, resetDmTab } from "./dmTab";
import { h, rerender, setRerender, store, ui, type Child } from "./dom";
import { renderLifeManagerPanel, resetLifeManagerPanel } from "./lifeManagerPanel";
import { renderPackageTab, resetPackageTab } from "./packageTab";
import { renderPartyTab, resetPartyTab } from "./partyTab";
import { refreshPlayersTab, renderPlayersTab, resetPlayersTab } from "./playersTab";
import { initPlayerItems, renderPlayerView } from "./playerView";
import { createRoster } from "./roster";
import { refreshPartyPanel, resetPartyPanel } from "./partyPanel";
import { refreshTracker, renderTrackerTab, resetTrackerTab } from "./trackerTab";
import { initRoomSettings, onRoomSettings } from "./roomSettings";
import { initVisionPanel } from "./visionPanel";

const TABS = [["tracker", "Tracker"], ["encounter", "Encounter"], ["party", "Party"], ["dm", "Tools"], ["settings", "Settings"]] as const;
type Tab = typeof TABS[number][0];
const savedTab = store.get("butler.tab");
let tab: Tab = TABS.find(([key]) => key === savedTab)?.[0]
  ?? (savedTab === "creatures" || savedTab === "combat" ? "encounter" : savedTab === "players" ? "party" : "tracker");
let encounterView: "creatures" | "import" | "difficulty" = savedTab === "combat" ? "difficulty" : "creatures";
let partyView = savedTab === "party" ? store.get("butler.partyView") ?? "manage" : "overview";
let sceneReady = true;
let restoreScroll: number | undefined;
const scrollByTab = new Map<Tab, number>();
let role: "GM" | "PLAYER" | null = null;
let playerPending = false;
document.addEventListener("focusout", () => { if (playerPending) { playerPending = false; setTimeout(render, 0); } });

const creatures = createRoster("creature");
const app = document.getElementById("app")!;

function segment(label: string, active: boolean, select: () => void): Child {
  return h("button", { className: active ? "on" : "", "aria-pressed": String(active), "data-nav": label, onclick: select }, label);
}

function renderEncounter(): Child[] {
  const views = [["creatures", "Add creatures"], ["import", "Import encounter"], ["difficulty", "Difficulty"]] as const;
  return [h("div", { className: "seg", role: "group", "aria-label": "Encounter" }, ...views.map(([key, label]) =>
    segment(label, encounterView === key, () => {
      encounterView = key;
      restoreScroll = 0;
      if (key === "difficulty" && sceneReady) refreshCombat(true);
      rerender();
    }))),
    ...(encounterView === "creatures" ? creatures.render() : encounterView === "import" ? [renderLifeManagerPanel(), ...renderPackageTab()] : renderCombatTab())];
}

function manageParty() {
  partyView = "manage";
  store.set("butler.partyView", partyView);
  restoreScroll = 0;
  rerender();
}

function renderParty(): Child[] {
  return [h("div", { className: "seg", role: "group", "aria-label": "Party" },
    segment("Overview", partyView !== "manage", () => {
      partyView = "overview";
      store.set("butler.partyView", partyView);
      restoreScroll = 0;
      if (sceneReady) refreshPlayersTab(true);
      rerender();
    }),
    segment("Manage", partyView === "manage", manageParty)),
    ...(partyView === "manage" ? renderPartyTab() : renderPlayersTab(manageParty))];
}

function refreshTab(immediate = false) {
  if (!sceneReady || role !== "GM") return;
  if (tab === "tracker") refreshTracker(immediate);
  if (tab === "encounter" && encounterView === "difficulty") refreshCombat(immediate);
  if (tab === "party" && partyView !== "manage") refreshPlayersTab(immediate);
  if (tab === "party" && partyView === "manage") void refreshPartyPanel();
  if (tab === "dm") refreshDmTab(immediate);
}

function selectTab(next: Tab) {
  if (next === tab) return;
  scrollByTab.set(tab, window.scrollY);
  tab = next;
  restoreScroll = scrollByTab.get(tab) ?? 0;
  store.set("butler.tab", tab);
  ui.error = "";
  refreshTab(true);
  rerender();
}

function render() {
  const scrollY = app.parentElement ? window.scrollY : 0;
  const focused = document.activeElement as HTMLElement | null;
  if (role === "PLAYER") {
    // Don't wipe a box the player is typing in (HP, initiative); render when it loses focus.
    if (focused && focused.closest("#app") && /^(INPUT|SELECT|TEXTAREA)$/.test(focused.tagName) && (focused as HTMLInputElement).type !== "checkbox") { playerPending = true; return; }
    const nodes: Child[] = [];
    if (!sceneReady) nodes.push(h("div", { className: "panel warn" }, "Waiting for the GM to open a scene."));
    else nodes.push(...renderPlayerView());
    app.replaceChildren(...nodes.filter((n): n is Node | string => !!n));
    window.scrollTo(0, scrollY);
    return;
  }
  const nodes: Child[] = [
    h("nav", { className: "tabs", "aria-label": "DM navigation" }, ...TABS.map(([key, label]) =>
      h("button", { className: key === tab ? "on" : "", "aria-current": key === tab ? "page" : null,
        "data-nav": key, onclick: () => selectTab(key) }, label))),
  ];
  if (!sceneReady && tab !== "settings") nodes.push(h("div", { className: "panel warn" }, "Open a scene in Owlbear to use this tab."));
  if (ui.error) nodes.push(h("div", { className: "panel bad", role: "alert" }, ui.error, " ", h("button", { className: "icon", "aria-label": "Dismiss error", onclick: () => { ui.error = ""; rerender(); } }, "✕")));
  if (tab === "settings") nodes.push(renderSettings());
  else if (sceneReady) nodes.push(...(tab === "tracker" ? renderTrackerTab() : tab === "encounter" ? renderEncounter() : tab === "party" ? renderParty() : renderDmTab()));
  const navFocus = focused?.dataset.nav;
  app.replaceChildren(...nodes.filter((n): n is Node | string => !!n));
  window.scrollTo(0, restoreScroll ?? scrollY);
  restoreScroll = undefined;
  if (navFocus) app.querySelector<HTMLElement>(`[data-nav="${navFocus}"]`)?.focus({ preventScroll: true });
}
setRerender(render);

if (OBR.isAvailable) {
  OBR.onReady(async () => {
    await initRoomSettings();
    onRoomSettings(() => render());
    role = await OBR.player.getRole();
    OBR.player.onChange((p) => {
      if (p.role === role) return;
      role = p.role;
      if (role === "PLAYER" && sceneReady) void initPlayerItems(() => render()).then(render);
      render();
    });
    // Subscribe first, so a scene that becomes ready while we're still starting up isn't missed.
    OBR.scene.onReadyChange((r) => {
      sceneReady = r;
      if (!r) { resetLifeManagerPanel(); resetPackageTab(); resetPartyTab(); resetCombatTab(); resetTrackerTab(); resetPartyPanel(); resetPlayersTab(); resetDmTab(); }
      else if (role === "PLAYER") void initPlayerItems(() => render()).then(render);
      else refreshTab(true);
      if (r) void initVisionPanel(() => render()).then(render);
      render();
    });
    sceneReady = await OBR.scene.isReady();
    if (role === "PLAYER" && sceneReady) await initPlayerItems(() => render());
    if (sceneReady) await initVisionPanel(() => render());
    render();
    OBR.scene.items.onChange(() => refreshTab());
    OBR.scene.onMetadataChange(() => {
      if (tab === "tracker" || tab === "dm") refreshTab();
    });
  });
} else {
  app.append(h("div", { className: "panel" }, "This page is an Owlbear Rodeo extension. Add ", h("code", {}, new URL("manifest.json", location.href).toString()),
    " in Owlbear → Profile → Extensions → Add Custom Extension."));
}
