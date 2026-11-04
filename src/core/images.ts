/**
 * Circular token images via wsrv.nl (free, open-source image proxy by weserv; no account).
 * It fetches the source server-side, crops to a circle with transparent corners and serves PNG with
 * `Access-Control-Allow-Origin: *` and a 1-year cache, so it works for D&D Beyond avatars (which block
 * cross-site use) and arbitrary artwork links. Verified 2026-11-04.
 */
export const IMAGE_PROXY = "https://wsrv.nl/";

export function circularTokenUrl(src: string, size = 256): string {
  const params = new URLSearchParams({ url: src, w: String(size), h: String(size), fit: "cover", a: "attention", mask: "circle", output: "png" });
  return `${IMAGE_PROXY}?${params.toString()}`;
}

export const isProxied = (url: string) => url.startsWith(IMAGE_PROXY);
