import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    emptyOutDir: true,
    target: "es2022",
    sourcemap: true,
    rollupOptions: {
      input: {
        landing: "index.html",
        csv: "csv.html",
        examples: "examples.html",
        vector: "vector.html",
        raster: "raster.html",
        filtering: "filtering.html",
        linkedTables: "linked-tables.html",
        events: "events.html",
      },
    },
  },
  worker: {
    format: "es",
  },
});
