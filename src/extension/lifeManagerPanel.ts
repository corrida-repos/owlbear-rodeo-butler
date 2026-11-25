import OBR from "@owlbear-rodeo/sdk";
import { convertMonster } from "../core/fivetools";
import { activeLifeManagerHandoff, importLifeManagerEncounter, lifeManagerMatch, lifeManagerResult, type PreparedCreature } from "../core/lifeManager";
import { DISPOSITIONS, fightOrFlightText, parseTacticalEncounter, type Disposition, type TacticalEncounter, type TacticalParticipant } from "../core/lifeManagerProtocol";
import { isUnitItem, readUnit } from "../core/unit";
import { rollInitiativeFor, trackerView } from "../core/tracker";
import { fetchMonsterIndex, fivetoolsImage, getLib } from "./bestiary";
import { action, h, rerender, ui, type Child } from "./dom";
import { obrGateway } from "./obrGateway";
import { roomSystem } from "./roomSettings";

let input = "";
let encounter: TacticalEncounter | undefined;
let tokens: { id: string; name: string }[] = [];
let selections: Record<string, string> = {};
let outcome = "";
let sceneEncounter: string | undefined;
let seconds = "";
let disposition: Disposition | undefined;
let notice = "";
let generation = 0;

export function resetLifeManagerPanel() {
  generation++;
  input = "";
  encounter = undefined;
  tokens = [];
  selections = {};
  outcome = "";
  sceneEncounter = undefined;
  seconds = "";
  disposition = undefined;
  notice = "";
}

async function preview(text: string) {
  encounter = undefined;
  const parsed = parseTacticalEncounter(text);
  const epoch = generation;
  const items = (await obrGateway.getItems()).filter((item) => isUnitItem(item) && readUnit(item.metadata));
  if (epoch !== generation) return;
  tokens = items.map((item) => ({ id: item.id, name: item.label || item.name || item.id }));
  selections = Object.fromEntries(parsed.participants.map((p) => [p.id, lifeManagerMatch(p, items)]));
  encounter = parsed;
}

async function prepareCreature(p: TacticalParticipant): Promise<PreparedCreature> {
  const name = p.creatureName ?? p.name;
  const index = await fetchMonsterIndex();
  const matches = index.filter((row) => row.name.toLowerCase() === name.toLowerCase());
  const source = p.source === "SRD 5.2"
    ? ["XMM", "XPHB", "XDMG"].find((book) => matches.some((row) => row.source === book))
    : p.source ?? matches.find((row) => row.rules === "2024")?.source;
  if (!source) throw new Error(`No published stat block for ${p.name}. Choose an existing Butler token for it.`);
  const ft = await (await getLib()).prepare(name, source);
  const sheet = convertMonster(ft.monster, { catalogEntry: ft.catalogEntry, copyChain: ft.copyChain, copyNotes: ft.copyNotes });
  const { image } = await fivetoolsImage(ft.monster);
  return { sheet, image: image ?? { url: new URL("tokens/party-placeholder.png", location.href).href, width: 256, height: 256, mime: "image/png" } };
}

function download(text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `encounter-result-${sceneEncounter ?? "butler"}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function loadLinkedEncounter() {
  const epoch = generation;
  const active = await activeLifeManagerHandoff(obrGateway);
  if (epoch !== generation) return;
  sceneEncounter = active.id;
  seconds = active.id ? String(active.seconds) : "";
  disposition = undefined;
  outcome = "";
}

export function renderLifeManagerPanel(): Child {
  return h("details", { className: "panel", open: true },
    h("summary", {}, "D&D Life Manager"),
    h("div", { className: "stack" },
      h("label", {}, "Encounter file", h("input", {
        type: "file", accept: ".json,application/json", disabled: ui.busy,
        onchange: (event: Event) => void action(async () => {
          const file = (event.target as HTMLInputElement).files?.[0];
          if (!file) return;
          if (file.size > 1_000_000) throw new Error("The encounter file exceeds 1 MB.");
          input = await file.text();
          await preview(input);
        })(),
      })),
      h("textarea", {
        "aria-label": "Life Manager encounter JSON", placeholder: "Or paste the encounter JSON",
        oninput: (e: Event) => { input = (e.target as HTMLTextAreaElement).value; },
      }, input),
      h("button", { disabled: ui.busy, onclick: action(() => preview(input)) }, "Preview encounter"),
      encounter ? renderPreview(encounter) : null,
      h("button", { className: "secondary", disabled: ui.busy, onclick: action(loadLinkedEncounter) }, "Review result for this scene"),
      sceneEncounter ? h("div", { className: "stack" },
        h("button", { className: "secondary", disabled: ui.busy, onclick: action(async () => {
          const [items, meta] = await Promise.all([obrGateway.getItems(), obrGateway.getSceneMetadata()]);
          const linked = await activeLifeManagerHandoff(obrGateway);
          if (linked.id !== sceneEncounter) throw new Error("The linked encounter changed. Review the scene again.");
          const waiting = trackerView(items, meta).waiting.filter((u) => linked.tokenIds.includes(u.id));
          await rollInitiativeFor(obrGateway, waiting.map((u) => u.id), { rules: roomSystem().rules });
          notice = `Rolled initiative for ${waiting.length} waiting participant(s).`;
        }) }, "Roll missing initiative"),
        h("label", {}, "Elapsed seconds", h("input", {
          type: "number", min: 0, max: 86400, value: seconds,
          oninput: (e: Event) => { seconds = (e.target as HTMLInputElement).value; outcome = ""; },
        })),
        h("label", {}, "Outcome", h("select", {
          onchange: (e: Event) => {
            disposition = DISPOSITIONS.find((value) => value === (e.target as HTMLSelectElement).value);
            outcome = "";
            rerender();
          },
        }, h("option", { value: "", selected: !disposition }, "Choose if known"),
        ...DISPOSITIONS.map((value) => h("option", { value, selected: disposition === value }, value)))),
        h("p", { className: "small muted" }, "Confirm elapsed time, including any partial round. Capture the result before ending combat or removing linked tokens."),
        h("button", { disabled: ui.busy, onclick: action(async () => {
          if (!seconds.trim()) throw new Error("Enter elapsed seconds.");
          const result = await lifeManagerResult(obrGateway, Number(seconds), undefined, disposition);
          if (result.encounterId !== sceneEncounter) throw new Error("The linked encounter changed. Review the scene again.");
          outcome = JSON.stringify(result, null, 2);
        }) }, "Capture result"),
        outcome ? h("div", { className: "row" },
          h("button", { onclick: () => download(outcome) }, "Download result"),
          h("button", { disabled: ui.busy, onclick: action(async () => {
            await navigator.clipboard.writeText(outcome); notice = "Result copied.";
          }) }, "Copy result"),
        ) : null,
      ) : null,
      notice ? h("p", { className: "small", role: "status" }, notice) : null,
    ),
  );
}

function renderPreview(pending: TacticalEncounter): Child {
  return h("div", { className: "stack" },
    h("strong", {}, pending.title),
    pending.attitude ? h("p", { className: "small" }, `Starting attitude: ${pending.attitude}.`) : null,
    h("p", { className: "small" }, pending.fightOrFlight ? fightOrFlightText(pending.fightOrFlight) : "Opening morale can be resolved in Life Manager before export."),
    h("p", { className: "small" }, `${pending.place} · ${pending.distanceFt} ft · ${pending.context}`),
    ...pending.participants.map((p) => h("label", {},
      `${p.name}${p.influencedAlly ? " (NPC ally)" : ""}${p.surprised ? " (surprised)" : ""}${p.asleep ? " (asleep)" : ""}${p.vitals ? ` · ${p.vitals.hp}/${p.vitals.maxHp} HP` : ""}`,
      h("select", { onchange: (e: Event) => { selections[p.id] = (e.target as HTMLSelectElement).value; } },
        h("option", { value: "", selected: !selections[p.id] }, "Choose a token"),
        p.side === "encounter" ? h("option", { value: "create", selected: selections[p.id] === "create" }, "Create hidden token") : null,
        ...tokens.map((token) => h("option", { value: token.id, selected: selections[p.id] === token.id }, token.name)),
        h("option", { value: "skip", selected: selections[p.id] === "skip" }, "Leave out"),
      ),
    )),
    h("p", { className: "small muted" }, "Mapped tokens receive the exported HP and conditions. Other tokens leave initiative. Review token placement and reveal hidden creatures when the party sees them."),
    h("button", { disabled: ui.busy, onclick: action(async () => {
      if (roomSystem().rules !== pending.rules) throw new Error("This encounter needs the room’s 2024 rules.");
      if (pending.participants.some((p) => !selections[p.id])) throw new Error("Choose a token or Leave out for each participant.");
      const selected = { ...selections };
      const epoch = generation;
      const active = await activeLifeManagerHandoff(obrGateway);
      if (active.id === pending.id) throw new Error("This encounter is already in the scene.");
      const library = new Map<string, Promise<PreparedCreature>>();
      const prepared = await Promise.all(pending.participants.filter((p) => selected[p.id] === "create").map(async (p) => {
        const key = `${p.creatureName ?? p.name}|${p.source ?? ""}`;
        if (!library.has(key)) library.set(key, prepareCreature(p));
        return [p.id, await library.get(key)!] as const;
      }));
      const [w, height] = await Promise.all([OBR.viewport.getWidth(), OBR.viewport.getHeight()]);
      const center = await OBR.viewport.inverseTransformPoint({ x: w / 2, y: height / 2 });
      if (epoch !== generation) throw new Error("The scene changed. Preview the encounter again.");
      await importLifeManagerEncounter(obrGateway, pending, selected, new Map(prepared), center);
      encounter = undefined;
      await loadLinkedEncounter();
      notice = "Encounter imported. Review placement, then start combat in Tracker.";
    }) }, "Import into current scene"),

  );
}
