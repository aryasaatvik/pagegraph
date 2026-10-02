import { describe, expect, it } from "@effect/vitest";
import type { AnyRoute } from "@tanstack/react-router";

import { contentCollection } from "../../src/core/collections";
import { applyTitleTemplate } from "../../src/core/declare";
import { buildSeoGraph, type SeoCollection } from "../../src/core/graph";
import { graphFromJson, graphToJson, type SeoGraphJson } from "../../src/core/wire";
import { contentSignal, renderRobots, renderSitemap } from "../../src/core/projections";

/**
 * A representative route-tree fixture that mirrors a real app's `staticData.seo`
 * declarations for the nodes under test. `buildSeoGraph` is pure over the
 * structural route shape, so this fixture exercises the same walk, merge, and
 * policy-inheritance logic a generated route tree would.
 */
function route(
  options: {
    path?: string | undefined;
    seo?: unknown;
  },
  children?: Array<unknown> | undefined,
): unknown {
  return {
    options: {
      path: options.path,
      staticData: options.seo ? { seo: options.seo } : undefined,
    },
    children,
  };
}

const fixtureRouteTree = route({ seo: { kind: "page", crumb: "Home" } }, [
  // (marketing) route group — pathless, transparent
  route({}, [
    route({
      path: "/",
      seo: { kind: "page", sitemap: { priority: 1.0, changeFrequency: "weekly" } },
    }),
    route({
      path: "/pricing",
      seo: {
        kind: "page",
        crumb: "Pricing",
        sitemap: { priority: 0.9, changeFrequency: "weekly" },
        link: { title: "Pricing", description: "Per-email pricing." },
      },
    }),
    route({
      path: "/developers",
      seo: {
        kind: "page",
        crumb: "Developers",
        sitemap: { priority: 0.8, changeFrequency: "monthly" },
        link: { title: "Developer reference", description: "Typed SDKs and webhooks." },
      },
    }),
    // features layout (hub, crumb) + index (page, sitemap) + email redirect
    route({ path: "/features", seo: { kind: "hub", crumb: "Features" } }, [
      route({
        path: "/",
        seo: {
          kind: "page",
          sitemap: { priority: 0.9, changeFrequency: "monthly" },
          link: { title: "Email API features", description: "The whole email surface." },
        },
      }),
      route({ path: "/email", seo: { kind: "page", redirectTo: "/features" } }),
    ]),
    // blog layout (hub) + index (page) + $slug (article collection)
    route({ path: "/blog", seo: { kind: "hub", crumb: "Blog" } }, [
      route({
        path: "/",
        seo: { kind: "page", sitemap: { priority: 0.8, changeFrequency: "weekly" } },
      }),
      route({
        path: "/$slug",
        seo: {
          kind: "article",
          crumb: () => "Post",
          sitemap: { priority: 0.7, changeFrequency: "weekly" },
          related: ["/features", "/pricing", "/developers"],
        },
      }),
    ]),
    // guides layout + index + $slug
    route({ path: "/guides", seo: { kind: "hub", crumb: "Guides" } }, [
      route({
        path: "/",
        seo: { kind: "page", sitemap: { priority: 0.8, changeFrequency: "weekly" } },
      }),
      route({
        path: "/$slug",
        seo: {
          kind: "article",
          crumb: () => "Guide",
          sitemap: { priority: 0.7, changeFrequency: "weekly" },
          related: ["/features", "/pricing", "/developers"],
        },
      }),
    ]),
    // /compare — noindex hub, excluded from the sitemap
    route({
      path: "/compare",
      seo: { kind: "hub", sitemap: false, robots: "noindex, follow" },
    }),
  ]),
  // (docs) route group + splat collection
  route({}, [
    route({
      path: "/docs/$",
      seo: { kind: "page", sitemap: { priority: 0.8, changeFrequency: "weekly" } },
    }),
  ]),
]) as AnyRoute;

const blog: SeoCollection = {
  route: "/blog/$slug",
  source: "blog",
  instances: [
    { path: "/blog/post-a", title: "Post A", description: "A post.", publishedAt: "2026-01-01" },
  ],
};

const guides: SeoCollection = {
  route: "/guides/$slug",
  source: "guide",
  instances: [
    {
      path: "/guides/guide-a",
      title: "Guide A",
      description: "A guide.",
      publishedAt: "2026-02-01",
      modifiedAt: "2026-03-01",
    },
  ],
};

/** The caller (not the package) applies visibility filtering — a staged page is simply absent. */
const docs: SeoCollection = {
  route: "/docs/$",
  source: "docs",
  instances: [{ path: "/docs", title: "Docs Home" }],
};

const buildFixtureGraph = () =>
  buildSeoGraph({ routeTree: fixtureRouteTree, collections: [blog, guides, docs] });

const ORIGIN = "https://example.test";
const DISALLOW = ["/dashboard", "/api"];

describe("buildSeoGraph", () => {
  it("keeps the declared policy on a static route node", () => {
    const graph = buildFixtureGraph();
    const pricing = graph.nodes.get("/pricing");
    expect(pricing?.kind).toBe("page");
    expect(pricing?.source).toBe("route");
    expect(pricing?.policy.sitemap).toEqual({ priority: 0.9, changeFrequency: "weekly" });
  });

  it("merges a layout route's crumb with its index child's policy", () => {
    const graph = buildFixtureGraph();
    const features = graph.nodes.get("/features");
    // hub layout supplies the crumb, index child supplies kind + sitemap
    expect(features?.kind).toBe("page");
    expect(features?.policy.crumb).toBe("Features");
    expect(features?.policy.sitemap).toEqual({ priority: 0.9, changeFrequency: "monthly" });
  });

  it("models /features/email as a redirect node with a redirect edge", () => {
    const graph = buildFixtureGraph();
    const email = graph.nodes.get("/features/email");
    expect(email?.policy.redirectTo).toBe("/features");
    expect(graph.edges).toContainEqual({
      from: "/features/email",
      to: "/features",
      type: "redirect",
    });
  });

  it("carries frontmatter dates on an instance node and inherits the route's policy", () => {
    const graph = buildFixtureGraph();
    const guide = graph.nodes.get("/guides/guide-a");
    expect(guide?.source).toBe("guide");
    expect(guide?.kind).toBe("article");
    expect(guide?.instance?.title).toBe("Guide A");
    expect(guide?.instance?.publishedAt).toBe("2026-02-01");
    expect(guide?.instance?.modifiedAt).toBe("2026-03-01");
    // instance inherits the collection route's sitemap policy
    expect(guide?.policy.sitemap).toEqual({ priority: 0.7, changeFrequency: "weekly" });
  });

  it("only admits the instances the collection supplies", () => {
    const graph = buildFixtureGraph();
    expect(graph.nodes.has("/docs")).toBe(true);
    expect(graph.nodes.has("/docs/hidden")).toBe(false);
  });

  it("reports a collision when an instance claims a path another node already owns", () => {
    const graph = buildSeoGraph({
      routeTree: fixtureRouteTree,
      collections: [
        {
          route: "/blog/$slug",
          source: "blog",
          instances: [{ path: "/pricing", title: "Impostor" }],
        },
      ],
    });
    expect(graph.collisions).toEqual([{ path: "/pricing", sources: ["route", "blog"] }]);
    // the first owner keeps the path
    expect(graph.nodes.get("/pricing")?.source).toBe("route");
  });

  it("drops the edges of an instance it rejected for a collision", () => {
    const graph = buildSeoGraph({
      routeTree: fixtureRouteTree,
      collections: [
        {
          route: "/blog/$slug",
          source: "blog",
          instances: [
            { path: "/pricing", title: "Impostor" },
            { path: "/blog/real", title: "Real" },
          ],
          edges: [
            // the impostor never became a node; an edge out of it would dangle
            { from: "/pricing", to: "/blog/real", type: "related" },
            { from: "/blog/real", to: "/blog", type: "crumb-parent" },
          ],
        },
      ],
    });
    expect(graph.edges).not.toContainEqual({
      from: "/pricing",
      to: "/blog/real",
      type: "related",
    });
    expect(graph.edges).toContainEqual({ from: "/blog/real", to: "/blog", type: "crumb-parent" });
  });

  it("appends the edges a collection declares", () => {
    const graph = buildSeoGraph({
      routeTree: fixtureRouteTree,
      collections: [
        {
          route: "/blog/$slug",
          source: "blog",
          instances: [{ path: "/blog/post-a", title: "Post A" }],
          edges: [{ from: "/blog/post-a", to: "/blog", type: "crumb-parent" }],
        },
      ],
    });
    expect(graph.edges).toContainEqual({ from: "/blog/post-a", to: "/blog", type: "crumb-parent" });
  });

  it("links crumb nodes to their nearest crumb ancestor down the route chain", () => {
    const graph = buildFixtureGraph();
    expect(graph.edges).toContainEqual({ from: "/pricing", to: "/", type: "crumb-parent" });
    expect(graph.edges).toContainEqual({ from: "/blog/$slug", to: "/blog", type: "crumb-parent" });
    expect(graph.edges).toContainEqual({ from: "/blog", to: "/", type: "crumb-parent" });
  });

  it("emits related edges from the collection template, not per instance", () => {
    const graph = buildFixtureGraph();
    expect(graph.edges).toContainEqual({ from: "/blog/$slug", to: "/features", type: "related" });
    // instances do not re-emit related edges
    expect(graph.edges.some((e) => e.from === "/blog/post-a" && e.type === "related")).toBe(false);
  });
});

describe("renderSitemap", () => {
  it("omits <lastmod> on undated static routes but emits it on content instances", () => {
    const sitemap = renderSitemap(buildFixtureGraph(), { origin: ORIGIN, indexable: true });
    // static /pricing: <loc> flows straight into <changefreq>, no <lastmod>
    expect(sitemap).toContain(`<loc>${ORIGIN}/pricing</loc>\n    <changefreq>weekly</changefreq>`);
    // blog instance: <loc> is followed by a <lastmod> from frontmatter
    expect(sitemap).toContain(`<loc>${ORIGIN}/blog/post-a</loc>\n    <lastmod>`);
  });

  it("prefers modifiedAt over publishedAt for an instance's lastmod", () => {
    const sitemap = renderSitemap(buildFixtureGraph(), { origin: ORIGIN, indexable: true });
    expect(sitemap).toContain(
      `<loc>${ORIGIN}/guides/guide-a</loc>\n    <lastmod>2026-03-01T00:00:00.000Z</lastmod>`,
    );
  });

  it("omits <lastmod> for an instance whose collection carries no dates", () => {
    const sitemap = renderSitemap(buildFixtureGraph(), { origin: ORIGIN, indexable: true });
    expect(sitemap).toContain(`<loc>${ORIGIN}/docs</loc>\n    <changefreq>weekly</changefreq>`);
  });

  it("emits a route's declared modifiedAt as its lastmod, without passing it to instances", () => {
    const tree = route({ seo: { kind: "page" } }, [
      route({ path: "/pricing", seo: { kind: "hub", crumb: "Pricing" } }, [
        route({
          path: "/",
          seo: {
            kind: "page",
            sitemap: { priority: 0.9, changeFrequency: "weekly" },
            modifiedAt: "2026-09-01",
          },
        }),
      ]),
      route({
        path: "/blog/$slug",
        seo: {
          kind: "article",
          sitemap: { priority: 0.7, changeFrequency: "weekly" },
          modifiedAt: "2026-09-02",
        },
      }),
    ]) as AnyRoute;
    const graph = buildSeoGraph({
      routeTree: tree,
      collections: [
        { route: "/blog/$slug", source: "blog", instances: [{ path: "/blog/undated", title: "Undated" }] },
      ],
    });
    const sitemap = renderSitemap(graph, { origin: ORIGIN, indexable: true });
    expect(sitemap).toContain(
      `<loc>${ORIGIN}/pricing</loc>\n    <lastmod>2026-09-01T00:00:00.000Z</lastmod>`,
    );
    expect(sitemap).toContain(`<loc>${ORIGIN}/blog/undated</loc>\n    <changefreq>`);
  });

  it("refuses to render an invalid date instead of emitting a bogus lastmod", () => {
    const tree = route({ seo: { kind: "page" } }, [
      route({
        path: "/pricing",
        seo: {
          kind: "page",
          sitemap: { priority: 0.9, changeFrequency: "weekly" },
          modifiedAt: "last tuesday",
        },
      }),
    ]) as AnyRoute;
    expect(() =>
      renderSitemap(buildSeoGraph({ routeTree: tree }), { origin: ORIGIN, indexable: true }),
    ).toThrow(/"\/pricing" declares an invalid date "last tuesday"/);
  });

  it("excludes noindex hubs, redirects, and param templates", () => {
    const sitemap = renderSitemap(buildFixtureGraph(), { origin: ORIGIN, indexable: true });
    expect(sitemap).not.toContain("/compare");
    expect(sitemap).not.toContain("/features/email");
    expect(sitemap).not.toContain("$slug");
  });

  it("includes the homepage as the bare origin and the docs home", () => {
    const sitemap = renderSitemap(buildFixtureGraph(), { origin: ORIGIN, indexable: true });
    expect(sitemap).toContain(`<loc>${ORIGIN}</loc>`);
    expect(sitemap).toContain(`<loc>${ORIGIN}/docs</loc>`);
  });

  it("deduplicates URLs that differ only by case or a trailing slash", () => {
    const graph = buildFixtureGraph();
    const pricing = graph.nodes.get("/pricing");
    expect(pricing).toBeDefined();
    graph.nodes.set("/PRICING/", { ...pricing!, path: "/PRICING/" });

    const sitemap = renderSitemap(graph, { origin: ORIGIN, indexable: true });
    expect(sitemap.match(/<loc>[^<]*\/pricing\/?<\/loc>/gi)).toHaveLength(1);
  });
});

describe("renderRobots", () => {
  it("disallows exactly the paths the caller passes on an indexable host", () => {
    const robots = renderRobots(buildFixtureGraph(), {
      origin: ORIGIN,
      indexable: true,
      disallow: DISALLOW,
    });
    for (const path of DISALLOW) {
      expect(robots).toContain(`Disallow: ${path}`);
    }
    // noindex pages use meta robots, never a robots.txt Disallow
    expect(robots).not.toContain("Disallow: /compare");
    expect(robots).toContain(`Sitemap: ${ORIGIN}/sitemap.xml`);
  });

  it("serves a disallow-all with no Sitemap line on a non-indexable host", () => {
    const robots = renderRobots(buildFixtureGraph(), {
      origin: ORIGIN,
      indexable: false,
      disallow: DISALLOW,
    });
    expect(robots).toContain("Disallow: /");
    expect(robots).not.toContain("Allow: /");
    expect(robots).not.toContain("Sitemap:");
  });

  it("omits Content-Signal unless the caller passes one", () => {
    const robots = renderRobots(buildFixtureGraph(), {
      origin: ORIGIN,
      indexable: true,
      disallow: DISALLOW,
    });
    expect(robots).not.toContain("Content-Signal:");
    expect(robots).toBe(
      [
        "User-agent: *",
        "Allow: /",
        "Disallow: /dashboard",
        "Disallow: /api",
        "",
        `Sitemap: ${ORIGIN}/sitemap.xml`,
        `Host: ${ORIGIN}`,
        "",
      ].join("\n"),
    );
  });

  it("emits Content-Signal on an indexable host when the caller sets it", () => {
    const robots = renderRobots(buildFixtureGraph(), {
      origin: ORIGIN,
      indexable: true,
      disallow: DISALLOW,
      contentSignal: "search=yes, ai-input=yes, ai-train=yes",
    });
    expect(robots).toBe(
      [
        "User-agent: *",
        "Content-Signal: search=yes, ai-input=yes, ai-train=yes",
        "Allow: /",
        "Disallow: /dashboard",
        "Disallow: /api",
        "",
        `Sitemap: ${ORIGIN}/sitemap.xml`,
        `Host: ${ORIGIN}`,
        "",
      ].join("\n"),
    );
  });

  it("inserts extra directives after Content-Signal and before Allow", () => {
    const robots = renderRobots(buildFixtureGraph(), {
      origin: ORIGIN,
      indexable: true,
      disallow: DISALLOW,
      contentSignal: "search=yes",
      directives: ["Crawl-delay: 10", contentSignal("ai-train=no")],
    });
    expect(robots).toBe(
      [
        "User-agent: *",
        "Content-Signal: search=yes",
        "Crawl-delay: 10",
        "Content-Signal: ai-train=no",
        "Allow: /",
        "Disallow: /dashboard",
        "Disallow: /api",
        "",
        `Sitemap: ${ORIGIN}/sitemap.xml`,
        `Host: ${ORIGIN}`,
        "",
      ].join("\n"),
    );
  });

  it("drops an empty contentSignal and empty directive lines", () => {
    const robots = renderRobots(buildFixtureGraph(), {
      origin: ORIGIN,
      indexable: true,
      disallow: DISALLOW,
      contentSignal: "",
      directives: ["", "Crawl-delay: 10", ""],
    });
    expect(robots).not.toContain("Content-Signal:");
    expect(robots).toContain("User-agent: *\nCrawl-delay: 10\nAllow: /");
  });

  it("ignores contentSignal and directives on a non-indexable host", () => {
    const robots = renderRobots(buildFixtureGraph(), {
      origin: ORIGIN,
      indexable: false,
      disallow: DISALLOW,
      contentSignal: "search=yes, ai-input=yes, ai-train=yes",
      directives: ["Crawl-delay: 10"],
    });
    expect(robots).toBe(["User-agent: *", "Disallow: /", ""].join("\n"));
  });

  it("runs transform last on both hosts", () => {
    const wrap = (robots: string) => `# wrapped\n${robots}`;
    const indexable = renderRobots(buildFixtureGraph(), {
      origin: ORIGIN,
      indexable: true,
      disallow: DISALLOW,
      contentSignal: "search=yes",
      transform: wrap,
    });
    const preview = renderRobots(buildFixtureGraph(), {
      origin: ORIGIN,
      indexable: false,
      disallow: DISALLOW,
      contentSignal: "search=yes",
      transform: wrap,
    });
    expect(indexable.startsWith("# wrapped\n")).toBe(true);
    expect(indexable).toContain("Content-Signal: search=yes");
    expect(preview).toBe(["# wrapped", "User-agent: *", "Disallow: /", ""].join("\n"));
  });

  it("formats a Content-Signal line from the preference list", () => {
    expect(contentSignal("search=yes, ai-input=yes")).toBe(
      "Content-Signal: search=yes, ai-input=yes",
    );
  });
});

describe("declared heads, collections, and the wire format", () => {
  const tree = route({ seo: { kind: "page", crumb: "Home" } }, [
    route({
      path: "/pricing",
      seo: {
        kind: "page",
        sitemap: { priority: 0.9, changeFrequency: "monthly" },
        head: { title: "Pricing | Example", description: "Pricing.", faqs: [{ question: "Q", answer: "A", extra: 1 }] },
      },
    }),
    route({
      path: "/blog/$slug",
      seo: { kind: "article", titleTemplate: "%s | Blog", sitemap: { priority: 0.7, changeFrequency: "weekly" } },
    }),
  ]) as AnyRoute;
  const blog = contentCollection({
    route: "/blog/$slug",
    source: "blog",
    pages: [
      { url: "/blog/b", title: "B", body: "" },
      { url: "/blog/a", title: "A", body: "" },
    ],
    entry: (page) => ({ title: page.title, description: `${page.title} post`, related: ["/pricing", "/pricing"] }),
  });
  const graph = buildSeoGraph({ routeTree: tree, collections: [blog] });

  it("projects a declared head and templates instance titles", () => {
    expect(graph.nodes.get("/pricing")?.head).toEqual({
      title: "Pricing | Example",
      description: "Pricing.",
      faqs: [{ question: "Q", answer: "A" }],
    });
    expect(graph.nodes.get("/blog/a")?.head).toEqual({ title: "A | Blog", description: "A post" });
  });

  it("turns related entries into deduplicated edges", () => {
    expect(graph.edges.filter((edge) => edge.from === "/blog/a")).toEqual([
      { from: "/blog/a", to: "/pricing", type: "related" },
    ]);
  });

  it("round-trips through JSON with the same sitemap", () => {
    const json = JSON.parse(JSON.stringify(graphToJson(graph))) as SeoGraphJson;
    const restored = graphFromJson(json);
    const config = { origin: "https://example.com", indexable: true };
    expect(renderSitemap(restored, config)).toBe(renderSitemap(graph, config));
    expect(restored.nodes.get("/blog/b")?.head?.title).toBe("B | Blog");
    expect(restored.nodes.get("/pricing")?.policy.head).toBeUndefined();
  });
});

describe("title templates", () => {
  it("keeps replacement tokens in a title literal", () => {
    expect(applyTitleTemplate("%s | Brand", "Costs $& today")).toBe("Costs $& today | Brand");
  });

  it("projects a merged index head with the index's own template, as seo.head renders it", () => {
    const tree = route({ seo: { kind: "page", crumb: "Home" } }, [
      route({ path: "/foo", seo: { kind: "hub", crumb: "Foo", titleTemplate: "%s | Layout" } }, [
        route({
          path: "/",
          seo: { kind: "page", sitemap: { priority: 0.5, changeFrequency: "monthly" }, head: { title: "Index", description: "The index." } },
        }),
      ]),
    ]) as AnyRoute;
    expect(buildSeoGraph({ routeTree: tree }).nodes.get("/foo")?.head?.title).toBe("Index");
  });
});
