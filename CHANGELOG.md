# Changelog

## Unreleased (2.0.0, in progress)

- **No more Forge!** Encounter Butler stores each unit's stat block and live state (HP, initiative, party) on the token itself and works on its own. Units created with Forge aren't converted: add them again. See [docs/ROADMAP.md](docs/ROADMAP.md) for what's coming (unit cards with clickable dice, initiative tracker, HP, conditions, player view).
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
