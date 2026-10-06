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
    // Only named stages own a domain; personal `sst dev` stages would otherwise claim the dev host.
    const host =
      $app.stage === "production"
        ? "pdf-hero.mwyndham.dev"
        : $app.stage === "dev"
          ? "pdf-hero-dev.mwyndham.dev"
          : undefined;

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
