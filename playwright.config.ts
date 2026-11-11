import { defineConfig } from "@playwright/test";

/**
 * Browser smoke tests: the built extension (vite preview) loaded inside a fake Owlbear host (tests/smoke/obrHost.js).
 * Run with `npm run test:smoke` (builds first). Unit tests stay in Vitest (`npm test`).
 */
const PORT = 4173;
export default defineConfig({
  testDir: "tests/smoke",
  testMatch: "**/*.smoke.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  use: { baseURL: `http://localhost:${PORT}/owlbear-rodeo-butler/`, trace: "off" },
  webServer: {
    command: `npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/owlbear-rodeo-butler/manifest.json`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
