import { defineConfig } from "vite";

// base "./" so the built extension works from any sub-path (e.g. GitHub Pages /<repo>/).
export default defineConfig({
  base: "./",
  server: {
    port: 5173,
    // Owlbear Rodeo fetches manifest.json and loads the popover cross-origin.
    cors: { origin: ["https://www.owlbear.rodeo", "https://owlbear.rodeo"] },
  },
  build: {
    outDir: "dist",
    rollupOptions: { input: { main: "index.html" } },
  },
});
