import { cloudflare } from "@cloudflare/vite-plugin";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { pagegraph } from "pagegraph/tanstack-start";
import { defineConfig } from "vite";

import { claims } from "./claims";

const graph = pagegraph({
  origin: "https://example.com",
  markdown: { origin: "https://example.com" },
  collections: "src/collections.ts",
  facts: "src/facts.ts",
  ...(process.env.PAGEGRAPH_FIXTURE_CLAIMS === "1" ? { claims } : {}),
});

export default defineConfig({
  root: import.meta.dirname,
  plugins: [
    cloudflare({
      config: {
        name: "pagegraph-markdown-fixture",
        main: "./src/server.ts",
        compatibility_date: "2026-09-20",
        compatibility_flags: ["nodejs_compat"],
      },
      viteEnvironment: { name: "ssr" },
      inspectorPort: false,
      persistState: false,
      experimental: {
        prerenderWorker: {
          config: {
            name: "pagegraph-markdown-fixture-prerender",
            main: "pagegraph/tanstack-start/prerender-worker",
            compatibility_date: "2026-09-20",
            compatibility_flags: ["nodejs_compat"],
            vars: { TSS_PRERENDERING: "true" },
            assets: { run_worker_first: true, binding: "ASSETS" },
          },
        },
      },
    }),
    tanstackStart({
      server: { entry: "./server.ts" },
      prerender: {
        enabled: true,
        autoStaticPathsDiscovery: false,
        crawlLinks: false,
        failOnError: true,
        concurrency: 1,
        retryCount: 0,
      },
      pages: [...graph.prerenderPages, { path: "/plain" }, { path: "/llms.txt" }],
    }),
    graph,
    react(),
  ],
});
