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

Tokens are matched to characters by name. Name each player's token after their character's full or first name. Missing tokens can be created for you. The sync only writes the stat block (and HP): it leaves token positions, owners and conditions alone, and it changes images only if you choose to use the D&D Beyond portraits (*Sync options*). What comes over: the whole stat block with every description in full, the complete inventory (what's in each container, custom items, charges, rarity, attunement, notes), coins, proficiencies, hit dice, and the background, personality, appearance and notes (on the card, under *Background & notes*). The campaign's shared party inventory and coins show on each member's card, marked *in Party inventory*. If the tab didn't send the party back (some browsers block it), the bookmark also copies it to your clipboard: press **Paste party**.

Below the sync, **Import published / homebrewed party member** work exactly like Add Creatures, for sidekicks, companions or a guest character. They join the party.

## Assess encounter difficulty

- **Difficulty calculator:** compares the hostile creatures in the scene with your party. In a 5.5E room it uses the 2024 Dungeon Master's Guide XP budgets: **Low**, **Moderate** and **High** follow the book, and **Extreme** is an extra tier for boss fights, at 1.5× the High budget. In a 5E room it uses the 2014 thresholds (**Easy**, **Medium**, **Hard**, **Deadly**) and multiplies the creatures' XP for their number, as the 2014 book does. Untick a creature that isn't hostile, or a character who isn't in this fight; enter a level for party members without a sheet. The calculator updates as tokens come and go.
- **Initiatives:** **Roll all initiatives** rolls for every unit in the initiative order. **Roll just creatures' initiatives** leaves the party alone, so players can roll their own. Advantage (e.g. from Alert or a monster trait) is applied.

## Run combat in Tracker



1. Choose **Roll all** or **Roll creatures**, or type a player's roll into their initiative box.
2. Press **Start combat**. Use **Next turn** and **Prev** to move through the order; the round advances when the order wraps.
3. Apply HP changes in a unit's HP box and press **Enter**:

   | Input | Effect |
   |---|---|
   | `-7` | Deal 7 damage; temporary HP absorbs damage first. |
   | `+5` | Heal 5, up to maximum HP. |
   | `12` | Set current HP to 12. |
   | `t5` | Grant 5 temporary HP; keeps the higher amount rather than stacking. |

4. When a unit drops to 0 HP, its controller (the player, or the GM for creatures and for player units whose player isn't connected) gets a **0 HP** window: **Dead**, **Death saves**, **Stable** or **Alive** (back to 1 HP). Any unit can make death saves. Roll them from that window or the unit's card, or record a roll made at the table: type the d20, tick successes and failures, or click the dots to correct them. Three successes make it Stable, three failures kill it, and healing of any amount brings it back up at once. **Mark as dead** removes a unit from initiative; **Revive** is available under **Not in initiative**.
5. **Loot (GM):** a dead monster's or NPC's card shows a **💰 Loot** suggestion. It has the Gear from its 2024 stat block (or, without a Gear line, the armor its AC names and the weapons it attacks with), and money (every creature except beasts and the like). The money is in light coins: the bulk in the best coin there are a few of, plus a little change. A purse over 500 gp holds part of its value as gemstones from the 2024 DMG tables. Money, gems and magic items together never exceed the DMG's average hoard for the monster's CR. A theme roll only finds a magic item some of the time: 10% plus 4% per CR, so weak monsters seldom have one. A found item's rarity is lowered to fit, and its value shows when you hover it. The amount is sized to the party's economy at its level: a DMG hoard per session plus quest rewards, with monster purses a further 20% shared out by XP. The party's level is its members' average in the scene, or the monster's CR when there's no party. It also has buttons to roll a magic item from the theme its Treasure line names. For *Any*, you pick the theme. Each monster gets one roll per theme. **Post** (or **Post all**, optionally naming who took it) adds a line to everyone's roll log. Nothing goes into anyone's inventory. Hover a line to see how it was rolled.
6. **End combat** stops the encounter. **Reset round & initiative** clears rolls and round while keeping the units in the encounter.

The active unit gets a map highlight. Controllers receive turn notices, and the player view shows whose turn it is and who is next. A player can **End my turn** when the GM allows player edits.

## Your players at a glance (Players tab)

The **Players** tab (GM only) has a card for each party member in the scene: HP with a bar and temp HP, AC, initiative, passive Perception, Insight and Investigation, spell save DC (Speed for non-casters), saving throws (proficient ones highlighted), speeds and senses, resistances and immunities, conditions, and which player plays them. The top line gives the party's lowest passive Perception, Insight and Investigation, handy for secret checks. It updates as the scene changes. Click a name to open the full card. Only units marked as party members appear (see *Sync a D&D Beyond party*).

## Conditions, concentration and movement

- **Add a condition** from a unit's card (**Conditions → Add condition**), or right-click one or more selected tokens → **Conditions** to apply the same one to all of them. Pick a standard condition, **Exhaustion** (with a level) or **Custom effect…** (your own name, e.g. *Hexed*), an optional note and an optional duration:
  - **1 round**, **1 minute (10 rounds)** or **N rounds**: ends when the order comes back round to the turn it was added on.
  - **Until the start of *X*'s turn**, or **until the end of *X*'s next turn**.

  Durations need combat to be running. When one ends, the GM gets a notice ("Poisoned ended on Wolf 2"). Conditions show on the card, in the tracker and as a small badge under the token; remove one with its **✕** on the card. In 5.5E, Exhaustion takes 2 off every d20 roll made from the card or the action bar and 5 ft off speed per level.
- **Concentration:** when a unit with the Concentration condition takes damage, its card shows a **Concentration check** with the DC. **Roll Con save** rolls it and keeps or ends Concentration; the GM can also **Dismiss** it. A player rolls it from their own card. Dropping to 0 HP ends Concentration.
- **Movement:** during a unit's turn, its token shows how far it has moved since the turn started against its speed, e.g. **25/40 ft**. It turns red past the limit. **Dash** doubles the limit for the turn. **Rewind** moves the token back to the last 5 ft point of its path (from 13 ft back to 10; pressing again goes back another 5 ft). The GM has these on the active row in **Tracker**, and the unit's player has them under the turn in their Encounter Butler panel.

## Light and vision (dim and dark scenes)

Scenes are in **bright light** by default. For a night ambush or an unlit cave, open **Tracker → Light & vision** (at the bottom) and set the scene to **◐ Dim** or **● Dark**. Each scene keeps its own setting.

- **Vision HUD:** nothing is drawn on the map until you click **👁 Show Vision HUD** in that panel. It's a per-browser switch: each player turns their own on and off, in their Encounter Butler panel. Click it again to hide everything. While it's on you get:
  - **Darkness fog:** the map is covered with what your units can't see. It goes **black** where a square is heavily obscured, **hazy** where it's lightly obscured, and **clear** where they see normally. Their darkvision, blindsight, truesight and Devil's Sight cut through it, and so does every light carried by a unit you can see. A player who controls no units sees what the party sees, and a unit's own square always stays clear. The fog sits above tokens and their labels, so a goblin in the dark stays hidden, and below rulers. It follows the grid square by square, judged at each square's centre. The GM's fog is see-through and shows what the party sees.
  - **Vision circles** around units. Choose whose senses to draw with **Circles for**:
    - **Selected tokens:** click a creature to see what it sees.
    - **The whole party**, or **Everyone** (party and creatures at once).
    - **Choose units…:** a checklist of every party member and creature in the scene. Tick any you like; **All** / **None** set a whole group. You can also right-click one or more tokens → **Show / hide vision aura**, which picks them (or unpicks them, if they were all picked) and turns the HUD on.

    Your see-through fog follows the same choice: pick a goblin and the fog shows what that goblin sees, even if it's hidden; with nobody picked, it shows the party. Players can pick their own units and party members, never creatures, and their fog always comes from their own units.
    - **Yellow circles** are carried light: solid for bright light, dashed and paler for dim light. Lights are drawn for every unit you can see, because a torch lights the room for everyone. In a dim scene only the bright part is drawn (the rest of the room is already dim).
    - **Dashed outlines** are senses, labelled with their range: **green** darkvision, **pink** Devil's Sight, **purple** truesight, **blue** blindsight, **brown** tremorsense. Ranges count from the edge of the creature's space.
    - Reading it: in **darkness**, anything outside every light is **heavily obscured** (a creature looking there is effectively Blinded) unless one of its senses reaches; inside a creature's darkvision, darkness is only **lightly obscured** and dim light is clear. In **dim light**, everything outside bright light is **lightly obscured** (disadvantage on Wisdom (Perception) checks that rely on sight); inside darkvision it's clear. The panel has the same legend.
- **Hiding monsters from players:** a player's fog only shows while their HUD is on. To keep creatures in the dark hidden whatever the players choose, tick **Force the darkness fog on players in this scene**. It's off by default.
- **Light a torch:** on a unit's card, **Light & vision** has a light picker. Lights found on the sheet (a torch or lantern in the inventory, the *Light* or *Produce Flame* spell…) are listed first; any light from the Player's Handbook is available, or **Other light** with your own bright and dim radii. Pick **No light** to put it out. Players can light their own units' lights when player edits are allowed.
- **On the card:** in a dim or dark scene, the same panel says in words what the unit can see (its darkvision, blindsight and so on) and what light it carries.
- Players only see the senses of their own units and party members; a monster's darkvision stays the GM's business. Walls and magical darkness aren't drawn: judge those at the table. Senses come from the stat block's Senses line (and a Devil's Sight trait), so a creature without one has none.

## Wild Shape (druids)

Wild Shape follows the **5.5E (2024)** rules, the room's default. (A room set to 5E (2014) in **Combat → Game system** uses the 2014 version instead, described at the end.)

A druid synced from D&D Beyond gets Wild Shape automatically. Encounter Butler reads the druid level and Circle of the Moon from the class line (also in a multiclass) and follows level-ups. For any other party member, the GM right-clicks the token → **Set up Wild Shape** and enters the druid level and circle.

Open it from the token's right-click menu (**Wild Shape**) or the **🐾 Wild Shape** button on the unit card. The druid's player can use it on their own druid; the GM can use it on any.

- **Known Forms:** search the 5etools bestiary. The list only shows Beasts up to your max CR: 1/4 at druid level 2, 1/2 at 4, 1 at 8. Circle of the Moon from level 3 uses druid level ÷ 3. Flying speeds are checked when you add a beast (allowed from level 8). You know 4, 6 or 8 forms (levels 2, 4 and 8). By the rules you swap one for another eligible beast when you finish a Long Rest; remove it with **✕** and add the new one.
- **Transform** (a Wild Shape use, 2 / 3 / 4 at levels 2 / 6 / 17):
  - The token takes the beast's picture and size.
  - The card shows the beast's stat block. You keep your creature type, hit points, Intelligence, Wisdom and Charisma, class features, languages and feats, and your skill and save proficiencies (the higher bonus wins).
  - You gain temporary HP equal to your druid level, or 3 × druid level for the Circle of the Moon.
  - Moon druids also get AC of at least 13 + Wisdom and can cast their Circle Spells in beast form. From level 6 (Improved Circle Forms) their Wisdom modifier is added to Constitution saves.
  - Anyone else can't cast spells in beast form.
- **Reverting:** you return to your normal form when you drop to 0 HP, when you get Incapacitated (or Paralyzed, Petrified, Stunned, Unconscious), when you're marked dead, or with **Revert** (a bonus action).
  - Picking another Known Form while transformed is a new use of Wild Shape, with fresh temp HP.
- **Rests:** **Short Rest** gives one use back, **Long Rest** gives back all of them.

**5E (2014) rooms:** any beast you have seen (no limit on Known Shapes). Swimming speeds are allowed from level 4. Circle of the Moon gets CR 1 from level 2. The form has the beast's hit points: at 0 you revert and leftover damage carries over to your own HP. Uses come back on any rest.

## DM Tools (GM)

The **DM Tools** tab gathers the 2024 DMG's combat tools, mass combat from Unearthed Arcana, and naval and aerial combat.

- **Fight or flight.** For a creature outside a Life Manager handoff, pick a monster and click **Will they fight?** for the DC 10 Wisdom save before Initiative (a failure means it flees or parleys). During combat, when a Bloodied monster starts its turn Frightened, or having lost more than half its allies while nobody in the party is down, you get a notice and a prompt in the Tracker to roll its save.
- **Chase mode.** Choose **On foot or mounted** or **Vehicles**, then **Start chase**. Butler runs it on each turn change; rolls are private unless you tick *players see the chase rolls*.
  - **On foot or mounted.** Set each unit as Quarry or Pursuer (or use the one-click buttons), pick Urban or Wilderness complications and the escape factor. After each participant's turn Butler rolls the complication and resolves it on the next participant (save or check rolled, damage, falls, Prone, Blinded or Restrained applied). It skips participants who are dead or at 0 HP. 5.5E rooms use the 2024 DMG (1d12, complications on 1–6, saves). 5E rooms use the 2014 DMG: a d20 with complications on 1–10, skill checks such as Dexterity (Acrobatics), the overzealous guard (it attacks only if the participant moves 20 feet or more, checked at the end of its turn with the movement tracker), the hunter's snare, the stampede and a 1d4 × 5 ft drop. Dashes are counted (tick Dash on the movement tracker), with a DC 10 Constitution save (5E: check) past 3 + Con modifier. At the end of each round each quarry's Stealth is rolled against the pursuers' best Passive Perception. Exhaustion counts against every chase roll (5.5E: −2 per level; 5E: Disadvantage on checks from level 1 and on saves from level 3). When the chase ends, the log lists the Exhaustion it cost, which a Short or Long Rest removes. Tick **in sight** for a quarry the lead pursuer never lost sight of.
  - **Vehicles.** Any kind of vehicle: drawn by animals, driven by engines or magic, sailed, rowed or flown. Vehicle chases are played at a large scale, so the scene's grid must be in feet and at least **100 ft per square**. **Start chase** stays greyed out until it is, and a running vehicle chase pauses if the grid changes. **Add vehicle** from a preset: chariot, carriage, cart, wagon, dog sled, mine cart, fast buggy, armored war wagon, land crawler, rowboat, keelboat, longship, sailing ship, fast skiff, skyskiff, airship or light flyer. Or choose **Build any vehicle** and give its terrain, size, material, handling and Speed. Butler works out its numbers: AC is the material's Object AC plus its Dexterity modifier, handling gives Dexterity, size gives HP, Strength and mishap threshold, and material gives damage threshold, Constitution and an HP multiplier. Change any number under **Edit stats**. Hover a vehicle's name to see where its numbers come from. Under **Who rides where**, put each unit aboard as **Driver**, **Aboard** (exposed), **Inside** (total cover) or **Clinging on** (exposed and unsecured: it can be thrown off). Then give each vehicle a side. A vehicle acts on its driver's turn, so drivers need an initiative. Tick Dash on the driver's movement tracker when the vehicle Dashes. A driver proficient with Vehicles (Land), or Vehicles (Water) for boats and airships, adds its Proficiency Bonus to the vehicle's checks and saves. Butler reads that from the sheet, or you can set it. With no able driver, the vehicle fails Dexterity saves and checks. The rules are adapted from the vehicle appendix of *Descent into Avernus*, with nothing that assumes a particular kind of vehicle.
    - **After each driver's turn**, Butler rolls a d20 on the **Roads and streets**, **Open country**, **Rivers and seas** or **Skies** table (11–20: nothing). The result hits the next vehicle in initiative order. Possible complications: a creature joins the chase, a storm, fire or falling cargo that hurts exposed riders, dust or spray that Blinds them, cover from weaving between obstacles, Difficult Terrain, a drop that can throw off anyone clinging on, a crash if the vehicle Dashes through a cluttered stretch (checked at the end of its driver's turn), and overturning or capsizing. A complication check that fails by 5 or more causes a **mishap**.
    - **Damage** typed on a vehicle follows its damage threshold and its Poison and Psychic immunity. Damage of at least its mishap threshold while it moves rolls on the **Mishaps** table: Fire Aboard (3d6 Fire to every rider at the start of their turn), Jammed Steering, Power Loss (−30 ft), Weapon Jam, Blinding Smoke (the driver is Blinded), Loose Plating (threshold −10), Damaged Running Gear or Overturned. Each mishap shows a **Repair** button: pick who repairs it and whether they're proficient with the tools, and Butler rolls the check (Disadvantage while the vehicle moves). A vehicle at 0 HP is wrecked and out of the chase.
    - **Crash** (1d6 per 10 ft moved to the vehicle and what it hits, riders DC 15 Strength save for half) and **Ram** (the creature makes a DC 10 Dexterity save to get clear, else it takes 1d6 per 10 ft, and the vehicle stops unless it's two sizes bigger) are buttons on each vehicle.
    - **Dashing** uses the vehicle's Constitution: past 3 + its modifier, a DC 10 Constitution save (5E: check) or a level of vehicular Exhaustion. At 5 levels it drops out; only repairs remove vehicular Exhaustion.
    - **Escape:** at the end of each round each quarry vehicle makes a Dexterity check with its own Dexterity plus the driver's proficiency, against the best Passive Perception of anyone aboard a pursuing vehicle. The books don't say how a vehicle escapes; this is Butler's ruling.
- **Area templates.** Choose a shape and size and **Place** it (on the selected token for a Cone, Line or Emanation). Drag, rotate or resize it on the map: every square it covers by at least half is highlighted. The list shows who's caught; **Select** them, or type damage to apply to all of them. Square grids only.
- **Hazards and traps.** The 2024 DMG's hazards and every official trap in 5etools (2014 and 2024 DMG, Xanathar's, Van Richten's haunted traps, The Book of Many Things, adventures), grouped by book. Pick one, **Place** it at the centre of the view, and drag it where it belongs. A unit entering it (the first time on a turn) or starting its turn in it gets the save rolled and the damage and conditions applied; you get a notice. One-shot traps are then spent and revealed. **Trigger on selected** sets one off by hand (Yellow Mold when touched, a Poisoned Needle, a Rockslide's path). Traps that attack roll against the unit's AC. For a complex trap, pick the part to set off (Path of Blades' Whirling Blades, Crushing Pillars or Rune of Fear) in the menu next to the button. The unit's damage Resistances, Vulnerabilities and Immunities and condition Immunities apply; conditional ones (“from nonmagical attacks”) are reported for you to rule on.
- **Mob rolls.** Pick a group of identical monsters, attack rolls or saving throws, the target's AC or the DC, and read how many succeed from the DMG's table, with average damage ready to apply. Attack damage takes the target's Resistances, Vulnerabilities and Immunities into account per hit; for saving throws, pick the damage type to apply the monsters' own.
- **Objects.** Add a door, a spell wall, siege equipment or any object by material and size; Butler works out its AC and HP. Type damage with its type to apply immunities, vulnerabilities and thresholds.
- **Mass combat (Unearthed Arcana 2017, playtest).** Off by default: turn it on in **Combat → Room settings**. For battles with hundreds of creatures. The battle needs its own scene with a square grid of **at least 100 ft per square** (Owlbear's scene grid settings); until then Butler won't place units or start the battle. Run the characters' own skirmishes on another scene: the battle waits on its scene until you switch back.
  - **Build a unit:** select creature tokens and click **From selected tokens** (the highest CR becomes the commander), add creatures from the 5etools search, or add them by hand. Set counts, mark riders and mounts, the commander's CR and Charisma modifier, the side, and morale (the UA's factors, or pick a rating). The summary shows its Battle Rating (BR), space (400 at most), speed, range, morale and initiative, with warnings. **Place on map** puts a token one square across at the centre of your view, or **Use the selected token**.
  - **Run it:** **Start battle** fixes the turn order (10 + morale + the commander's Charisma, counted twice as the UA writes it; ties drawn once). On each unit's turn, move its token and pick an action: **Attack** (adjacent, or within range for a unit of archers; Advantage and Disadvantage are worked out from the map, with toggles for higher ground and cover), **Dash**, **Defend**, **Disengage** (DC 10 morale check) or **Guard** (the panel offers the guard's attack when the acting unit comes next to it). Butler rolls both sides' d20 + BR, takes off 2 or 5 BR, rolls the morale checks (DC 10 on heavy casualties, DC 15 once at half strength, DC 10 for neighbours within 500 ft when a unit is removed) and hides removed tokens. **House rule:** a unit at BR 0 is removed. The panel warns when a unit moves farther than it may or leaves an enemy without Disengaging.
  - **Characters:** attach party members to a unit; on its turn the panel reminds you they act first. Take the creatures they (or a spell) kill off a unit with **Casualties**, which also estimates how many an area catches. BR is recalculated.
  - **Players** see each visible unit, its creatures and how it's doing in words ("bloodied ranks", "shaken"), and the battle's results as notes, never BR or morale. The dice stay private unless you tick *players see the battle's dice*.
  - **Players commanding units:** pick a player in a unit's *commanded by* list. On the unit's turn they get a notice, and their popover's **Battle** section lets them move it one square at a time and give its orders: Attack, Dash, Defend, Disengage, Guard, Undo move and End turn, plus their guard's attack when an enemy comes next to it. Your Butler applies each order with the rules enforced: the movement allowance, stopping next to an enemy unit unless it disengaged, no moving into a held square, one action, nothing while shaken. Higher ground and cover are your call, so a player's attack uses only what the map shows. They see their own unit's BR and morale unless you untick *commanders see their unit's BR*. You can still move the token or act for the unit yourself.
  - **Critical events:** list side missions with what success and failure mean, and mark the outcome.
- **Ships and sky (naval and aerial combat).** Off by default: turn on *Naval and aerial combat* in **Combat → Room settings**. Rules from the books in 5etools: *Ghosts of Saltmarsh* (ships, crews, officers), *Astral Adventurer's Guide* (spelljammers), *Eberron: Forge of the Artificer* (elemental airships), the DMG (wind, weather, underwater) and *Xanathar's* (falling).
  - **Ships:** add any of 28 stat blocks: the six GoS ships, the battle balloon and mechanical beholder (*Acquisitions Incorporated*), 16 spelljammers, the three Lyrandar airships and the 2024 PHB airship. Each has its hull and components (helm, sails or oars, weapons, crew stations) with their own AC and HP; damage thresholds and Immunity to Poison and Psychic apply, a destroyed helm stops the ship turning, damaged sails slow it, a destroyed balloon brings it down.
  - **Turns:** GoS ships roll initiative (Dexterity + crew quality) and Butler starts their turn when initiative passes their count, with as many actions as their crew allows (Move, Fire Ballistas…, each once). Spelljammer and airship crews work stations on their own turns: **Load** and **Aim** count the actions each weapon needs before **Fire**. Pick a target (another ship's hull or component, or a creature) and its distance: range, minimum range, long range and strong wind apply.
  - **Officers:** assign units as captain, first mate, bosun, quartermaster, surgeon, cook or pilot. **Full Speed Ahead** (+d6 × 5 ft) and **Take Aim** (Advantage) are theirs; the captain heads off **mutinies**; the bosun makes **repairs**; officers and crew fight **fire aboard** as a group check.
  - **Crew:** crew count and quality (−10 to +10); **Spell casualties** kills 1d6 crew per spell level, and fewer crew means fewer actions.
  - **Crashing** follows each book: GoS (Constitution save, ram, Dexterity save for creatures struck; a rammed ship saves like a creature, Butler's ruling), AAG (the pilot's attack roll, rams) or EFA (creatures in the path dodge on DC 15 Dexterity, everyone aboard saves or goes Prone).
  - **Elemental airships (EFA):** a breakable core shard, a suppressed core flying at 5 ft, **Tilt and Roll** (everyone aboard saves or falls), **Emergency repair** (once per part until **Docked**) and **Sky hazard** (turbulence, altitude, lightning, strong wind that can invert the ship).
  - **Wind:** dead calm stops sails; ships go into, across or with the wind. A strong wind gives ranged weapon attacks Disadvantage and drops anyone flying without magic at the end of their turn.
  - **Creatures in the air:** list flying creatures with their height. Butler drops one that's knocked Prone or stopped (2024: or Incapacitated) unless it hovers or magic holds it up, and rolls the fall (1d6 per 10 ft, at most 20d6, Prone). Optional *rate of falling* (500 ft per round) and *fliers slow their fall* from Xanathar's; **Halt** for a flier that rights itself. **Overboard** throws a unit off a ship into the water or off an airship.
  - **Underwater** and other reference rules are listed under *Rules at a glance*.

## Action bar (what can I do?)

A quick reference for one unit, in the style of Baldur's Gate 3's hotbar: everything the unit can do, sorted by what it costs, with an explanation of how each option works. Nothing is spent or counted (Butler only tracks HP), but every roll is right there: each option shows its attack bonus, check modifier or damage dice, on the tile and in the detail, and clicking one rolls it (Shift for advantage, Ctrl/⌘ for disadvantage). Rolls are public or private like the card's (the switch at the bottom is shared with the card); exhaustion is applied, and after a natural 20 that option's damage rolls as a critical hit. Saving throws show their DC instead and aren't rolled from here. Options that list several skills (Influence, Search, Study) show the best one on the tile and all of them in the detail.

Open it from the token's right-click menu (**Actions**), the **⚔ Actions** button on the unit card, or, for players, **⚔ Actions** under **My units** and **⚔ My actions** on their turn. It opens at the bottom of the screen. Players can tick **Open my action bar on my turn** to have it open by itself when their turn starts (each browser remembers its own choice).

- **Tabs** sort the options by cost: **● Action**, **▲ Bonus**, **◆ Reaction**, **★ Legendary**, plus **✦ Spells** and **❖ Features** (features with a limit or a recharge). Spells also appear under their casting time, so a bonus-action spell shows under **Bonus**. **⚔ Combat** lists everything anyone can do in a fight by the rules, worked out for that unit and worded for the room's edition:
  - **Actions:** Attack, Dash, Disengage, Dodge, Help, Hide, Influence, Magic, Ready, Search, Study, Utilize (5E: Cast a Spell, Use an Object), Escape a Grapple, Stabilize.
  - **Attack options:** Unarmed Strike (if the sheet doesn't list one), Grapple, Shove, Two-Weapon Fighting, Opportunity Attack, Improvised Weapon.
  - **Movement:** Move, Drop Prone, Stand Up, Jump, Climb, Swim, Mount, Dismount.
  - **Other:** Interact with an Object, Drink or Administer a Potion, Speak.
  - **DMG optional rules** (marked *DMG* in 5E rooms and *2014 DMG* in 5.5E rooms, where they come from the 2014 book; only if your GM uses them): Disarm, Mark, Overrun, Shove Aside, Tumble, Climb onto a Bigger Creature.

  The numbers come from the sheet: Unarmed Strike to-hit and damage, the Grapple / Shove DC (8 + Strength + proficiency; Athletics in 5E), Athletics, Acrobatics, Stealth and Medicine bonuses, Dash distance, half Speed to stand up, and jump distances from Strength. Hover a tab to see what that cost means.

  Options that depend on a condition follow the unit's conditions: **Escape a Grapple** only while it's Grappled, **Stand Up** only while Prone (and **Drop Prone** only while it isn't), and **Mount** or **Dismount** depending on whether it has the **Mounted** status (set it in *Change status* or on the card).
- **Tiles** show the attack bonus, damage or save DC, the spell level (`C` for cantrips, `L2`), a limit as written on the sheet (`2/Long Rest`, `5–6` for a recharge) and ◎ for Concentration.
- **Click a tile** for **How it works**, in plain words: what it costs, what to roll and against what (attack roll vs AC, or the target's saving throw and DC), the damage, spell slot level, Concentration, Ritual, limits and recharge. **From the sheet** has the full text.
- **Reach on the map.** Hover or click an option and the map shows how far it reaches around the unit: green for melee reach (and Touch), blue for range, dashed orange for long range (attacks at Disadvantage), red for an area on the unit itself (an Emanation, "each creature within 10 feet"), and dashed purple for how far a Cone or Line goes (who it catches depends on where you aim it). Every creature it reaches gets a ring in the same colour, labelled with its distance ("25 ft · in range", "50 ft · long range: Disadvantage"). **Attack** shows the farthest reach and range of its attacks. A spell aimed at a point (*Fireball*) shows its range and names the area ("20-ft-radius Sphere at a point in range"). Distances run from the edge of the unit's space to the edge of the target's, counted the way your scene's grid measures (on a grid that counts a diagonal as one square, the bands are squares). Only you see it, and it clears when you close the bar; untick **Reach on map** at the bottom to turn it off. Players only get rings on tokens they can see. Walls, cover and line of sight aren't taken into account, and an option whose text gives no distance (Dash, Second Wind, Shield) shows nothing. Party members synced before this version show a spell's area only if its description names it; re-sync to get every area.

**Cast it.** Spells and attacks with an attack roll, a saving throw or damage get a **Cast it** box in their detail: every creature on the map with its distance and whether it's in range (or at long range, with Disadvantage). Tick the targets, or click **Everyone in range** or **Everyone in its area** (the area you placed with ◎ Place … on the map), then **Cast**. To see the range on the map while you pick, click **◎ Aim on the map** (or shrink the window with ▁): the action bar shrinks to a strip with the spell, its range, a chip per creature (tap to target, out-of-range ones dimmed) and **Cast**; **▢ Back** returns to the full bar. An attack rolls against each target's AC (Shift for Advantage, Ctrl/⌘ for Disadvantage), with damage for each hit and a critical hit on a natural 20. A saving throw rolls the damage once: the GM's Butler rolls creatures' saves privately, and each party member's player gets a notice and a **Saving throws to roll** box in their popover and action bar (the GM can **Roll for them**). The GM sees each target's result in the Tracker under **Spell and attack results**, with damage after the target's Resistances, Vulnerabilities and Immunities, and applies it per target or with **Apply all**, or the room applies it by itself (Combat → Room settings). Conditions the spell gives ("has the Frightened condition for 1 minute", "knocked Prone") are added on a failed save or a hit, with their duration when the text gives one (until the end or start of your next turn, 1 minute, 1 round).

**Costly components.** A spell whose Material component has a cost or is consumed (Revivify's diamond, Chromatic Orb's diamond, Find Familiar's incense) shows 💎 on its tile and a warning in its detail: a spellcasting focus or component pouch can't replace it, and a consumed one is needed for each casting. Butler reads the component from the spell's text (re-sync D&D Beyond characters once to bring it) or, failing that, from the books.

**Upcasting.** A spell of level 1 or higher has a **Cast at level** picker: the slot levels the caster has (from the D&D Beyond sync or the stat block's spell list), the spell's own level first. A higher level adds the spell's extra dice from its own text ("the damage increases by 1d6 for each spell slot level above 3"). Butler doesn't track spent slots: mark them on your sheet.

**Hits.** By default players see whether their attacks hit. With *Players see whether their attacks hit* off (Combat → Room settings), players only see their rolls: damage is rolled "if it hits" and the GM's Butler checks each attack against the target's AC.

**From D&D Beyond.** For a party member, the list comes from their D&D Beyond sync: actions and bonus actions as D&D Beyond sorts them, and each spell's casting time. Re-sync (the player's **⟳ D&D Beyond**, the **⟳** on the bar, or the GM's party sync) and the list follows the sheet. Characters synced before this version need one re-sync to sort their spells by casting time.

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
- Light and vision auras and the darkness fog don't stop at walls (use Owlbear's own fog for walls), a Bullseye Lantern's cone counts as a full circle, and magical darkness isn't modelled. The fog only knows Encounter Butler units and the lights set on their cards.
- Active spell effects (Mage Armor, Shield) aren't applied to party AC, and multiclass spell slots aren't combined.
- Lair actions are noted on the card but not listed as actions. Mythic actions are listed with the legendary actions.


## Encounters from D&D Life Manager

Open **Add Creatures → D&D Life Manager** in a room using the 2024 rules. Upload or paste the encounter JSON and preview it. Check how party members map to existing Butler tokens. Published creatures can be created as hidden tokens. Review placement in the current scene before revealing them. Use **Roll missing initiative** to respect any initiative already supplied, including Disadvantage for a surprised participant with no result yet.

The preview includes Life Manager's starting attitude and any opening Fight or Flight decision. Resolve that decision in Life Manager before exporting. During combat, Butler can still prompt for morale. An NPC who agrees to fight after Influence can be marked in Life Manager before exporting, or in Butler under **DM Tools → Fight or flight** after the roll. The NPC fights on the party’s side and gets the usual morale prompt when Bloodied and Frightened, or when Bloodied and more than half their allies are down with nobody on the other side down. Use **Withdraw from initiative** once the NPC leaves the fight. Decide how any retreat, surrender, or parley plays out.

Before resetting the tracker, return to **D&D Life Manager → Review result for this scene**, confirm elapsed seconds and choose the encounter outcome. Capture and download or copy the result, then review it in Life Manager. Include a partial round if the encounter ends mid-round. The return file carries linked party members' HP, life status, death saves, and conditions. Record resource use and any loot or world changes separately.
