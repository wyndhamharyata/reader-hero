import { mkdirSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin, type ViteDevServer } from "vite";
import { VitePWA } from "vite-plugin-pwa";

function deviceLogPlugin(): Plugin {
  const logFile = path.resolve("logs/device.log");
  return {
    name: "reader-hero:device-log",
    configureServer(server: ViteDevServer) {
      server.middlewares.use("/__log", (request, response, next) => {
        if (request.method !== "POST") {
          next();
          return;
        }
        const chunks: Buffer[] = [];
        request.on("data", (chunk: Buffer) => chunks.push(chunk));
        request.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          mkdirSync(path.dirname(logFile), { recursive: true });
          void appendFile(logFile, `${body}\n`);
          console.log(`[device] ${body}`);
          response.end("ok");
        });
      });
    },
  };
}

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  plugins: [
    react(),
    deviceLogPlugin(),
    tailwindcss(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      injectRegister: null,
      manifest: false,
      injectManifest: {
        globPatterns: ["**/*.{js,mjs,css,html,svg,png,json,wasm,icc}"],
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
