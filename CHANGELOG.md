# Changelog

## 1.0.0 — 2026-11-04

First public release. Install in Owlbear Rodeo with
`https://corrida-repos.github.io/owlbear-rodeo-butler/manifest.json` (see the [README](README.md)).

- **Monsters tab:** search every 5etools creature (112 books, 2024 versions marked), set quantities, and add them at the centre of the view. Each creature gets its own HP (average or rolled), individually rolled initiative (advantage handled), a Forge! stat block with dice chips, and a place in the tracker. Adds can be undone. Custom creatures can come from a pasted 5etools JSON or quick stats, with art from the Owlbear library, an https link, or a placeholder.
- **Party tab:** the "Copy party for Encounter Butler" bookmarklet reads your D&D Beyond campaign in your own browser. **Paste party** computes each character's HP, AC (including party-stash armor), saves, skills, initiative, attacks, actions, features and spells, and writes them to the matching tokens. It can also create missing tokens, use round D&D Beyond portraits (with undo), and roll initiative.
- **Prepared encounter tab:** import a package with a map, grid alignment, positioned tokens and pre-rolled initiative. Duplicate detection, replace and undo are included.
- Requires the Forge! extension on its default D&D 5E system.
