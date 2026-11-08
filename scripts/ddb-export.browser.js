/**
 * D&D Beyond party export — runs INSIDE a logged-in dndbeyond.com tab (bookmarklet "Copy party for
 * Encounter Butler", or the browser console, or Claude via the Chrome extension).
 * D&D Beyond has no public API: this calls the same endpoints the character sheet uses, with your own
 * session. The token never leaves the page; the result goes to YOUR clipboard (or a download).
 *
 *   await ddbExport()                        // on a /campaigns/<id> page: id detected from the URL
 *   await ddbExport(7909498, { mode: "download" })
 *   await ddbExport()                        // on a /characters/<id> page: just that character (a player's own sync)
 *
 * When Encounter Butler opened this tab ("Sync from D&D Beyond"), the party is posted straight back to it
 * (only to `targetOrigin`, the extension's own origin) and no clipboard is needed.
 */
async function ddbExport(campaignId, { mode = "clipboard", targetOrigin } = {}) {
  const toast = (msg, ok = true) => {
    const el = Object.assign(document.createElement("div"), { textContent: msg });
    Object.assign(el.style, { position: "fixed", zIndex: 99999, top: "16px", right: "16px", maxWidth: "380px", padding: "12px 16px", borderRadius: "8px",
      font: "14px system-ui, sans-serif", color: "#fff", background: ok ? "#4b47b8" : "#b83a3a", boxShadow: "0 4px 16px rgba(0,0,0,.4)" });
    document.body.append(el);
    setTimeout(() => el.remove(), 8000);
  };
  try {
    const tokenFor = async () => (await (await fetch("https://auth-service.dndbeyond.com/v1/cobalt-token", { method: "POST", credentials: "include" })).json()).token;
    const characterId = campaignId ? null : Number((location.pathname.match(/\/characters\/(\d+)/) ?? [])[1]);
    if (characterId) {
      // A player's own character page: export just this character (the player's Encounter Butler panel opened it).
      toast("Encounter Butler: reading your character from D&D Beyond…");
      const tok = await tokenFor();
      const get = async (u) => { const r = await fetch(u, { headers: { Authorization: `Bearer ${tok}` } }); if (!r.ok) throw new Error(`${u.split("?")[0]}: HTTP ${r.status}`); const j = await r.json(); return j.data ?? j; };
      const character = await get(`https://character-service.dndbeyond.com/character/v5/character/${characterId}?includeCustomItems=true`);
      const camp = character.campaign && character.campaign.id ? { id: character.campaign.id, name: character.campaign.name || "" } : { name: character.name };
      const party = camp.id ? await get(`https://character-service.dndbeyond.com/character/v5/party/inventory/${camp.id}`).catch(() => null) : null;
      const equipped = (party?.partyItems ?? []).filter((i) => i.equipped);
      const defIds = new Set(equipped.map((i) => i.definition && i.definition.id));
      const partyInventory = party ? { partyItems: equipped, modifiers: { item: ((party.modifiers && party.modifiers.item) || []).filter((m) => defIds.has(m.componentId)) } } : null;
      const bundle = { schema: "owlbear-butler/ddb-export@1", single: true, campaign: camp, fetchedAt: new Date().toISOString(), characters: [character], partyInventory };
      if (mode === "return") return bundle;
      if (targetOrigin && window.opener && !window.opener.closed) {
        window.opener.postMessage({ type: "encounter-butler/ddb-export", bundle }, targetOrigin);
        toast(`${character.name} sent to Encounter Butler. This tab closes in a moment.`);
        setTimeout(() => window.close(), 3000);
        return { character: character.name, sent: true };
      }
      throw new Error("Open this tab from Encounter Butler (your unit's D&D Beyond button), then click the bookmark.");
    }
    campaignId = campaignId ?? Number((location.pathname.match(/\/campaigns\/(\d+)/) ?? [])[1]);
    if (!campaignId) throw new Error("Open your campaign page (or your character's page) on D&D Beyond first.");
    toast("Encounter Butler: reading your party from D&D Beyond…");
    const html = await fetch(`/campaigns/${campaignId}`, { credentials: "include" }).then((r) => r.text());
    const doc = new DOMParser().parseFromString(html, "text/html");
    const campaignName = (doc.querySelector(".page-title, h1")?.textContent ?? "").trim() || `campaign-${campaignId}`;
    const ids = [...new Set([...doc.querySelectorAll(".ddb-campaigns-character-card a[href*='/characters/']")]
      .map((a) => (a.getAttribute("href").match(/characters\/(\d+)/) ?? [])[1]).filter(Boolean))];
    if (!ids.length) throw new Error("No characters found on this campaign page (are you its DM?).");

    const tok = await tokenFor();
    const get = async (u) => {
      const r = await fetch(u, { headers: { Authorization: `Bearer ${tok}` } });
      if (!r.ok) throw new Error(`${u.split("?")[0]}: HTTP ${r.status}`);
      const j = await r.json();
      return j.data ?? j;
    };
    const characters = [];
    for (const id of ids) characters.push(await get(`https://character-service.dndbeyond.com/character/v5/character/${id}?includeCustomItems=true`));
    // Only equipped shared items affect stats; keep the payload small.
    const party = await get(`https://character-service.dndbeyond.com/character/v5/party/inventory/${campaignId}`).catch(() => null);
    const equipped = (party?.partyItems ?? []).filter((i) => i.equipped);
    const defIds = new Set(equipped.map((i) => i.definition && i.definition.id));
    const partyInventory = party ? { partyItems: equipped, modifiers: { item: ((party.modifiers && party.modifiers.item) || []).filter((m) => defIds.has(m.componentId)) } } : null;

    const bundle = { schema: "owlbear-butler/ddb-export@1", campaign: { id: campaignId, name: campaignName }, fetchedAt: new Date().toISOString(), characters, partyInventory };
    const json = JSON.stringify(bundle);
    const names = characters.map((c) => c.name).join(", ");
    if (mode === "return") return bundle;
    let sent = false;
    if (targetOrigin && window.opener && !window.opener.closed) {
      // The browser only delivers this if the opener really is Encounter Butler; the clipboard copy below stays as a fallback.
      try { window.opener.postMessage({ type: "encounter-butler/ddb-export", bundle }, targetOrigin); sent = true; } catch { /* opener gone */ }
    }
    let copied = false;
    if (mode === "clipboard") {
      try { window.focus(); await navigator.clipboard.writeText(json); copied = true; } catch { /* fall back to download */ }
    }
    if (!copied && !sent) {
      const slug = campaignName.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([json], { type: "application/json" })), download: `ddb-party-${slug}.json` });
      document.body.append(a); a.click(); a.remove();
    }
    if (sent) {
      toast(`Party sent to Encounter Butler (${names}). This tab closes in a moment.`);
      setTimeout(() => window.close(), 3000);
      return { campaign: campaignName, characters: characters.map((c) => c.name), sent, copied, bytes: json.length };
    }
    toast(copied ? `Party copied (${names}). In Owlbear: Encounter Butler → Add Party Members → Paste party.` : `Party saved as a file (${names}). In Owlbear: Encounter Butler → Add Party Members → Choose file.`);
    return { campaign: campaignName, characters: characters.map((c) => c.name), copied, bytes: json.length };
  } catch (e) {
    toast(`Encounter Butler: ${e instanceof Error ? e.message : e}`, false);
    throw e;
  }
}
