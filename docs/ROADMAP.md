# Roadmap: Encounter Butler 2.0 — independent of Forge!

Status (2026-11-08):
- **Phase 0:** done. Live-checked with a GM and a player (background, context menu → card, public/private roll
  notifications, 256 kB item metadata OK). Finding: players can't select GM-owned tokens, so they open cards from the
  popover, not the context menu.
- **Phase 1:** done. All converters write native sheets, Forge code removed, Combat tab reads native data,
  game-system room setting (search follows it), bundled package rebuilt; 4,574/4,574 5etools creatures OK. Live: a
  5etools wolf added from Add Creatures carries its native sheet (card shows AC, HP, initiative, actions).
- **Phase 2:** done. Full unit card (F2) with clickable dice (F3: Shift/Ctrl or toggle for adv/dis, damage after an
  attack, crit damage, public/private, session roll log), portraits, aliases, renaming and controlling player (F7).
  Players get a "My units" popover to open their cards. Live: GM attack with advantage + crit damage; player private
  check seen by the player and the GM only. 105 tests.
- **Next:** phase 3 (combat core: tracker, turns, HP, Dead / Death Saves / Stable).

## Goal

Encounter Butler runs a whole D&D combat in Owlbear Rodeo **on its own**: stat blocks live on the tokens, the GM and
players see unit cards with clickable dice, and the initiative tracker, HP, conditions and turn flow are native.
Forge! is no longer needed.

### Success criteria for 2.0
1. A room with **only Encounter Butler enabled** can add creatures and party members, run initiative for several rounds,
   track HP/temp HP and conditions, and roll every attack/damage/save from the unit cards.
2. A **player** (second account, nothing installed) sees the player tracker, gets "your turn / you're next" notices,
   sees public rolls as text, and can open their own unit's card and roll from it.
3. D&D 5.5E (2024) is the default system; switching the room to 5E (2014) changes the rules that differ (below).
4. `npm test` covers all rules logic (turn order, HP math, durations, dice, system rules); a written live-test checklist
   passes with a GM and a player.

### Non-goals (2.0)
- Any Forge compatibility: no reading, writing or converting Forge data. Existing Forge units and party members are
  discarded and re-added with Butler.
- Game systems other than D&D 5E / 5.5E.
- 3D dice, sound, animations.
- Full player character sheets (spell slot spending, inventory management). D&D Beyond stays the source for those;
  the card shows what the sync brings.
- Fog, walls, lighting, maps beyond what exists today.
- Hiding stat data from technically savvy players (token metadata is readable by every client, as it is with Forge).

---

## Architecture

```
manifest.json
 ├─ background_url → background.html   (always running for every client in the room)
 │    registers context-menu items, listens to rolls/turn changes, shows notifications,
 │    draws local overlays (active-turn ring, HP bars, condition badges)
 ├─ action popover  → index.html        (existing; becomes role-aware)
 │    GM:     Tracker · Add Creatures · Party · Collection · Settings
 │    Player: Player tracker · My units · Roll log
 └─ popover         → card.html?id=…    (unit card, opened from the context menu or the tracker)
```

### Where data lives

| Data | Location | Why |
|---|---|---|
| Stat block ("sheet") | token metadata `dev.owlbear-butler/sheet` | large, rarely changes; travels with the token (copy/paste, scene export) |
| Live state: HP, temp HP, initiative, conditions, in-tracker, party, controlling player, portrait | token metadata `dev.owlbear-butler/state` | small, changes often; kept separate from the sheet so frequent writes stay small and GM/player edits don't collide |
| Encounter: round, active unit, started/stopped, turn history for "previous turn" | scene metadata `dev.owlbear-butler/encounter` | per scene, shared by everyone |
| Room settings: game system (default `dnd5e-2024`), player-view options, default roll visibility | room metadata `dev.owlbear-butler/settings` | small (room metadata is capped, so nothing large goes here) |
| Creature collection (saved homebrew + favourites) | GM's browser (IndexedDB), with export/import as a JSON file | too big for room metadata; see decision D3 |
| Roll messages | `OBR.broadcast` (not stored in the scene) | ephemeral; each client keeps a session log |

### Native sheet format
- A system-neutral `UnitSheet` (identity, size, type, alignment, AC, HP formula, speeds, abilities, saves, skills,
  senses, languages, damage/condition defences, CR/level, proficiency bonus, initiative setup, and lists of
  traits / actions / bonus actions / reactions / legendary actions / spells / inventory).
- Rollable text keeps the **`[1d20+4]` chip syntax** the converters already emit for Forge, so 5etools, D&D Beyond
  and quick stats map onto it directly. Labels like "+4 to hit" become a chip with a
  recognisable roll name ("Scimitar · to hit").
- Versioned (`schema: "butler-sheet@1"`) with a migration function, so later changes don't break old tokens.

### Code layout (proposed)
- `src/core/sheet.ts` — `UnitSheet` type, validation, migration.
- `src/core/systems/` — `dnd5e-2024.ts`, `dnd5e-2014.ts` behind one `GameSystem` interface (below).
- `src/core/encounter.ts` — turn order, next/previous, round counter, reset (pure, unit-tested).
- `src/core/hp.ts`, `src/core/conditions.ts` — damage/heal/temp-HP rules, durations, concentration checks.
- `src/core/rolls.ts` — formula parser (kh/kl, adv/dis, crits), roll message type.
- `src/background/` — context menus, notifications, overlays.
- `src/extension/card/` — the unit card page.
- The existing `SceneGateway` abstraction grows (broadcast, players, local items) so the fake gateway keeps
  everything testable without Owlbear.

### GameSystem interface (what differs between 5E and 5.5E)
| Concern | 5.5E (2024) — default | 5E (2014) |
|---|---|---|
| Encounter difficulty | XP budget per character (Low/Moderate/High) + Butler's Extreme | XP thresholds (Easy/Medium/Hard/Deadly) × group-size multiplier |
| Creature search preference | 2024 books first | 2014 books first |
| Initiative | stat block initiative bonus (incl. proficiency) | Dex modifier |
| Exhaustion | levels 1–6, −2 per level on d20 tests, −5 ft speed per level | 6-level effects table |
| Conditions list / wording | 2024 glossary | 2014 PHB appendix |
| Concentration DC | max(10, half damage), capped at 30 | max(10, half damage) |
| Bloodied | automatic condition while HP ≤ half max HP (any unit); added/removed by HP changes, never set by hand; not shown once Dead | none |
| Card labels | "Melee Attack Roll: +4" | "Melee Weapon Attack: +4 to hit" |

---

## Feature goals and acceptance criteria

### F1 · Stat block storage on tokens
- Every unit Butler creates stores a `UnitSheet` + state on the token; no Forge keys are written or read.
- 5etools, homebrew JSON, quick stats, prepared encounters and the D&D Beyond party sync all write the native format.
- **Done when:** `check:5etools` converts all 4,574 creatures to valid sheets; the 3 verified D&D Beyond characters
  produce the same numbers as today; the largest sheet's metadata size is measured and within Owlbear's limit.

### F2 · Unit card viewer
- Right-click → **View <name>**, or click a row in the tracker, opens the card: portrait, name, HP/temp HP/AC, speeds,
  abilities with modifiers, saves, skills, senses, defences, CR/level, and every list section.
- GM sees every card. Players see the full cards of units they control. For every other unit (monsters, NPCs, other
  players' units) a player sees only the **name, image and conditions** — including Dead and, in 5.5E, Bloodied —
  never stats or HP (D4).
- **Done when:** a wolf, an aboleth (legendary), a priest (spells) and a synced PC render completely.

### F3 · Clickable dice rolls (public or private)
- Every `[formula]` chip, ability check, save, skill and initiative on the card is clickable.
- Shift-click = advantage, Ctrl/Cmd-click = disadvantage (also buttons for touch); attacks offer the matching damage
  roll next; a natural 20 can roll crit damage (doubled dice).
- **Public** rolls appear as text to everyone: a notification ("Goblin 2 · Scimitar to hit: **17** (13 + 4)") and an
  entry in the roll log. **Private** rolls: a GM's private roll shows only to the GM; a player's private roll shows to
  that player **and the GM** (D2). A toggle on the card sets the default; each roller's default is remembered.
- **Done when:** a GM and a player each see public rolls from both sides; a private GM roll is seen by nobody else; a
  private player roll is seen by that player and the GM only.

### F4 · Initiative tracker (GM)
- Lists units in the encounter sorted by initiative (ties: higher initiative modifier, then Dex, then name; GM can drag
  to reorder ties). Shows portrait, name, initiative, HP/temp HP, AC, conditions.
- Add/remove units; roll for all / creatures only / one unit; type a value for players who roll their own.
- Hidden tokens are marked for the GM and invisible to players.
- **Done when:** 10 units across 5 rounds keep a stable order, including tokens added mid-combat.

### F5 · Turn controls, round counter, active-turn highlight, notifications
- **Start combat / Next turn / Previous turn / End combat**, round counter that increments when the order wraps.
- The active unit is highlighted in the tracker and on the map (local overlay ring), and the view can follow it.
- The player controlling the active unit gets **"It's your turn: <unit>"**; the controller of the next unit gets
  **"You're up next: <unit>"**. The GM gets a notice when a monster's turn starts (optional).
- Players may end their own turn (button on the player tracker) if the GM allows it.
- **Done when:** notifications reach the right player only, also with the popover closed.

### F6 · HP and temporary HP
- Damage/heal box per unit (`-7`, `+5`, or a number); damage removes temp HP first; temp HP doesn't stack (keeps the
  higher); healing can't exceed max; at 0 HP, party members gain **Death Saves** (F11) and creatures offer *Mark as dead*
  (F10); a setting can make that automatic.
- Max-HP override and HP re-roll; optional on-map HP bars (the GM sees all; a player sees only their own units').
- Players never see other units' HP numbers or health status; in 5.5E the automatic Bloodied condition is what they see.
- **Done when:** HP rules are unit-tested and a player editing their own PC's HP doesn't overwrite a GM edit to another field.

### F7 · Unit portraits and names
- Portrait defaults to the token image; can be set to another URL or library image (portrait ≠ token art).
- Name shown on card and tracker; renaming syncs the token label; numbering ("Wolf 3") stays as today.
- GM can show a creature to players under an alias ("Hooded figure") until revealed.

### F8 · Custom (fabricated) units and creature collection
- A unit editor creates or edits a sheet from scratch, from quick stats, from a published creature, or from a token
  already in the scene ("save to collection").
- Stored in the GM's browser (IndexedDB) (D3): it stays on that browser/device, so export is the backup and the way
  to move it to another computer.
- The collection lists saved units with search and tags; add any of them to the scene with quantities (reuses the
  existing roster flow); export/import the collection as JSON.
- **Done when:** a homebrew boss can be created, saved, added to two scenes and edited without affecting placed copies.

### F9 · Game system support (5E and 5.5E, 5.5E default)
- Room setting, GM-only. Everything in the GameSystem table above follows it.
- **Done when:** both systems' difficulty, exhaustion and concentration rules have tests from the books' numbers.

### F10 · Context-menu unit actions and initiative reset
- On selected token(s): View card · Add to / remove from initiative · Roll initiative · Damage/Heal · Conditions ·
  Add to / remove from party · Set controlling player (GM) · Save to collection (GM).
- **Mark as dead** (GM): the unit gains the **Dead** condition and is removed from initiative. If it was the active
  unit, the turn passes to the next one; the round counter and everyone else's order are unchanged. Works on a
  multi-selection. **Revive** reverses it (removes Dead; the unit can be added back to initiative).
- **Reset round & initiative** (GM): clears initiative values and round, keeps the units in the encounter.
- Multi-select applies to all selected units (e.g. damage five goblins from one Fireball).

### F11 · Conditions and status effects
- The system's standard conditions plus Exhaustion levels, Concentration, **Dead** (set by *Mark as dead*, F10),
  **Bloodied** (5.5E only, automatic from HP, see the GameSystem table), and custom effects (name, icon/colour, note).
- **Death Saves** (both systems, automatic): a party member at 0 HP gains it, and keeps their place in initiative.
  It tracks successes/failures (clickable death save roll on their turn); healing above 0 HP clears it.
  *Mark as dead* supersedes it: Death Saves is removed, Dead is added, the unit leaves initiative. Three failures
  offer *Mark as dead*.
- **Stable** (both systems): the GM (or the player, if player edits are on) can set it on a party member at 0 HP;
  three death-save successes set it automatically. It supersedes Death Saves (counters reset; the unit stays in
  initiative). Taking damage while Stable removes it and Death Saves resumes; healing above 0 HP clears it.
- Conditions are visible to everyone, on every unit (players included, D4), unless the token itself is hidden.
- Optional duration: N rounds, until the start/end of a given unit's turn; expires automatically on turn change with a
  notice. Concentration prompts a Con save (with the right DC, clickable) when the unit takes damage.
- Shown in tracker, card, player tracker and as small badges on the token.

### F12 · Player-facing initiative tracker
- Players open the same Butler button and get the order: round, active and next unit, every unit's name, image and
  conditions (incl. Dead and Bloodied), their own units' HP/temp HP; hidden tokens omitted.
- On their own units, players can change HP/temp HP, conditions and initiative, and end their turn (D5). One GM
  setting turns player edits off.

### F13 · Party list management
- Party view: which units are PCs/companions, which player controls each (from `OBR.party.getPlayers()`, stored by
  player id so it survives reconnects), level, and quick add/remove.
- D&D Beyond sync keeps working and writes the native party.
- Feeds difficulty, notifications (who gets "your turn") and the player tracker.

### F14 · Movement (spent speed) tracker
- While combat runs, Butler counts how far the **active unit's token** has moved since its turn started: the sum of
  every move along the path it actually took (each drag measured with the scene's grid distance rules), in feet.
- Shown to the GM and to the active unit's controller (tracker, player tracker and a small label near the token):
  "Moved 20 / 30 ft". It turns **red** once the distance moved exceeds the unit's speed (walk speed; the highest
  speed if the unit has fly/swim/climb; a *Dash* toggle doubles the limit for this turn).
- **Rewind** button (the controlling player and the GM): moves the token back along its recorded path to the last
  position that was a multiple of 5 ft. Example: moved 13 ft → rewind puts it where it was at 10 ft (3 ft back).
  Pressing again while on a multiple of 5 goes back another 5 ft, down to the turn's starting position.
- The path resets when the turn changes; the GM moving a token outside its turn isn't counted.
- **Done when:** the path math (summing segments, the "last multiple of 5" point, interpolating inside a segment) is
  unit-tested, and live a player's 13 ft move rewinds to the 10 ft point and a move past speed shows red for both
  the player and the GM.

### F15 · Player D&D Beyond sync (own unit only)
- A player sees **Sync from D&D Beyond** on their player view, next to each unit they control. It works like the
  GM's party sync, limited to that one character: it opens the character's D&D Beyond page, the bookmarklet (running
  in the player's own logged-in tab) sends the character back, and Butler converts it with the same code as the
  party sync and updates that unit's sheet.
- Only the sheet changes. Position, image, initiative and live state stay as they are; current HP follows the same
  "keep from token / take from D&D Beyond" choice as the GM's sync. The D&D Beyond character id remembered on the
  unit (from an earlier GM sync) picks the right character; a player can't overwrite a unit they don't control.
- If players can't write token metadata in the room, the player's client sends the converted sheet (≤ 16 kB, fits
  one broadcast) to the GM's client, which checks the player controls that unit and applies it.
- The GM sees a notice ("Worg synced Thorn from D&D Beyond") and can turn player syncing off with the player-edits
  setting.
- **Done when:** a player re-syncs their own character after levelling up on D&D Beyond and the GM's card shows the
  new numbers, and the same player can't sync a unit they don't control.

---

## Phases

Each phase ends with tests green, a build deployed to Pages, and a short live check in Owlbear. Forge support is
dropped in phase 1 (no compatibility layer, no conversion: saved Forge units and party members are discarded and
re-added). Between phases 1 and 3 there is no initiative tracker; that gap is accepted.

| # | Phase | Features | Exit check |
|---|---|---|---|
| 0 | **Foundations & spikes** | background script; context menu; card popover; broadcast + notifications to a player; measure metadata limits with the biggest sheets; `UnitSheet` + `GameSystem` skeleton; room settings | spike results written into DEVELOPMENT.md |
| 1 | **Native data** | F1, F9 (data side) | all converters write native sheets only; Forge code, constants, system check and README requirement removed; Combat tab (difficulty, initiative rolls) reads native data |
| 2 | **Card + dice** | F2, F3, F7 | live: GM and player roll from cards, public/private correct |
| 3 | **Combat core** | F4, F5, F10, F6 (+ Dead, Death Saves and Stable, ahead of the rest of F11) | live: 5-round fight with notifications, HP edits, a PC dropping to 0 (Death Saves) then marked dead, Mark as dead on the active unit and on others, reset |
| 4 | **Conditions + movement** | F11, F14 | durations expire on the right turn; concentration prompts; a 13 ft move rewinds to 10 ft |
| 5 | **Players & party** | F12, F13, F15 | second account runs through the player checklist, including a self-sync from D&D Beyond |
| 6 | **Collection, 2014 rules, release** | F8, F9 (rules side) | README/DEVELOPMENT rewritten; CHANGELOG; release **2.0.0** |

## Risks and how they're handled
- **Metadata size.** Big spellcasters may approach Owlbear's per-item/per-update limits. Phase 0 measures this;
  fallback: compress long text, or store each distinct sheet once in scene metadata and reference it.
- **Concurrent edits** (GM and player at once). Separate `sheet`/`state` keys and field-level updates via
  `updateItems`; encounter state written by the GM only, player "end turn" sent as a request the GM's client applies.
- **Notifications need someone's background running.** The background runs for every client with the room open, so
  turn notices work even with popovers closed; tested in phase 0.
- **Late joiners miss earlier rolls** (broadcasts aren't stored). Accepted; the log is per session.

## Decisions (all made 2026-11-08)
- **D1. Forge:** native-only from phase 1, no Forge compatibility or conversion; existing Forge units and party
  members are discarded.
- **D2. Players' private rolls:** visible to that player and the GM.
- **D3. Collection storage:** the GM's browser, with JSON export/import.
- **D4. What players see of units they don't control:** name, image and conditions (Dead, and Bloodied in 5.5E,
  included). No card, stats or HP.
- **D5. Player edits:** players may change their own units' HP, conditions and initiative and end their own turn; the
  GM can turn this off.
