# Encounter Butler: Owlbear Rodeo + Forge! encounter importer

"Here is the map and encounter description" → **one import** → a runnable Owlbear scene with the map, grid, positioned tokens, Forge! stat blocks, separate HP per creature, and individually rolled initiative.

Everything here uses free tiers only: the official Owlbear SDK, Forge's built-in D&D 5E system, 5etools public data, and GitHub Pages.

## Architecture

```
encounters/<id>/encounter.source.json   ← written per encounter (by the AI or the GM): map, creatures, placements
        │  npm run encounter:build      (Node CLI: fetches 5etools stats, converts to Forge, rolls HP/initiative)
        ▼
public/encounters/<id>/encounter.json   ← self-contained ENCOUNTER PACKAGE (data only, versioned, re-importable)
public/encounters/<id>/assets/*         ← map / custom art, hosted on GitHub Pages
        │  Owlbear extension popover (this repo's Vite app): Load → Preview → Import → Report/Undo
        ▼
Owlbear scene: MAP item + CHARACTER tokens with com.battle-system.forge/* metadata → Forge tracker + unit cards
```

| Layer | Files | Notes |
|---|---|---|
| Core (pure TS, fully unit-tested) | [src/core/](src/core/) | schema + validation, dice/initiative, 5etools→Forge conversion, grid math, the importer itself (talks to an abstract `SceneGateway`) |
| Owlbear adapter + UI | [src/extension/](src/extension/) | ~40-line SDK adapter ([obrGateway.ts](src/extension/obrGateway.ts)) + popover UI |
| Package builder CLI | [scripts/build-encounter.ts](scripts/build-encounter.ts) | turns a source spec into a package |
| Content | [encounters/](encounters/) | one folder per encounter; **no code change per monster** |

### Key design decisions (from research, 2026-11-04)
- **Owlbear SDK 3.1.0** (`@owlbear-rodeo/sdk`): items are created with `buildImage(...)` + `OBR.scene.items.addItems`. The map image's grid `dpi`/`offset` aligns it to the scene grid. Scene grid scale and type are set with `OBR.scene.grid.setScale/setType`. Scene DPI can't be set, so it's read and used.
- **Forge! 1.6.0** has no public API. It reads unit data from token metadata `com.battle-system.forge/<BID>`. The full built-in D&D 5E dictionary (Z001–Z042) was **transcribed from Forge's own published bundle**, not guessed ([constants.ts](src/core/constants.ts)). It matches your experiment (Z005/Z006/Z007/Z042).
  - `fabd: true` is **required**: for non-fabricated tokens, Forge's "View Unit" re-fetches data by name and overwrites it.
  - Forge stores the loaded system in room metadata `com.battle-system.forge/SnapshotPublicId`, which is empty when the built-in system is loaded. The importer checks it and blocks if a custom system is loaded, until you confirm the BIDs match.
  - We never use the Unit Card JSON import, which was observed to clear omitted fields. All metadata is written in full at token creation.
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
| Fetch 5etools stats, convert to Forge fields with dice chips, roll HP (average or rolled) and initiative (adv/dis, cancel rule) and record every die | **Code** (`npm run encounter:build`) |
| Validate the package; check the Forge system, duplicates, grid and asset reachability; show a preview | **Code** (extension) |
| Add map + tokens, set grid, add to Forge tracker, verify, record, and offer undo | **Code** (extension) |
| Commit/push the encounter folder (Pages deploys it), then open the extension in Owlbear and click Import | **You** (manual, ~1 min) |

## Setup

```bash
npm install
npm test                 # 28 unit + end-to-end tests (no Owlbear needed)
npm run dev              # serves the extension at http://localhost:5173
```

**Free hosting (recommended):** push this repo to GitHub, then **Settings → Pages → Source: GitHub Actions**. [pages.yml](.github/workflows/pages.yml) tests, builds and deploys on every push to `main`. A GitHub Pages site is public; anyone with the URL can see the map and package files.

**Install in Owlbear:** Owlbear → profile → *Extensions* → *Add Custom Extension* → `https://corrida-repos.github.io/owlbear-rodeo-butler/manifest.json`, or `http://localhost:5173/manifest.json` while developing. Enable both **Encounter Butler** and **Forge!** in the room. Forge must be on its default system (Forge → System → *Load Default System*).

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
    { "statblock": { "fivetools": { "name": "Wolf", "source": "XMM" } }, "token": "fivetools",
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

## Initiative rules implemented
- Modifier: an explicit initiative value if the stat block has one. Otherwise Dex mod, plus `proficiency × PB(CR)` when the 2024 stat block marks initiative proficiency (×2 = expertise; the Aboleth's +7 is tested).
- Advantage/disadvantage come from the stat block's flag, trait text ("advantage on Initiative"), or an explicit DM override. Both together cancel.
- Normal is `1d20+mod`. Adv/dis rolls `2d20`, keeps the high/low die, then adds the modifier. Every package records `dice`, `kept`, `modifier`, `mode`, `total`, `formula`, `rolledAt` and `rolledBy`, and the same record is stored on each token under `dev.owlbear-butler/import`.

## Validation status

**Verified locally**
- `npm test`: 28 tests pass, covering dice and initiative modes, 5etools→Forge conversion (Wolf, Aboleth, Priest from real 2024 MM data), and the Forge dictionary and type checks. They also cover grid/placement math, the asset URL policy, and an end-to-end import into an in-memory scene: duplicate detection, replace, party tokens and Forge round state preserved, abort cases, import-time rolls, and partial failure with rollback.
- `tsc` is clean, and `vite build` produces `dist/` with the manifest, popover, and the wolves package and map.
- The dev server serves the manifest, package and map with CORS for `https://www.owlbear.rodeo`. The 5etools token URL returns 200 with CORS `*`.

**Not yet verified live in Owlbear.** These need your test below:
- that Forge picks up the tokens (tracker rows, unit cards, HP bars, dice chips) with exactly this metadata
- `buildImage` token labels and the map grid alignment on a real scene
- the Owlbear library picker path

## Milestone live test: one map, five wolves

1. `npm run dev`. In an Owlbear room, add `http://localhost:5173/manifest.json`, and enable Forge (default system).
2. Open a **new empty scene**. Add one party token yourself, set its initiative in Forge (this checks that existing state is preserved).
3. Encounter Butler → **Bundled wolves test** → Load. Expect: package valid, Forge "Dungeons & Dragons 5E", 5 rows with HP 11/11 and AC 12, initiative shown as `d20 N +2 = T`.
   - On localhost, the map URL is flagged "not reachable by players". Tick the **GM-only override** for this first test. Players will see the map only once you load it from GitHub Pages.
4. **Import.** Check that:
   - the map sits on the grid (its dark grid lines align with Owlbear's 5 ft grid)
   - the five wolf tokens are 1 cell each, at the north/south tree lines and the east path
   - the Forge tracker lists Wolf 1–5 with the exact initiative totals from the preview, and your party token is unchanged
   - right-click a wolf → *View Wolf N*: HP 11/11, AC 12, abilities, *Pack Tactics*, and *Bite* with clickable `[1d20+4]` / `[1d6+2]` chips
   - damage one wolf in Forge; only that wolf's HP changes
5. Click Import again. The duplicate warning should appear and block the import. Try *Replace*, then *Undo this import*.
6. Repeat from the Pages URL with a player connected, to confirm they see the map and tokens.

Please report anything that differs. Forge's on-token format is internal, and this is where a mismatch would show up.

## Known limits (v1)
- Square grids only. No fog, walls or lighting (out of scope by request).
- 5etools `_copy` monsters (variants) are rejected with a clear message; provide the stat block instead. Lair/mythic actions are flagged, not mapped.
- Forge `Z001 Level`, `Z029 Proficiency` (its roll formula treats the value as a level), `Z040 Inventory` and `Z041` are left unset for monsters.
- Owlbear item metadata size: the preflight reports the largest token's metadata size, but the exact Owlbear limit isn't documented in the SDK typings.
