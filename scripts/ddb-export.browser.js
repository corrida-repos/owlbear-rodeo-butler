/**
 * D&D Beyond party export — runs INSIDE a logged-in dndbeyond.com tab (bookmarklet "Copy party for
 * Encounter Butler", or the browser console, or Claude via the Chrome extension).
 * D&D Beyond has no public API: this calls the same endpoints the character sheet uses, with your own
 * session. The token never leaves the page; the result goes to YOUR clipboard (or a download).
 *
 *   await ddbExport()                        // on a /campaigns/<id> page: id detected from the URL
 *   await ddbExport(7909498, { mode: "download" })
 */
async function ddbExport(campaignId, { mode = "clipboard" } = {}) {
  const toast = (msg, ok = true) => {
    const el = Object.assign(document.createElement("div"), { textContent: msg });
    Object.assign(el.style, { position: "fixed", zIndex: 99999, top: "16px", right: "16px", maxWidth: "380px", padding: "12px 16px", borderRadius: "8px",
      font: "14px system-ui, sans-serif", color: "#fff", background: ok ? "#4b47b8" : "#b83a3a", boxShadow: "0 4px 16px rgba(0,0,0,.4)" });
    document.body.append(el);
    setTimeout(() => el.remove(), 8000);
  };
  try {
    campaignId = campaignId ?? Number((location.pathname.match(/\/campaigns\/(\d+)/) ?? [])[1]);
    if (!campaignId) throw new Error("Open your campaign page on D&D Beyond first (dndbeyond.com/campaigns/…).");
    toast("Encounter Butler: reading your party from D&D Beyond…");
    const html = await fetch(`/campaigns/${campaignId}`, { credentials: "include" }).then((r) => r.text());
    const doc = new DOMParser().parseFromString(html, "text/html");
    const campaignName = (doc.querySelector(".page-title, h1")?.textContent ?? "").trim() || `campaign-${campaignId}`;
    const ids = [...new Set([...doc.querySelectorAll(".ddb-campaigns-character-card a[href*='/characters/']")]
      .map((a) => (a.getAttribute("href").match(/characters\/(\d+)/) ?? [])[1]).filter(Boolean))];
    if (!ids.length) throw new Error("No characters found on this campaign page (are you its DM?).");

    const tok = (await (await fetch("https://auth-service.dndbeyond.com/v1/cobalt-token", { method: "POST", credentials: "include" })).json()).token;
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
    let copied = false;
    if (mode === "clipboard") {
      try { window.focus(); await navigator.clipboard.writeText(json); copied = true; } catch { /* fall back to download */ }
    }
    if (!copied) {
      const slug = campaignName.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([json], { type: "application/json" })), download: `ddb-party-${slug}.json` });
      document.body.append(a); a.click(); a.remove();
    }
    toast(copied ? `Party copied (${names}). In Owlbear: Encounter Butler → Party → Paste party.` : `Party saved as a file (${names}). In Owlbear: Encounter Butler → Party → Choose file.`);
    return { campaign: campaignName, characters: characters.map((c) => c.name), copied, bytes: json.length };
  } catch (e) {
    toast(`Encounter Butler: ${e instanceof Error ? e.message : e}`, false);
    throw e;
  }
}
