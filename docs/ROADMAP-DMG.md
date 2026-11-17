# Roadmap: 2024 DMG combat tools (2.1)

Started 2026-11-17. Source: the 2024 *Dungeon Master's Guide* (5etools data `book-xdmg.json`, `trapshazards.json`,
`objects.json`) and the 2024 *Player's Handbook* rules glossary (Breaking Objects, Cover, Surprise).

Each goal lists what "done" means. Everything rules-related is a pure function in `src/core/` with unit tests;
the Owlbear-facing parts (popover tabs, background page, map items) are thin and are checked live.

## Goals

### G1 · DMG action options labelled by edition
- 5E rooms: Disarm, Mark, Overrun, Shove Aside, Tumble and Climb onto a Bigger Creature show with a **DMG** badge.
- 5.5E rooms: the same options show, labelled **2014 DMG (optional)** (they aren't in the 2024 DMG).
- On by default in both editions; the room setting can still turn them off.

### G2 · Movement keeps the 5/10 diagonal count across stops
- On a square grid set to *Alternating* diagonals, the movement tracker counts the 1st, 3rd, 5th… diagonal square
  of the whole turn as 5 ft and the 2nd, 4th… as 10 ft, even when the token stops in between (DMG "Diagonal Movement").
- Rewind recomputes from the remaining stops. Other grid settings are unchanged.

### G3 · Surprised
- A *Surprised* condition in both editions.
- 5.5E: a Surprised unit rolls initiative with Disadvantage (PHB 2024 "Surprise"); it ends at the end of its first turn.
- 5E: Surprised can't move or act on its first turn and can't take reactions until that turn ends; it ends then.

### G4 · Area-of-effect templates
- From the Tracker (and the action bar for entries with an area), place a Sphere/Cylinder (radius), Cube, Emanation,
  Cone or Line on the map; it can be dragged and rotated.
- Every square the area covers by at least half is highlighted (DMG "Areas of Effect"), and the units in those
  squares are listed, ready to select for damage.

### G5 · Fight or flight
- Before combat: "Will they fight?" rolls a DC 10 Wisdom save for a chosen leader; a failure means flee or parley.
- At the start of a non-party unit's turn, if it is Bloodied and either Frightened, or more than half its allies are
  dead or Incapacitated while nobody on the other side is, the GM is told it is likely to flee, with a one-click DC 10
  Wisdom save (DMG "Fight or Flight").

### G6 · Objects (no token, no initiative)
- A list of objects in the scene (a wall, a door, a pillar used as cover…), stored in scene metadata.
- AC and HP come from the rules: PHB 2024 Object AC by substance and Object HP by size (fragile/resilient),
  Huge/Gargantuan split into Large sections, DMG door table, spell walls (Wall of Stone, Wall of Ice, Wall of Force),
  DMG siege equipment. Immunity to Poison and Psychic, optional vulnerabilities and damage threshold.
- Damage, repair and destroyed state; a "did the cover take the hit?" check for attacks that miss only because of
  the cover's AC bonus (2014 DMG optional rule "Hitting Cover").

### G7 · Chase mode
- Pick the quarry and the pursuers, with one-click sides: *party is the quarry / pursuers* and *every hostile* or
  *everyone else* on the other side.
- After each participant's turn, a d12 roll on the Urban or Wilderness complication table; a complication affects the
  next participant in initiative order and is announced.
- At initiative count 0 (end of each round), each quarry rolls Dexterity (Stealth) against the highest pursuer
  Passive Perception; escape is announced (the GM rules on "never out of sight").
- Dash budget: 3 + Constitution modifier free Dashes, each extra one asks for a DC 10 Constitution save or
  1 Exhaustion level.

### G8 · Hazards and traps on the map
- A catalog of the 2024 DMG's hazards and traps with a picture each, placed on the map as an area.
- The mechanics run: a unit that enters the area or starts its turn there gets the hazard's saving throw rolled,
  damage applied (half on a success where the rules say so) and conditions added; the GM is notified.
- Detect/disarm DCs shown on the hazard's card.
- Damage follows the creature's Resistances, Vulnerabilities and Immunities (after halving on a save); conditions it's immune to are skipped; conditional defenses are reported, not applied.

### G9 · Apply Poison (injury poison)
- When a unit's inventory has a weapon and an injury poison (Basic Poison, Serpent Venom, Wyvern Poison, Purple Worm
  Poison, Lolth's Sting…), the action bar shows *Apply Poison* (Bonus Action in 5.5E, Action in 5E) with its effect.

### G10 · Mob rolls
- For a group of identical monsters: attack rolls or saving throws resolved with the DMG Mob Results table
  (normal, Advantage, Disadvantage), average damage applied to the target, and the Targets in Area of Effect table.

## Order of work
G1 → G2 → G3 → G9 → G10 → G5 → G6 → G7 → G4 → G8 (small and self-contained first; map features last).

## Status
| Goal | Status | Checked by |
|---|---|---|
| G1 | done | unit tests (labels per edition, on by default) |
| G2 | done | unit tests (DMG 30 ft example across three stops, rewind); live check pending |
| G3 | done | unit tests (expiry, 2024 initiative Disadvantage); live check pending |
| G4 | done | unit tests (half-square coverage for every shape, tokens in area, areas from text); map drawing live check pending |
| G5 | done | unit tests (Frightened, allies down, edge cases); turn-start prompt live check pending |
| G6 | done | unit tests (object AC/HP tables, presets, damage rules, hitting cover); DM Tools panel live check pending |
| G7 | done | unit tests (sides, order, tables, Dash budget, escape); automation on turn changes live check pending |
| G8 | done | unit tests (catalog, pictures, save/half/condition rules); automatic triggers on the map live check pending |
| G9 | done | unit tests (2024 Bonus Action, 2014 action, no weapon / ingested poison) |
| G10 | done | unit tests (DMG zombie examples, Advantage/Disadvantage columns, area table); DM Tools tab live check pending |
