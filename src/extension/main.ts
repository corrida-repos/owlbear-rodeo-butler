/** Encounter Butler popover: three tabs — Monsters (quick add), Party (D&D Beyond), Prepared encounter (packages). */
import OBR from "@owlbear-rodeo/sdk";
import { h, rerender, setRerender, store, ui, type Child } from "./dom";
import { afterRenderMonsters, renderMonstersTab } from "./monstersTab";
import { renderPackageTab, resetPackageTab } from "./packageTab";
import { renderPartyTab, resetPartyTab } from "./partyTab";

type Tab = "monsters" | "party" | "package";
const TABS: [Tab, string][] = [["monsters", "Monsters"], ["party", "Party"], ["package", "Prepared encounter"]];
let tab: Tab = (["monsters", "party", "package"] as Tab[]).find((t) => t === store.get("butler.tab")) ?? "monsters";
let sceneReady = true;

const app = document.getElementById("app")!;

function render() {
  const scrollY = app.parentElement ? window.scrollY : 0;
  const focused = document.activeElement as HTMLElement | null;
  const nodes: Child[] = [
    h("nav", { className: "tabs" }, ...TABS.map(([t, label]) =>
      h("button", { className: t === tab ? "on" : "", onclick: () => { tab = t; store.set("butler.tab", t); ui.error = ""; rerender(); } }, label))),
  ];
  if (!sceneReady) nodes.push(h("div", { className: "panel warn" }, "Open a scene in Owlbear — this panel updates when it's ready."));
  if (ui.error) nodes.push(h("div", { className: "panel bad" }, ui.error, " ", h("button", { className: "icon", onclick: () => { ui.error = ""; rerender(); } }, "✕")));
  nodes.push(...(tab === "monsters" ? renderMonstersTab() : tab === "party" ? renderPartyTab() : renderPackageTab()));
  app.replaceChildren(...nodes.filter((n): n is Node | string => !!n));
  window.scrollTo(0, scrollY);
  if (focused && focused !== document.body && focused.isConnected && document.activeElement !== focused) focused.focus();
  if (tab === "monsters") afterRenderMonsters();
}
setRerender(render);

if (OBR.isAvailable) {
  OBR.onReady(async () => {
    sceneReady = await OBR.scene.isReady();
    render();
    OBR.scene.onReadyChange((r) => {
      sceneReady = r;
      if (!r) { resetPackageTab(); resetPartyTab(); }
      render();
    });
  });
} else {
  app.append(h("div", { className: "panel" }, "This page is an Owlbear Rodeo extension. Add ", h("code", {}, new URL("manifest.json", location.href).toString()),
    " in Owlbear → Profile → Extensions → Add Custom Extension."));
}
