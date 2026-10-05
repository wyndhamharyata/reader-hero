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
        globPatterns: ["**/*.{js,mjs,css,html,svg,png,webmanifest}"],
        globIgnores: ["**/sw.js"],
      },
    }),
  ],
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
    target: "es2022",
  },
  server: {
    host: true,
    port: 5173,
  },
});
