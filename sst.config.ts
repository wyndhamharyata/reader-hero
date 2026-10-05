/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: "reader-hero",
      removal: input?.stage === "production" ? "retain" : "remove",
      protect: ["production"].includes(input?.stage),
      home: "cloudflare",
      providers: { cloudflare: "6.15.0" },
    };
  },
  async run() {
    const isProd = $app.stage === "production";
    const host = isProd ? "pdf-hero.mwyndham.dev" : "pdf-hero-dev.mwyndham.dev";

    const web = new sst.cloudflare.Worker("Web", {
      handler: "src/worker/index.ts",
      domain: host,
      url: true,
      assets: {
        directory: "dist/client",
        notFoundHandling: "single-page-application",
      },
    });

    new sst.x.DevCommand("LocalWeb", {
      dev: { command: "npm run dev", autostart: true },
    });

    return { url: web.url, host };
  },
});
