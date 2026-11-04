import { defineConfig } from "vite";

// Owlbear joins manifest paths onto the origin, so manifest paths are absolute (/owlbear-rodeo-butler/...).
// Dev and GitHub Pages both serve under the same sub-path so one manifest works for both.
export default defineConfig({
  base: "/owlbear-rodeo-butler/",
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
