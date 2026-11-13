import { cloudflare } from "@cloudflare/vite-plugin";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import mdx from "fumadocs-mdx/vite";
import { pagegraph } from "pagegraph/tanstack-start";
import { readdirSync } from "node:fs";
import { join } from "node:path";

import { defineConfig } from "vite";

import { ogImage } from "./src/lib/og-image.ts";

import * as mdxConfig from "./source.config.ts";

const SITE_ORIGIN = "https://pagegraph.arya.sh";

/** Every docs URL, from the MDX files on disk; prerender writes each page and its .md twin. */
const docsUrls = readdirSync(join(import.meta.dirname, "content/docs"), { recursive: true })
  .map(String)
  .filter((file) => file.endsWith(".mdx"))
  .map((file) =>
    `/docs/${file.replace(/\.mdx$/, "").replace(/(^|\/)index$/, "")}`.replace(/\/$/, ""),
  );

const graph = pagegraph({
  origin: SITE_ORIGIN,
  indexable: process.env.PAGEGRAPH_SITE_PREVIEW !== "1",
  robots: { contentSignal: "search=yes, ai-input=yes, ai-train=yes" },
  collections: "src/lib/collections.ts",
  ogImage,
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
  server: {
    // The changelog page imports the package CHANGELOG.md from the repository root.
    fs: { allow: [".."] },
    // The CLI evaluates only the pagegraph environment; CSS URL imports need their buildStart lifecycle.
    perEnvironmentStartEndDuringDev: true,
  },
  // `fumadocs-mdx:collections/*` resolves to the generated .source/ files through tsconfig paths.
  resolve: { tsconfigPaths: true },
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
      pages: [
        ...graph.prerenderPages,
        { path: "/" },
        { path: "/changelog" },
        { path: "/robots.txt" },
        { path: "/sitemap.xml" },
        { path: "/llms.txt" },
        ...docsUrls.flatMap((url) => [{ path: url }, { path: `${url}.md` }]),
      ],
    }),
    graph,
    react(),
  ],
});
