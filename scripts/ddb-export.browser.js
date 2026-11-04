/**
 * D&D Beyond party export — runs INSIDE a logged-in dndbeyond.com tab (Claude runs it via the Chrome
 * extension; you can also paste it into the browser console). D&D Beyond has no public API: this uses the
 * same endpoints the character sheet uses, with your own session. The token never leaves the page.
 *
 * Usage (as an expression): await ddbExport(7909498)          // campaign id from the campaign URL
 *   → downloads ddb-party-<campaign>.json (characters + equipped party-inventory items)
 * Then:  npm run party:build -- party/ddb-party-<campaign>.json
 */
async function ddbExport(campaignId, { download = true } = {}) {
  const html = await fetch(`/campaigns/${campaignId}`, { credentials: "include" }).then((r) => r.text());
  const doc = new DOMParser().parseFromString(html, "text/html");
  const campaignName = doc.querySelector(".page-title, h1")?.textContent?.trim() || `campaign-${campaignId}`;
  const ids = [...new Set([...doc.querySelectorAll(".ddb-campaigns-character-card a[href*='/characters/']")]
    .map((a) => a.getAttribute("href").match(/characters\/(\d+)/)?.[1]).filter(Boolean))];
  if (!ids.length) throw new Error("No characters found on the campaign page (are you its DM?)");

  const tok = (await (await fetch("https://auth-service.dndbeyond.com/v1/cobalt-token", { method: "POST", credentials: "include" })).json()).token;
  const get = async (u) => {
    const r = await fetch(u, { headers: { Authorization: `Bearer ${tok}` } });
    if (!r.ok) throw new Error(`${u}: HTTP ${r.status}`);
    const j = await r.json();
    return j.data ?? j;
  };
  const characters = [];
  for (const id of ids) characters.push(await get(`https://character-service.dndbeyond.com/character/v5/character/${id}?includeCustomItems=true`));

  // Only equipped shared items matter for stats; keep the file small.
  const party = await get(`https://character-service.dndbeyond.com/character/v5/party/inventory/${campaignId}`).catch(() => null);
  const equipped = (party?.partyItems ?? []).filter((i) => i.equipped);
  const defIds = new Set(equipped.map((i) => i.definition?.id));
  const partyInventory = party ? { partyItems: equipped, modifiers: { item: (party.modifiers?.item ?? []).filter((m) => defIds.has(m.componentId)) } } : null;

  const bundle = { schema: "owlbear-butler/ddb-export@1", campaign: { id: campaignId, name: campaignName }, fetchedAt: new Date().toISOString(), characters, partyInventory };
  const slug = campaignName.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (download) {
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([JSON.stringify(bundle)], { type: "application/json" })), download: `ddb-party-${slug}.json` });
    document.body.append(a); a.click(); a.remove();
  }
  return { file: `ddb-party-${slug}.json`, campaign: campaignName, characters: characters.map((c) => c.name), partyItemsEquipped: equipped.length };
}
