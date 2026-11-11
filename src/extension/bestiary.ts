/** 5etools data shared by the extension pages: the bundled creature index, the lazy library, and token artwork. */
import { fivetoolsArtUrl, fivetoolsTokenUrl } from "../core/fivetools";
import { FivetoolsLibrary } from "../core/fivetools-library";
import { decodeEnvs } from "../core/habitat";
import type { ResolvedImage } from "../core/importer";
import type { IndexRow } from "../core/search";
import { measure } from "./dom";

let indexPromise: Promise<IndexRow[]> | null = null;
/** The bundled creature index (public/data/monsters.json), fetched once per page. */
export function fetchMonsterIndex(): Promise<IndexRow[]> {
  indexPromise ??= (async () => {
    const res = await fetch(new URL("data/monsters.json", location.href));
    if (!res.ok) throw new Error(`monster index: HTTP ${res.status}`);
    const j = await res.json();
    return (j.rows as any[]).map(([name, source, cr, type, size, token, env, caster]): IndexRow => {
      const e = decodeEnvs(String(env ?? "*"));
      return { name, source, cr, type, size, token: !!token, book: j.books[source]?.[0] ?? source, rules: j.books[source]?.[1] ?? "", envs: e.envs, envAssigned: e.assigned, caster: caster === 1 };
    });
  })();
  indexPromise.catch(() => { indexPromise = null; });
  return indexPromise;
}

let lib: Promise<FivetoolsLibrary> | null = null;
export const getLib = () => (lib ??= new FivetoolsLibrary().init());

/** 5etools artwork: own token, then own art, then the base creature's token/art. */
export async function fivetoolsImage(m: any): Promise<{ image: ResolvedImage | null; note: string }> {
  const c = [fivetoolsTokenUrl(m.source, m.name), fivetoolsArtUrl(m.source, m.name)];
  if (m._copiedFrom) c.push(fivetoolsTokenUrl(m._copiedFrom.source, m._copiedFrom.name), fivetoolsArtUrl(m._copiedFrom.source, m._copiedFrom.name));
  for (const [i, url] of c.entries()) {
    try {
      const size = await measure(url);
      const note = i === 0 ? "5etools token" : i === 1 ? "5etools artwork (no token)" : i === 2 ? "base creature's token" : "base creature's artwork";
      return { image: { url, ...size, mime: "image/webp" }, note };
    } catch { /* try next */ }
  }
  return { image: null, note: "no 5etools artwork — choose an image" };
}
