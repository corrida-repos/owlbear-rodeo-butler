import { describe, expect, it } from "vitest";
import manifest from "../public/manifest.json";
import pkg from "../package.json";

// Owlbear rejects manifests that break these limits ("Unable to load extension"), per docs.owlbear.rodeo reference/manifest.
describe("Owlbear manifest limits", () => {
  it("name ≤ 45, description ≤ 128, known permissions, absolute paths", () => {
    expect(manifest.name.length).toBeLessThanOrEqual(45);
    expect(manifest.description.length).toBeLessThanOrEqual(128);
    const allowed = ["clipboard-write", "clipboard-read", "autoplay", "bluetooth", "camera", "microphone", "usb", "display-capture", "hid"];
    for (const p of manifest.permissions ?? []) expect(allowed).toContain(p.name);
    for (const path of [manifest.icon, manifest.action.icon, manifest.action.popover, manifest.background_url]) expect(path.startsWith("/")).toBe(true);
  });

  it("manifest version matches package.json (release tags use it)", () => {
    expect(manifest.version).toBe(pkg.version);
    expect(manifest.homepage_url).toMatch(/^https:\/\//);
  });
});
