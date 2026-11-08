import { describe, expect, it } from "vitest";
import fx from "./fixtures/5etools-copy-sample.json";
import { buildPackage, type EncounterSource } from "../src/core/builder";
import { seededRng } from "../src/core/dice";
import { convertMonster } from "../src/core/fivetools";
import { resolveCopy, resolveVariables, shortName } from "../src/core/fivetools-copy";
import { buildCatalog, chooseMonster } from "../src/core/fivetools-shared";

// Real 5etools entries (copies + their base creatures + templates), extracted 2026-11-04.
const files = (fx as any).files as Record<string, { monster: any[] }>;
const get = (n: string, s: string) =>
  files[Object.keys(files).find((k) => k.toLowerCase() === s.toLowerCase())!]?.monster.find((m) => m.name.toLowerCase() === n.toLowerCase());
const ctx = { getMonster: get, templates: (fx as any).templates };
const convert = (n: string, s: string) => {
  const r = resolveCopy(get(n, s), ctx);
  return { r, sb: convertMonster(r.monster, { copyChain: r.chain, copyNotes: r.notes }) };
};
const names = (list: unknown) => (list as { name: string }[]).map((x) => x.name);
const text = (list: unknown) => JSON.stringify(list);

describe("5etools _copy resolution", () => {
  it("replaceTxt on all entries, across books (Bitter Breath = Horned Devil MM)", () => {
    const { r, sb } = convert("Bitter Breath", "BGDIA");
    expect(r.chain).toEqual(["copy of Horned Devil (MM)"]);
    expect(sb.name).toBe("Bitter Breath");
    expect(sb.ac).toBe(18);
    expect(sb.hp.max).toBe(178);
    expect(text(sb.actions)).toContain("Bitter Breath makes three melee attacks");
    expect(text(sb.actions)).not.toMatch(/the devil makes/i);
    expect(sb.source.notes!.join(" ")).toContain("Horned Devil (MM)");
  });

  it("replaceArr swaps a named action (Archduke Zariel)", () => {
    const { sb } = convert("Archduke Zariel of Avernus", "BGDIA");
    const multi = (sb.actions as any[]).find((a) => a.name === "Multiattack");
    expect(multi.text).toContain("She can substitute Horrid Touch for Matalotok");
  });

  it("own props override the base and replaceSpells swaps spells (Traxigor the otter)", () => {
    const { sb } = convert("Traxigor", "BGDIA");
    expect(sb.size).toBe("T");
    expect(sb.type).toBe("Beast");
    const spells = text(sb.spells);
    expect(spells).toContain("Plane Shift");
    expect(spells).not.toMatch(/Level 7[^}]*Teleport/);
  });

  it("templates add root props/senses; setProp null removes (Cat Skeleton)", () => {
    const { r, sb } = convert("Cat Skeleton", "CoS");
    expect(r.chain).toEqual(["copy of Cat (MM)", "template Skeleton (DMG)"]);
    expect(sb.type).toBe("Undead");
    expect(sb.senses).toContain("darkvision 60 ft.");
    expect(sb.defenses.vulnerable).toBeUndefined();
    expect(sb.languages).toBeUndefined();
  });

  it('"remove" deletes a property (Arabelle has no Commoner actions)', () => {
    const { sb } = convert("Arabelle", "CoS");
    expect(sb.actions).toEqual([]);
  });

  it("template scalarAddHit and halved HP (Reduced-Threat Aboleth)", () => {
    const { sb } = convert("Reduced-Threat Aboleth", "TftYP");
    const base = convertMonster(get("Aboleth", "MM"));
    expect(names(sb.traits)).toContain("Reduced Threat");
    expect(text(base.actions)).toContain("+9 [1d20+9]");
    expect(text(sb.actions)).toContain("+7 [1d20+7]");
    expect(sb.hp.max).toBe(67);
  });

  it("template + addSkills (Sylvira Savikas = Archmage + Tiefling)", () => {
    const { sb } = convert("Sylvira Savikas", "BGDIA");
    expect(sb.type).toBe("Humanoid (Tiefling)");
    expect(sb.languages).toContain("Infernal");
    expect(sb.senses).toContain("darkvision 60 ft.");
    expect(sb.skills).toContainEqual({ name: "Investigation", bonus: 13 }); // INT 20 (+5) + 2 × PB 4
  });

  it("errors clearly when a base creature isn't loaded", () => {
    expect(() => resolveCopy(get("Bitter Breath", "BGDIA"), { getMonster: () => undefined })).toThrow(/copies "Horned Devil" \(MM\)/);
  });
});

describe("5etools variables", () => {
  it("resolves <$name$>, short names and derived numbers", () => {
    const ent = { name: "Young Red Dragon", str: 23, cr: "10", size: ["L"] };
    expect(resolveVariables("<$title_short_name$> attacks <$to_hit__str$>, DC <$dc__str$>, avg <$damage_avg__2.5*size_mult+str$>", ent))
      .toBe("The dragon attacks +10, DC 18, avg 11");
    expect(shortName({ name: "Bob the Brave", isNamedCreature: true })).toBe("Bob");
  });
});

describe("initiative detection from text", () => {
  it("unconditional Alert + stat-block flag => advantage (Storm Giant Tempest Caller)", () => {
    const sb = convertMonster(get("Storm Giant Tempest Caller", "BGG"));
    expect(sb.initiative.advantage).toBe(true);
    expect(sb.initiative.conditional).toBeUndefined();
  });
  it("conditional 'if motionless at the start of combat' is flagged, not applied (Animated Broom)", () => {
    const sb = convertMonster(get("Animated Broom", "CM"));
    expect(sb.initiative.advantage).toBe(false);
    expect(sb.initiative.conditional![0]).toMatch(/False Object.*motionless/);
    expect(sb.flags.join(" ")).toMatch(/NOT applied automatically/);
  });
  it("flat bonuses and proficiency-bonus features are added", () => {
    const base = { name: "X", source: "T", size: ["M"], str: 10, dex: 14, con: 10, int: 10, wis: 10, cha: 10, cr: "5", ac: [12], hp: { average: 10 } };
    const alert = convertMonster({ ...base, trait: [{ name: "Alert", entries: ["The X gains a +5 bonus to initiative and can't be surprised."] }] });
    expect(alert.initiative.modifier).toBe(2 + 5);
    const pb = convertMonster({ ...base, trait: [{ name: "Quick", entries: ["The X adds its proficiency bonus to its initiative rolls."] }] });
    expect(pb.initiative.modifier).toBe(2 + 3);
    const dice = convertMonster({ ...base, trait: [{ name: "Talisman", entries: ["It can add {@dice 1d6} to its initiative rolls while it wears the talisman."] }] });
    expect(dice.initiative.modifier).toBe(2);
    expect(dice.initiative.conditional).toHaveLength(1);
  });
  it("an encounter override switches a conditional advantage on, with a recorded reason", () => {
    const src: EncounterSource = {
      id: "broom", title: "t", map: { name: "m", image: { kind: "url", url: "https://x/m.png" }, width: 700, height: 700, grid: { cellPx: 70, scale: "5ft" } },
      groups: [{ statblock: { fivetools: { name: "Animated Broom", source: "CM" } }, token: "fivetools", placements: [{ x: 1, y: 1 }],
        initiative: { advantage: true, reason: "broom is motionless in the closet when combat starts" } }],
    };
    const pkg = buildPackage(src, { fivetools: (n, s) => ({ monster: resolveCopy(get(n, s!), ctx).monster }), rng: seededRng(5) });
    const c = pkg.creatures[0]!;
    expect(c.initiative!.mode).toBe("advantage");
    expect(c.initiative!.dice).toHaveLength(2);
    expect(c.initiative!.kept).toBe(Math.max(...c.initiative!.dice));
    expect(pkg.statblocks[c.statblock]!.initiative.reasons.at(-1)).toMatch(/override: broom is motionless/);
  });
});

describe("source catalog", () => {
  const catalog = buildCatalog(
    { MM: "bestiary-mm.json", XMM: "bestiary-xmm.json", CoS: "bestiary-cos.json", ZZZ: "bestiary-zzz.json" },
    { book: [{ id: "MM", name: "Monster Manual (2014)", published: "2014-09-30" }, { id: "XMM", name: "Monster Manual (2025)", published: "2025-02-18" }] },
    { adventure: [{ id: "CoS", name: "Curse of Strahd", published: "2016-03-15" }] },
  );
  it("titles and edition come from 5etools metadata", () => {
    expect(catalog.XMM).toMatchObject({ title: "Monster Manual (2025)", rules: "2024" });
    expect(catalog.CoS).toMatchObject({ title: "Curse of Strahd", rules: "2014" });
    expect(catalog.ZZZ).toMatchObject({ title: "ZZZ", rules: "2014" });
  });
  it("prefers the 2024 version when no book is named (Bandit)", () => {
    const { chosen, note } = chooseMonster([get("Bandit", "MM"), get("Bandit", "XMM")], catalog);
    expect(chosen.source).toBe("XMM");
    expect(note).toMatch(/picked Monster Manual \(2025\) \(XMM\) over MM/);
  });
  it("points a 2014 creature to its 2024 reprint", () => {
    const sb = convertMonster(get("Bandit", "MM"), { catalogEntry: catalog.MM });
    expect(sb.flags.join(" ")).toMatch(/newer version exists: Bandit \(XMM\)/);
  });
});
