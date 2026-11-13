import { cloudflare } from "@cloudflare/vite-plugin";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import mdx from "fumadocs-mdx/vite";
import { pagegraph } from "pagegraph/tanstack-start";
import { defineConfig } from "vite";

import * as mdxConfig from "./source.config.ts";

export const SITE_ORIGIN = "https://pagegraph.arya.sh";

const graph = pagegraph({
  origin: SITE_ORIGIN,
  indexable: process.env.PAGEGRAPH_SITE_PREVIEW !== "1",
  robots: { contentSignal: "search=yes, ai-input=yes, ai-train=yes" },
  collections: "src/lib/collections.ts",
  markdown: {
    origin: SITE_ORIGIN,
    // cf builds the entry Worker here; the prerender Worker wraps that compiled server.
    serverEntry: ".cloudflare/output/v0/workers/default/bundle/index.js",
  },
});

// `pagegraph` CLI commands run on Bun and evaluate this config only to build the graph. The cf
// beta cannot load `cloudflare.config.ts` under Bun, and the graph never needs the Worker, so the
// Cloudflare plugin joins only Node runs (`cf dev`, `cf build`, `cf deploy`).
const onBun = process.versions.bun !== undefined;

export default defineConfig({
  root: import.meta.dirname,
  plugins: [
    mdx(mdxConfig),
    !onBun &&
      cloudflare({
        viteEnvironment: { name: "ssr" },
        prerenderWorker: {
          config: ({ entryWorkerConfig }) => ({
            ...entryWorkerConfig,
            name: "pagegraph-site-prerender",
            entrypoint: "pagegraph/tanstack-start/prerender-worker",
            env: {
              ...entryWorkerConfig.env,
              TSS_PRERENDERING: { type: "json", value: "true" },
            },
          }),
        },
      }),
    tanstackStart({
      server: { entry: "./server.ts" },
      prerender: {
        enabled: true,
        autoStaticPathsDiscovery: false,
        crawlLinks: false,
        failOnError: true,
      },
      pages: [...graph.prerenderPages],
    }),
    graph,
    react(),
  ],
});
