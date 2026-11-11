![Encounter Butler: a die-headed butler serving dice beside adventurers and wolves on a miniature forest battlefield.](docs/assets/encounter-butler-hero.png)

# Encounter Butler

### Set the scene. Serve the rolls. Keep combat moving.

A combat assistant for [Owlbear Rodeo](https://www.owlbear.rodeo): bring in creatures and your party, open their stat cards, and roll straight from the action. Built for D&D 5.5E (2024), with a 5E (2014) setting.

**[Install](#install-in-owlbear-rodeo)** · **[How to play](docs/USAGE.md)** · **[Roadmap](docs/ROADMAP.md)** · **[Developer guide](docs/DEVELOPMENT.md)**

> **2.0 is here.** Butler now runs a whole encounter on its own, no Forge! needed. See the [changelog](CHANGELOG.md) and [releases](https://github.com/corrida-repos/owlbear-rodeo-butler/releases) for what's new; the [roadmap](docs/ROADMAP.md) records how each part was checked.

## Your encounter, at hand

**Bring the cast.** Search published creatures from 5etools (filter by CR, type, environment, size or spellcasting), build a homebrew unit and keep it in your collection, or sync your D&D Beyond campaign. Add one wolf or a whole pack, with individual HP and initiative. D&D Beyond is optional; sidekicks and party members can be added directly.

**Play from the card.** Each token carries its stat block. Open a unit card for abilities, attacks, spells and clickable dice. Roll with advantage or disadvantage, follow an attack with damage, and choose public or private results.

**Keep the table together.** Run initiative, turns, HP, conditions and movement from the tracker. Give players control of their units: they get turn notices, their own cards and the initiative order, and can update their HP or re-sync from D&D Beyond. Use the difficulty calculator to assess the opposition.

<picture>
  <source media="(max-width: 600px)" srcset="docs/assets/encounter-flow-mobile.svg">
  <img src="docs/assets/encounter-flow.svg" alt="Add creatures and party, open cards and roll, then run initiative, turns, HP, conditions and movement." width="1080">
</picture>

### What's in 2.0

| Area | What you get |
|---|---|
| Creatures & party | Published creatures, homebrew, quantities, rolled HP, D&D Beyond party sync and prepared encounter imports. |
| Cards & dice | Native stat blocks, clickable rolls, advantage/disadvantage, critical damage, public/private rolls and a session log. |
| Unit identity | Portraits, names, aliases and controlling players. Players can open their own cards. |
| Combat core | Tracker, turn controls, rounds, HP/temp HP, Death Saves status, Stable, Dead, turn notices and an active-turn ring. |
| Conditions & movement | Conditions with durations, concentration checks, token badges, and a movement tracker with Dash and Rewind. |
| Players & party | Player initiative view, player edits to their own units, party view, and players re-syncing their own character from D&D Beyond. |
| Collection & rules | A saved creature collection with tags and export, search filters, and both 5.5E (2024) and 5E (2014) rules. |

One extension for a whole encounter. The [2.0 roadmap](docs/ROADMAP.md) lists every feature with how it was checked.

## Install in Owlbear Rodeo

You need an Owlbear Rodeo account and a room where you are the **GM**. Players do not need to install anything separately.

1. On the Owlbear home page, open **Profile → Extensions → Add Custom Extension** and paste:

   ```text
   https://corrida-repos.github.io/owlbear-rodeo-butler/manifest.json
   ```

2. Open your room, click **Extensions** (the puzzle piece), and enable **Encounter Butler**.
3. Open Butler from the room toolbar. In **Combat → Game system**, choose your edition. **D&D 5.5E (2024)** is the default.

The hosted extension updates without a download or reinstall. **Upgrading from 1.x?** If the right-click *View unit card* or turn notices don't appear, remove Encounter Butler in **Profile → Extensions** and add the link again: Owlbear keeps the old manifest, and 2.0 adds a background page.

**Coming from Forge?** Butler 2.0 uses its own token data. Existing Forge units are not converted; add them again through Butler.

## Start with one small encounter

1. **Add Creatures:** search for a creature, put it on the list, set a quantity and add it to the scene.
2. **Add Party:** add characters or companions directly, or use **Sync from D&D Beyond**. The sync needs a one-time bookmark setup in a desktop browser and access to the campaign you DM.
3. **Open a card:** right-click a Butler token → **View unit card**. Click a roll; hold **Shift** for advantage or **Ctrl/Cmd** for disadvantage.
4. **Tracker:** roll initiative, press **Start combat**, and move through turns. Enter `-7` for damage, `+5` for healing or `t5` for temporary HP.

The [player guide](docs/USAGE.md) covers homebrew, party sync, combat controls, player access and troubleshooting. To package a map with positioned creatures, follow the [prepared encounter workflow](docs/DEVELOPMENT.md#new-encounter-workflow).

## Your table's data

Butler has no separate account, subscription or application backend. Unit sheets and combat state live in Owlbear token and scene metadata. D&D Beyond sync reads sheets in your logged-in browser and sends the export back to the extension, with clipboard fallback; your login credentials stay in that tab.

Creature data and art load from public 5etools repositories on GitHub. D&D Beyond portraits use the [wsrv.nl](https://wsrv.nl) image proxy. See [privacy and limitations](docs/USAGE.md#privacy) for details. Token metadata is readable by technically savvy players, so card visibility does not secure hidden stat blocks.

**Current limits:** square grids; no automatic active-spell AC adjustments or combined multiclass spell slots. Butler is a combat companion, not a full character-sheet replacement.

## Build with us

Found a rough edge? [Report a bug or suggest a feature](https://github.com/corrida-repos/owlbear-rodeo-butler/issues). Include your rules edition, what you expected, and what happened. Avoid posting private character exports.

For local development, use Node.js (CI uses **22**) and npm:

```bash
npm ci
npm test
npm run build
npm run dev
```

The extension is served under `/owlbear-rodeo-butler/`. Architecture, local installation in Owlbear, encounter tooling and validation notes are in the [developer guide](docs/DEVELOPMENT.md).

---

Encounter Butler is an unofficial fan project, not affiliated with or endorsed by Owlbear Rodeo, D&D Beyond or Wizards of the Coast. The banner is AI-generated brand artwork, not a screenshot of the extension.
