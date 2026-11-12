# Encounter Butler: developer guide

Architecture, build pipeline, prepared-encounter format and verification notes. For installing and using the extension as a DM, see the [README](../README.md).

## Architecture

```
encounters/<id>/encounter.source.json   ← written per encounter (by the AI or the GM): map, creatures, placements
        │  npm run encounter:build      (Node CLI: fetches 5etools stats, converts to unit sheets, rolls HP/initiative)
        ▼
public/encounters/<id>/encounter.json   ← self-contained ENCOUNTER PACKAGE (data only, versioned, re-importable)
public/encounters/<id>/assets/*         ← map / custom art, hosted on GitHub Pages
        │  Owlbear extension popover (this repo's Vite app): Load → Preview → Import → Report/Undo
        ▼
Owlbear scene: MAP item + CHARACTER tokens with dev.owlbear-butler/sheet + /state metadata → initiative, unit cards
```

| Layer | Files | Notes |
|---|---|---|
| Core (pure TS, fully unit-tested) | [src/core/](../src/core/) | schema + validation, dice/initiative, 5etools → unit sheet conversion, grid math, the importer itself (talks to an abstract `SceneGateway`) |
| Owlbear adapter + UI | [src/extension/](../src/extension/) | ~40-line SDK adapter ([obrGateway.ts](../src/extension/obrGateway.ts)) + popover UI |
| Package builder CLI | [scripts/build-encounter.ts](../scripts/build-encounter.ts) | turns a source spec into a package |
| Content | [encounters/](../encounters/) | one folder per encounter; **no code change per monster** |

### Key design decisions (from research, 2026-11-04)
- **Owlbear SDK 3.1.0** (`@owlbear-rodeo/sdk`): items are created with `buildImage(...)` + `OBR.scene.items.addItems`. The map image's grid `dpi`/`offset` aligns it to the scene grid. Scene grid scale and type are set with `OBR.scene.grid.setScale/setType`. Scene DPI can't be set, so it's read and used.
- **Units live on the token (2.0, no Forge).** Each unit token carries `dev.owlbear-butler/sheet` (the stat block, a versioned `UnitSheet`, see [sheet.ts](../src/core/sheet.ts)) and `dev.owlbear-butler/state` (HP, temp HP, initiative, conditions, party, controlling player). State is patched field by field (`SceneGateway.patchMetadata`, one atomic `updateItems`), so a GM edit and a player edit to different fields don't overwrite each other. Rollable text uses `[1d20+4]` chips. Until 1.x the extension wrote Forge! 1.6.0's internal metadata instead; that code was removed in 2.0 and Forge units are not converted.
- **Asset hosting.** Players' browsers load every image, and Owlbear renders with WebGL, so image hosts must be public HTTPS and send CORS headers. Supported sources:
  1. **GitHub Pages** (this repo): maps and custom art in `public/encounters/<id>/assets/`. Free, permanent, CORS `*`.
  2. **5etools-img** on `raw.githubusercontent.com` for official tokens. These are hot-linked (CORS `*` verified) rather than re-hosted, so book art isn't redistributed from your repo.
  3. **Owlbear library** (`"kind": "library"`): the importer opens Owlbear's own asset picker (`OBR.assets.downloadImages`) and uses the Owlbear-hosted URL. This works without any hosting, at the cost of one click per asset.
  - `blob:`, `data:`, `file:`, `http:`, localhost and LAN URLs are **blocked**. There is a GM-only override for testing, clearly labelled.

## Who does what

| Step | Who |
|---|---|
| Read your map/description; decide grid size (cellPx, offset), cell positions, size categories; note assumptions | **AI** (writes `encounter.source.json`) |
| Find the correct stat block: your upload > official book > 5etools (matching source/edition; 2024 by default); preserve adventure NPCs & homebrew; flag gaps | **AI** (custom stat blocks go in the source spec with `provenance`) |
| Find artwork / generate homebrew art (when the image tools allow) and place it in `assets/` | **AI** |
| Fetch 5etools stats, convert to unit sheets with dice chips, roll HP (average or rolled) and initiative (adv/dis, cancel rule) and record every die | **Code** (`npm run encounter:build`) |
| Validate the package and its stat blocks; check duplicates, grid and asset reachability; show a preview | **Code** (extension) |
| Add map + tokens, set grid, put the creatures in the initiative, verify, record, and offer undo | **Code** (extension) |
| Commit/push the encounter folder (Pages deploys it), then open the extension in Owlbear and click Import | **You** (manual, ~1 min) |

## Setup

```bash
npm install
npm test                 # 28 unit + end-to-end tests (no Owlbear needed)
npm run dev              # serves the extension at http://localhost:5173
```

**Free hosting (recommended):** push this repo to GitHub, then **Settings → Pages → Source: GitHub Actions**. [pages.yml](../.github/workflows/pages.yml) tests, builds and deploys on every push to `main`. A GitHub Pages site is public; anyone with the URL can see the map and package files.

**Install in Owlbear:** Owlbear → profile → *Extensions* → *Add Custom Extension* → `https://corrida-repos.github.io/owlbear-rodeo-butler/manifest.json`, or `http://localhost:5173/owlbear-rodeo-butler/manifest.json` while developing. Enable **Encounter Butler** in the room.

## New encounter workflow

1. Put the map and `encounter.source.json` in `encounters/<id>/` (format below).
2. `npm run encounter:build -- encounters/<id>/encounter.source.json`
   This prints every creature's HP, the initiative dice/modifier/mode/total, sources, flags and assumptions.
3. `git push`, then in Owlbear: Encounter Butler → paste `https://corrida-repos.github.io/owlbear-rodeo-butler/encounters/<id>/encounter.json` → Load → review → Import.

Rebuilding re-rolls. Importing **never** re-rolls a package's recorded initiative. It only rolls (and reports) for creatures whose `initiative` is `null`.

### Source spec (what the AI writes)
```jsonc
{
  "id": "church-ambush", "title": "…", "description": "…", "rules": "2024",
  "map": { "name": "Church", "file": "church.jpg",              // or "image": {"kind":"library","search":"Church"} + width/height
           "grid": { "cellPx": 140, "offsetPx": {"x":12,"y":8}, "scale": "5ft" } },
  "groups": [
    { "statblock": { "fivetools": { "name": "Wolf", "source": "XMM" } }, "token": "fivetools",   // "source" optional: omit to prefer the 2024 version
      "count": 5, "name": "Wolf {n}", "hp": "average",          // or "roll"
      "placements": [ {"x":8,"y":3,"note":"north"}, … ],        // top-left cell, 0-based, one per creature
      "hidden": false },
    { "statblock": { "custom": { /* full Statblock: provenance "user-provided" | "adapted" | "homebrew" */ } },
      "token": { "kind": "url", "url": "garrow.png", "credit": "AI-generated", "provenance": "generated" },
      "placements": [ {"x":10,"y":2,"note":"at the altar"} ],
      "initiative": { "advantage": true, "reason": "DM: Garrow is expecting them" } }
  ],
  "assumptions": ["Map grid estimated at 140 px from the pew spacing — adjust cellPx if tokens look off-scale."]
}
```

## 2.0 foundations (phase 0, see [ROADMAP.md](ROADMAP.md))

New pages: [background.html](../background.html) (`background_url` in the manifest: context menu + roll notifications for
every client) and [card.html](../card.html) (unit card popover, `?id=<itemId>`). New core modules:
[sheet.ts](../src/core/sheet.ts) (native `UnitSheet` + `UnitState` under `dev.owlbear-butler/sheet` and `/state`),
[systems.ts](../src/core/systems.ts) (5.5E default, 5E; conditions incl. automatic Bloodied / Death Saves, Stable, Dead;
concentration DC), [settings.ts](../src/core/settings.ts) (room settings) and [rolls.ts](../src/core/rolls.ts) (roll
broadcast messages and visibility).

**Action bar:** [actions.html](../actions.html) (`?id=<itemId>`, [src/actions/main.ts](../src/actions/main.ts)) renders
[actions.ts](../src/core/actions.ts), a read-only reference built from the sheet: section → cost, `SheetEntry.cost`
(D&D Beyond spell casting time), limits / recharge / legendary cost parsed from entry names, and `explain()` for the
plain-language "How it works". [combatOptions.ts](../src/core/combatOptions.ts) holds the PHB / DMG combat options with
numbers from the sheet, per edition. It stores nothing; rolls stay on the card.

**Combat HUD:** [hud.html](../hud.html) ([src/hud/main.ts](../src/hud/main.ts)), opened per player by the background page
while combat runs (`disableClickAway`, `hidePaper`). [economy.ts](../src/core/economy.ts): `UnitState.turn` holds the
spent markers for the round of the unit's own latest turn (`ownTurnRound`), so they reset when its turn starts. Players
change them with the `economy` request (not gated by player edits). The HUD's ✕ / "Show my combat HUD" talk to the
background over a LOCAL broadcast (`HUD_CHANNEL`).

**Limits (Owlbear docs, checked 2026-11-08):** broadcast messages ≤ 16 kB; room metadata ≤ 16 kB in total for all
extensions. No documented limit for item metadata (256 kB on one token tested fine, see below).

**Sheet size (measured 2026-11-08, `npm run check:5etools`, all 4,574 creatures):** per-token stat metadata median
2.7 kB, 99th percentile 5.6 kB, max 7.9 kB (Vampire Spellcaster, Strahd). None over 16 kB, so a sheet also fits in one
broadcast message.

**Verified live (2026-11-08, GM + player in two browsers, dev build):**
- The background page loads for the GM and for the player, also with no popover open, and registers the context menu.
- Right-click a Butler unit → *View unit card* opens the card popover for that token (GM).
- A public roll from the card shows as a notification for the GM and the player; a private GM roll is sent LOCAL
  and shows only for the GM.
- Item metadata: 8 to 256 kB written to one token and read back intact (card → *Diagnostics*), so sheets (max 7.9 kB)
  are far from any limit.
- **Players can't select tokens they don't own**, so the token context menu never shows Butler items to a player for
  monsters. Players open cards from the popover instead (phase 2). A player's private roll is checked in phase 2.

### Dev tools
- **Localhost install:** `npm run dev` serves the manifest as *Encounter Butler (dev)* with CORS and Chrome's
  private-network header (`Access-Control-Allow-Private-Network`), which Owlbear's https page needs to fetch it.
  Disable the Pages copy in a room while the dev copy is enabled.
- **Log relay:** in dev, every extension page forwards `console.*` output and uncaught errors to the dev server, which
  appends them to `.cache/devlog.txt`, tagged with page, role and player name (e.g.
  `[background.html PLAYER:Worg:eea1]`). Owlbear runs the pages in cross-origin iframes, so this is the easiest way to
  see GM and player logs side by side. See [devlog.ts](../src/extension/devlog.ts).

## Unit card and dice (phase 2)
- [card.ts](../src/core/card.ts): who sees what (`cardAccess`: GM everything; a player the full card of units they
  control, else name/alias, portrait and conditions; nothing for hidden tokens), shown names and aliases, portraits,
  and the standard rolls (ability checks, saves, skills, initiative with its built-in advantage).
- [chips.ts](../src/core/chips.ts): splits sheet text into text and roll segments. The printed value before a chip is
  folded into the button (`+4 [1d20+4]` → **+4**), the kind is guessed from context (attack / save / check / damage /
  plain dice, plus the damage type), and bare `(2d6 + 6)` without a chip also becomes rollable. `check:5etools`
  reports chip statistics over every creature.
- [dice.ts](../src/core/dice.ts) rolls `kh`/`kl` terms; advantage turns the leading `1d20` into `2d20kh1`; crits double
  every damage die. [rolls.ts](../src/core/rolls.ts) messages carry mode, crit, the natural d20 and every die rolled.
- The background page writes every roll this client may see to a per-room log in localStorage
  ([rollLog.ts](../src/extension/rollLog.ts)); the card and popover read it and follow the `storage` event (all
  extension pages share one origin).
- `controlledBy` stores the Owlbear user id (`Player.id`, the same across tabs and reconnects).

## Tracker, turns and HP (phase 3)
- [encounter.ts](../src/core/encounter.ts): the scene's encounter record (`dev.owlbear-butler/encounter`: started,
  round, active unit, its index, turn history) and pure turn logic. Order: initiative, then the GM's tie order
  (`state.initiativeTiebreak`), initiative modifier, Dex, name. If the active unit leaves, the unit that takes its
  place goes next; `passTurnFrom` is used before Mark as dead / Remove from initiative.
- [hp.ts](../src/core/hp.ts): damage/heal/set/temp rules and the 0-HP statuses (Death Saves, Stable, Dead); returns
  a state patch plus events for the UI. [tracker.ts](../src/core/tracker.ts): the GM operations on the gateway.
- Players can only change tokens they own and can't write scene metadata, so a player's *End my turn* and death
  saves go to the GM's client over broadcast ([turns.ts](../src/core/turns.ts)). Only one GM client applies them
  (the one with the smallest connection id), so two GM tabs don't double-advance.
- The background page watches the encounter and items on every client: turn notices for the unit's controller, the
  active-turn ring (a local `CIRCLE` shape attached to the token, so each client draws its own and hidden tokens
  get none for players), and optionally moving the view to the active unit.
- Context-menu items for the GM are filtered by `roles: ["GM"]`; their labels toggle with nested metadata filters
  (`["metadata", STATE_KEY, "inEncounter"]`).

## Conditions and movement (phase 4)
- [conditions.ts](../src/core/conditions.ts): add/remove, exhaustion, durations stored as `until` plus `from` (the
  round and active unit when applied) and checked on each forward turn change by the primary GM client
  (`expireConditions`); Previous turn doesn't expire or restore anything. Concentration checks are a
  `state.concentrationCheck` set by [hp.ts](../src/core/hp.ts) and cleared by the save.
- [movement.ts](../src/core/movement.ts) is the pure path math; [background/movement.ts](../src/background/movement.ts)
  records the active unit's moves on the primary GM client (segment length = `grid.getDistance` × the grid scale), keeps
  the record in memory, mirrors it to scene metadata (`dev.owlbear-butler/movement`) and runs tracking, Rewind and Dash
  one at a time, so a Rewind's own token move is never counted as movement.
- Badges and the movement label are local `Label` items ([overlays.ts](../src/background/overlays.ts)); labels are
  drawn at a fixed screen size, so their font and padding are in screen pixels.

## Players and party (phase 5)
- Player edits (D5) are requests on `dev.owlbear-butler/request` ([turns.ts](../src/core/turns.ts)): the primary GM
  client checks the sender controls the unit (or is a GM) and, for edits (`EDIT_REQUESTS`), that the room allows
  player edits, then applies them with the same tracker functions the GM uses.
- Player D&D Beyond self-sync: the bookmarklet exports one character when run on `/characters/<id>`; the player's
  popover converts it ([party.ts](../src/core/party.ts) `partyFromDdbExport`) and sends a `sheet-sync` request.
  Converted sheets are 15–19 kB, so requests over 14 kB go in chunks on `dev.owlbear-butler/request-chunk`
  ([chunks.ts](../src/core/chunks.ts)). `applySelfSync` refuses a different D&D Beyond id (or, before the first sync,
  a name that doesn't match the token) and keeps the unit's live state.
- Aliases: while one is set, the token label shows the alias (players see the map) and the item name keeps the real
  name; `unitName(item, sheet, state)` reads it accordingly.

## Search filters, 2014 rules, collection (phase 6)
- [habitat.ts](../src/core/habitat.ts) + `npm run index:build`: every creature in `public/data/monsters.json` gets an
  environment (5etools, the same creature in another book, or assigned by rules, marked `~`) and a spellcaster flag;
  [search.ts](../src/core/search.ts) filters the index (CR range, types, environments, sizes, spellcaster).
- 2014 rules: [combat.ts](../src/core/combat.ts) `difficulty2014` (DMG thresholds × the group multiplier, adjusted
  for party size) and one `DifficultyView` for both systems; creatures' initiative uses Dex in 2014 rooms
  (`initiativeSetupFor(…, rules)`); `editionText` swaps the attack wording on cards.
- Collection: [collection.ts](../src/core/collection.ts) (entries, tags, search, export/import merge) and
  [collectionStore.ts](../src/extension/collectionStore.ts) (IndexedDB, a BroadcastChannel keeps the pages in step).

## Combat tab
[src/core/combat.ts](../src/core/combat.ts): units are CHARACTER-layer images with a Butler sheet. Party = `state.party`. Difficulty uses the 2024 DMG per-character XP budgets (Low/Moderate/High) and XP by CR, plus an invented Extreme tier (1.5× High); the tier is the highest budget reached. Per-token settings (`exclude`, `level`) are stored in `dev.owlbear-butler/combat`. Initiative re-rolls use the recorded `initiativeSetup` (written by quick add, the importer and party sync), else the last roll's modifier/mode, else Forge Dexterity.

## 5etools creatures
- **Any book or adventure in 5etools** works. Books are discovered from 5etools' own `data/bestiary/index.json` (112 sources), and titles come from `books.json`/`adventures.json`. Files are fetched on demand and cached in `.cache/5etools/`.
- **No book given** (`{"name": "Bandit"}`): the 2024-rules version is preferred, then the newest book. The choice is recorded as an assumption. If you name a 2014 creature that has a 2024 reprint, it is kept as asked and flagged "a newer version exists".
- The rules edition is **inferred from the publication date** (on or after the 2024 PHB means 2024), because 5etools doesn't tag editions. The stat block's source notes say so.
- **Copies, templates and variants** (`_copy`: about 25% of all 5etools creatures, mostly adventure NPCs) are resolved following 5etools' own merge rules, including copies whose base creature is in another book. Supported: every `_mod` operation (text and array edits, spell add/replace/remove, skills, saves, senses, scalar hit/DC changes, size caps), templates, `_preserve`, and `<$name$>`-style variables. The card notes record the chain, e.g. "copy of Archmage (MM) → template Tiefling (PHB)".
- **Token art:** the creature's own token is used first, then its own book art, then (for copies) the base creature's token or art. Anything other than its own token produces a warning.
- `npm run check:5etools` converts **every** 5etools creature (4,574 in total, 1,144 of them copies) and validates the unit sheet each would get. Last run (2026-11-08): 4,574/4,574 OK; unit metadata median 2.3 kB, max 7.4 kB.

## Party sync (D&D Beyond → party tokens)
D&D Beyond has no public API. The export runs inside your logged-in D&D Beyond tab and uses the same character-service endpoints the sheet uses, with your own session; the login token never leaves the page. You must be the campaign's DM, or the characters must be visible to you.

**One-button sync (extension, v1.1):** the extension can't call D&D Beyond itself (checked 2026-11-06: `character-service.dndbeyond.com` sends no CORS headers). Instead **Sync from D&D Beyond** `window.open`s the campaign page (the id is remembered from the last export). The bookmarklet, built with the extension's own origin as `targetOrigin`, posts the export back with `window.opener.postMessage`. The popover accepts only messages from `https://www.dndbeyond.com` of type `encounter-butler/ddb-export`, then syncs automatically unless the preview has ambiguities or errors. The clipboard copy stays as a fallback.

Manual / CLI route:

1. **Export:** in a dndbeyond.com tab, run [scripts/ddb-export.browser.js](../scripts/ddb-export.browser.js) with `await ddbExport(<campaignId>)`. It downloads `ddb-party-<campaign>.json`: every character in the campaign, plus the shared **party-inventory** items each character has equipped (an armor taken from the party stash changes AC).
2. **Convert:** `npm run party:build -- party/ddb-party-<campaign>.json` writes `party/<campaign>.party.json`. `party/` is git-ignored, so your players' sheets are never published.
3. **Sync in Owlbear:** Encounter Butler → choose the file (or paste it) → preview → **Sync party**.
   - Tokens are matched on the Character layer by D&D Beyond id (after the first sync), full name, or unique first name.
   - Only the sheet and state are written. Position, image, owner, conditions and other extensions' data are untouched; initiative only changes if you choose to roll it. Party members get `state.party: true`.
   - **Current HP:** taken from D&D Beyond, or kept from the token (useful mid-session).
   - **Initiative:** rolls `1d20 + modifier` from the sheet (2d20 keep-highest with advantage, e.g. Alert-style features) for party members whose token has none (missing or 0, e.g. after "Reset Round & Initiative"). It can instead re-roll everyone or leave it to the players. The choice is remembered. Every roll is recorded on the token (dice, modifier, mode, total) and listed in the report.
   - **Missing tokens** can be created. D&D Beyond avatars **can't** be used, because D&D Beyond blocks cross-site image use (verified). Use the bundled placeholder (swap later via right-click → Replace Image) or pick an image from your Owlbear library.

**What's computed:** ability scores (base + species/background/feat bonuses, overrides) and HP (base + Con × level + per-level bonuses such as Tough). **AC** uses the best equipped armor including party-stash items, the Dex cap, shields, item, feat and fighting-style bonuses (attunement-aware), and Unarmored Defense. Also computed:
- saves, skills (proficiency, expertise, half-proficiency, ability-based bonuses), passives
- initiative (Dex + bonuses; Alert's "+PB" encoded as a proficiency-bonus modifier) and advantage
- speeds, senses, languages, resistances and immunities
- weapon attacks (finesse/ranged ability, proficiency, magic bonus, versatile), including gear with weapon behaviour, such as a druidic Staff counting as a Quarterstaff
- D&D Beyond actions, sorted into action, bonus action, reaction or other, with limited uses; class/subclass features up to the current level; species traits; feats
- spellcasting DC and attack, slots used, prepared or known spells with dice chips (cantrips scaled by level), species/feat spells, and inventory

**Verified 2026-11-04** against D&D Beyond's displayed sheet for 3 real characters (Wizard 2, Sorcerer 2, Druid 2): HP, AC, initiative, speed, all saves, passives, skills and attacks match. The first comparison caught the party-inventory armor, which is now handled. Synced live into Owlbear: tracker HP/AC and the unit cards (attacks and spells with dice chips) show correctly.

**Known gaps:** active spell effects (Mage Armor, Shield) aren't applied. Multiclass spell slots aren't combined. Items granting fixed AC formulas beyond Unarmored Defense are flagged rather than guessed.

## Initiative rules implemented
- Modifier: an explicit initiative value if the stat block has one. Otherwise Dex mod, plus `proficiency × PB(CR)` when the 2024 stat block marks initiative proficiency (×2 = expertise; the Aboleth's +7 is tested).
- Trait/feature text adds unconditional effects automatically: "advantage on initiative rolls" (e.g. Alert, Combat Ready), "+N bonus to initiative" (2014 Alert), and "adds its proficiency bonus to initiative".
- **Situational** effects ("*If* the broom is motionless at the start of combat, it has advantage…"), and dice added to initiative, are **not** applied automatically. They're shown as flags in the preview. When the encounter description makes them true (for example, the mimic is disguised as a chest), the encounter spec turns them on with a recorded reason: `"initiative": {"advantage": true, "reason": "disguised as a chest"}`.
- A DM override can also set the modifier or disadvantage. Advantage plus disadvantage cancel.
- Normal is `1d20+mod`. Adv/dis rolls `2d20`, keeps the high/low die, then adds the modifier. Every package records `dice`, `kept`, `modifier`, `mode`, `total`, `formula`, `rolledAt` and `rolledBy`, and the same record is stored on each token under `dev.owlbear-butler/import`.

## Validation status

**Verified locally (2026-11-08, 2.0 in progress)**
- `npm test`: 86 tests pass, covering dice and initiative modes, 5etools → unit sheet conversion (Wolf, Aboleth, Priest from real 2024 MM data), copy/template resolution on real 5etools NPCs (Bitter Breath, Zariel, Traxigor, Cat Skeleton, Arabelle, Reduced-Threat Aboleth, Sylvira Savikas), D&D Beyond conversion, initiative detection from trait text, and picking a source when no book is given. They also cover grid/placement math, the asset URL policy, quick add, party sync (state kept across re-syncs), the Combat tab, game systems (Bloodied, Death Saves, Stable, concentration DC), roll visibility, and an end-to-end import into an in-memory scene: duplicate detection, replace, existing units and encounter state preserved, abort cases, import-time rolls, partial failure with rollback, and the bundled package being valid.
- `tsc` is clean, and `vite build` produces `dist/` with the manifest, popover, background page, card page, and the wolves package and map.

**Verified live in Owlbear (1.0, 2026-11-04, with Forge)**: map/grid alignment, token placement and footprint, duplicate detection. The Forge-specific checks no longer apply.

**Not yet verified live for 2.0**: everything that touches the new format in a real room (see the checklist below), the Owlbear library picker path, Replace/Undo in a real scene, and a second player viewing the scene.

## Milestone live test: one map, five wolves

1. `npm run dev`. In an Owlbear room, add `http://localhost:5173/owlbear-rodeo-butler/manifest.json` and enable Encounter Butler.
2. Open a **new empty scene**. Add one party member (Add Party Members) so existing units can be checked afterwards.
3. Encounter Butler → **Prepared encounter** → **Bundled wolves test** → Load. Expect: package valid, 5 rows with HP 11/11 and AC 12, initiative shown as `d20 N +2 = T`.
   - On localhost, the map URL is flagged "not reachable by players". Tick the **GM-only override** for this first test. Players will see the map only once you load it from GitHub Pages.
4. **Import.** Check that:
   - the map sits on the grid (its dark grid lines align with Owlbear's 5 ft grid)
   - the five wolf tokens are 1 cell each, at the north/south tree lines and the east path
   - Combat → *Current order* lists Wolf 1–5 with the exact initiative totals from the preview, and your party member is unchanged
   - right-click a wolf → *View unit card* opens the card for that wolf
5. Click Import again. The duplicate warning should appear and block the import. Try *Replace*, then *Undo this import*.
6. Repeat from the Pages URL with a player connected, to confirm they see the map and tokens.

## Known limits
- Square grids only. No fog, walls or lighting (out of scope by request).
- Lair actions and regional effects are flagged, not listed. Mythic actions are listed after the legendary actions.
- Companion and summon stat blocks that scale with the caster's level (e.g. Steel Defender) convert, but with placeholder HP and saves. They are flagged.
- Owlbear item metadata size: the preflight reports the largest token's metadata size (5etools max 7.4 kB); Owlbear documents no item limit (room metadata: 16 kB total, broadcasts: 16 kB); 256 kB on one token worked live.
