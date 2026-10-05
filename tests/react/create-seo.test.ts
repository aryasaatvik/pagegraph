import type { AnyRouteMatch } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";

import { buildSeoGraph, type OgImageNode, type RouteSeo } from "../../src/core";
import { createSeo, defineJsonLd } from "../../src/react";

const routeMatch = (pathname: string): AnyRouteMatch =>
  ({ id: pathname, pathname, staticData: {} }) as unknown as AnyRouteMatch;

describe("seoHead JSON-LD composition", () => {
  it("emits generated and route-defined documents in caller order", () => {
    const seo = createSeo({
      origin: "https://example.com",
      site: {
        name: "Example",
        logo: "/logo.png",
        publisherLogo: "/publisher.png",
        defaultImage: "/og.png",
        defaultAuthor: { name: "Example Team" },
      },
      organization: {
        description: "Example description.",
        sameAs: [],
        contactPoint: {
          contactType: "Customer Support",
          email: "support@example.com",
        },
      },
      website: { searchPath: "/search?q={search_term_string}" },
    });
    const match = routeMatch("/product");
    const application = defineJsonLd({
      "@type": "SoftwareApplication",
      name: "Example",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Web",
    });

    const head = seo.seoHead(
      { match, matches: [match] },
      {
        title: "Example product",
        description:
          "A developer product with enough detail for a useful search result.",
        service: { name: "Example API", serviceType: "API" },
        jsonLd: [application],
      },
    );
    const documents = head.meta.flatMap((descriptor) =>
      descriptor && "script:ld+json" in descriptor
        ? [descriptor["script:ld+json"]]
        : [],
    );

    expect(documents).toMatchObject([
      { "@type": "Service", name: "Example API" },
      { "@type": "SoftwareApplication", name: "Example" },
    ]);
  });

  it("passes the route canonical to a zero/one/many transform", () => {
    const seenCanonicals: Array<string | undefined> = [];
    const extra = defineJsonLd({ "@type": "Offer", name: "Free tier" });
    const seo = createSeo({
      origin: "https://example.com",
      site: {
        name: "Example",
        logo: "/logo.png",
        publisherLogo: "/publisher.png",
        defaultImage: "/og.png",
        defaultAuthor: { name: "Example Team" },
      },
      organization: {
        description: "Example description.",
        sameAs: [],
        contactPoint: {
          contactType: "Customer Support",
          email: "support@example.com",
        },
      },
      website: { searchPath: "/search?q={search_term_string}" },
      jsonLd: {
        transform: (entry, context) => {
          expect(context.entityIds.organization).toBe(
            "https://example.com/#organization",
          );
          seenCanonicals.push(context.canonical);
          if (entry.kind === "service") return [entry.document, extra];
          if (entry.kind === "custom") return false;
          return entry.document;
        },
      },
    });
    const match = routeMatch("/product/");

    const head = seo.seoHead(
      { match, matches: [match] },
      {
        title: "Example product",
        description:
          "A developer product with enough detail for a useful search result.",
        service: { name: "Example API", serviceType: "API" },
        jsonLd: [
          defineJsonLd({ "@type": "SoftwareApplication", name: "Suppressed" }),
        ],
      },
    );
    const documents = head.meta.flatMap((descriptor) =>
      descriptor && "script:ld+json" in descriptor
        ? [descriptor["script:ld+json"]]
        : [],
    );

    expect(seenCanonicals).toEqual([
      "https://example.com/product",
      "https://example.com/product",
    ]);
    expect(documents).toMatchObject([
      { "@type": "Service", name: "Example API" },
      { "@type": "Offer", name: "Free tier" },
    ]);
  });
});

describe("declared heads", () => {
  const config = {
    origin: "https://example.com",
    site: {
      name: "Example",
      logo: "/logo.png",
      publisherLogo: "/publisher.png",
      defaultImage: "/og.png",
      defaultAuthor: { name: "Example Team" },
    },
    organization: {
      description: "Example description.",
      sameAs: [],
      contactPoint: { contactType: "Customer Support", email: "support@example.com" },
    },
    website: { searchPath: "/search?q={search_term_string}" },
  };
  const matchWith = (pathname: string, seo: unknown): AnyRouteMatch =>
    ({ id: pathname, routeId: pathname, pathname, staticData: { seo } }) as unknown as AnyRouteMatch;

  it("seo.head renders the head declared in staticData.seo", () => {
    const seo = createSeo(config);
    const declaration: RouteSeo = {
      kind: "page",
      sitemap: { priority: 0.9, changeFrequency: "monthly" },
      head: {
        title: "Pricing | Example",
        description: "Simple pricing.",
        faqs: [{ question: "Free?", answer: "Yes.", category: "billing" }],
      },
    };
    const match = matchWith("/pricing", declaration);
    const head = seo.head({ match, matches: [match] });
    expect(head.meta).toContainEqual({ title: "Pricing | Example" });
    expect(head.meta).toContainEqual({ name: "description", content: "Simple pricing." });
    expect(JSON.stringify(head.meta)).toContain("FAQPage");
  });

  it("seo.head fails loud on a route without a declared head", () => {
    const seo = createSeo(config);
    const match = matchWith("/bare", { kind: "page" });
    expect(() => seo.head({ match, matches: [match] })).toThrow("seo.head needs staticData.seo.head");
  });

  it("applies the route's title template to the page title", () => {
    const seo = createSeo(config);
    const match = matchWith("/blog/post", { kind: "article", titleTemplate: "%s | Example Blog" });
    const head = seo.seoHead({ match, matches: [match] }, { title: "A post", description: "About it." });
    expect(head.meta).toContainEqual({ title: "A post | Example Blog" });
    expect(head.meta).toContainEqual({ property: "og:title", content: "A post | Example Blog" });
  });

  it("runs transformHead on every rendered head", () => {
    const seo = createSeo({
      ...config,
      transformHead: (head) => ({ ...head, meta: [...head.meta, { name: "x-test", content: "1" }] }),
    });
    const match = matchWith("/page", { kind: "page" });
    const head = seo.seoHead({ match, matches: [match] }, { title: "Page", description: "A page." });
    expect(head.meta.at(-1)).toEqual({ name: "x-test", content: "1" });
  });
});

describe("social images", () => {
  const config = {
    origin: "https://example.com",
    site: { name: "Example", logo: "/logo.png", publisherLogo: "/logo.png", defaultImage: "/schema-only.png", defaultAuthor: { name: "Team" } },
    organization: { description: "Example", sameAs: [], contactPoint: { contactType: "Support", email: "hi@example.com" } },
    website: { searchPath: "/search?q={search_term_string}" },
  };
  const match = routeMatch("/post/");
  const context = { match, matches: [match] };

  it("emits resolver image details using the canonical node and site origin", () => {
    const seo = createSeo({ ...config, ogImage: (node) => {
      expect(node.path).toBe("/canonical");
      expect(node.head?.title).toBe("Post");
      return { url: "cards/post.png", width: 1200, height: 630, alt: "A post" };
    } });
    const head = seo.seoHead(context, { title: "Post", description: "About it", canonicalPath: "/canonical" });
    expect(head.meta).toEqual(expect.arrayContaining([
      { property: "og:image", content: "https://example.com/cards/post.png" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:image:alt", content: "A post" },
      { name: "twitter:image", content: "https://example.com/cards/post.png" },
      { name: "twitter:card", content: "summary_large_image" },
    ]));
  });

  it("passes the same declared metadata to the graph and render resolver", () => {
    const seen: Array<OgImageNode> = [];
    const resolver = (node: OgImageNode) => {
      seen.push(node);
      return { url: "/default.png" };
    };
    const declaration: RouteSeo = {
      kind: "page", titleTemplate: "%s | Example",
      head: { title: "Post", description: "About it", canonicalPath: "/canonical", faqs: [{ question: "Why?", answer: "Because.", category: "extra", isHighlighted: true }] },
    };
    buildSeoGraph({ origin: config.origin, ogImage: resolver, routeTree: {
      options: {}, children: [{ options: { path: "post", staticData: { seo: declaration } } }],
    } });
    const declaredMatch = { ...match, staticData: { seo: declaration } };
    createSeo({ ...config, ogImage: resolver }).head({ match: declaredMatch, matches: [declaredMatch] });
    expect(seen).toHaveLength(2);
    expect(seen[0]).toEqual(seen[1]);
    expect(seen[0]?.path).toBe("/canonical");
    expect(seen[1]?.head?.faqs).toEqual([{ question: "Why?", answer: "Because." }]);
    expect(Object.keys(seen[1]!)).toEqual(["path", "kind", "head"]);
  });

  it("prefers the page image, then the article image, and never calls the fallback for either", () => {
    const seo = createSeo({ ...config, ogImage: () => { throw new Error("Fallback must not run"); } });
    const article = { publishedAt: "2026-10-05", image: "/article.png" };
    const page = { title: "Post", description: "About it", article, image: { url: "https://cdn.example.com/page.png" } };
    expect(seo.seoHead(context, page).meta).toContainEqual({ property: "og:image", content: "https://cdn.example.com/page.png" });
    expect(seo.seoHead(context, { ...page, image: undefined }).meta).toContainEqual({ property: "og:image", content: "https://example.com/article.png" });
  });

  it("uses a summary card without inventing an image from the JSON-LD default", () => {
    const head = createSeo({ ...config, ogImage: () => undefined }).seoHead(context, { title: "Post", description: "About it" });
    expect(head.meta).toContainEqual({ name: "twitter:card", content: "summary" });
    expect(head.meta).not.toEqual(expect.arrayContaining([expect.objectContaining({ property: "og:image" })]));
  });
});
