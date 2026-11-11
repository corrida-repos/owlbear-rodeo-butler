/**
 * Smoke tests: each built page starts inside a fake Owlbear host and renders, and a few everyday actions work end to
 * end (HP change and undo, spending limited uses, the lair turn, the player view, the background's menus).
 */
import { readFileSync } from "node:fs";
import { expect, test, type FrameLocator, type Page } from "@playwright/test";
import { scene } from "./fixtures";

const HOST_JS = readFileSync(new URL("./obrHost.js", import.meta.url), "utf8");
const HOST_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Fake Owlbear</title></head><body><script src="__obr-host.js"></script></body></html>`;

/** Errors from any frame: uncaught exceptions and console.error. */
async function boot(page: Page, seed: Record<string, unknown> = {}) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });
  // Only the local preview server: no 5etools, D&D Beyond or image proxy calls from a smoke test.
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return url.hostname === "localhost" ? route.continue() : route.abort();
  });
  await page.route("**/__obr-host.html", (r) => r.fulfill({ contentType: "text/html", body: HOST_HTML }));
  await page.route("**/__obr-host.js", (r) => r.fulfill({ contentType: "text/javascript", body: HOST_JS }));
  await page.goto("__obr-host.html");
  await page.evaluate((s) => Object.assign((window as any).__obr, s), { ...scene(), ...seed });
  return errors;
}

async function open(page: Page, path: string, name = path.split(/[?.]/)[0]!): Promise<FrameLocator> {
  await page.evaluate(([p, n]) => (window as any).openPage(p, { name: n }), [path, name]);
  return page.frameLocator(`iframe[name="${name}"]`);
}

const obr = (page: Page) => page.evaluate(() => {
  const s = (window as any).__obr;
  return { items: s.items, sceneMeta: s.sceneMeta, menus: s.menus, notifications: s.notifications, popovers: s.popovers, broadcasts: s.broadcasts };
});
const state = async (page: Page, id: string) => (await obr(page)).items.find((i: any) => i.id === id).metadata["dev.owlbear-butler/state"];

test("GM popover: tracker lists the order; damage and undo", async ({ page }) => {
  const errors = await boot(page);
  const f = await open(page, "index.html");
  await expect(f.getByRole("button", { name: "Tracker" })).toBeVisible();
  await expect(f.getByRole("button", { name: "Start combat" })).toBeVisible();
  const rows = f.locator(".panel.tracker .trow");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText("Goblin");
  await expect(rows.nth(2)).toContainText("Adult Red Dragon");
  await expect(rows.nth(2)).toContainText("Fire Breath ✓");

  const dragonRow = rows.filter({ hasText: "Adult Red Dragon" });
  await dragonRow.locator("input.hpbox").fill("-70");
  await dragonRow.locator("input.hpbox").press("Enter");
  await expect(dragonRow).toContainText("186/256");
  await dragonRow.getByTitle(/^Undo -70/).click();
  await expect(dragonRow).toContainText("256/256");
  expect((await state(page, "drg")).hpLog).toBeUndefined();
  expect(errors).toEqual([]);
});

test("GM popover: the lair turn appears on initiative 20 and combat steps through it", async ({ page }) => {
  const errors = await boot(page);
  const f = await open(page, "index.html");
  const rows = f.locator(".panel.tracker .trow");
  await expect(rows).toHaveCount(3);
  await f.getByRole("button", { name: "In its lair?" }).click();
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(1)).toContainText("Lair actions");
  await f.getByRole("button", { name: "Start combat" }).click();
  await f.getByRole("button", { name: "Next turn ▶" }).click();
  await expect(f.locator(".trow.active")).toContainText("Lair actions");
  await expect(f.getByText("Round 1 · Lair actions (initiative 20)")).toBeVisible();
  expect((await obr(page)).sceneMeta["dev.owlbear-butler/encounter"].turnId).toBe("butler-lair");
  expect(errors).toEqual([]);
});

test("Unit card: stat block, recharge and legendary actions", async ({ page }) => {
  const errors = await boot(page);
  const f = await open(page, "card.html?id=drg", "card");
  await expect(f.locator("h1")).toHaveText("Adult Red Dragon");
  await expect(f.locator(".statbar")).toContainText("19");
  await expect(f.getByText("Lair Actions (1) · not in its lair")).toBeVisible();

  await f.getByRole("button", { name: "Ready" }).click();
  await expect(f.getByRole("button", { name: /Used · recharge 5–6/ })).toBeVisible();
  expect((await state(page, "drg")).uses).toEqual({ "actions:fire breath (recharge 5–6)": 1 });

  await f.getByRole("button", { name: "Use (2)" }).click();
  await expect(f.locator(".entry-text").filter({ hasText: "can take 3 legendary actions" })).toContainText("1/3");
  await expect(f.getByRole("button", { name: "Use (2)" })).toBeDisabled();

  await f.getByRole("button", { name: "Reset uses" }).click();
  await expect(f.getByRole("button", { name: "Ready" })).toBeVisible();
  expect((await state(page, "drg")).uses).toBeUndefined();
  expect(errors).toEqual([]);
});

test("Unit card: rolling from a Recharge ability marks it used", async ({ page }) => {
  const errors = await boot(page);
  const f = await open(page, "card.html?id=drg", "card");
  await f.locator(".entry-text").filter({ hasText: "Fire Breath" }).locator("button.chip").first().click();
  await expect(f.locator(".lastroll")).toContainText("Fire Breath is now used");
  expect((await state(page, "drg")).uses).toEqual({ "actions:fire breath (recharge 5–6)": 1 });
  const rolls = (await obr(page)).broadcasts.filter((b: any) => b.channel === "dev.owlbear-butler/roll");
  expect(rolls).toHaveLength(1);
  expect(errors).toEqual([]);
});

test("Player popover: initiative order, own unit and HP box", async ({ page }) => {
  const errors = await boot(page, { role: "PLAYER", name: "Ana", id: "player-1" });
  const f = await open(page, "index.html");
  await expect(f.getByRole("heading", { name: "Initiative" })).toBeVisible();
  await expect(f.locator(".panel.tracker .trow")).toHaveCount(3);
  await expect(f.locator(".panel.tracker .trow").filter({ hasText: "Thorn" })).toContainText("(you)");
  await expect(f.getByRole("heading", { name: "My units" })).toBeVisible();
  // Players see their own HP, not the dragon's.
  await expect(f.locator(".panel.tracker .trow").filter({ hasText: "Thorn" })).toContainText("44/44");
  await expect(f.locator(".panel.tracker .trow").filter({ hasText: "Adult Red Dragon" })).not.toContainText("256");
  expect(errors).toEqual([]);
});

test("Background: registers the context menus without errors", async ({ page }) => {
  const errors = await boot(page);
  await open(page, "background.html", "background");
  await expect.poll(async () => (await obr(page)).menus.length).toBeGreaterThan(5);
  const labels = (await obr(page)).menus.flatMap((m: any) => m.icons.map((i: any) => i.label));
  expect(labels).toEqual(expect.arrayContaining(["View unit card", "Roll initiative", "Damage / heal", "Surprised", "Mark as dead", "Set size"]));
  expect(errors).toEqual([]);
});

test("Damage / heal popover and Wild Shape popover load", async ({ page }) => {
  const errors = await boot(page);
  const hp = await open(page, "hp.html?ids=gob,drg", "hp");
  await expect(hp.locator("body")).toContainText("Goblin");
  const ws = await open(page, "wildshape.html?id=pc", "wildshape");
  await expect(ws.getByText("Set up Wild Shape").first()).toBeVisible();
  await expect(ws.getByText(/Uses:|Short Rest|Long Rest/)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("GM popover: a world turn added by hand, renamed, reached in combat; players see it only when shown", async ({ page }) => {
  const errors = await boot(page);
  const f = await open(page, "index.html");
  const rows = f.locator(".panel.tracker .trow");
  await expect(rows).toHaveCount(3);
  await f.getByRole("button", { name: "+ World turn" }).click();
  await expect(rows).toHaveCount(4);
  const world = rows.nth(1); // initiative 20: after the goblin (22), before Thorn (15)
  await expect(world.locator("input").nth(1)).toHaveValue("Lair / world actions");
  await world.locator("input").nth(1).fill("Collapsing ceiling");
  await world.locator("input").nth(2).fill("DC 13 Dex save under the cracks");
  await world.locator("input").nth(2).press("Tab");
  await expect.poll(async () => (await obr(page)).sceneMeta["dev.owlbear-butler/worldTurns"]?.[0]).toMatchObject({ name: "Collapsing ceiling", note: "DC 13 Dex save under the cracks", initiative: 20 });

  await f.getByRole("button", { name: "Start combat" }).click();
  await f.getByRole("button", { name: "Next turn ▶" }).click();
  await expect(f.locator(".trow.active input").nth(1)).toHaveValue("Collapsing ceiling");
  await expect(f.getByText("Round 1 · Collapsing ceiling")).toBeVisible();

  // Players: hidden by default (a GM reminder), listed once the GM shows it.
  const p = await page.evaluate(() => (window as any).__obr.sceneMeta);
  const ctx = await page.context().newPage();
  const perr = await boot(ctx, { role: "PLAYER", name: "Ana", id: "player-1", sceneMeta: p });
  const pf = await open(ctx, "index.html");
  await expect(pf.locator(".panel.tracker .trow")).toHaveCount(3);
  await expect(pf.getByText("the GM's turn")).toBeVisible();
  await world.getByTitle(/Only you see this turn/).click();
  await expect.poll(async () => (await obr(page)).sceneMeta["dev.owlbear-butler/worldTurns"]?.[0]?.shown).toBe(true);
  const shown = await page.evaluate(() => (window as any).__obr.sceneMeta);
  await ctx.evaluate((m) => { const s = (window as any).__obr; s.sceneMeta = m; for (const fr of s.frames) fr.contentWindow.postMessage({ id: "OBR_SCENE_METADATA_EVENT_CHANGE", data: { metadata: m } }, location.origin); }, shown);
  await expect(pf.locator(".panel.tracker .trow")).toHaveCount(4);
  await expect(pf.locator(".trow.active")).toContainText("Collapsing ceiling");
  expect([...errors, ...perr]).toEqual([]);
});

test("Set size: the picker resizes and re-snaps the selected tokens, then closes", async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(() => { const s = (window as any).__obr; s.items[1].position = { x: 80, y: 90 }; s.items[2].position = { x: 80, y: 90 }; });
  const f = await open(page, "size.html?ids=gob,drg", "size");
  await expect(f.getByText("Size: 2 tokens")).toBeVisible();
  await expect(f.getByRole("button")).toHaveCount(6);
  await f.getByRole("button", { name: "Large" }).click();
  await expect.poll(async () => (await page.evaluate(() => (window as any).__obr.closed)) ?? []).toContain("dev.owlbear-butler/size");
  const items = (await obr(page)).items.filter((i: any) => i.id !== "pc");
  for (const i of items) {
    expect(i.grid.dpi).toBe(150); // 300 px image over 2 cells
    expect(i.scale).toEqual({ x: 1, y: 1 });
    expect(i.position).toEqual({ x: 150, y: 150 }); // even footprint: on a grid corner
  }
  // Thorn wasn't selected: unchanged.
  expect((await obr(page)).items.find((i: any) => i.id === "pc").grid.dpi).toBe(300);

  // Medium on one token: back to one cell, centred in a cell.
  const g = await open(page, "size.html?ids=gob", "size2");
  await expect(g.getByText("Size: Goblin")).toBeVisible();
  await expect(g.getByRole("button", { name: "Large" })).not.toHaveClass(/secondary/); // current size highlighted
  await g.getByRole("button", { name: "Medium" }).click();
  await expect.poll(async () => (await obr(page)).items.find((i: any) => i.id === "gob").grid.dpi).toBe(300);
  // From a grid corner, any of the four cells around it is nearest; it must land on a cell centre.
  const pos = (await obr(page)).items.find((i: any) => i.id === "gob").position;
  expect([(pos.x - 75) % 150, (pos.y - 75) % 150]).toEqual([0, 0]);
  expect(errors).toEqual([]);
});
