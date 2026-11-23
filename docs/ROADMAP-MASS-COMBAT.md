# Roadmap: mass combat (UA 2017)

Drafted 2026-11-23. Nothing here is built yet.

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
- **Character-scale combat**: pause the battle, fight a normal encounter (DMG mob rules welcome), then resume.
- **Spells against a unit** (a *Wall of Ice* across a 100 ft line) use the members' own statistics. Any deaths
  recalculate the unit's BR.
- **Critical events**: side missions such as holding a bridge or killing a commander. They work like short adventures,
  and their success or failure changes the battle's starting position or its course.

### Gaps and contradictions, with the ruling Butler will use
| # | Issue in the text | Butler's default |
|---|---|---|
| A1 | The commander's Charisma is added to morale, and then initiative adds morale **and** Charisma again. | Follow the text (counted twice). The breakdown is shown, and a room option counts it only once. |
| A2 | The text never says how kills by characters and the flat −2/−5 attack losses combine. | Current BR = the BR of the creatures still there − the BR lost to attacks. Starting BR is fixed when the battle starts. |
| A3 | A unit at BR 0 or below isn't removed, so a long battle can grind on. | Follow the text. An off-by-default option removes a unit at BR ≤ 0. |
| A4 | The text doesn't say whether the Casualties check happens only once. | Once, when the unit first drops to half its BR or below. |
| A5 | Heavy casualties can call for both the DC 10 and the DC 15 check. | DC 10 first. If the unit stays, the DC 15 check follows if it applies. |
| A6 | Guard has no end, and it isn't clear when the attack happens during a move. | Guard lasts until it is used or until the unit's next turn. The attack happens when the enemy moves next to it, before that enemy acts. |
| A7 | "Don't count the speed of mounted creatures" could be read either way. | Riders are left out and their mounts' speed counts. |
| A8 | The text doesn't say whether "adjacent" includes diagonals. | It does: the 8 squares around the unit, on Butler's square grid. |
| A9 | The text doesn't say how often a unit can be the target of advantage factors. | The factors are counted again for every attack, from the map as it is then. Advantage and Disadvantage cancel as usual. |
| A10 | A PC's or NPC's own BR, when one is part of a unit, needs a CR. | The GM types a CR or BR. 5etools NPCs use their CR. |

## How it fits Butler

Butler's existing tools follow one pattern, and mass combat uses it too. The rules are pure functions in `src/core/`
with unit tests. A DM Tools panel lets the GM edit the record. The primary GM client's background page runs the
automatic parts. Rolls go through `gmRoll`. State lives in metadata.

| Piece | Where | Notes |
|---|---|---|
| Rules | `src/core/massCombat.ts` | BR table, `unitBr(composition)`, space, speed, range, morale rows, initiative, `resolveAttack`, morale triggers, adjacency/advantage from grid cells. |
| Battle unit | token metadata `dev.owlbear-butler/battle-unit` | Side, name, composition `{ name, cr, size, speeds, rangeFt, count, mount? }[]`, commander, morale factors, starting BR, BR lost, flags (Defend/Guard/Shaken + expiry), attached characters. These are snapshots, not full sheets (400 sheets wouldn't fit). |
| Battle | scene metadata `dev.owlbear-butler/battle` | Active, paused, round, turn, fixed tie order, sides, options (A1/A3), log. The same idea as `chase`. |
| UI | `src/extension/battlePanel.ts` in DM Tools | Army builder plus a turn panel. |
| Automation | `src/background/battle.ts` | Turn changes, flag expiry, Guard triggers, friendly-casualty checks. |
| Map | badges via `background/overlays.ts` | BR and morale on each unit token, plus Defend/Guard/Shaken. |

Two choices to note:
- **A separate turn order from the regular tracker.** Battle units aren't `UnitSheet` tokens, and a pause for a
  character-scale fight has to leave the battle's turn order alone while the normal tracker runs. Reusing the
  tracker would mean special cases all through `encounter.ts`.
- **The battle map is a normal scene with the grid set to 100 ft.** Butler reads `OBR.scene.grid.getScale()` and warns
  if the grid isn't 100 ft. Butler supports square grids only, so the UA's hex option is left out.

## Milestones

### M1 · Rules core (pure, tested)
- Everything in "The rules, as an implementer reads them" and the A1–A10 defaults, as functions.
- **Done when** the tests cover:
  - The UA's own examples: 5 CR 1/2 creatures = +1 BR; 50 Large + 200 Medium = 400 space.
  - Every row of the BR table, and the per-group rounding.
  - Each attack band: a tie, a target win, a win by 10, a win by 11.
  - Advantage and Disadvantage from the map's adjacency, cancelling each other.
  - Morale triggers, including A4/A5.
  - Initiative with A1 on and off.
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
    BR is lost, and the morale checks are rolled and resolved.
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
- **Zoom in**: *Pause battle* freezes the battle and the regular tracker takes over. That can be on the same scene or
  on another scene the GM prepared. *Resume* brings the battle's turn order back.
- **Done when** a fireball on a unit of 200 orcs works out its casualties with the Targets in Area of Effect table and
  takes them off the unit's BR, and a pause and resume keeps the battle's round and turn.

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

## Open questions for the owner
1. Keep the defaults for A1 (Charisma counted twice) and A3 (no removal at BR 0), or the alternatives?
2. Should a battle always run on its own scene, or should a pause hand over to the tracker on the same scene?
3. Should players see enemy BR? By default the plan hides it, as Butler hides monster HP.
