import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { relay } from "./src/worker/relay";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  plugins: [
    react(),
    {
      name: "relay",
      // The dev server has no Worker, so it answers /relay with the Worker's own relay code.
      configureServer(server) {
        server.middlewares.use("/relay", (req, res) => {
          const bodyless = req.method === "GET" || req.method === "HEAD";
          const request = new Request("http://localhost/relay", {
            method: req.method,
            headers: Object.entries(req.headers).flatMap(([name, value]) =>
              typeof value === "string" ? [[name, value] as [string, string]] : [],
            ),
            body: bodyless ? null : (Readable.toWeb(req) as ReadableStream),
            duplex: "half",
          });
          void relay(request).then((response) => {
            res.writeHead(response.status, Object.fromEntries(response.headers));
            if (response.body === null) res.end();
            else Readable.fromWeb(response.body as NodeReadableStream).pipe(res);
          });
        });
      },
    },
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
