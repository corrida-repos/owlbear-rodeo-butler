import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";

const OWLBEAR_ORIGINS = ["https://www.owlbear.rodeo", "https://owlbear.rodeo"];

// The dev server labels its manifest "(dev)" so a localhost install is easy to tell apart from the Pages one in Owlbear.
const devManifest = (): Plugin => ({
  name: "butler-dev-manifest",
  apply: "serve",
  configureServer(server) {
    // Receives console output from extension pages (src/extension/devlog.ts) → .cache/devlog.txt.
    server.middlewares.use("/owlbear-rodeo-butler/__devlog", (req, res) => {
      let body = "";
      req.on("data", (c) => { body += c; });
      req.on("end", () => {
        try {
          const { page, level, text } = JSON.parse(body);
          mkdirSync(".cache", { recursive: true });
          appendFileSync(".cache/devlog.txt", `${new Date().toISOString().slice(11, 23)} [${page}] ${level}: ${text}\n`);
        } catch { /* ignore malformed */ }
        res.statusCode = 204;
        res.end();
      });
    });
    server.middlewares.use("/owlbear-rodeo-butler/manifest.json", (req, res) => {
      const m = JSON.parse(readFileSync("public/manifest.json", "utf8"));
      m.name = `${m.name} (dev)`;
      // Runs before Vite's own CORS middleware, so allow Owlbear's origin here.
      const origin = req.headers.origin;
      if (origin && OWLBEAR_ORIGINS.includes(origin)) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Vary", "Origin");
        // Chrome's private/local network access preflight (https page → localhost).
        res.setHeader("Access-Control-Allow-Private-Network", "true");
      }
      if (req.method === "OPTIONS") {
        res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", String(req.headers["access-control-request-headers"] ?? "*"));
        res.statusCode = 204;
        res.end();
        return;
      }
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(m, null, 2));
    });
  },
});

// Owlbear joins manifest paths onto the origin, so manifest paths are absolute (/owlbear-rodeo-butler/...).
// Dev and GitHub Pages both serve under the same sub-path so one manifest works for both.
export default defineConfig({
  base: "/owlbear-rodeo-butler/",
  plugins: [devManifest()],
  server: {
    port: 5173,
    // Owlbear Rodeo fetches manifest.json and loads the popover cross-origin.
    cors: { origin: OWLBEAR_ORIGINS },
  },
  build: {
    outDir: "dist",
    rollupOptions: { input: { main: "index.html", background: "background.html", card: "card.html", hp: "hp.html", wildshape: "wildshape.html", actions: "actions.html", initiative: "initiative.html", zerohp: "zerohp.html" } },
  },
});
