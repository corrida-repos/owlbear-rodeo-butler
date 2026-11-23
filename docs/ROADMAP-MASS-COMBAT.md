# Roadmap: mass combat (UA 2017)

Drafted 2026-11-23. Built the same day: see [Status](#status).

## Source

**Unearthed Arcana: Mass Combat** (Wizards of the Coast, 2017-02-21, 5 pages,
[PDF](https://media.wizards.com/2017/dnd/downloads/2017_UAMassCombat_MCUA_v1.pdf)). It is the most recent mass
combat playtest I could find. No UA from 2018 to 2026 covers armies, and the 2024 core books have no mass combat rules
(the 2024 DMG has Mobs, which Butler already runs as G10). It replaces the 2015 UA *When Armies Clash*, a miniatures
game with stands of 10 creatures and solos. The 2017 rules are more abstract: each unit's strength comes from its
creatures' CR, and an attack is one opposed d20 roll.

It is playtest material ("not refined by design iterations"), so the UI labels it **UA 2017 (playtest)**, and it works
the same in 5E and 5.5E rooms (it reads CR only).

## The rules, as an implementer reads them

### Units
- **Battle Rating (BR)** per creature, by CR: 1/8 → +1 per 20 creatures, 1/4 → +1 per 10, 1/2 → +1 per 5, 1 → +1 per 2;
  2 → +1, 3 → +2, 4 → +3, 5 → +4, 6 → +5, 7 → +6, 8 → +8, 9 → +10, 10 → +12, 11 → +16, 12 → +18, then +4 per CR up
  to 20 → +50. (CR 0 gives nothing. The table isn't linear: CR 8 jumps by 2 and CR 11 by 4.)
- A creature with a CR of 1 or lower adds BR only in groups. "Smaller groups provide no BR", so BR is counted
  **per CR group**, rounding down: 9 CR 1/2 soldiers = +1.
- **Unit BR** is the total of all its creatures, commander included, plus mounts counted as creatures.
- **Space**: at most 400. Tiny, Small or Medium = 1, Large = 4, Huge = 9, Gargantuan = 16. The commander doesn't count
  toward it. Only creatures that have a BR count toward the limit.
- **Footprint**: 100 × 100 ft, however many creatures are in it. One token per unit on a 100 ft grid.
- **Speed**: 10 × the lowest speed among its members. A movement mode such as flying counts only if every member has it.
  Riders move on their mounts.
- **Ranged**: only if every member except the commander has an at-will attack with a range of 100 ft or more. The unit's
  maximum range is the shortest maximum range among them.
- **Morale**: from −10 to +10, on the rows −10, −8, −4, −2, 0, +2, +4, +8, +10. Start at 0 and move one row per
  factor: worse for poor treatment, animosity toward an ally, low pay, no stake in the outcome, an incompetent
  commander, a daunting foe or poor equipment, better for the opposite. Then add the **commander's Charisma
  modifier**. A morale check is d20 + morale against a DC.

### Turns
- A round is **1 minute**. Initiative isn't rolled: it is **10 + morale + the commander's Charisma modifier**, fixed.
  Ties are ordered randomly once and keep that order for the whole battle.
- On its turn a unit moves and takes one action, with movement before and after the action as normal. It may enter a
  square if it has at least half the movement that square costs. It must stop when it moves next to an enemy unit, and
  it can't move away from one without Disengage.
- **Actions:**
  - **Attack**: against an adjacent unit, or at range if every member can reach the target.
  - **Dash**: adds the unit's speed again.
  - **Defend**: attacks against the unit have Disadvantage until the end of its next turn.
  - **Disengage**: a DC 10 morale check. On a failure the unit loses its action and doesn't move. On a success it moves
    up to half its speed and doesn't have to stop next to enemies.
  - **Guard**: the next enemy unit that moves next to it is attacked at once.

### Attacks
- Both sides roll **d20 + BR**.
  - A tie or a higher target total: nothing happens.
  - The attacker wins by 1 to 10: the target loses 2 BR.
  - The attacker wins by 11 or more: the target loses 5 BR, then makes a **DC 10 morale check**. On a failure it flees
    and is removed.
- Only the attacker's roll has Advantage or Disadvantage:
  - **Advantage**: the attacker is on higher ground, or the target is next to at least one other enemy unit.
  - **Disadvantage**: the target is partly behind cover, or the target is next to at least two units of its own side,
    or the target is Defending.
- BR already covers resistances and spells, so no other modifiers apply.

### Morale checks during the battle
- **Casualties**: a unit at half its starting BR or less makes a DC 15 morale check. On a failure it is removed.
- **Friendly casualties**: when a friendly unit within 500 ft (5 squares) is removed, the unit makes a DC 10 morale
  check. On a failure it can't move or act on its next turn.

### Characters
- **Characters in a unit** don't add to its BR or space. On the unit's turn each character takes one turn of attacks,
  spells or magic items against the target unit, using the normal rules. The creatures they kill come out of the
  unit's composition and its BR is recalculated. A creature that can't move or act counts as eliminated. Attacks on
  the unit don't hurt the characters, and if the unit is removed they stay on the battlefield.
- **Character-scale combat**: pause the battle, fight a normal encounter (DMG mob rules welcome), then resume. In
  Butler the GM switches to another scene for the skirmish (see "How it fits Butler").
- **Spells against a unit** (a *Wall of Ice* across a 100 ft line) use the members' own statistics. Any deaths
  recalculate the unit's BR.
- **Critical events**: side missions such as holding a bridge or killing a commander. They work like short adventures,
  and their success or failure changes the battle's starting position or its course.

### Gaps and contradictions, with the ruling Butler will use
| # | Issue in the text | Butler's default |
|---|---|---|
| A1 | The commander's Charisma is added to morale, and then initiative adds morale **and** Charisma again. **Decided:** counted twice, as written. The initiative breakdown shows both terms. |
| A2 | The text never says how kills by characters and the flat −2/−5 attack losses combine. | Current BR = the BR of the creatures still there − the BR lost to attacks. Starting BR is fixed when the battle starts. |
| A3 | A unit at BR 0 or below isn't removed, so a long battle can grind on. | **Decided (house rule):** a unit at BR 0 or below is removed at once, with no morale check, and counts as a removed friendly unit for the 500 ft check. |
| A4 | The text doesn't say whether the Casualties check happens only once. | Once, when the unit first drops to half its BR or below. |
| A5 | Heavy casualties can call for both the DC 10 and the DC 15 check. | DC 10 first. If the unit stays, the DC 15 check follows if it applies. |
| A6 | Guard has no end, and it isn't clear when the attack happens during a move. | Guard lasts until it is used or until the unit's next turn. The attack happens when the enemy moves next to it, before that enemy acts. |
| A7 | "Don't count the speed of mounted creatures" could be read either way. | Riders are left out and their mounts' speed counts. |
| A8 | The text doesn't say whether "adjacent" includes diagonals. | It does: the 8 squares around the unit, on Butler's square grid. |
| A9 | The text doesn't say how often a unit can be the target of advantage factors. | The factors are counted again for every attack, from the map as it is then. Advantage and Disadvantage cancel as usual. |
| A10 | A PC's or NPC's own BR, when one is part of a unit, needs a CR. | The GM types a CR or BR. 5etools NPCs use their CR. |
| A11 | Only ranged attacks exempt the commander, and mounts can't shoot, so mounted archers could never be ranged. | The commander's speed and range don't limit the unit. Mounts don't need a ranged attack. |
| A12 | The BR table stops at CR 20. | +4 per CR above 20 (CR 21 = +54). |
| A13 | The text doesn't say where a 100 ft unit's range is measured from. | Centre to centre, in squares × the grid's feet per square. Morale is kept within −10…+10 after the commander's Charisma is added. |

## How it fits Butler

Butler's existing tools follow one pattern, and mass combat uses it too. The rules are pure functions in `src/core/`
with unit tests. A DM Tools panel lets the GM edit the record. The primary GM client's background page runs the
automatic parts. Rolls go through `gmRoll`. State lives in metadata.

| Piece | Where | Notes |
|---|---|---|
| Rules | `src/core/massCombat.ts` | BR table, `unitBr(composition)`, space, speed, range, morale rows, initiative, `resolveAttack`, morale triggers, adjacency/advantage from grid cells. |
| Battle unit | token metadata `dev.owlbear-butler/battle-unit` | Side, name, composition `{ name, cr, size, speeds, rangeFt, count, mount? }[]`, commander, morale factors, starting BR, BR lost, flags (Defend/Guard/Shaken + expiry), attached characters. These are snapshots, not full sheets (400 sheets wouldn't fit). |
| Battle | scene metadata `dev.owlbear-butler/battle` | Active, round, turn, fixed tie order, sides, log. The same idea as `chase`. |
| UI | `src/extension/battlePanel.ts` in DM Tools | Army builder plus a turn panel. |
| Automation | `src/background/battle.ts` | Turn changes, flag expiry, Guard triggers, friendly-casualty checks. |
| Map | badges via `background/overlays.ts` | BR and morale on each unit token, plus Defend/Guard/Shaken. |

Two choices to note:
- **A separate turn order from the regular tracker.** Battle units aren't `UnitSheet` tokens. Reusing the tracker
  would mean special cases all through `encounter.ts`.
- **The battle scene's grid must be at least 100 ft per square (enforced).** Butler reads `OBR.scene.grid.getScale()`.
  On a scene with a smaller grid, or one not measured in feet, *Place on map* and *Start battle* are disabled and the
  panel says why. One unit fills one square. Speeds and ranges are measured in feet from the grid, so a coarser grid
  (200 ft) still works. Butler supports square grids only, so the UA's hex option is left out.
- **Zooming in uses another scene.** The battle's record lives in its own scene's metadata, so switching to a
  skirmish scene leaves the battle exactly where it was. There the GM runs the characters' fight with the normal
  tracker, then switches back to carry on. Nothing has to be paused or handed over.

## Milestones

### M1 · Rules core (pure, tested)
- Everything in "The rules, as an implementer reads them" and the A1–A10 defaults, as functions.
- **Done when** the tests cover:
  - The UA's own examples: 5 CR 1/2 creatures = +1 BR; 50 Large + 200 Medium = 400 space.
  - Every row of the BR table, and the per-group rounding.
  - Each attack band: a tie, a target win, a win by 10, a win by 11.
  - Advantage and Disadvantage from the map's adjacency, cancelling each other.
  - Morale triggers, including A4/A5.
  - Initiative counting the commander's Charisma twice (A1).
  - Removal at BR 0 or below (A3), including the friendly-casualty checks it sets off.
  - The grid check: under 100 ft refused, 100 ft and 200 ft accepted.
  - Tie order fixed once.

### M2 · Army builder (DM Tools → Mass combat)
- New unit: pick creatures from the 5etools search or the collection and set counts. Or **from selected tokens**,
  grouping them by creature. Then pick the commander, mark mounts, choose the side, and set morale with the factor
  checklist (or a typed rating).
- A summary line, as the GM builds the unit: `Orc warband · BR 14 · 310/400 · 300 ft · melee · morale +2 · init 13`.
  Warnings: over 400 space; a member with no BR; no commander; ranged turned off (and which member is why).
- **Place on map**: a token one grid square across (100 ft), with the commander's or the main creature's art and a BR
  badge. Duplicate, edit, and save to the collection as an army template.
- **Done when** a 300-orc / 30-ogre / 1-warchief army and a 200-human / 50-knight-on-warhorse army build, check out
  against hand counts, and appear on a 100 ft grid.

### M3 · Running the battle
- **Start battle**: fixed initiative order with the random tie order, the round counter (1 minute), Next and Previous
  unit, an active-unit ring (reusing the tracker's overlay), and **End battle**.
- The turn panel offers the five actions:
  - **Attack**: enemy targets in range or adjacent, worked out from the token positions. Advantage and Disadvantage
    are shown with their reasons and can be overridden, with toggles for high ground and cover. Both rolls are made,
    BR is lost, a unit at BR 0 or below is removed (A3), and otherwise the morale checks are rolled and resolved.
  - **Dash**.
  - **Defend**: lasts until the end of the unit's next turn.
  - **Disengage**: the DC 10 check.
  - **Guard**.
- **Removal**: the token is hidden, not deleted, and marked as removed, so the battle can be undone or reviewed. Units
  within 5 squares get the friendly-casualty check automatically, and a failure marks them Shaken until the end of
  their next turn.
- A battle log, and rolls that are public or private per battle.
- **Done when** a scripted battle replays deterministically in tests (the dice are seeded through the existing roll
  layer), and it is checked live with two armies over 3 rounds, including a rout and a friendly-casualty check.

### M4 · Map rules
- A movement allowance in squares, using the half-movement rule. A warning when a unit moves on after coming next to
  an enemy, or leaves one without Disengage. Butler warns and doesn't block, as the movement tracker does now.
- Guard fires when an enemy token ends a move next to the guarding unit (A6). The GM confirms it, then the attack runs.
- **Done when** the adjacency, range and half-movement functions are tested and the warnings appear live.

### M5 · Characters and spells
- **Attach characters** (party tokens) to a unit. They show up on its turn as "Characters act first", and the unit's
  results don't apply to them. If the unit is removed, they are detached and stay on the map.
- **Casualties editor**: remove N creatures of type X, from character kills, a spell, or creatures that can't move or
  act. BR is recalculated and the Casualties check runs.
- **Mob shortcut**: open the existing Mob panel with the unit's count and the selected creature's AC, save bonus or
  attack, so the GM can resolve a spell or an assault on the unit's members quickly.
- **Zoom in**: the GM switches to a skirmish scene and runs the characters' fight with the normal tracker. The
  battle stays on its own scene, unchanged. Back on the battle scene, the casualties editor records what the skirmish
  cost each unit.
- **Done when** a fireball on a unit of 200 orcs works out its casualties with the Targets in Area of Effect table and
  takes them off the unit's BR, and switching to a skirmish scene and back keeps the battle's round and turn.

### M6 · Critical events, players and wrap-up
- **Critical events**: a short list on the battle with a success consequence and a failure consequence. The GM applies
  each one as a morale shift, a BR change, a starting flag (cover, high ground) or a removal.
- **Player view**: a player sees the units, the sides, the turn order and public rolls. A room option shows players
  their own side's BR and morale. A player can be given a unit to command and gets turn notices for it, reusing
  `controlledBy` and the existing notices.
- **Battle summary** at the end: removed units, BR lost, and the remaining strength per side.
- **Done when** a player commands a unit live and sees only what the options allow.

## Order of work
M1 → M2 → M3 together make a usable battle. M5 brings in the player characters, which is the point of the rules.
M4 and M6 are refinements. M1 and M2 are self-contained. M3 is the first milestone that needs live checks.

## Decisions
Decided 2026-11-23: A1 counted twice; A3 removal at BR 0 or below; the battle scene's grid at least 100 ft per square,
enforced; skirmishes on another scene.

**What players see**, decided 2026-11-23 from what the UA implies. The UA is a DM's tool: "designed to allow you, the
DM, to determine the outcome of battles". BR is "an abstract measure", and players take part through their
characters. They do need each enemy unit's makeup, because characters in a unit "pick out which members of the unit
they want to target". So:
- Players see each visible unit's name, side and creatures, and what happens to it, in words: "casualties", "heavy
  casualties", "flees", "bloodied ranks", "shaken".
- Players never see enemy BR, morale or initiative breakdowns.
- Battle dice are private by default, because d20 + BR totals would reveal BR. The results are announced as words.
- A player commanding a unit goes beyond the UA. It's a house extension, off unless the GM assigns a commander.

**Mass combat is off by default** (decided 2026-11-23): a room setting in Combat → Room settings turns on the DM Tools
panel, the badges, the players' Battle view and their orders.

**A commanding player controls their unit** (decided 2026-11-23). On its turn, their popover moves it one square at a
time and gives its orders (Attack, Dash, Defend, Disengage, Guard, Undo move, End turn, and their guard's attack). The
orders travel as requests to the primary GM client, which checks that the player commands the unit and that it's its
turn, then applies them with the rules enforced. Players can't move GM tokens in Owlbear, so this is how they move.
The GM still moves tokens freely, with warnings. The player sees their own unit's BR and morale: **on by default**, and
the GM can turn it off.

## Status
| Milestone | Status | Checked by |
|---|---|---|
| M1 rules core | done | 24 unit tests in `tests/massCombat.test.ts`: the UA's examples, every BR row, each attack band, morale triggers (A3–A5), initiative (A1), the grid check, adjacency and range, Advantage/Disadvantage from the map, the turn order and flags, what players see, and a scripted skirmish chaining them |
| M2 army builder | done | headless smoke test against a stubbed Owlbear SDK. Live check pending: *From selected tokens*, the 5etools search, *Place on map* sizing the token to one square |
| M3 running the battle | done | headless smoke test: start, an attack with heavy casualties, a failed DC 10 rout, a friendly-casualty check, Defend, a round wrap. Live check pending with two armies over 3 rounds |
| M4 map rules | done (warnings) | movement over the allowance, moving away from an enemy without Disengage, and Guard triggers are worked out in the panel from the token positions. Guard triggers only for the acting unit's move, seen when the GM's panel refreshes. Live check pending |
| M5 characters and spells | done | attach party members, a casualties editor with the Targets in Area of Effect estimate. Skirmishes run on another scene. Live check pending |
| Player command | done | unit tests: one-square moves (allowance, Dash, Disengage, stopping next to enemies, held squares, Shaken), guard triggers, request validation, BR shown by default, the setting off by default. Headless smoke test: the player's popover with the orders, a move, a refused move, an attack, a refused second action, End turn. Live check pending with a player |
| M6 events, players, wrap-up | done | critical events, the player popover's Battle section (pure `playerBattleView`, unit-tested), badges on unit tokens, turn notices for commanded units, a summary when the battle ends. Live check pending with a player |

Deviations from the plan above: the unit tests cover the rules end to end with fixed rolls rather than replaying a
battle through the Owlbear layer, which isn't testable without Owlbear, so that layer was smoke-tested in Chromium
against a stub. The *Mob shortcut* is an area estimate on the Casualties tool, plus the existing Mob panel for the
saves.
