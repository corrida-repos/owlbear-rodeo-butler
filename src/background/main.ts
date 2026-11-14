/**
 * Background script: loaded once per client (GM and every player) while the extension is enabled in the room,
 * even when no popover is open.
 *  - Context menu: View unit card (everyone, on units they can select); GM actions on selected units.
 *  - Rolls: broadcast → notification + this browser's roll log.
 *  - Turns: "It's your turn" / "You're up next" for the controlling player, the active-turn ring on the map
 *    (a local item, so each client draws its own), and optionally following the active unit.
 *  - The GM's client applies players' "end my turn" requests.
 *  - Wild Shape: the menu entry, players' Wild Shape requests, and (primary GM) setting up druids found on the map.
 */
import "../extension/devlog";
import OBR, { buildShape, type Item, type KeyFilter } from "@owlbear-rodeo/sdk";
import { controls, zeroHpPromptee } from "../core/card";
import { ZERO_HP_TEXT } from "../core/hp";
import { needsDeathSaves } from "../core/systems";
import { openZeroHp } from "../extension/zeroHpPopover";
import { BUTLER_NS } from "../core/constants";
import { canSeeRoll, isRollMessage, ROLL_CHANNEL, rollText } from "../core/rolls";
import { SHEET_KEY, STATE_KEY } from "../core/sheet";
import {
  addConditionTo, changeHp, chooseAtZero, endTurnFor, expireConditions, recordDeathSave, removeConditionFrom, resolveConcentration,
  setDeathSaves, setInitiative, setParty, trackerView, zeroHpUnits, type TrackerView,
} from "../core/tracker";
import { movedFeet, readMovement, speedLimit } from "../core/movement";
import { speedPenalty, type TurnPoint } from "../core/conditions";
import { resetMovementMemory, rewindActive, setDash, trackMovement } from "./movement";
import { resetOverlays, updateOverlays } from "./overlays";
import { resetVision, updateVision } from "./vision";
import { resetDarkness, updateDarkness } from "./darkness";
import { AURA_CHANNEL, AURA_CHOSEN_KEY, AURA_SCOPE_KEY, HUD_KEY, readChosen, readSceneLight, setUnitLight, toggleChosen } from "../core/vision";
import { EDIT_REQUESTS, isPlayerRequest, REQUEST_CHANNEL, REQUEST_CHUNK_CHANNEL } from "../core/turns";
import { Assembler, isChunk } from "../core/chunks";
import { applySelfSync } from "../core/party";
import { openCard } from "../extension/cardPopover";
import { readUnit } from "../core/unit";
import { store } from "../extension/dom";
import { obrGateway } from "../extension/obrGateway";
import { pushRollLog } from "../extension/rollLog";
import { initRoomSettings, onRoomSettings, roomSettings, roomSystem } from "../extension/roomSettings";
import { openWildShape } from "../extension/wildShapePopover";
import { openActions } from "../extension/actionsPopover";
import {
  addKnownShape, detectWildShape, readWildShape, removeKnownShape, resetWildShapeUses, revertWildShape, setupWildShape, transformUnit, WILD_KEY,
} from "../core/wildshape";
import { migrateSheet } from "../core/sheet";

const icon = new URL("icon.svg", location.href).href;
const RING_ID = `${BUTLER_NS}/active-ring`;
const HP_POPOVER = `${BUTLER_NS}/hp`;
const INIT_POPOVER = `${BUTLER_NS}/initiative`;

const UNIT_FILTER: KeyFilter[] = [
  { key: "layer", value: "CHARACTER" },
  { key: "type", value: "IMAGE" },
  { key: ["metadata", SHEET_KEY], value: undefined, operator: "!=" },
];
const ids = (items: Item[]) => items.filter((i) => SHEET_KEY in i.metadata).map((i) => i.id);
const notify = (text: string, variant: "INFO" | "SUCCESS" | "WARNING" | "ERROR" = "INFO") => {
  if (import.meta.env.DEV) console.log("[Butler] notify", variant, text);
  return OBR.notification.show(text, variant).catch((e) => console.error("[Butler] notification failed", e));
};

/** Dev log of every context-menu action (which item, which tokens). */
const logClick = (id: string, items: Item[]) => { if (import.meta.env.DEV) console.log("[Butler] menu", id, items.map((i) => i.name).join(", ")); };

async function createMenus() {
  // Players can only select tokens they own, so for them this shows on their own units only.
  await OBR.contextMenu.create({
    id: `${BUTLER_NS}/view-unit`,
    icons: [{ icon, label: "View unit card", filter: { max: 1, every: [...UNIT_FILTER] } }],
    onClick: async (ctx, elementId) => {
      logClick("view-unit", ctx.items); if (ctx.items[0]) await openCard(ctx.items[0].id, elementId); },
  });
  // Action bar (BG3-style hotbar): same reach as the card.
  await OBR.contextMenu.create({
    id: `${BUTLER_NS}/actions`,
    icons: [{ icon, label: "Actions", filter: { max: 1, every: [...UNIT_FILTER] } }],
    onClick: async (ctx) => {
      logClick("actions", ctx.items); if (ctx.items[0]) await openActions(ctx.items[0].id); },
  });
  // Vision HUD: show or hide this unit's vision circles (and, for the GM, look through its eyes in the darkness fog).
  await OBR.contextMenu.create({
    id: `${BUTLER_NS}/vision-toggle`,
    icons: [{ icon, label: "Show / hide vision aura", filter: { every: [...UNIT_FILTER] } }],
    onClick: async (ctx) => {
      logClick("vision-toggle", ctx.items);
      const picked = ids(ctx.items);
      const chosen = toggleChosen(readChosen(store.get(AURA_CHOSEN_KEY)), picked);
      store.set(AURA_CHOSEN_KEY, JSON.stringify(chosen));
      store.set(AURA_SCOPE_KEY, "chosen");
      store.set(HUD_KEY, "1");
      await OBR.broadcast.sendMessage(AURA_CHANNEL, { key: AURA_CHOSEN_KEY }, { destination: "LOCAL" }).catch(() => {});
      if (readSceneLight(await OBR.scene.getMetadata()) === "bright") await notify("Vision auras show in dim or dark scenes: set the scene's light in Tracker → Light & vision.");
      void onSceneChange();
    },
  });
  // Wild Shape: on druids (set up from their sheet or by the GM); the GM can set it up on any party member.
  await OBR.contextMenu.create({
    id: `${BUTLER_NS}/wild-shape`,
    icons: [
      { icon, label: "Wild Shape: revert or change", filter: { max: 1, every: [...UNIT_FILTER, { key: ["metadata", WILD_KEY, "active"], value: undefined, operator: "!=" }] } },
      { icon, label: "Wild Shape", filter: { max: 1, every: [...UNIT_FILTER, { key: ["metadata", WILD_KEY], value: undefined, operator: "!=" }, { key: ["metadata", WILD_KEY], value: null, operator: "!=" }] } },
      { icon, label: "Set up Wild Shape", filter: { roles: ["GM"], max: 1, every: [...UNIT_FILTER, { key: ["metadata", STATE_KEY, "party"], value: true }] } },
    ],
    onClick: async (ctx, elementId) => {
      logClick("wild-shape", ctx.items); if (ctx.items[0]) await openWildShape(ctx.items[0].id, elementId); },
  });
  const gm = { roles: ["GM" as const] };
  // Manage initiative: add / remove, roll, or type initiative for the selected units, in one screen.
  await OBR.contextMenu.create({
    id: `${BUTLER_NS}/initiative`,
    icons: [{ icon, label: "Manage initiative", filter: { ...gm, every: [...UNIT_FILTER] } }],
    onClick: async (ctx, elementId) => {
      logClick("initiative", ctx.items);
      await OBR.popover.close(INIT_POPOVER).catch(() => {});
      await OBR.popover.open({ id: INIT_POPOVER, url: new URL(`initiative.html?ids=${ids(ctx.items).map(encodeURIComponent).join(",")}`, location.href).href, width: 360, height: 460, anchorElementId: elementId });
    },
  });
  // Change status: HP (damage, heal, temp, set) and every condition, Dead, Stable and Death Saves included, in one screen.
  await OBR.contextMenu.create({
    id: `${BUTLER_NS}/hp`,
    icons: [{ icon, label: "Change status", filter: { ...gm, every: [...UNIT_FILTER] } }],
    onClick: async (ctx, elementId) => {
      logClick("status", ctx.items);
      await OBR.popover.close(HP_POPOVER).catch(() => {});
      await OBR.popover.open({ id: HP_POPOVER, url: new URL(`hp.html?ids=${ids(ctx.items).map(encodeURIComponent).join(",")}`, location.href).href, width: 340, height: 520, anchorElementId: elementId });
    },
  });
  await OBR.contextMenu.create({
    id: `${BUTLER_NS}/party`,
    icons: [
      { icon, label: "Add to party", filter: { ...gm, every: [...UNIT_FILTER], some: [{ key: ["metadata", STATE_KEY, "party"], value: true, operator: "!=" }] } },
      { icon, label: "Remove from party", filter: { ...gm, every: [...UNIT_FILTER] } },
    ],
    onClick: async (ctx) => {
      logClick("party", ctx.items);
      const anyOut = ctx.items.some((i) => (i.metadata[STATE_KEY] as { party?: boolean } | undefined)?.party !== true);
      await setParty(obrGateway, ids(ctx.items), anyOut);
    },
  });
}

// ------------------------------------------------------------------ turns

let lastTurnKey: string | null = null;
let lastTurn: TurnPoint | null = null;
let ringFor: string | null = null;
let busy = false;
let again = false;
/** This browser's selected items (vision auras can follow the selection). */
let selection: string[] = [];

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

/** Units whose 0-HP prompt this client already opened (so it opens once per drop, not on every scene change). */
const prompted = new Set<string>();
const connectedPlayerIds = async () => (await OBR.party.getPlayers()).filter((p) => p.role === "PLAYER").map((p) => p.id);

/** A unit dropped to 0 HP: opens the 0 HP popover on its controller's client (the player, or the GM). */
async function promptZeroHp(lite: Awaited<ReturnType<typeof obrGateway.getItems>>, role: "GM" | "PLAYER") {
  const pendingIds = lite.filter((i) => (i.metadata[STATE_KEY] as { zeroHpPending?: boolean } | undefined)?.zeroHpPending).map((i) => i.id);
  for (const id of [...prompted]) if (!pendingIds.includes(id)) prompted.delete(id);
  if (!pendingIds.some((id) => !prompted.has(id))) return;
  const { pending } = zeroHpUnits(lite, { id: OBR.player.id, role }, await connectedPlayerIds());
  const fresh = pending.filter((u) => !prompted.has(u.id));
  if (!fresh.length) return;
  for (const u of fresh) prompted.add(u.id);
  await openZeroHp().catch((e) => console.error("[Butler] 0 HP popover failed", e));
  await notify(`${fresh.map((u) => u.name).join(", ")} dropped to 0 HP: dead, death saves, stable or alive?`, "WARNING");
}

async function onSceneChange() {
  if (busy) { again = true; return; }
  busy = true;
  try {
    do {
      again = false;
      if (!(await OBR.scene.isReady())) { lastTurnKey = null; lastTurn = null; ringFor = null; resetOverlays(); resetVision(); resetDarkness(); resetMovementMemory(); continue; }
      const [items, meta, role] = await Promise.all([OBR.scene.items.getItems(), OBR.scene.getMetadata(), OBR.player.getRole()]);
      const lite = await obrGateway.getItems();
      const v = trackerView(lite, meta);
      await updateRing(v, items, role);
      await promptZeroHp(lite, role).catch((e) => console.error("[Butler] 0 HP prompt failed", e));
      const primary = await isPrimaryGm();
      if (primary) await setupDruids(lite);
      const active = v.encounter.started && v.active ? { id: v.active, round: v.encounter.round } : null;
      // Movement: the primary GM client records; every client shows the active unit's label.
      const mv = primary ? await trackMovement(meta, active) : readMovement(meta);
      const au = v.order.find((u) => u.id === mv?.unitId);
      const movement = mv && au && active?.id === au.id
        ? (() => { const lim = speedLimit(au.sheet, { dash: mv.dash, penalty: speedPenalty(roomSystem(), au.state) }); const moved = movedFeet(mv); return { unitId: au.id, text: `${moved}/${lim} ft${mv.dash ? " Dash" : ""}`, over: moved > lim }; })()
        : null;
      await updateOverlays([...v.order, ...v.waiting, ...v.outside], items, role, roomSystem(), movement);
      await updateVision([...v.order, ...v.waiting, ...v.outside], items, role, meta, selection, roomSystem().rules)
        .catch((e) => console.error("[Butler] vision auras failed", e));
      await updateDarkness([...v.order, ...v.waiting, ...v.outside], items, role, meta, selection, roomSystem().rules)
        .catch((e) => console.error("[Butler] darkness fog failed", e));
      const key = v.encounter.started && v.active ? `${v.encounter.round}:${v.active}` : "";
      if (key === lastTurnKey) continue;
      const firstLook = lastTurnKey === null;
      lastTurnKey = key;
      const prevTurn = lastTurn;
      lastTurn = active ? { round: active.round, turnId: active.id } : null;
      if (!key || firstLook) continue; // nothing on load: only actual turn changes notify
      // Durations end on forward turn changes (not when the GM steps back with Previous).
      if (primary && lastTurn && prevTurn) {
        const pos = (id: string) => v.order.findIndex((u) => u.id === id);
        const forward = lastTurn.round > prevTurn.round || (lastTurn.round === prevTurn.round && pos(lastTurn.turnId) > pos(prevTurn.turnId));
        if (forward) for (const line of await expireConditions(obrGateway, prevTurn, lastTurn, roomSystem())) await notify(line);
      }
      const me = { id: OBR.player.id, role };
      const unit = (id?: string) => v.order.find((u) => u.id === id);
      const item = (id?: string) => items.find((i) => i.id === id);
      const activeU = unit(v.active), next = unit(v.next);
      // A unit making death saves: its controller gets the death save tracker at the start of its turn.
      if (activeU && needsDeathSaves(activeU.state) && !activeU.state.zeroHpPending
        && zeroHpUnits(lite, me, await connectedPlayerIds()).dying.some((u) => u.id === activeU.id)) {
        await notify(`${activeU.name} is dying: roll a death save.`, "WARNING");
        await openZeroHp().catch((e) => console.error("[Butler] 0 HP popover failed", e));
      } else if (activeU && item(activeU.id) && controls(me, item(activeU.id)!, activeU.state) && role === "PLAYER") {
        await notify(`It's your turn: ${activeU.name}`, "SUCCESS");
        if (store.get("butler.autoActions") === "1") await openActions(activeU.id).catch((e) => console.error("[Butler] action bar failed", e));
      } else if (next && item(next.id) && role === "PLAYER" && controls(me, item(next.id)!, next.state)) {
        await notify(`You're up next: ${next.name}`, "INFO");
      }
      if (store.get("butler.followActive") === "1" && activeU && (role === "GM" || item(activeU.id)?.visible)) {
        const b = await OBR.scene.items.getItemBounds([activeU.id]);
        await OBR.viewport.animateToBounds({ ...b, min: { x: b.min.x - b.width * 3, y: b.min.y - b.height * 3 }, max: { x: b.max.x + b.width * 3, y: b.max.y + b.height * 3 }, width: b.width * 7, height: b.height * 7 });
      }
    } while (again);
  } catch (e) {
    console.error("[Butler] turn watch failed", e);
  } finally {
    busy = false;
  }
}

/**
 * Primary GM client: units whose sheet shows Wild Shape (a druid class line from D&D Beyond, or a Wild Shape trait) get
 * it set up; a druid set up that way follows level-ups and subclass changes. Hand-set values aren't touched.
 */
async function setupDruids(items: Awaited<ReturnType<typeof obrGateway.getItems>>) {
  for (const it of items) {
    if (it.layer !== "CHARACTER" || it.type !== "IMAGE" || !(SHEET_KEY in it.metadata)) continue;
    const u = readUnit(it.metadata);
    if (!u) continue;
    const ws = readWildShape(it.metadata);
    if (ws?.active || (ws && !ws.auto) || it.metadata[WILD_KEY] === null) continue; // transformed, set by hand, or removed by the GM
    const found = detectWildShape(u.sheet);
    if (!found || (ws && ws.druidLevel === found.druidLevel && ws.moon === found.moon)) continue;
    await setupWildShape(obrGateway, it.id, { ...found, auto: true }).catch((e) => console.error("[Butler] Wild Shape setup failed", e));
  }
}

/** Applies a request from a player's (or GM's) client; only the primary GM client acts on it. */
async function handleRequest(req: unknown) {
  try {
    if (!isPlayerRequest(req) || !(await isPrimaryGm())) return;
    // The request must come from the player who controls the unit, or from a GM.
    const [it] = await OBR.scene.items.getItems([req.unitId]);
    if (!it) return;
    const st = it.metadata[STATE_KEY] as { controlledBy?: string } | undefined;
    const fromGm = req.playerId === OBR.player.id || (await OBR.party.getPlayers()).some((p) => p.id === req.playerId && p.role === "GM");
    if (!fromGm && !controls({ id: req.playerId, role: "PLAYER" }, it, st ?? {})) return;
    if (!fromGm && EDIT_REQUESTS.includes(req.type) && !roomSettings().playerEdits) {
      await notify(`${req.playerName} tried to edit ${it.name}, but player edits are off (Combat tab).`, "WARNING");
      return;
    }
    const name = (it as { text?: { plainText?: string } }).text?.plainText || it.name;
    switch (req.type) {
      case "end-turn":
        if (await endTurnFor(obrGateway, req.unitId, req.round)) await notify(`${req.playerName} ended their turn.`);
        break;
      case "concentration": {
        const r = await resolveConcentration(obrGateway, req.unitId, req.total);
        if (r === "lost") await notify(`${name} lost Concentration (${req.total}).`, "WARNING");
        break;
      }
      case "rewind": await rewindActive(await OBR.scene.getMetadata(), req.unitId); break;
      case "dash": await setDash(await OBR.scene.getMetadata(), req.unitId, req.on); break;
      case "death-save": {
        const outcome = await recordDeathSave(obrGateway, req.unitId, req.natural);
        if (outcome === "dead") await notify(`${name}: third death save failure. ${name} is dead.`, "WARNING");
        if (outcome === "stable") await notify(`${name} is Stable.`, "SUCCESS");
        if (outcome === "regain-1-hp") await notify(`${name} rolled a natural 20 and is back up with 1 HP!`, "SUCCESS");
        break;
      }
      case "death-save-set": {
        const outcome = await setDeathSaves(obrGateway, req.unitId, req.successes, req.failures);
        if (outcome === "dead") await notify(`${name}: three death save failures. ${name} is dead.`, "WARNING");
        if (outcome === "stable") await notify(`${name} is Stable.`, "SUCCESS");
        break;
      }
      case "zero-hp-choice": {
        await chooseAtZero(obrGateway, req.unitId, req.choice);
        await notify(`${req.playerName}: ${name} ${ZERO_HP_TEXT[req.choice]}.`, req.choice === "dead" ? "WARNING" : "INFO");
        break;
      }
      case "hp": {
        const [r] = await changeHp(obrGateway, [req.unitId], req.change, { system: roomSystem() });
        if (r?.events.includes("wild-shape-ended")) await notify(`${name}'s Wild Shape ended: back to their normal form.`, "WARNING");
        if (r?.events.includes("dropped-to-zero")) await notify(`${name} dropped to 0 HP.`, "WARNING");
        if (r?.deadBy === "three-failures") await notify(`${name} took damage at 0 HP: third death save failure. ${name} is dead.`, "WARNING");
        if (r?.deadBy === "massive-damage") await notify(`${name} took massive damage at 0 HP and is dead.`, "WARNING");
        break;
      }
      case "initiative": await setInitiative(obrGateway, req.unitId, req.value); break;
      case "light": await setUnitLight(obrGateway, req.unitId, req.light); break;
      case "condition-add": {
        const reverted = await addConditionTo(obrGateway, [req.unitId], req.key, req);
        if (reverted.length) await notify(`${name}'s Wild Shape ended (Incapacitated).`, "WARNING");
        break;
      }
      case "condition-remove": await removeConditionFrom(obrGateway, req.unitId, req.conditionId); break;
      case "wild-shape": {
        const rules = roomSystem().rules;
        if (req.op === "known-add") await addKnownShape(obrGateway, req.unitId, req.shape, rules);
        else if (req.op === "known-remove") await removeKnownShape(obrGateway, req.unitId, req.shape);
        else if (req.op === "rest") await resetWildShapeUses(obrGateway, req.unitId, req.rest ?? "long", rules);
        else if (req.op === "revert") { if (await revertWildShape(obrGateway, req.unitId)) await notify(`${name} returns to their normal form.`); }
        else {
          const r = await transformUnit(obrGateway, req.unitId, migrateSheet(req.sheet), req.image, { rules, form: req.form });
          await notify(`${r.name} turns into a ${r.form}.${r.warnings.length ? ` ${r.warnings.join(" ")}` : ""}`, "SUCCESS");
        }
        break;
      }
      case "sheet-sync": {
        const who = await applySelfSync(obrGateway, req.unitId, req.member, req.hp);
        await notify(`${req.playerName} synced ${who} from D&D Beyond.`, "SUCCESS");
        break;
      }
    }
  } catch (e) {
    console.error("[Butler] request failed", e);
    await notify(`A player's request failed: ${e instanceof Error ? e.message : String(e)}`, "ERROR");
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

  OBR.broadcast.onMessage(REQUEST_CHANNEL, (event) => void handleRequest(event.data));
  const assembler = new Assembler();
  OBR.broadcast.onMessage(REQUEST_CHUNK_CHANNEL, (event) => {
    if (!isChunk(event.data)) return;
    const whole = assembler.add(event.data);
    if (whole !== undefined) void handleRequest(whole);
  });

  // Vision auras: redraw for this browser's selection, its aura choice (set in another Butler page) and grid changes.
  selection = (await OBR.player.getSelection()) ?? [];
  OBR.player.onChange((p) => {
    const next = p.selection ?? [];
    if (next.join() === selection.join()) return;
    selection = next;
    void onSceneChange();
  });
  window.addEventListener("storage", (e) => { if (e.key === HUD_KEY || e.key === AURA_SCOPE_KEY || e.key === AURA_CHOSEN_KEY) void onSceneChange(); });
  OBR.broadcast.onMessage(AURA_CHANNEL, () => void onSceneChange());
  OBR.scene.grid.onChange(() => void onSceneChange());

  void onSceneChange();
  OBR.scene.onReadyChange(() => void onSceneChange());
  OBR.scene.onMetadataChange(() => void onSceneChange());
  OBR.scene.items.onChange(() => void onSceneChange());
  // Badges depend on the game system (Bloodied is 5.5E only).
  onRoomSettings(() => void onSceneChange());
});
