/*
 * A stand-in for Owlbear Rodeo, for the browser smoke tests. It runs in a page on the same origin as the built
 * extension and loads extension pages (popover, card, background…) in iframes, the way Owlbear does. It speaks the
 * SDK's postMessage protocol: OBR_READY to start, then `<ID>_RESPONSE<nonce>` for each request, and change events
 * (items, scene and room metadata) after writes. State lives in `window.__obr` so tests can seed and inspect it.
 */
(() => {
  const S = (window.__obr = {
    role: "GM", name: "Gail", id: "gm-1", connectionId: "c-1",
    items: [], sceneMeta: {}, roomMeta: {}, players: [], localItems: [],
    notifications: [], broadcasts: [], popovers: [], menus: [], unknown: [], frames: [],
  });
  const origin = location.origin;
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const send = (win, id, data) => win.postMessage({ id, data }, origin);
  const emit = (id, data) => { for (const f of S.frames) if (f.contentWindow) send(f.contentWindow, id, data); };
  const merge = (cur, update) => {
    const out = { ...cur };
    for (const [k, v] of Object.entries(update)) { if (v === undefined) delete out[k]; else out[k] = v; }
    return out;
  };

  function handle(id, d, src) {
    switch (id) {
      case "OBR_PLAYER_GET_ROLE": return { role: S.role };
      case "OBR_PLAYER_GET_NAME": return { name: S.name };
      case "OBR_PLAYER_GET_ID": return { id: S.id };
      case "OBR_PLAYER_GET_CONNECTION_ID": return { connectionId: S.connectionId };
      case "OBR_PLAYER_GET_METADATA": return { metadata: {} };
      case "OBR_PLAYER_GET_SELECTION": return { selection: [] };
      case "OBR_PLAYER_GET_COLOR": return { color: "#9d99ff" };
      case "OBR_PARTY_GET_PLAYERS": return { players: clone(S.players) };
      case "OBR_ROOM_GET_METADATA": return { metadata: clone(S.roomMeta) };
      case "OBR_ROOM_SET_METADATA": S.roomMeta = merge(S.roomMeta, d.update); emit("OBR_ROOM_METADATA_EVENT_CHANGE", { metadata: clone(S.roomMeta) }); return {};
      case "OBR_ROOM_GET_PERMISSIONS": return { permissions: [] };
      case "OBR_SCENE_IS_READY": return { ready: true };
      case "OBR_SCENE_GET_METADATA": return { metadata: clone(S.sceneMeta) };
      case "OBR_SCENE_SET_METADATA": S.sceneMeta = merge(S.sceneMeta, d.update); emit("OBR_SCENE_METADATA_EVENT_CHANGE", { metadata: clone(S.sceneMeta) }); return {};
      case "OBR_SCENE_ITEMS_GET_ALL_ITEMS": return { items: clone(S.items) };
      case "OBR_SCENE_ITEMS_GET_ITEMS": return { items: clone(S.items.filter((i) => d.ids.includes(i.id))) };
      case "OBR_SCENE_ITEMS_UPDATE_ITEMS": {
        // The SDK sends each changed top-level key of an item in full.
        for (const u of d.updates) { const it = S.items.find((i) => i.id === u.id); if (it) Object.assign(it, clone(u)); }
        emit("OBR_SCENE_ITEMS_EVENT_CHANGE", { items: clone(S.items) });
        return {};
      }
      case "OBR_SCENE_ITEMS_ADD_ITEMS": S.items.push(...clone(d.items)); emit("OBR_SCENE_ITEMS_EVENT_CHANGE", { items: clone(S.items) }); return {};
      case "OBR_SCENE_ITEMS_DELETE_ITEMS": S.items = S.items.filter((i) => !d.ids.includes(i.id)); emit("OBR_SCENE_ITEMS_EVENT_CHANGE", { items: clone(S.items) }); return {};
      case "OBR_SCENE_ITEMS_GET_ITEM_BOUNDS":
      case "OBR_SCENE_LOCAL_GET_ITEM_BOUNDS": return { bounds: { min: { x: 0, y: 0 }, max: { x: 150, y: 150 }, center: { x: 75, y: 75 }, width: 150, height: 150 } };
      case "OBR_SCENE_ITEMS_GET_ITEM_ATTACHMENTS": return { items: [] };
      case "OBR_SCENE_LOCAL_GET_ALL_ITEMS": return { items: clone(S.localItems) };
      case "OBR_SCENE_LOCAL_GET_ITEMS": return { items: clone(S.localItems.filter((i) => d.ids.includes(i.id))) };
      case "OBR_SCENE_LOCAL_ADD_ITEMS": S.localItems.push(...clone(d.items)); return {};
      case "OBR_SCENE_LOCAL_DELETE_ITEMS": S.localItems = S.localItems.filter((i) => !d.ids.includes(i.id)); return {};
      case "OBR_SCENE_LOCAL_UPDATE_ITEMS": return {};
      case "OBR_SCENE_GRID_GET_DPI": return { dpi: 150 };
      case "OBR_SCENE_GRID_GET_SCALE": return { raw: "5ft", parsed: { multiplier: 5, unit: "ft", digits: 0 } };
      case "OBR_SCENE_GRID_GET_TYPE": return { type: "SQUARE" };
      case "OBR_SCENE_GRID_SNAP_POSITION": {
        // 150-unit cells: corners are multiples of 150, centres sit halfway.
        const c = (v) => (d.useCorners ? Math.round(v / 150) * 150 : Math.floor(v / 150) * 150 + 75);
        return { position: { x: c(d.position.x), y: c(d.position.y) } };
      }
      case "OBR_POPOVER_CLOSE": S.closed = [...(S.closed ?? []), d.id]; return {};
      case "OBR_SCENE_GRID_GET_MEASUREMENT": return { measurement: "CHEBYSHEV" };
      case "OBR_SCENE_GRID_GET_DISTANCE": return { distance: d.from && d.to ? Math.max(Math.abs(d.from.x - d.to.x), Math.abs(d.from.y - d.to.y)) / 150 : 0 };
      case "OBR_THEME_GET_THEME": return { theme: { mode: "DARK", primary: { main: "#bb99ff" }, secondary: {}, background: {}, text: {} } };
      case "OBR_NOTIFICATION_SHOW": S.notifications.push({ message: d.message, variant: d.variant }); return { id: `n${S.notifications.length}` };
      case "OBR_BROADCAST_SEND_MESSAGE": {
        S.broadcasts.push(clone(d));
        // LOCAL and ALL reach this browser's pages (the background shows roll notifications); REMOTE doesn't.
        if (d.options?.destination !== "REMOTE") emit(`OBR_BROADCAST_MESSAGE_${d.channel}`, { data: d.data, connectionId: S.connectionId });
        return {};
      }
      case "OBR_CONTEXT_MENU_CREATE": S.menus.push(clone(d)); return {};
      case "OBR_POPOVER_OPEN": S.popovers.push(clone(d)); return {};
      case "OBR_ACTION_GET_IS_OPEN": return { isOpen: true };
      case "OBR_ACTION_GET_WIDTH": return { width: 440 };
      case "OBR_ACTION_GET_HEIGHT": return { height: 760 };
      default:
        if (!/SUBSCRIBE|CLOSE|SET_|REMOVE|ANIMATE/.test(id)) S.unknown.push(id);
        return {};
    }
  }

  window.addEventListener("message", (e) => {
    const m = e.data;
    if (!m || typeof m.id !== "string" || typeof m.ref !== "string" || e.origin !== origin) return;
    try {
      const data = handle(m.id, m.data ?? {}, e.source);
      if (m.nonce) send(e.source, `${m.id}_RESPONSE${m.nonce}`, data);
    } catch (err) {
      if (m.nonce) send(e.source, `${m.id}_ERROR${m.nonce}`, { name: "Error", message: String(err) });
    }
  });

  /** Loads an extension page (path relative to the extension base, e.g. "card.html?id=w1") in a new iframe. */
  window.openPage = (path, { width = 440, height = 760, name = path } = {}) => new Promise((resolve) => {
    const f = document.createElement("iframe");
    const ref = btoa(`${origin} smoke-room`);
    f.src = `${path}${path.includes("?") ? "&" : "?"}obrref=${encodeURIComponent(ref)}`;
    f.name = name;
    f.style.cssText = `width:${width}px;height:${height}px;border:1px solid #888;margin:4px`;
    f.onload = () => { send(f.contentWindow, "OBR_READY", { ref: `ref-${S.frames.length}`, userId: S.id }); resolve(true); };
    S.frames.push(f);
    document.body.append(f);
  });
})();
