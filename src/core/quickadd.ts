/**
 * Quick add: put creatures into the current scene (no map/grid changes) with their stat block, separate HP and
 * individually rolled initiative. Tokens are laid out around a point (the GM's view centre), one row per
 * creature type, snapped to the grid; the GM then drags them where they belong.
 */
import { BUTLER_ITEM_KEY, SIZE_CELLS } from "./constants";
import { rollHp } from "./builder";
import { cryptoRng, rollForStatblock, type Rng } from "./dice";
import { unitMetadata, unitState } from "./unit";
import { checkAssetUrl, type ButlerItemRecord, type ImageItemSpec, type ResolvedImage, type SceneGateway, type StepResult } from "./importer";
import { tokenImageGrid, type Vec2 } from "./layout";
import type { HpRecord, InitiativeRoll, Statblock } from "./schema";

export interface QuickEntry {
  statblock: Statblock;
  image: ResolvedImage;
  count: number;
  hp: "average" | "roll";
  hidden?: boolean;
  /** Initiative override, e.g. advantage when a conditional trait applies. */
  advantage?: boolean;
}

export interface QuickAddReport {
  ok: boolean;
  importId: string;
  steps: StepResult[];
  createdItemIds: string[];
  creatures: { name: string; hp: HpRecord; initiative: InitiativeRoll }[];
  warnings: string[];
  error?: string;
}

/** "Wolf 1".."Wolf n", continuing after existing "Wolf k" tokens; single creatures keep the plain name if free. */
export function nameCreatures(base: string, count: number, existing: string[]): string[] {
  const esc = base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^${esc}(?: (\\d+))?$`, "i");
  let max = 0;
  let plainTaken = false;
  for (const n of existing) { const m = re.exec(n.trim()); if (m) { if (m[1]) max = Math.max(max, Number(m[1])); else plainTaken = true; } }
  if (count === 1 && !plainTaken && max === 0) return [base];
  const start = max + 1 + (plainTaken && max === 0 ? 1 : 0);
  return Array.from({ length: count }, (_, i) => `${base} ${start + i}`);
}

export async function quickAdd(entries: QuickEntry[], center: Vec2, gw: SceneGateway,
  opts: { rng?: Rng; newId?: () => string; now?: () => Date; inParty?: boolean } = {}): Promise<QuickAddReport> {
  const newId = opts.newId ?? (() => globalThis.crypto.randomUUID());
  const rng = opts.rng ?? cryptoRng;
  const now = opts.now ?? (() => new Date());
  const importId = newId();
  const report: QuickAddReport = { ok: false, importId, steps: [], createdItemIds: [], creatures: [], warnings: [] };
  try {
    if (!entries.length) throw new Error("Nothing to add.");
    if ((await gw.getRole()) !== "GM") throw new Error(`Only the GM can add ${opts.inParty ? "party members" : "creatures"}.`);
    for (const e of entries) {
      const problem = checkAssetUrl(e.image.url);
      if (problem) throw new Error(`${e.statblock.name}: image ${problem}`);
    }
    const [items, grid] = await Promise.all([gw.getItems(), gw.getGrid()]);
    const dpi = grid.dpi;
    const existingNames = items.flatMap((i) => [i.label, i.name].filter((x): x is string => !!x));

    // Layout: one row per entry, centred on `center`, snapped to the grid.
    const rows = entries.map((e) => ({ e, size: Math.max(SIZE_CELLS[e.statblock.size] ?? 1, 0.5) }));
    const widthCells = Math.max(...rows.map((r) => Math.max(1, r.size) * r.e.count));
    const heightCells = rows.reduce((s, r) => s + Math.max(1, r.size), 0);
    const snap = (v: number) => Math.round(v / dpi) * dpi;
    const origin = { x: snap(center.x - (widthCells * dpi) / 2), y: snap(center.y - (heightCells * dpi) / 2) };

    const specs: ImageItemSpec[] = [];
    let rowY = 0;
    for (const { e, size } of rows) {
      const step = Math.max(1, size);
      const names = nameCreatures(e.statblock.name, e.count, [...existingNames, ...specs.map((s) => s.name)]);
      names.forEach((name, i) => {
        const hp = rollHp(e.statblock, e.hp, rng, report.warnings);
        const sb = e.advantage ? { ...e.statblock, initiative: { ...e.statblock.initiative, advantage: true } } : e.statblock;
        const initiative = rollForStatblock(sb.initiative, rng, "importer");
        const unit = unitMetadata(e.statblock, unitState(e.statblock, hp, initiative, { party: !!opts.inParty }));
        const record: ButlerItemRecord = {
          packageId: "quick-add", revision: now().toISOString(), importId, role: "creature", creatureKey: name, initiative,
          initiativeSetup: { modifier: sb.initiative.modifier, advantage: sb.initiative.advantage, disadvantage: sb.initiative.disadvantage },
          hp: { max: hp.max, method: hp.method, formula: hp.formula, dice: hp.dice },
          source: [e.statblock.source.provenance, e.statblock.source.book, e.statblock.source.page].filter(Boolean).join(" "),
        };
        specs.push({
          id: newId(), name, layer: "CHARACTER", image: e.image,
          grid: tokenImageGrid(e.image.width, e.image.height, size),
          position: { x: origin.x + (i * step + size / 2) * dpi, y: origin.y + (rowY + size / 2) * dpi },
          visible: !e.hidden, locked: false, label: name,
          metadata: { ...unit, [BUTLER_ITEM_KEY]: record },
        });
        report.creatures.push({ name, hp, initiative });
      });
      rowY += step;
    }
    report.steps.push({ step: "Prepare", ok: true, detail: `${specs.length} creature(s)` });
    await gw.addImages(specs);
    report.createdItemIds = specs.map((s) => s.id);
    const present = new Set((await gw.getItems()).map((i) => i.id));
    const missing = report.createdItemIds.filter((id) => !present.has(id));
    if (missing.length) throw new Error(`${missing.length} token(s) missing after adding`);
    report.steps.push({ step: "Add", ok: true, detail: `${specs.length} token(s) added to the scene and the initiative tracker` });
    report.ok = true;
    return report;
  } catch (e) {
    report.error = e instanceof Error ? e.message : String(e);
    report.steps.push({ step: "Failed", ok: false, detail: report.error });
    return report;
  }
}
