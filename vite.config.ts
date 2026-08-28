import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  build: { outDir: "dist", emptyOutDir: true },
  server: {
    // `npm run dev` is Vite only. For the API, run `npm run preview`
    // (build + wrangler dev), which serves assets and the Worker together.
    proxy: { "/api": "http://localhost:8787" },
  },
});
