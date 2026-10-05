import { describe, expect, it } from "@effect/vitest";

import { checkGraph, hasStructuralViolations, type Violation } from "../../src/core/checks";
import type { RouteSeo, SeoKind } from "../../src/core/declare";
import type { SeoEdge, SeoGraph, SeoNode } from "../../src/core/graph";

/**
 * `checkGraph` is pure over a `SeoGraph`, so these fixtures build minimal graphs
 * directly (one per rule) rather than walking a route tree — that keeps each test
 * targeted at the single rule it exercises and its severity.
 */
const graphOf = (nodes: Array<SeoNode>, edges: Array<SeoEdge> = []): SeoGraph => ({
  nodes: new Map(nodes.map((node) => [node.path, node])),
  edges,
});

const routeNode = (path: string, policy: Partial<RouteSeo> & { kind: SeoKind }): SeoNode => ({
  path,
  kind: policy.kind,
  source: "route",
  head: { title: path, image: { url: "https://images.example.com/og.png" } },
  policy,
});

const instanceNode = (
  path: string,
  instance: { title: string; description?: string | undefined },
  kind: SeoKind = "article",
): SeoNode => ({
  path,
  kind,
  source: "blog",
  policy: { kind },
  instance,
});

const rulesOf = (violations: ReadonlyArray<Violation>): Array<string> =>
  violations.map((violation) => violation.rule);

describe("checkGraph — structural rules", () => {
  it("flags a related or redirect edge whose target is not a node (dead-edge)", () => {
    const graph = graphOf(
      [routeNode("/blog/$slug", { kind: "article", related: ["/gone"] })],
      [
        { from: "/blog/$slug", to: "/gone", type: "related" },
        { from: "/old", to: "/also-gone", type: "redirect" },
        { from: "/blog/$slug", to: "/blog", type: "crumb-parent" }, // crumb edges are exempt
      ],
    );
    const dead = checkGraph(graph).filter((violation) => violation.rule === "dead-edge");
    expect(dead).toHaveLength(2);
    expect(dead.every((violation) => violation.severity === "structural")).toBe(true);
    expect(dead.map((violation) => violation.path).sort()).toEqual(["/blog/$slug", "/old"]);
  });

  it("flags a content instance with no title (instance-missing-title)", () => {
    const graph = graphOf([instanceNode("/blog/empty", { title: "  " })]);
    const violations = checkGraph(graph);
    expect(rulesOf(violations)).toContain("instance-missing-title");
    expect(violations[0]?.severity).toBe("structural");
  });

  it("flags a path owned by more than one source (path-owner-collision)", () => {
    const graph: SeoGraph = {
      ...graphOf([routeNode("/pricing", { kind: "page" })]),
      collisions: [{ path: "/pricing", sources: ["route", "template"] }],
    };
    const violations = checkGraph(graph);
    expect(rulesOf(violations)).toContain("path-owner-collision");
    expect(hasStructuralViolations(violations)).toBe(true);
  });

  it("flags a sitemap policy that also declares robots noindex (contradiction)", () => {
    const graph = graphOf([
      routeNode("/compare", {
        kind: "hub",
        sitemap: { priority: 0.5, changeFrequency: "monthly" },
        robots: "noindex, follow",
      }),
    ]);
    const violations = checkGraph(graph);
    expect(rulesOf(violations)).toContain("sitemap-noindex-contradiction");
    expect(hasStructuralViolations(violations)).toBe(true);
  });

  it("catches the contradiction case-insensitively and flags miscased robots values", () => {
    const graph = graphOf([
      routeNode("/compare", {
        kind: "hub",
        sitemap: { priority: 0.5, changeFrequency: "monthly" },
        robots: "NOINDEX, follow",
      }),
    ]);
    const violations = checkGraph(graph);
    expect(rulesOf(violations)).toContain("sitemap-noindex-contradiction");
    expect(rulesOf(violations)).toContain("robots-not-lowercase");
    expect(hasStructuralViolations(violations)).toBe(true);
  });

  it("flags a related target route that declares no link metadata", () => {
    const graph = graphOf(
      [
        routeNode("/blog/$slug", { kind: "article", related: ["/no-link", "/has-link"] }),
        routeNode("/no-link", { kind: "page" }),
        routeNode("/has-link", { kind: "page", link: { title: "Has", description: "Link." } }),
      ],
      [
        { from: "/blog/$slug", to: "/no-link", type: "related" },
        { from: "/blog/$slug", to: "/has-link", type: "related" },
      ],
    );
    const missing = checkGraph(graph).filter(
      (violation) => violation.rule === "related-target-missing-link",
    );
    expect(missing).toHaveLength(1);
    expect(missing[0]?.path).toBe("/no-link");
    expect(missing[0]?.severity).toBe("structural");
  });

  it("does not require link metadata when the related target is a content instance", () => {
    const graph = graphOf(
      [
        routeNode("/blog/$slug", { kind: "article", related: ["/blog/other"] }),
        instanceNode("/blog/other", { title: "Other", description: "x".repeat(80) }),
      ],
      [{ from: "/blog/$slug", to: "/blog/other", type: "related" }],
    );
    expect(rulesOf(checkGraph(graph))).not.toContain("related-target-missing-link");
  });

  it("flags a redirect node that also declares a sitemap policy (redirect-in-sitemap)", () => {
    const graph = graphOf([
      routeNode("/features/email", {
        kind: "page",
        redirectTo: "/features",
        sitemap: { priority: 0.5, changeFrequency: "monthly" },
      }),
    ]);
    const violations = checkGraph(graph);
    expect(rulesOf(violations)).toContain("redirect-in-sitemap");
    expect(violations[0]?.severity).toBe("structural");
  });
});

describe("checkGraph — editorial rules", () => {
  it("flags duplicate instance titles, one violation per page", () => {
    const graph = graphOf([
      instanceNode("/blog/a", { title: "Same", description: "y".repeat(80) }),
      instanceNode("/blog/b", { title: "Same", description: "z".repeat(80) }),
    ]);
    const dupes = checkGraph(graph).filter((violation) => violation.rule === "duplicate-title");
    expect(dupes).toHaveLength(2);
    expect(dupes.every((violation) => violation.severity === "editorial")).toBe(true);
  });

  it("flags duplicate instance descriptions", () => {
    const shared = "The same meta description reused across two distinct pages here.";
    const graph = graphOf([
      instanceNode("/blog/a", { title: "A", description: shared }),
      instanceNode("/blog/b", { title: "B", description: shared }),
    ]);
    const dupes = checkGraph(graph).filter(
      (violation) => violation.rule === "duplicate-description",
    );
    expect(dupes).toHaveLength(2);
  });

  it("flags descriptions that are too long or too short, but not those in range", () => {
    const graph = graphOf([
      instanceNode("/blog/long", { title: "Long", description: "x".repeat(200) }),
      instanceNode("/blog/short", { title: "Short", description: "too short" }),
      instanceNode("/blog/ok", { title: "Ok", description: "y".repeat(100) }),
    ]);
    const lengths = checkGraph(graph).filter(
      (violation) => violation.rule === "description-length",
    );
    expect(lengths.map((violation) => violation.path).sort()).toEqual([
      "/blog/long",
      "/blog/short",
    ]);
    expect(lengths.every((violation) => violation.severity === "editorial")).toBe(true);
  });
});

describe("checkGraph — exit classification", () => {
  it("reports no violations and no structural failure on a clean graph", () => {
    const graph = graphOf(
      [
        routeNode("/pricing", {
          kind: "page",
          sitemap: { priority: 0.9, changeFrequency: "weekly" },
          link: { title: "Pricing", description: "Per-email pricing." },
        }),
        instanceNode("/blog/a", { title: "Unique A", description: "a".repeat(90) }),
      ],
      [],
    );
    const violations = checkGraph(graph);
    expect(violations).toHaveLength(0);
    expect(hasStructuralViolations(violations)).toBe(false);
  });

  it("classifies an editorial-only graph as passing (no structural failure)", () => {
    const graph = graphOf([
      instanceNode("/blog/a", { title: "Dup", description: "a".repeat(90) }),
      instanceNode("/blog/b", { title: "Dup", description: "b".repeat(90) }),
    ]);
    const violations = checkGraph(graph);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.every((violation) => violation.severity === "editorial")).toBe(true);
    expect(hasStructuralViolations(violations)).toBe(false);
  });

  it("classifies a graph with any structural violation as failing", () => {
    const graph = graphOf(
      [routeNode("/old", { kind: "page", redirectTo: "/new" })],
      [{ from: "/old", to: "/new", type: "redirect" }],
    );
    expect(hasStructuralViolations(checkGraph(graph))).toBe(true);
  });
});


describe("checkGraph — OG image requirements", () => {
  const sitemap = { priority: 0.5, changeFrequency: "monthly" } as const;
  it("fails only sitemap-eligible pages without a resolved image", () => {
    const eligible = routeNode("/pricing", { kind: "page", sitemap });
    const noindex = routeNode("/private", { kind: "page", sitemap, robots: "noindex" });
    const dynamic = routeNode("/blog/$slug", { kind: "article", sitemap });
    for (const node of [eligible, noindex, dynamic]) delete node.head;
    const findings = checkGraph(graphOf([eligible, noindex, dynamic])).filter((v) => v.rule === "missing-og-image");
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ path: "/pricing", severity: "structural" });
    expect(findings[0]?.fix).toContain("ogImage resolver");
  });
  it("allows warning and off policies, and accepts a resolved image", () => {
    const node = routeNode("/pricing", { kind: "page", sitemap });
    expect(checkGraph(graphOf([node]))).toEqual([]);
    delete node.head;
    const graph = graphOf([node]);
    expect(checkGraph(graph, { ogImage: { severity: "editorial" } })).toEqual([
      expect.objectContaining({ rule: "missing-og-image", severity: "editorial" }),
    ]);
    expect(checkGraph(graph, { ogImage: { severity: "off" } })).toEqual([]);
  });
});
