# Using Encounter Butler

[← Back to the overview](../README.md) · [Install](../README.md#install-in-owlbear-rodeo) · [Development guide](DEVELOPMENT.md)

This guide covers version 2.0. See the [changelog](../CHANGELOG.md) for what changed and the [roadmap](ROADMAP.md) for how each part was checked.

## Your first encounter

Open a scene as GM, add a few creatures in **Add Creatures**, then add your party in **Add Party**. Use **Tracker** to roll initiative and start combat. Click a unit's name to open its card and roll an attack.

## Add creatures

1. Open a scene, then open Encounter Butler → **Add Creatures**.
2. **Import published creature:** type a name (*goblin*, *young red dragon*…). Results from 2024 books are marked. Pick a creature to put it on the list; pick it again for one more.
   **Filters** narrows the results by **CR** (from–to), **type**, **environment**, **size** and **spellcaster**. With filters set and no name typed, you get every match, lowest CR first. Environments marked ≈ were assigned by Encounter Butler because 5etools gives none for that creature. Your filters are remembered in this browser.
3. **Import homebrewed creature:**
   - **Stat block (JSON):** upload or paste a 5etools-format stat block, or *start from a published creature*: its stat block is loaded into the box so you can edit anything. **Quick stats** is a short form for simple NPCs.
   - **Name** replaces the stat block's name (or gives one if the JSON has none).
   - **Token:** upload or choose an image in Owlbear's library, use an https image link, the original creature's 5etools token, or the placeholder.
   - Click **Put on the list**.
4. In the list, set how many of each (type a number or use **− / +**), and tick **roll HP** or **hidden** if you want. Click **Add … to the scene**. They appear in the middle of your view, already in the initiative order, each with rolled initiative. **Undo** removes them again.

**Your collection** keeps creatures you made or adjusted, in this browser:

- Save one with **Save to collection** (next to *Put on the list* in the homebrew form), from a unit's card (**Edit unit → Save to collection**) or from its right-click menu (several tokens at once).
- Search by name, type or tag, and click tags to narrow the list. **+ List** puts a creature on the list above, to add it as usual. **Edit** changes its name, tags, AC, HP and CR, or anything else in **Full stat block (JSON)**; write rolls as `[1d20+4]` to make them clickable. **New** starts a blank one.
- It lives in this browser only: **Export file** saves a backup (or moves it to another computer with **Import file**). Tokens already in a scene keep their own copy when you edit the collection.

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

- **Difficulty calculator:** compares the hostile creatures in the scene with your party. In a 5.5E room it uses the 2024 Dungeon Master's Guide XP budgets: **Low**, **Moderate** and **High** follow the book, and **Extreme** is an extra tier for boss fights, at 1.5× the High budget. In a 5E room it uses the 2014 thresholds (**Easy**, **Medium**, **Hard**, **Deadly**) and multiplies the creatures' XP for their number, as the 2014 book does. Untick a creature that isn't hostile, or a character who isn't in this fight; enter a level for party members without a sheet. The calculator updates as tokens come and go.
- **Initiatives:** **Roll all initiatives** rolls for every unit in the initiative order. **Roll just creatures' initiatives** leaves the party alone, so players can roll their own. Advantage (e.g. from Alert or a monster trait) is applied.

## Run combat in Tracker



1. **Surprise?** Before rolling, click **Surprise?** under any unit that's caught off guard (or right-click tokens → **Surprised**). In 5.5E they roll initiative with disadvantage. In 5E they get *Surprised* until the end of their first turn (no move, action or reaction).
2. Choose **Roll all** or **Roll creatures**, or type a player's roll into their initiative box.
3. Press **Start combat**. Use **Next turn** and **Prev** to move through the order; the round advances when the order wraps.
4. Apply HP changes in a unit's HP box and press **Enter**:

   | Input | Effect |
   |---|---|
   | `-7` | Deal 7 damage; temporary HP absorbs damage first. |
   | `+5` | Heal 5, up to maximum HP. |
   | `12` | Set current HP to 12. |
   | `t5` | Grant 5 temporary HP; keeps the higher amount rather than stacking. |

   Typed `-70` instead of `-7`? **↶** next to the HP box undoes the last change, including what it set off: death saves, lost Concentration, or an automatic Mark as dead. Each unit keeps its last five changes; **Recent HP changes** under the order lists them. Undo also works on the unit card, and players can undo changes to their own units.

5. A party member at 0 HP uses death saves. Use their card to record saves or make them Stable. **Mark as dead** removes a unit from initiative; **Revive** is available under **Not in initiative**.
6. **End combat** stops the encounter. **Reset round & initiative** clears rolls and round while keeping the units in the encounter.

**World turns:** for anything that should happen at a point in the order but isn't a creature (lair actions you run yourself, a collapsing ceiling, a storm, rising water, reinforcements), press **+ World turn**. It adds a *Lair / world actions* slot on initiative 20, losing ties. In its row you can rename it, change its initiative, and add a reminder note (*DC 13 Dex save under the cracks*). When its turn comes, **Next turn** stops there and you get a notice with the name and note. Encounter Butler doesn't resolve anything for you. Add as many as you need. World turns belong to the scene, so they stay through **End combat** and **Reset** until you remove them with **✕**. Players don't see them unless you click **🙈** to show one (**👁**).

**Hidden creatures:** a token hidden from players shows **Reveal on its turn?** in the tracker. Turn it on and the token appears to the players when its turn starts; **Reveal now** shows it straight away.

The active unit gets a map highlight. Controllers receive turn notices, and the player view shows whose turn it is and who is next. A player can **End my turn** when the GM allows player edits.

## Recharge, legendary actions and daily uses

Encounter Butler reads limited uses from the stat block's wording, so 5etools creatures, homebrew and D&D Beyond characters all work:

- **Recharge** (*Fire Breath (Recharge 5–6)*): the card shows **Ready**. Rolling any dice from that ability marks it **Used**. At the start of the creature's turn Encounter Butler rolls the d6 for you (a private GM roll in the log) and sets it back to Ready on a 5 or 6. **🎲 d6** rolls it by hand.
- **X/Day** (*Legendary Resistance (3/Day)*, *Dominate Mind (2/Day)*, spells *1/Day Each: …* or *3/Day: …*): pips next to the name. Click a filled pip to spend one, an empty pip to get it back. *Each* lists get a counter per spell.
- **Legendary actions:** the header shows the pool (*3/3*). **Use** on each action spends its cost (*Costs 2 Actions* spends two) and is greyed out when there aren't enough left. The pool refills at the start of the creature's turn.
- *Recharges after a Short or Long Rest* and *N/Long Rest* abilities have the same Ready/Used switch.
- **Reset uses** (GM, on the card) gives everything back: a new day or a rest.

The tracker lists each creature's uses under its name (*Fire Breath ✗ · Legendary Resistance 2/3 · Legendary actions 1/3*). The card is where you spend them. A player's own unit works the same way, through the GM's client.

**Lairs:** creatures with lair actions (from the 2014 books) show **In its lair?** in the tracker and on their card. Turn it on and the order gets a **Lair actions** turn on initiative 20, losing ties. **Next turn** stops there, and the card's *Lair Actions* section lists the options. In 5.5E, where lair actions became extra uses, the same switch raises the in-lair counts: *Legendary Action Uses: 3 (4 in Lair)* and *Legendary Resistance (3/Day, or 4/Day in Lair)*.

## Conditions, concentration and movement

- **Add a condition** from a unit's card (**Conditions → Add condition**), or right-click one or more selected tokens → **Conditions** to apply the same one to all of them. Pick a standard condition, **Exhaustion** (with a level) or **Custom effect…** (your own name, e.g. *Hexed*), an optional note and an optional duration:
  - **1 round**, **1 minute (10 rounds)** or **N rounds**: ends when the order comes back round to the turn it was added on.
  - **Until the start of *X*'s turn**, or **until the end of *X*'s next turn**.

  Durations need combat to be running. When one ends, the GM gets a notice ("Poisoned ended on Wolf 2"). Conditions show on the card, in the tracker and as a small badge under the token; remove one with its **✕** on the card. In 5.5E, Exhaustion takes 2 off every d20 roll made from the card and 5 ft off speed per level.
- **Concentration:** when a unit with the Concentration condition takes damage, its card shows a **Concentration check** with the DC. **Roll Con save** rolls it and keeps or ends Concentration; the GM can also **Dismiss** it. A player rolls it from their own card. Dropping to 0 HP ends Concentration.
- **Movement:** during a unit's turn, its token shows how far it has moved since the turn started against its speed, e.g. **25/40 ft**. It turns red past the limit. **Dash** doubles the limit for the turn. **Rewind** moves the token back to the last 5 ft point of its path (from 13 ft back to 10; pressing again goes back another 5 ft). The GM has these on the active row in **Tracker**, and the unit's player has them under the turn in their Encounter Butler panel.

## Wild Shape (druids)

Wild Shape follows the **5.5E (2024)** rules, the room's default. (A room set to 5E (2014) in **Combat → Game system** uses the 2014 version instead, described at the end.)

A druid synced from D&D Beyond gets Wild Shape automatically. Encounter Butler reads the druid level and Circle of the Moon from the class line (also in a multiclass) and follows level-ups. For any other party member, the GM right-clicks the token → **Set up Wild Shape** and enters the druid level and circle.

Open it from the token's right-click menu (**Wild Shape**) or the **🐾 Wild Shape** button on the unit card. The druid's player can use it on their own druid; the GM can use it on any.

- **Known Forms:** search the 5etools bestiary. The list only shows Beasts up to your max CR: 1/4 at druid level 2, 1/2 at 4, 1 at 8. Circle of the Moon from level 3 uses druid level ÷ 3. Flying speeds are checked when you add a beast (allowed from level 8). You know 4, 6 or 8 forms (levels 2, 4 and 8). By the rules you swap one for another eligible beast when you finish a Long Rest; remove it with **✕** and add the new one.
- **Transform:**
  - The token takes the beast's picture and size.
  - The card shows the beast's stat block. You keep your creature type, hit points, Intelligence, Wisdom and Charisma, class features, languages and feats, and your skill and save proficiencies (the higher bonus wins).
  - You gain temporary HP equal to your druid level, or 3 × druid level for the Circle of the Moon.
  - Moon druids also get AC of at least 13 + Wisdom and can cast their Circle Spells in beast form. From level 6 (Improved Circle Forms) their Wisdom modifier is added to Constitution saves.
  - Anyone else can't cast spells in beast form.
- **Reverting:** you return to your normal form when you drop to 0 HP, when you get Incapacitated (or Paralyzed, Petrified, Stunned, Unconscious), when you're marked dead, or with **Revert** (a bonus action).
  - Picking another Known Form while transformed is a new use of Wild Shape, with fresh temp HP.
- **Uses aren't counted.** Keep track of your Wild Shape uses on your character sheet (D&D Beyond tracks them for synced characters).

**5E (2014) rooms:** any beast you have seen (no limit on Known Shapes). Swimming speeds are allowed from level 4. Circle of the Moon gets CR 1 from level 2. The form has the beast's hit points: at 0 you revert and leftover damage carries over to your own HP.

## Give players their cards

On a unit card, the GM opens **Edit unit** and sets **Controlled by** (or picks the player in the **Party** list at the top of **Add Party**). That player then finds the unit under **My units**, opens its card and rolls from it. Players do not install another extension.

What a player sees under the Encounter Butler button:

- **Whose turn it is** and who's next, with **End my turn** on their own turn and the movement bar.
- **Initiative:** every unit they can see, by name (or the alias you gave it), picture and conditions. Hidden tokens never appear. Their own units also show HP, an HP box (`-7`, `+5`, `12`, `t5`) and their initiative box. Clicking another unit's name shows only its name, picture and conditions.
- **My units:** each with **Card** (roll, conditions, death saves, Concentration saves) and, for a character, **⟳ D&D Beyond**: it opens their character on D&D Beyond; they click the same *Copy party for Encounter Butler* bookmark there (set it up once from the panel), and your Encounter Butler updates that unit's stat block. HP is kept unless they choose to take it from D&D Beyond.

Player changes go through your Encounter Butler, so it must be open in the room. To stop players changing their units, untick **Players may change their own units…** in **Combat → Room settings**. Rolls, the movement tracker and cards still work.

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

- Square grids only.
- Active spell effects (Mage Armor, Shield) aren't applied to party AC, and multiclass spell slots aren't combined.
- Lair actions are noted on the card but not listed as actions. Mythic actions are listed with the legendary actions.
