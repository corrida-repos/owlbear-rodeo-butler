# Changelog

## Unreleased (2.0.0, in progress)

- **No more Forge!** Encounter Butler stores each unit's stat block and live state (HP, initiative, party) on the token itself and works on its own. Units created with Forge aren't converted: add them again. See [docs/ROADMAP.md](docs/ROADMAP.md) for what's coming (unit cards with clickable dice, initiative tracker, HP, conditions, player view).
- **Unit cards:** right-click a unit → *View unit card*, or click a name in the Combat tab. The card shows the whole stat block: portrait, AC, HP, initiative, speed, abilities, saves, skills, senses, defences and every trait, action, reaction, legendary action, spell and item.
- **Clickable dice:** every bonus and damage value on the card rolls. Shift-click for advantage, Ctrl/Cmd-click for disadvantage (or the toggle on the card). After an attack, the card offers its damage, and crit damage (dice doubled) after a natural 20. Rolls are **public** (everyone gets a notification) or **private** (only you; a player's private roll also goes to the GM). Each browser keeps a roll log for the session.
- **Players:** the Encounter Butler button shows a player their own units, with a button to open the card and roll. The GM picks who controls a unit on its card (*Edit unit*).
- **Initiative tracker** (new first tab): the turn order with Start combat, Next / Previous turn, the round counter, End combat and Reset round & initiative. Type players' initiative rolls, roll everyone or just the creatures, reorder ties, damage or heal from each row (`-7`, `+5`, `12`, `t5` for temp HP), and add units that aren't in the fight yet.
- **Turns:** the player who controls a unit gets "It's your turn" and "You're up next", even with the panel closed. The active unit has a ring on the map, and anyone can have their view follow it. Players can end their own turn.
- **HP, 0 HP and death:** temp HP absorbs damage first and doesn't stack. A party member at 0 HP makes death saves (rolled from their card; damage at 0 HP counts as a failure, and three successes make them Stable); a creature at 0 HP can be marked dead, or automatically by room setting. **Mark as dead** takes a unit out of initiative and passes the turn on if it was theirs; **Revive** undoes it.
- **Right-click actions (GM)** on one or more selected units: add to / remove from initiative, roll initiative, damage / heal (one amount for all, with half damage for a successful save), mark as dead, add to / remove from party.
- **Names, aliases and portraits:** rename a unit (the token label follows), show it to players under an alias ("Hooded figure") until revealed, and give it a portrait different from its token art (link or Owlbear library).
- **Game system setting:** D&D 5.5E (2024 rules, default) or 5E (2014 rules), in the Combat tab. Creature search puts the chosen edition's books first.
- Mythic actions are now listed with legendary actions. Dice chips accept any die size (e.g. d3).
- Party files from earlier versions need a fresh sync from D&D Beyond.

## 1.1.0 (unreleased, folded into 2.0.0)

- **New layout: three tabs.** *Add Creatures*, *Add Party Members* and *Combat* replace Monsters / Party / Prepared encounter. Prepared encounters are now a collapsed section at the bottom of Add Creatures.
- **Import homebrewed creature:** upload a stat block JSON file, or start from any published 5etools creature and edit its stat block before adding it. Name it yourself and give it any token (Owlbear library upload, https link, the original 5etools token or the placeholder).
- **Add Party Members:** a one-button **Sync from D&D Beyond**. It opens your campaign, and the bookmark there sends the party straight back (no clipboard step) and syncs it as Forge's Party. The campaign is remembered. Re-drag the bookmark once. Published and homebrewed party members (sidekicks, companions) can be added like creatures. Undo removes tokens a sync created and restores replaced portraits.
- **Combat tab:** encounter difficulty from the 2024 DMG XP budgets (Low / Moderate / High), plus an invented **Extreme** tier for boss fights (1.5× High). Exclude non-hostile creatures or absent characters, set levels, and see it update live. **Roll all initiatives** or **Roll just creatures' initiatives**.
- Party sync no longer rolls initiative by default (the Combat tab does); the old choices are still in *Sync options*.

## 1.0.0 — 2026-11-04

First public release. Install in Owlbear Rodeo with
`https://corrida-repos.github.io/owlbear-rodeo-butler/manifest.json` (see the [README](README.md)).

- **Monsters tab:** search every 5etools creature (112 books, 2024 versions marked), set quantities, and add them at the centre of the view. Each creature gets its own HP (average or rolled), individually rolled initiative (advantage handled), a Forge! stat block with dice chips, and a place in the tracker. Adds can be undone. Custom creatures can come from a pasted 5etools JSON or quick stats, with art from the Owlbear library, an https link, or a placeholder.
- **Party tab:** the "Copy party for Encounter Butler" bookmarklet reads your D&D Beyond campaign in your own browser. **Paste party** computes each character's HP, AC (including party-stash armor), saves, skills, initiative, attacks, actions, features and spells, and writes them to the matching tokens. It can also create missing tokens, use round D&D Beyond portraits (with undo), and roll initiative.
- **Prepared encounter tab:** import a package with a map, grid alignment, positioned tokens and pre-rolled initiative. Duplicate detection, replace and undo are included.
- Requires the Forge! extension on its default D&D 5E system.
