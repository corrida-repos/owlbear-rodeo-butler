import { describe, expect, it } from "vitest";
import { allTags, blankSheet, COLLECTION_SCHEMA, exportCollection, importCollection, newEntry, parseTags, searchCollection, updateEntry } from "../src/core/collection";
import { validateSheet } from "../src/core/sheet";

let n = 0;
const ids = () => `id${++n}`;
const at = (iso: string) => () => new Date(iso);

describe("creature collection", () => {
  it("the blank homebrew sheet is valid; entries copy the sheet (placed tokens stay independent)", () => {
    const s = blankSheet("Ash Wight");
    expect(validateSheet(s)).toEqual([]);
    const e = newEntry(s, { tags: ["undead"], newId: ids, now: at("2026-11-08T10:00:00Z") });
    s.ac = 99;
    expect(e.sheet.ac).toBe(12);
    expect(() => newEntry({ ...s, hp: { max: 0 } })).toThrow(/invalid/);
  });

  it("updates bump updatedAt and refuse invalid sheets", () => {
    const e = newEntry(blankSheet(), { newId: ids, now: at("2026-11-08T10:00:00Z") });
    const u = updateEntry(e, { tags: ["boss"], sheet: { ...e.sheet, name: "Boss" } }, at("2026-11-08T11:00:00Z"));
    expect(u).toMatchObject({ id: e.id, tags: ["boss"], updatedAt: "2026-11-08T11:00:00.000Z", savedAt: e.savedAt });
    expect(u.sheet.name).toBe("Boss");
    expect(() => updateEntry(e, { sheet: { ...e.sheet, abilities: {} as any } })).toThrow(/Invalid/);
  });

  it("tags parse from commas or #, lower-cased, de-duplicated", () => {
    expect(parseTags("Boss, #undead,boss , act 2")).toEqual(["boss", "undead", "act 2"]);
  });

  it("search by name, type or tag, narrowed by selected tags", () => {
    const es = [
      newEntry({ ...blankSheet("Ash Wight"), type: "Undead" }, { tags: ["undead", "act 2"], newId: ids }),
      newEntry({ ...blankSheet("Bandit Lord"), type: "Humanoid" }, { tags: ["boss", "act 2"], newId: ids }),
      newEntry({ ...blankSheet("Zombie Ogre"), type: "Undead" }, { tags: ["undead"], newId: ids }),
    ];
    expect(searchCollection(es, "undead").map((e) => e.sheet.name)).toEqual(["Ash Wight", "Zombie Ogre"]);
    expect(searchCollection(es, "", ["act 2"]).map((e) => e.sheet.name)).toEqual(["Ash Wight", "Bandit Lord"]);
    expect(searchCollection(es, "", ["act 2", "undead"]).map((e) => e.sheet.name)).toEqual(["Ash Wight"]);
    expect(searchCollection(es, "lord").map((e) => e.sheet.name)).toEqual(["Bandit Lord"]);
    expect(allTags(es)).toEqual(["act 2", "boss", "undead"]);
  });

  it("export and import: new ones added, newer copies win, invalid ones reported", () => {
    const a = newEntry(blankSheet("A"), { newId: () => "a", now: at("2026-11-08T10:00:00Z") });
    const b = newEntry(blankSheet("B"), { newId: () => "b", now: at("2026-11-08T10:00:00Z") });
    const file = exportCollection([updateEntry(a, { tags: ["new"] }, at("2026-11-09T00:00:00Z")), b, newEntry(blankSheet("C"), { newId: () => "c" })], at("2026-11-09T00:00:00Z"));
    expect(file.schema).toBe(COLLECTION_SCHEMA);
    const older = { ...file, entries: [...file.entries, { id: "bad", sheet: { name: "Broken" } }] };
    const r = importCollection([a, b], JSON.parse(JSON.stringify(older)));
    expect(r).toMatchObject({ added: 1, updated: 1, skipped: 1 });
    expect(r.errors).toHaveLength(1);
    expect(r.entries.find((e) => e.id === "a")!.tags).toEqual(["new"]);
    expect(() => importCollection([], { schema: "something else" })).toThrow(/collection file/);
  });
});
