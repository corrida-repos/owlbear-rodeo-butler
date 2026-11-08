/**
 * Background script: loaded once per client (GM and every player) while the extension is enabled in the room,
 * even when no popover is open.
 *  - Context menu: View unit card (everyone, on units they can select); GM actions on selected units.
 *  - Rolls: broadcast → notification + this browser's roll log.
 *  - Turns: "It's your turn" / "You're up next" for the controlling player, the active-turn ring on the map
 *    (a local item, so each client draws its own), and optionally following the active unit.
 *  - The GM's client applies players' "end my turn" requests.
 */
import "../extension/devlog";
import OBR, { buildShape, type Item, type KeyFilter } from "@owlbear-rodeo/sdk";
import { controls } from "../core/card";
import { BUTLER_NS } from "../core/constants";
import { canSeeRoll, isRollMessage, ROLL_CHANNEL, rollText } from "../core/rolls";
import { SHEET_KEY, STATE_KEY } from "../core/sheet";
import { endTurnFor, markUnitsDead, recordDeathSave, rollInitiativeFor, setInEncounter, setParty, trackerView, type TrackerView } from "../core/tracker";
import { isPlayerRequest, REQUEST_CHANNEL } from "../core/turns";
import { openCard } from "../extension/cardPopover";
import { store } from "../extension/dom";
import { obrGateway } from "../extension/obrGateway";
import { pushRollLog } from "../extension/rollLog";
import { initRoomSettings, roomSettings } from "../extension/roomSettings";

const icon = new URL("icon.svg", location.href).href;
const RING_ID = `${BUTLER_NS}/active-ring`;
const HP_POPOVER = `${BUTLER_NS}/hp`;

const UNIT_FILTER: KeyFilter[] = [
  { key: "layer", value: "CHARACTER" },
  { key: "type", value: "IMAGE" },
  { key: ["metadata", SHEET_KEY], value: undefined, operator: "!=" },
];
const ids = (items: Item[]) => items.filter((i) => SHEET_KEY in i.metadata).map((i) => i.id);
const notify = (text: string, variant: "INFO" | "SUCCESS" | "WARNING" | "ERROR" = "INFO") =>
  OBR.notification.show(text, variant).catch((e) => console.error("[Butler] notification failed", e));

async function createMenus() {
  // Players can only select tokens they own, so for them this shows on their own units only.
  await OBR.contextMenu.create({
    id: `${BUTLER_NS}/view-unit`,
    icons: [{ icon, label: "View unit card", filter: { max: 1, every: [...UNIT_FILTER] } }],
    onClick: async (ctx, elementId) => { if (ctx.items[0]) await openCard(ctx.items[0].id, elementId); },
  });
  const gm = { roles: ["GM" as const] };
  await OBR.contextMenu.create({
    id: `${BUTLER_NS}/initiative`,
    icons: [
      { icon, label: "Add to initiative", filter: { ...gm, every: [...UNIT_FILTER], some: [{ key: ["metadata", STATE_KEY, "inEncounter"], value: true, operator: "!=" }] } },
      { icon, label: "Remove from initiative", filter: { ...gm, every: [...UNIT_FILTER] } },
    ],
    onClick: async (ctx) => {
      const anyOut = ctx.items.some((i) => (i.metadata[STATE_KEY] as { inEncounter?: boolean } | undefined)?.inEncounter !== true);
      await setInEncounter(obrGateway, ids(ctx.items), anyOut);
    },
  });
  await OBR.contextMenu.create({
    id: `${BUTLER_NS}/roll-initiative`,
    icons: [{ icon, label: "Roll initiative", filter: { ...gm, every: [...UNIT_FILTER] } }],
    onClick: async (ctx) => { const n = await rollInitiativeFor(obrGateway, ids(ctx.items)); await notify(`Rolled initiative for ${n} unit${n === 1 ? "" : "s"}.`, "SUCCESS"); },
  });
  await OBR.contextMenu.create({
    id: `${BUTLER_NS}/hp`,
    icons: [{ icon, label: "Damage / heal", filter: { ...gm, every: [...UNIT_FILTER] } }],
    onClick: async (ctx, elementId) => {
      await OBR.popover.close(HP_POPOVER).catch(() => {});
      await OBR.popover.open({ id: HP_POPOVER, url: new URL(`hp.html?ids=${ids(ctx.items).map(encodeURIComponent).join(",")}`, location.href).href, width: 300, height: 300, anchorElementId: elementId });
    },
  });
  await OBR.contextMenu.create({
    id: `${BUTLER_NS}/dead`,
    icons: [{ icon, label: "Mark as dead", filter: { ...gm, every: [...UNIT_FILTER] } }],
    onClick: async (ctx) => { await markUnitsDead(obrGateway, ids(ctx.items)); },
  });
  await OBR.contextMenu.create({
    id: `${BUTLER_NS}/party`,
    icons: [
      { icon, label: "Add to party", filter: { ...gm, every: [...UNIT_FILTER], some: [{ key: ["metadata", STATE_KEY, "party"], value: true, operator: "!=" }] } },
      { icon, label: "Remove from party", filter: { ...gm, every: [...UNIT_FILTER] } },
    ],
    onClick: async (ctx) => {
      const anyOut = ctx.items.some((i) => (i.metadata[STATE_KEY] as { party?: boolean } | undefined)?.party !== true);
      await setParty(obrGateway, ids(ctx.items), anyOut);
    },
  });
}

// ------------------------------------------------------------------ turns

let lastTurnKey: string | null = null;
let ringFor: string | null = null;
let busy = false;
let again = false;

async function updateRing(v: TrackerView, items: Item[], role: "GM" | "PLAYER") {
  const target = v.active ? items.find((i) => i.id === v.active) : undefined;
  const show = target && (role === "GM" || target.visible) ? target : undefined;
  if (ringFor === (show?.id ?? null)) return;
  await OBR.scene.local.deleteItems([RING_ID]).catch(() => {});
  ringFor = null;
  if (!show) return;
  const b = await OBR.scene.items.getItemBounds([show.id]);
  const d = Math.max(b.width, b.height) * 1.18;
  const ring = buildShape()
    .id(RING_ID)
    .shapeType("CIRCLE")
    .width(d).height(d)
    .position(b.center)
    .strokeColor("#9d99ff").strokeWidth(Math.max(4, d * 0.05)).strokeOpacity(0.95)
    .fillColor("#9d99ff").fillOpacity(0.12)
    .attachedTo(show.id)
    .layer("PROP")
    .locked(true)
    .disableHit(true)
    .build();
  await OBR.scene.local.addItems([ring]);
  ringFor = show.id;
}

async function onSceneChange() {
  if (busy) { again = true; return; }
  busy = true;
  try {
    do {
      again = false;
      if (!(await OBR.scene.isReady())) { lastTurnKey = null; ringFor = null; continue; }
      const [items, meta, role] = await Promise.all([OBR.scene.items.getItems(), OBR.scene.getMetadata(), OBR.player.getRole()]);
      const lite = await obrGateway.getItems();
      const v = trackerView(lite, meta);
      await updateRing(v, items, role);
      const key = v.encounter.started && v.active ? `${v.encounter.round}:${v.active}` : "";
      if (key === lastTurnKey) continue;
      const firstLook = lastTurnKey === null;
      lastTurnKey = key;
      if (!key || firstLook) continue; // nothing on load: only actual turn changes notify
      const me = { id: OBR.player.id, role };
      const unit = (id?: string) => v.order.find((u) => u.id === id);
      const item = (id?: string) => items.find((i) => i.id === id);
      const active = unit(v.active), next = unit(v.next);
      if (active && item(active.id) && controls(me, item(active.id)!, active.state) && role === "PLAYER") {
        await notify(`It's your turn: ${active.name}`, "SUCCESS");
      } else if (next && item(next.id) && role === "PLAYER" && controls(me, item(next.id)!, next.state)) {
        await notify(`You're up next: ${next.name}`, "INFO");
      }
      if (store.get("butler.followActive") === "1" && active && (role === "GM" || item(active.id)?.visible)) {
        const b = await OBR.scene.items.getItemBounds([active.id]);
        await OBR.viewport.animateToBounds({ ...b, min: { x: b.min.x - b.width * 3, y: b.min.y - b.height * 3 }, max: { x: b.max.x + b.width * 3, y: b.max.y + b.height * 3 }, width: b.width * 7, height: b.height * 7 });
      }
    } while (again);
  } catch (e) {
    console.error("[Butler] turn watch failed", e);
  } finally {
    busy = false;
  }
}

/** Only one GM client applies a player's request (the one with the smallest connection id), so two GM tabs don't both advance. */
async function isPrimaryGm(): Promise<boolean> {
  if ((await OBR.player.getRole()) !== "GM") return false;
  const mine = await OBR.player.getConnectionId();
  const others = (await OBR.party.getPlayers()).filter((p) => p.role === "GM").map((p) => p.connectionId);
  return others.every((c) => mine < c);
}

OBR.onReady(async () => {
  await initRoomSettings();
  await createMenus();

  OBR.broadcast.onMessage(ROLL_CHANNEL, async (event) => {
    const msg = event.data;
    if (!isRollMessage(msg)) { console.warn("[Butler] ignored malformed roll message", msg); return; }
    const viewer = { id: OBR.player.id, role: await OBR.player.getRole() };
    if (!canSeeRoll(msg, viewer)) return;
    pushRollLog(msg);
    await notify(rollText(msg), msg.visibility === "private" ? "WARNING" : msg.natural === 20 ? "SUCCESS" : "INFO");
  });

  OBR.broadcast.onMessage(REQUEST_CHANNEL, async (event) => {
    const req = event.data;
    if (!isPlayerRequest(req) || !(await isPrimaryGm())) return;
    // The request must come from the player who controls the unit.
    const [it] = await OBR.scene.items.getItems([req.unitId]);
    const st = it?.metadata[STATE_KEY] as { controlledBy?: string } | undefined;
    if (!it || !controls({ id: req.playerId, role: "PLAYER" }, it, st ?? {})) return;
    if (req.type === "end-turn") {
      if (roomSettings().playerEdits && await endTurnFor(obrGateway, req.unitId, req.round)) await notify(`${req.playerName} ended their turn.`);
    } else if (req.type === "death-save") {
      const outcome = await recordDeathSave(obrGateway, req.unitId, req.natural);
      if (outcome === "dead") await notify(`${it.name}: third death save failure. Mark as dead?`, "WARNING");
      if (outcome === "stable") await notify(`${it.name} is Stable.`, "SUCCESS");
    }
  });

  void onSceneChange();
  OBR.scene.onReadyChange(() => void onSceneChange());
  OBR.scene.onMetadataChange(() => void onSceneChange());
  OBR.scene.items.onChange(() => void onSceneChange());
});
