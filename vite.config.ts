import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      injectRegister: null,
      manifest: false,
      injectManifest: {
        globPatterns: ["**/*.{js,mjs,css,html,svg,png,json,wasm,icc,woff2}"],
        globIgnores: ["**/sw.js"],
      },
    }),
  ],
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
    target: "es2022",
    // One bundle is expected: the service worker precaches it, so size costs only the first visit.
    chunkSizeWarningLimit: 1200,
  },
  server: {
    host: true,
    port: 5173,
  },
});
