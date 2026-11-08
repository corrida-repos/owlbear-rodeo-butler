# Using Encounter Butler

[← Back to the overview](../README.md) · [Install](../README.md#install-in-owlbear-rodeo) · [Development guide](DEVELOPMENT.md)

This guide follows the developing 2.0 interface in `main`. The hosted release may differ; see the [changelog](../CHANGELOG.md) and [roadmap](ROADMAP.md) for version status.

## Your first encounter

Open a scene as GM, add a few creatures in **Add Creatures**, then add your party in **Add Party**. Use **Tracker** to roll initiative and start combat. Click a unit's name to open its card and roll an attack.

## Add creatures

1. Open a scene, then open Encounter Butler → **Add Creatures**.
2. **Import published creature:** type a name (*goblin*, *young red dragon*…). Results from 2024 books are marked. Pick a creature to put it on the list; pick it again for one more.
3. **Import homebrewed creature:**
   - **Stat block (JSON):** upload or paste a 5etools-format stat block, or *start from a published creature*: its stat block is loaded into the box so you can edit anything. **Quick stats** is a short form for simple NPCs.
   - **Name** replaces the stat block's name (or gives one if the JSON has none).
   - **Token:** upload or choose an image in Owlbear's library, use an https image link, the original creature's 5etools token, or the placeholder.
   - Click **Put on the list**.
4. In the list, set how many of each (type a number or use **− / +**), and tick **roll HP** or **hidden** if you want. Click **Add … to the scene**. They appear in the middle of your view, already in the initiative order, each with rolled initiative. **Undo** removes them again.

A **Prepared encounter** (map, grid and positioned creatures in one file) can still be imported from the collapsed section at the bottom of this tab. To make your own packages, see the [developer guide](DEVELOPMENT.md#new-encounter-workflow).

Right-click a creature or party token → **View unit card** (or click a name in Tracker or Combat). The card shows the whole stat block, and every bonus and damage value is a button:

- **Click** to roll, **Shift-click** for advantage, **Ctrl-click** (Cmd on Mac) for disadvantage, or use the toggle at the top of the card.
- After an attack, roll its damage from the result box; after a natural 20, use **Crit** (damage dice doubled).
- **Public** rolls show to everyone as a notification. **Private** rolls show only to you (a player's private roll also shows to the GM). *Roll log* lists this session's rolls.
- **Edit unit** (GM): rename it, give it an alias players see until you reveal it, set a portrait, and choose which player controls it. That player then finds the unit under the Encounter Butler button and can open its card and roll.

## Sync a D&D Beyond party

**Once:** open Encounter Butler → **Add Party** → *First time: set up the bookmark*, and drag the **⭳ Copy party for Encounter Butler** button to your browser's bookmarks bar. If you set it up before version 1.1, drag it again.

**Every time a character sheet changes:**

1. Press **⟳ Sync from D&D Beyond**. Your campaign opens in a new tab (the first time, open the campaign you DM from the list).
2. Click the **Copy party for Encounter Butler** bookmark in that tab. It sends the party back to Owlbear and closes itself.
3. The party tokens are updated and marked as party members. If something needs a look first (two tokens that could match, an error), you see a preview and press **Sync party** yourself. **Undo** removes tokens the sync created and puts back pictures it replaced.

Tokens are matched to characters by name. Name each player's token after their character's full or first name. Missing tokens can be created for you. The sync only writes the stat block (and HP): it leaves token positions, owners and conditions alone, and it changes images only if you choose to use the D&D Beyond portraits (*Sync options*). If the tab didn't send the party back (some browsers block it), the bookmark also copies it to your clipboard: press **Paste party**.

Below the sync, **Import published / homebrewed party member** work exactly like Add Creatures, for sidekicks, companions or a guest character. They join the party.

## Assess encounter difficulty

- **Difficulty calculator:** compares the hostile creatures in the scene with your party, using the 2024 Dungeon Master's Guide XP budgets. **Low**, **Moderate** and **High** follow the book. **Extreme** is an extra tier for boss fights, at 1.5× the High budget. Untick a creature that isn't hostile, or a character who isn't in this fight; enter a level for party members without a sheet. The calculator updates as tokens come and go.
- **Initiatives:** **Roll all initiatives** rolls for every unit in the initiative order. **Roll just creatures' initiatives** leaves the party alone, so players can roll their own. Advantage (e.g. from Alert or a monster trait) is applied.

## Run combat in Tracker

The combat core, conditions and the movement tracker are implemented in `main` (phases 3 and 4, live-checked); see the [roadmap](ROADMAP.md) for validation details and the remaining 2.0 work.

1. Choose **Roll all** or **Roll creatures**, or type a player's roll into their initiative box.
2. Press **Start combat**. Use **Next turn** and **Prev** to move through the order; the round advances when the order wraps.
3. Apply HP changes in a unit's HP box and press **Enter**:

   | Input | Effect |
   |---|---|
   | `-7` | Deal 7 damage; temporary HP absorbs damage first. |
   | `+5` | Heal 5, up to maximum HP. |
   | `12` | Set current HP to 12. |
   | `t5` | Grant 5 temporary HP; keeps the higher amount rather than stacking. |

4. A party member at 0 HP uses death saves. Use their card to record saves or make them Stable. **Mark as dead** removes a unit from initiative; **Revive** is available under **Not in initiative**.
5. **End combat** stops the encounter. **Reset round & initiative** clears rolls and round while keeping the units in the encounter.

The active unit gets a map highlight. Controllers receive turn notices, and the player view shows whose turn it is and who is next. A player can **End my turn** when the GM allows player edits. The full player-facing initiative list is still planned.

## Conditions, concentration and movement

- **Add a condition** from a unit's card (**Conditions → Add condition**), or right-click one or more selected tokens → **Conditions** to apply the same one to all of them. Pick a standard condition, **Exhaustion** (with a level) or **Custom effect…** (your own name, e.g. *Hexed*), an optional note and an optional duration:
  - **1 round**, **1 minute (10 rounds)** or **N rounds**: ends when the order comes back round to the turn it was added on.
  - **Until the start of *X*'s turn**, or **until the end of *X*'s next turn**.

  Durations need combat to be running. When one ends, the GM gets a notice ("Poisoned ended on Wolf 2"). Conditions show on the card, in the tracker and as a small badge under the token; remove one with its **✕** on the card. In 5.5E, Exhaustion takes 2 off every d20 roll made from the card and 5 ft off speed per level.
- **Concentration:** when a unit with the Concentration condition takes damage, its card shows a **Concentration check** with the DC. **Roll Con save** rolls it and keeps or ends Concentration; the GM can also **Dismiss** it. A player rolls it from their own card. Dropping to 0 HP ends Concentration.
- **Movement:** during a unit's turn, its token shows how far it has moved since the turn started against its speed, e.g. **25/40 ft**. It turns red past the limit. **Dash** doubles the limit for the turn. **Rewind** moves the token back to the last 5 ft point of its path (from 13 ft back to 10; pressing again goes back another 5 ft). The GM has these on the active row in **Tracker**, and the unit's player has them under the turn in their Encounter Butler panel.

## Give players their cards

On a unit card, the GM opens **Edit unit** and sets **Controlled by**. That player then finds the unit under **My units**, opens its card and rolls from it. Players do not install another extension.

Private player rolls are visible to that player **and the GM**. Private GM rolls stay with the GM. Card visibility is a presentation feature, not a security boundary: technically savvy players can read token metadata.

## Privacy

- Your D&D Beyond login never leaves the D&D Beyond tab. The bookmark reads your campaign using your own session, sends the character export back to the extension, and also copies it to **your** clipboard as a fallback. No application backend run by this project receives the export; synced unit data is stored in Owlbear token metadata.
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

- The 2014 rules setting is still being completed; see the [roadmap](ROADMAP.md#gamesystem-interface-what-differs-between-5e-and-55e).
- Square grids only.
- Active spell effects (Mage Armor, Shield) aren't applied to party AC, and multiclass spell slots aren't combined.
- Lair actions are noted on the card but not listed as actions. Mythic actions are listed with the legendary actions.
