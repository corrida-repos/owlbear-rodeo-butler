# Encounter Butler for Owlbear Rodeo

An [Owlbear Rodeo](https://www.owlbear.rodeo) extension for Dungeon Masters who run D&D 5.5e (2024) or 5e (2014), with or without **D&D Beyond** character sheets. It needs no other extension.

> **Version 2 is being built.** Encounter Butler no longer uses Forge!: creatures and party members keep their stat block on the token, and unit cards have clickable dice. The initiative tracker, HP and conditions are on the way (see the [roadmap](docs/ROADMAP.md)).

- **Add Creatures:** search any creature from 5etools (2014 and 2024 books), or bring your own stat block and token, choose how many, and drop them on the map. Each one has its own HP, rolled initiative, its full stat block stored on the token, and a place in the initiative order.
- **Add Party Members:** one button syncs your D&D Beyond campaign's character sheets onto your players' tokens as the party. Press it again whenever someone levels up. You can also add sidekicks and companions the same way as creatures.
- **Combat:** see whether the fight is Low, Moderate, High or Extreme for your party (2024 rules), and roll initiative for everyone or just the creatures.

It's free: no account, server or subscription beyond the free Owlbear Rodeo and D&D Beyond accounts you already have.

**Latest release:** see [Releases](https://github.com/corrida-repos/owlbear-rodeo-butler/releases). The extension updates on its own, so there's nothing to download or reinstall.

---

## What you need

- A free **Owlbear Rodeo** account. You must be the GM of the room.
- A desktop browser (Chrome, Edge, Firefox or Safari) with the bookmarks bar visible. This is only needed for the Party sync.
- For the Party sync: you must be the **DM of the campaign on D&D Beyond**, with your players' characters joined to it.

Your players don't need to install anything. Extensions you turn on in a room work for everyone in it.

## Install (about 2 minutes, once)

1. **Add Encounter Butler.** On the Owlbear Rodeo home page, click your **profile** (top right) → **Extensions** → **Add Custom Extension**, paste this link, and confirm:

   ```
   https://corrida-repos.github.io/owlbear-rodeo-butler/manifest.json
   ```

2. **Turn it on in your room.** Open your room, click the **Extensions** button (the puzzle piece), and enable **Encounter Butler**.
3. **Pick your rules (optional).** Encounter Butler → **Combat** → **Game system**: *D&D 5.5E (2024 rules)* is the default; choose *D&D 5E (2014 rules)* if your table plays those.

The **Encounter Butler** icon now appears in the room's toolbar at the top left. Click it to open the extension.

## Use it

### Add Creatures
1. Open a scene, then open Encounter Butler → **Add Creatures**.
2. **Import published creature:** type a name (*goblin*, *young red dragon*…). Results from 2024 books are marked. Pick a creature to put it on the list; pick it again for one more.
3. **Import homebrewed creature:**
   - **Stat block (JSON):** upload or paste a 5etools-format stat block, or *start from a published creature*: its stat block is loaded into the box so you can edit anything. **Quick stats** is a short form for simple NPCs.
   - **Name** replaces the stat block's name (or gives one if the JSON has none).
   - **Token:** upload or choose an image in Owlbear's library, use an https image link, the original creature's 5etools token, or the placeholder.
   - Click **Put on the list**.
4. In the list, set how many of each (type a number or use **− / +**), and tick **roll HP** or **hidden** if you want. Click **Add … to the scene**. They appear in the middle of your view, already in the initiative order, each with rolled initiative. **Undo** removes them again.

A **Prepared encounter** (map, grid and positioned creatures in one file) can still be imported from the collapsed section at the bottom of this tab. To make your own packages, see the [developer guide](docs/DEVELOPMENT.md#new-encounter-workflow).

Right-click a creature or party token → **View unit card** (or click a name in the Combat tab). The card shows the whole stat block, and every bonus and damage value is a button:
- **Click** to roll, **Shift-click** for advantage, **Ctrl-click** (Cmd on Mac) for disadvantage, or use the toggle at the top of the card.
- After an attack, roll its damage from the result box; after a natural 20, use **Crit** (damage dice doubled).
- **Public** rolls show to everyone as a notification. **Private** rolls show only to you (a player's private roll also shows to the GM). *Roll log* lists this session's rolls.
- **Edit unit** (GM): rename it, give it an alias players see until you reveal it, set a portrait, and choose which player controls it. That player then finds the unit under the Encounter Butler button and can open its card and roll.

### Add Party Members (from D&D Beyond)
**Once:** open Encounter Butler → **Add Party Members** → *First time: set up the bookmark*, and drag the **⭳ Copy party for Encounter Butler** button to your browser's bookmarks bar. If you set it up before version 1.1, drag it again.

**Every time a character sheet changes:**
1. Press **⟳ Sync from D&D Beyond**. Your campaign opens in a new tab (the first time, open the campaign you DM from the list).
2. Click the **Copy party for Encounter Butler** bookmark in that tab. It sends the party back to Owlbear and closes itself.
3. The party tokens are updated and marked as party members. If something needs a look first (two tokens that could match, an error), you see a preview and press **Sync party** yourself. **Undo** removes tokens the sync created and puts back pictures it replaced.

Tokens are matched to characters by name. Name each player's token after their character's full or first name. Missing tokens can be created for you. The sync only writes the stat block (and HP): it leaves token positions, owners and conditions alone, and it changes images only if you choose to use the D&D Beyond portraits (*Sync options*). If the tab didn't send the party back (some browsers block it), the bookmark also copies it to your clipboard: press **Paste party**.

Below the sync, **Import published / homebrewed party member** work exactly like Add Creatures, for sidekicks, companions or a guest character. They join the party.

### Combat
- **Difficulty calculator:** compares the hostile creatures in the scene with your party, using the 2024 Dungeon Master's Guide XP budgets. **Low**, **Moderate** and **High** follow the book. **Extreme** is an extra tier for boss fights, at 1.5× the High budget. Untick a creature that isn't hostile, or a character who isn't in this fight; enter a level for party members without a sheet. The calculator updates as tokens come and go.
- **Initiatives:** **Roll all initiatives** rolls for every unit in the initiative order. **Roll just creatures' initiatives** leaves the party alone, so players can roll their own. Advantage (e.g. from Alert or a monster trait) is applied.

## Privacy
- Your D&D Beyond login never leaves the D&D Beyond tab. The bookmark reads your campaign there, using your own session, and copies the result only to **your** clipboard. Nothing is sent to or stored on any server run by this project.
- Portraits are fetched through the free [wsrv.nl](https://wsrv.nl) image proxy, because D&D Beyond blocks its images from being shown on other sites.
- Monster data and token art load from the public 5etools data on GitHub.

## Troubleshooting

| Problem | Fix |
|---|---|
| "Unable to load extension" | Check the link: it must end in `/manifest.json`. Remove the extension and add it again. |
| Icon missing in the room | Enable Encounter Butler in the room's **Extensions** list. Custom extensions are per room. |
| "You are not the GM" | Only the room's GM can add creatures, sync the party or roll initiative. |
| Bookmark says "No characters found" | Open the campaign page itself (`dndbeyond.com/campaigns/<number>`), and make sure you are its DM. |
| Sync button opens D&D Beyond but nothing comes back | Drag the bookmark to your bar again (older bookmarks can't send the party back), or use **Paste party**. |
| Paste does nothing | Allow clipboard access for owlbear.rodeo, or paste into the box that appears. |
| Party token not updated | Rename the token to the character's name, or let the sync create one. |

Found a bug or have an idea? [Open an issue](https://github.com/corrida-repos/owlbear-rodeo-butler/issues).

## Known limits
- Square grids only.
- Active spell effects (Mage Armor, Shield) aren't applied to party AC, and multiclass spell slots aren't combined.
- Lair actions are noted on the card but not listed as actions. Mythic actions are listed with the legendary actions.

---

Encounter Butler is an unofficial fan project. It isn't affiliated with or endorsed by Owlbear Rodeo, D&D Beyond or Wizards of the Coast.

**Developers:** architecture, build scripts and test notes are in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).
