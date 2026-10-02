import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { createServer, type RunnableDevEnvironment } from "vite";
import { afterAll, describe, expect, it } from "vitest";

import { pageHeads } from "../../src/core/page-heads";
import { evaluateAppGraph } from "../../src/tanstack-start/load";

const fixture = fileURLToPath(new URL("../fixtures/tanstack-start-app", import.meta.url));

describe("evaluateAppGraph", () => {
  it("builds the graph from route declarations and collections in the app's Vite pipeline", async () => {
    const { graph, site } = await evaluateAppGraph({ root: fixture });

    // `define` and aliases apply: the home head reads a build constant through `@/seo`.
    expect(graph.nodes.get("/")?.head).toEqual({ title: "Example — home", description: "The home page.", faqs: undefined });
    expect(graph.nodes.get("/pricing")?.head?.faqs).toEqual([{ question: "Is there a free plan?", answer: "Yes." }]);
    // Instances take their route's title template; the collection's related links become edges.
    expect(graph.nodes.get("/blog/first")?.head?.title).toBe("First post | Example Blog");
    expect(graph.edges).toContainEqual({ from: "/blog/first", to: "/pricing", type: "related" });
    expect(graph.edges).toContainEqual({ from: "/pricing", to: "/", type: "crumb-parent" });
    // The excluded app route never evaluates (it imports a Worker-only module).
    expect(graph.nodes.has("/app-only")).toBe(false);
    expect(site).toEqual({
      origin: "https://example.com",
      indexable: true,
      robots: { disallow: ["/app"], contentSignal: "search=yes", directives: undefined },
    });
    expect(pageHeads(graph).map((head) => head.path)).toEqual(["/", "/pricing", "/blog/second", "/blog/first"]);
  });

  it("names a route that cannot evaluate and how to exclude it", async () => {
    // A sibling of the fixture, so its relative imports and node_modules resolve the same way.
    const root = mkdtempSync(join(fixture, "..", ".tmp-start-"));
    try {
      cpSync(fixture, root, { recursive: true });
      const config = join(root, "vite.config.ts");
      writeFileSync(config, readFileSync(config, "utf8").replace('exclude: ["app-only.tsx"],', ""));
      await expect(evaluateAppGraph({ root })).rejects.toThrow(
        /could not evaluate src\/routes\/app-only\.tsx[\s\S]*add "app-only\.tsx" to pagegraph\(\{ exclude \}\)/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("pagegraph() in dev", async () => {
  const server = await createServer({
    root: fixture,
    configFile: join(fixture, "vite.config.ts"),
    logLevel: "error",
    server: { middlewareMode: true, hmr: false, watch: null },
  });
  afterAll(() => server.close());
  const ssr = server.environments.ssr as RunnableDevEnvironment;

  it("serves the graph to the server runtime through the virtual module", async () => {
    const runtime = await ssr.runner.import("/src/server-entry.ts");
    const sitemap = await (runtime["sitemapXml"] as () => Response)().text();
    expect(sitemap.match(/<loc>/g)).toHaveLength(4);
    // Collection order is preserved after the route entries.
    expect(sitemap.indexOf("/blog/second")).toBeLessThan(sitemap.indexOf("/blog/first"));
    const robots = await (runtime["robotsTxt"] as () => Response)().text();
    expect(robots).toContain("Content-Signal: search=yes");
    expect(robots).toContain("Disallow: /app");
    expect(robots).toContain("Sitemap: https://example.com/sitemap.xml");
  });
});
