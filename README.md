# Encounter Butler for Owlbear Rodeo

An [Owlbear Rodeo](https://www.owlbear.rodeo) extension for Dungeon Masters who run D&D 5e with **D&D Beyond** character sheets and the **Forge!** battle system.

- **Monsters:** search any creature from 5etools (2014 and 2024 books), or add your own, and drop them on the map. Each one has its own HP, rolled initiative, a full Forge stat block with clickable dice, and a place in the initiative tracker.
- **Party:** copy your whole party from your D&D Beyond campaign in one click. HP, AC, saves, skills, attacks and spells are written onto your players' tokens, and their D&D Beyond portraits can be used too.
- **Prepared encounter:** import a ready-made scene (map, grid, positioned monsters) in one go.

It's free: no account, server or subscription beyond the free Owlbear Rodeo and D&D Beyond accounts you already have.

**Latest release:** see [Releases](https://github.com/corrida-repos/owlbear-rodeo-butler/releases). The extension updates on its own, so there's nothing to download or reinstall.

---

## What you need

- A free **Owlbear Rodeo** account. You must be the GM of the room.
- The **Forge!** extension, on its default D&D 5E system.
- A desktop browser (Chrome, Edge, Firefox or Safari) with the bookmarks bar visible. This is only needed for the Party sync.
- For the Party sync: you must be the **DM of the campaign on D&D Beyond**, with your players' characters joined to it.

Your players don't need to install anything. Extensions you turn on in a room work for everyone in it.

## Install (about 2 minutes, once)

1. **Add Forge!** Open the [Owlbear Rodeo extension store](https://extensions.owlbear.rodeo), find **Forge!**, and add it to your account.
2. **Add Encounter Butler.** On the Owlbear Rodeo home page, click your **profile** (top right) → **Extensions** → **Add Custom Extension**, paste this link, and confirm:

   ```
   https://corrida-repos.github.io/owlbear-rodeo-butler/manifest.json
   ```

3. **Turn both on in your room.** Open your room, click the **Extensions** button (the puzzle piece), and enable **Forge!** and **Encounter Butler**.
4. **Check Forge's system.** In Forge, choose **System → Load Default System**, unless it already shows *Dungeons & Dragons 5E*.

The **Encounter Butler** icon now appears in the room's toolbar at the top left. Click it to open the extension.

## Use it

### Monsters
1. Open a scene, then open Encounter Butler → **Monsters**.
2. Type a name (*goblin*, *young red dragon*…). Results from 2024 books are marked. Tap a creature to add it and set how many you want.
3. HP is the stat block's average; tick **roll HP** on a row to roll it instead. Click **Add creatures to the scene**. The creatures appear in the middle of your view, already in the Forge tracker with rolled initiative. **Undo** removes them again.
4. **+ Custom creature** handles homebrew. Paste a 5etools stat block, or type quick stats, and pick art from your Owlbear library, an https image link, or the placeholder.

Right-click any token → **View …** to open its Forge unit card, with clickable attack and damage dice.

### Party (from D&D Beyond)
**Once:** open Encounter Butler → **Party** and drag the **⭳ Copy party for Encounter Butler** button to your browser's bookmarks bar.

**Every session (or whenever your players level up):**
1. In another tab, go to [dndbeyond.com](https://www.dndbeyond.com) → **Campaigns** → your campaign page.
2. Click the **Copy party for Encounter Butler** bookmark. A purple notice confirms when the party has been copied.
3. Back in Owlbear, press **Paste party**. Allow clipboard access if your browser asks. If pasting doesn't work, a box appears where you can paste with Ctrl+V / ⌘V.
4. Review the preview, then click **Sync party**.

Tokens are matched to characters by name. Name each player's token after their character's full or first name. Missing tokens can be created for you. The sync only writes Forge stats: it leaves token positions and owners alone, and it changes images only if you choose to use the D&D Beyond portraits. You can also roll initiative for anyone who doesn't have one yet.

### Prepared encounter
Paste the link to an `encounter.json` package and click **Load URL**. Check the preview, then click **Import … creatures + map**. The bundled **wolves test** shows what this does. To make your own packages, see the [developer guide](docs/DEVELOPMENT.md#new-encounter-workflow).

## Privacy
- Your D&D Beyond login never leaves the D&D Beyond tab. The bookmark reads your campaign there, using your own session, and copies the result only to **your** clipboard. Nothing is sent to or stored on any server run by this project.
- Portraits are fetched through the free [wsrv.nl](https://wsrv.nl) image proxy, because D&D Beyond blocks its images from being shown on other sites.
- Monster data and token art load from the public 5etools data on GitHub.

## Troubleshooting

| Problem | Fix |
|---|---|
| "Unable to load extension" | Check the link: it must end in `/manifest.json`. Remove the extension and add it again. |
| Icon missing in the room | Enable Encounter Butler in the room's **Extensions** list. Custom extensions are per room. |
| "Forge has a custom system" | In Forge, choose **System → Load Default System**. |
| "You are not the GM" | Only the room's GM can add monsters or sync the party. |
| Bookmark says "No characters found" | Open the campaign page itself (`dndbeyond.com/campaigns/<number>`), and make sure you are its DM. |
| Paste does nothing | Allow clipboard access for owlbear.rodeo, or paste into the box that appears. |
| Party token not updated | Rename the token to the character's name, or let the sync create one. |

Found a bug or have an idea? [Open an issue](https://github.com/corrida-repos/owlbear-rodeo-butler/issues).

## Known limits
- Square grids only.
- Active spell effects (Mage Armor, Shield) aren't applied to party AC, and multiclass spell slots aren't combined.
- Lair and mythic actions are noted on the card but not turned into Forge actions.

---

Encounter Butler is an unofficial fan project. It isn't affiliated with or endorsed by Owlbear Rodeo, Battle-System (Forge!), D&D Beyond or Wizards of the Coast.

**Developers:** architecture, build scripts and test notes are in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).
