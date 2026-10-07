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
    // The service worker precaches every chunk, so size costs only the first visit.
    chunkSizeWarningLimit: 1200,
    rolldownOptions: {
      output: {
        // Libraries keep their hash across deploys, so an update downloads only the app chunk.
        // pdf.js stays out of the group: a named chunk for it attracts Vite's preload helper,
        // and the app then loads pdf.js at startup instead of on first use.
        codeSplitting: {
          groups: [{ name: "vendor", test: /node_modules[\\/](?!pdfjs-dist)/ }],
        },
      },
    },
  },
  worker: { format: "es" },
  server: {
    host: true,
    port: 5173,
  },
});
