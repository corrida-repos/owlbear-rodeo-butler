/** Node wrapper: the core FivetoolsLibrary with a disk cache under .cache/5etools (and optional local data dir). */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { FIVETOOLS_DATA_BASE } from "../../src/core/fivetools";
import { FivetoolsLibrary as CoreLibrary, type DataFetcher } from "../../src/core/fivetools-library";

export function diskFetcher(cacheDir = resolve(".cache/5etools"), dataDir?: string, log: (s: string) => void = () => {}): DataFetcher {
  return async (rel) => {
    if (dataDir && existsSync(join(dataDir, rel))) return JSON.parse(readFileSync(join(dataDir, rel), "utf8"));
    const cacheFile = join(cacheDir, rel.replace(/^bestiary\//, ""));
    if (existsSync(cacheFile)) return JSON.parse(readFileSync(cacheFile, "utf8"));
    const url = `${FIVETOOLS_DATA_BASE}/${rel}`;
    log(`fetching ${url}`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    const text = await res.text();
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(cacheFile, text);
    return JSON.parse(text);
  };
}

export class FivetoolsLibrary extends CoreLibrary {
  constructor(cacheDir = resolve(".cache/5etools"), dataDir?: string, log: (s: string) => void = () => {}) {
    super(diskFetcher(cacheDir, dataDir, log));
  }
}
