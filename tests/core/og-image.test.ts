import { describe, expect, it } from "vitest";
import { buildSeoGraph, graphFromJson, graphToJson, pageHeads, type SeoRouteNode } from "../../src/core";

const sitemap = { priority: 0.8, changeFrequency: "monthly" } as const;
const routeTree: SeoRouteNode = { options: {}, children: [
  { options: { path: "page", staticData: { seo: { kind: "page", sitemap, head: { title: "Page", description: "Page description", image: { url: "/page.png", alt: "Page" }, article: { publishedAt: "2026-10-05", image: "/article.png" } } } } } },
  { options: { path: "article", staticData: { seo: { kind: "article", sitemap, head: { title: "Article", description: "Article description", article: { publishedAt: "2026-10-05", image: "/article.png" } } } } } },
  { options: { path: "fallback", staticData: { seo: { kind: "page", sitemap, head: { title: "Fallback", description: "Fallback description" } } } } },
  { options: { path: "missing-head", staticData: { seo: { kind: "page", sitemap } } } },
  { options: { path: "blog/$slug", staticData: { seo: { kind: "article", sitemap, titleTemplate: "%s | Blog" } } } },
] };

describe("resolved graph images", () => {
  it("preserves page/article/collection overrides ahead of the resolver and serialization", () => {
    const resolved: Array<string> = [];
    const graph = buildSeoGraph({ routeTree, origin: "https://example.com", ogImage: (node) => {
      resolved.push(node.path);
      return { url: `/og${node.path}.png`, width: 1200, height: 630, alt: node.head?.title };
    }, collections: [{ route: "/blog/$slug", source: "blog", instances: [
      { path: "/blog/post", title: "Post", description: "A post", image: { url: "https://cdn.example.com/post.png" } },
      { path: "/blog/second", title: "Second", description: "Another post" },
    ] }] });
    expect(resolved).not.toContain("/blog/$slug");
    expect(resolved).not.toContain("/page");
    expect(resolved).not.toContain("/article");
    expect(resolved).not.toContain("/blog/post");
    expect(graph.nodes.get("/page")?.head?.image).toEqual({ url: "https://example.com/page.png", alt: "Page" });
    expect(graph.nodes.get("/article")?.head?.image?.url).toBe("https://example.com/article.png");
    expect(graph.nodes.get("/missing-head")?.head?.image?.url).toBe("https://example.com/og/missing-head.png");
    expect(graph.nodes.get("/blog/second")?.head?.image?.alt).toBe("Second | Blog");
    const roundtrip = graphFromJson(JSON.parse(JSON.stringify(graphToJson(graph))));
    expect(roundtrip.nodes.get("/fallback")?.head?.image).toEqual({ url: "https://example.com/og/fallback.png", width: 1200, height: 630, alt: "Fallback" });
    expect(pageHeads(roundtrip, { exclude: ["/missing-head"] }).find((head) => head.path === "/fallback")?.image).toEqual(graph.nodes.get("/fallback")?.head?.image);
  });

  it("leaves missing images absent and does not fabricate metadata for a resolver-only head", () => {
    const graph = buildSeoGraph({ routeTree, ogImage: () => undefined });
    expect(graph.nodes.get("/fallback")?.head?.image).toBeUndefined();
    expect(graph.nodes.get("/missing-head")?.head).toBeUndefined();
    const resolved = buildSeoGraph({ routeTree, ogImage: () => ({ url: "/default.png" }) });
    expect(() => pageHeads(resolved)).toThrow("Invalid page head for /missing-head: missing title");
  });
});
