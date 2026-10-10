import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createBuilder, createServer, type RunnableDevEnvironment } from "vite";
import { afterAll, describe, expect, it } from "vitest";

import { renderRobots } from "../../src/core/projections";
import { pageHeads } from "../../src/core/page-heads";
import { evaluateAppGraph, tanstackStartGraph } from "../../src/tanstack-start/load";

const fixture = fileURLToPath(new URL("../fixtures/tanstack-start-app", import.meta.url));

/** A sibling copy of the fixture, so its relative imports and node_modules resolve the same way. */
const withFixtureCopy = async (edit: (root: string) => void, run: (root: string) => Promise<void>) => {
  const root = mkdtempSync(join(fixture, "..", ".tmp-start-"));
  try {
    cpSync(fixture, root, { recursive: true });
    edit(root);
    await run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

describe("evaluateAppGraph", () => {
  it("loads the plugin's preview identity and renders the same robots posture", async () => {
    const loaded = await tanstackStartGraph({ root: fixture, command: "serve" })();
    try {
      expect(loaded.site).toEqual({
        origin: "http://localhost:5173", indexable: false,
        robots: { disallow: ["/app"], contentSignal: "search=yes", directives: undefined },
      });
      expect(renderRobots(loaded.graph, { ...loaded.site, ...loaded.site.robots }))
        .toBe("User-agent: *\nDisallow: /\n");
    } finally { await loaded.dispose(); }
  });

  it("uses built site identity and defaults indexability to true when omitted", async () => {
    await withFixtureCopy(
      (root) => {
        const config = join(root, "vite.config.ts");
        writeFileSync(
          config,
          readFileSync(config, "utf8")
            .replace('      indexable: command === "build",\n', "")
            .replace('JSON.stringify("Example")', 'JSON.stringify(command === "build" ? "Built" : "Dev")'),
        );
      },
      async (root) => {
        const loaded = await tanstackStartGraph({ root })();
        try {
          expect(loaded.site.origin).toBe("https://example.com");
          expect(loaded.site.indexable).toBe(true);
          expect(loaded.graph.nodes.get("/")?.head?.title).toBe("Built — home");
          const robots = renderRobots(loaded.graph, { ...loaded.site, ...loaded.site.robots });
          expect(robots).toContain("Sitemap: https://example.com/sitemap.xml");
          expect(robots).toContain("Disallow: /app");
        } finally { await loaded.dispose(); }
      },
    );
  });

  it("builds the graph from route declarations and collections in the app's Vite pipeline", async () => {
    const { graph, site } = await evaluateAppGraph({ root: fixture });

    // `define` and aliases apply: the home head reads a build constant through `@/seo`.
    expect(graph.nodes.get("/")?.head).toEqual({ title: "Example — home", description: "The home page.", faqs: undefined, image: { url: "http://localhost:5173/og/default.png", width: 1200, height: 630, alt: "Example — home" } });
    expect(graph.nodes.get("/pricing")?.head?.faqs).toEqual([{ question: "Is there a free plan?", answer: "Yes." }]);
    // Instances take their route's title template; the collection's related links become edges.
    expect(graph.nodes.get("/blog/first")?.head?.title).toBe("First post | Example Blog");
    expect(graph.edges).toContainEqual({ from: "/blog/first", to: "/pricing", type: "related" });
    expect(graph.edges).toContainEqual({ from: "/pricing", to: "/", type: "crumb-parent" });
    // Pathless layouts and route groups without a layout file contribute no URL segment.
    expect(graph.nodes.has("/help")).toBe(true);
    expect(graph.nodes.has("/terms")).toBe(true);
    // The excluded app route never evaluates (it imports a Worker-only module).
    expect(graph.nodes.has("/app-only")).toBe(false);
    // Serve-mode evaluation: the config's `command` branch describes the local host.
    expect(site).toEqual({
      origin: "http://localhost:5173",
      indexable: false,
      robots: { disallow: ["/app"], contentSignal: "search=yes", directives: undefined },
    });
    expect(pageHeads(graph).map((head) => head.path)).toEqual([
      "/",
      "/pricing",
      "/help",
      "/terms",
      "/blog/second",
      "/blog/first",
    ]);
  });

  it("names a route that cannot evaluate and how to exclude it", async () => {
    await withFixtureCopy(
      (root) => {
        const config = join(root, "vite.config.ts");
        writeFileSync(config, readFileSync(config, "utf8").replace('exclude: ["app-only.tsx"],', ""));
      },
      async (root) => {
        await expect(evaluateAppGraph({ root })).rejects.toThrow(
          /could not evaluate src\/routes\/app-only\.tsx[\s\S]*add "app-only\.tsx" to pagegraph\(\{ exclude \}\)/,
        );
      },
    );
  });
});

describe("pagegraph() in a build", () => {
  it("evaluates with the build's config and inlines the graph into the server output", async () => {
    await withFixtureCopy(
      () => {},
      async (root) => {
        const builder = await createBuilder({ root, configFile: join(root, "vite.config.ts"), logLevel: "error" });
        await builder.buildApp();
        const server = (await import(pathToFileURL(join(root, "dist/server/server-entry.js")).href)) as {
          robotsTxt: () => Response;
          sitemapXml: () => Response;
        };
        const robots = await server.robotsTxt().text();
        expect(robots).toContain("Sitemap: https://example.com/sitemap.xml");
        expect(robots).toContain("Disallow: /app");
        const sitemap = await server.sitemapXml().text();
        expect(sitemap.match(/<loc>/g)).toHaveLength(6);
        expect(sitemap).toContain("<loc>https://example.com/help</loc>");
      },
    );
  });

  it("names a route that cannot evaluate in the built graph environment", async () => {
    await withFixtureCopy(
      (root) => {
        const config = join(root, "vite.config.ts");
        writeFileSync(config, readFileSync(config, "utf8").replace('exclude: ["app-only.tsx"],', ""));
      },
      async (root) => {
        const builder = await createBuilder({ root, configFile: join(root, "vite.config.ts"), logLevel: "silent" });
        await expect(builder.buildApp()).rejects.toThrow(/could not evaluate src\/routes\/app-only\.tsx/);
      },
    );
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
    expect(sitemap.match(/<loc>/g)).toHaveLength(6);
    // Collection order is preserved after the route entries.
    expect(sitemap.indexOf("/blog/second")).toBeLessThan(sitemap.indexOf("/blog/first"));
    // A non-indexable host disallows everything.
    const robots = await (runtime["robotsTxt"] as () => Response)().text();
    expect(robots).toBe("User-agent: *\nDisallow: /\n");
  });

  it("keeps pages and the markdown capture on one copy of pagegraph's module state", () => {
    expect(ssr.config.optimizeDeps.exclude).toEqual(
      expect.arrayContaining(["pagegraph", "pagegraph/react", "pagegraph/tanstack-start/markdown"]),
    );
  });
});

describe("pagegraph() dev refresh", () => {
  it("re-evaluates after a route change reaches the graph environment", async () => {
    await withFixtureCopy(
      () => {},
      async (root) => {
        const server = await createServer({
          root,
          configFile: join(root, "vite.config.ts"),
          logLevel: "error",
          // HMR processing runs hotUpdate hooks; no websocket is needed for that.
          server: { middlewareMode: true, ws: false },
        });
        try {
          const ssr = server.environments.ssr as RunnableDevEnvironment;
          const title = async () => {
            ssr.runner.clearCache();
            const runtime = await ssr.runner.import("/src/server-entry.ts");
            return (runtime["seoGraph"] as () => { nodes: Map<string, { head?: { title: string } }> })().nodes.get("/pricing")?.head?.title;
          };
          expect(await title()).toBe("Pricing | Example");

          const file = join(root, "src/routes/(marketing)/pricing.tsx");
          writeFileSync(file, readFileSync(file, "utf8").replace("Pricing | Example", "Plans | Example"));
          await expect.poll(title, { timeout: 5000 }).toBe("Plans | Example");
        } finally {
          await server.close();
        }
      },
    );
  }, 20_000);
});

describe("pagegraph Markdown runtime configuration", () => {
  it("evaluates facts in the graph environment and ships canonical Markdown options in dev and build", async () => {
    await withFixtureCopy(
      (root) => {
        const config = join(root, "vite.config.ts");
        writeFileSync(config, readFileSync(config, "utf8").replace('collections: "src/collections.ts",',
          'collections: "src/collections.ts", markdown: { origin: "https://canonical.example.com" }, facts: "src/facts.ts",'));
        writeFileSync(join(root, "src/fact-value.ts"), 'export const brand = import.meta.env.VITE_BRAND;');
        writeFileSync(join(root, "src/facts.ts"), 'import { brand } from "@/fact-value"; export const facts = { brand: { kind: "text", value: brand, text: brand } };');
        const entry = join(root, "src/server-entry.ts");
        writeFileSync(entry, `${readFileSync(entry, "utf8")}\nexport { markdown, facts } from "virtual:pagegraph/runtime";\n`);
      },
      async (root) => {
        const server = await createServer({ root, configFile: join(root, "vite.config.ts"), logLevel: "error",
          server: { middlewareMode: true, hmr: false, watch: null } });
        try {
          const environment = server.environments.ssr as RunnableDevEnvironment;
          const runtime = await environment.runner.import("/src/server-entry.ts");
          expect(runtime.markdown).toEqual({ origin: "https://canonical.example.com" });
          expect(runtime.facts).toEqual({ brand: { kind: "text", value: "Example", text: "Example" } });
          const graphEnvironment = server.environments.pagegraph as RunnableDevEnvironment;
          const stub = await graphEnvironment.runner.import("virtual:pagegraph/runtime");
          expect(stub.markdown).toBeNull();
          expect(stub.facts).toBeUndefined();
        } finally { await server.close(); }
        const builder = await createBuilder({ root, configFile: join(root, "vite.config.ts"), logLevel: "error" });
        await builder.buildApp();
        const built = await import(pathToFileURL(join(root, "dist/server/server-entry.js")).href);
        expect(built.markdown).toEqual({ origin: "https://canonical.example.com" });
        expect(built.facts).toEqual({ brand: { kind: "text", value: "Example", text: "Example" } });
      },
    );
  });
});
