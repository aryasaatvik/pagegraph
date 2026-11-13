import { defineConfig } from "cf/config";

export default defineConfig({
  worker: {
    name: "pagegraph-site",
    entrypoint: "./src/server.ts",
    compatibilityDate: "2026-11-01",
    compatibilityFlags: ["nodejs_compat"],
    domains: ["pagegraph.arya.sh"],
    observability: { enabled: true },
    // Canonical URLs carry no trailing slash; prerendered pages are written as <path>/index.html.
    assets: { htmlHandling: "drop-trailing-slash" },
  },
});
