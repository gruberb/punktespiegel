import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { copyFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// "historie" and "fantasy-team" stay so old links keep resolving; the app
// routes them to /tabelle beziehungsweise /mannschaften.
const staticRoutes = ["tabelle", "spieler", "mannschaften", "historie", "topspieler", "fantasy-team", "ueber", "daten-methodik", "quellen", "faq"];

function staticRouteEntrypoints() {
  return {
    name: "static-route-entrypoints",
    apply: "build" as const,
    async closeBundle() {
      const outputDirectory = fileURLToPath(new URL("./dist", import.meta.url));
      const index = `${outputDirectory}/index.html`;
      await Promise.all(staticRoutes.map(async (route) => {
        const routeDirectory = `${outputDirectory}/${route}`;
        await mkdir(routeDirectory, { recursive: true });
        await copyFile(index, `${routeDirectory}/index.html`);
      }));
      await copyFile(index, `${outputDirectory}/404.html`);
    },
  };
}

export default defineConfig({
  base: "/",
  plugins: [react(), staticRouteEntrypoints()],
  server: {
    port: 5173,
  },
});
