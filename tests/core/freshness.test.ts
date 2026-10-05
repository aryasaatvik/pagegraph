import { describe, expect, it } from "@effect/vitest";

import { checkGraph } from "../../src/core/checks";
import type { RouteSeo } from "../../src/core/declare";
import { freshnessReport } from "../../src/core/freshness";
import type { SeoGraph, SeoNode } from "../../src/core/graph";

const SITEMAP = { priority: 0.5, changeFrequency: "monthly" } as const;
const NOW = new Date("2026-09-29T12:00:00.000Z");

const graphOf = (nodes: Array<SeoNode>): SeoGraph => ({
  nodes: new Map(nodes.map((node) => [node.path, node])),
  edges: [],
});

const routeNode = (path: string, policy: Partial<RouteSeo> = {}): SeoNode => ({
  path,
  kind: "page",
  source: "route",
  head: { title: path, image: { url: "https://images.example.com/og.png" } },
  policy: { kind: "page", sitemap: SITEMAP, ...policy },
});

const post = (
  path: string,
  dates: { publishedAt?: string; modifiedAt?: string },
  policy: Partial<RouteSeo> = {},
): SeoNode => ({
  path,
  kind: "article",
  source: "blog",
  head: { title: path, image: { url: "https://images.example.com/og.png" } },
  policy: { kind: "article", sitemap: SITEMAP, ...policy },
  instance: { title: path, ...dates },
});

describe("freshnessReport", () => {
  const graph = graphOf([
    routeNode("/pricing", { modifiedAt: "2026-09-20" }),
    routeNode("/features"),
    post("/blog/old", { publishedAt: "2025-01-01" }),
    post("/blog/older", { publishedAt: "2024-01-01", modifiedAt: "2024-06-01" }),
    post("/blog/refreshed", { publishedAt: "2024-01-01", modifiedAt: "2026-09-01" }),
    post("/blog/hidden", { publishedAt: "2020-01-01" }, { robots: "noindex, follow", sitemap: false }),
    post("/blog/broken", { publishedAt: "not a date" }),
  ]);

  it("queues sitemap pages older than the limit, oldest first", () => {
    const report = freshnessReport(graph, { maxAgeDays: 90 }, NOW);
    expect(report.stale.map((entry) => entry.path)).toEqual(["/blog/older", "/blog/old"]);
    expect(report.stale[0]).toMatchObject({
      lastModified: "2024-06-01T00:00:00.000Z",
      source: "blog",
      ageDays: 850,
    });
  });

  it("dates an instance by modifiedAt before publishedAt, and a route by its own modifiedAt", () => {
    const report = freshnessReport(graph, { maxAgeDays: 90 }, NOW);
    expect(report.fresh.map((entry) => entry.path)).toEqual(["/pricing", "/blog/refreshed"]);
  });

  it("reports undated pages separately and skips noindex pages and unparseable dates", () => {
    const report = freshnessReport(graph, { maxAgeDays: 90 }, NOW);
    expect(report.undated).toEqual(["/features"]);
    const judged = [...report.stale, ...report.fresh].map((entry) => entry.path);
    expect(judged).not.toContain("/blog/hidden");
    expect(judged).not.toContain("/blog/broken");
    expect(report.invalid).toEqual(["/blog/broken"]);
    expect(report).toMatchObject({ asOf: NOW.toISOString(), maxAgeDays: 90 });
  });
});

describe("checkGraph — dates", () => {
  it("flags an unparseable instance or route date as a structural invalid-date", () => {
    const violations = checkGraph(
      graphOf([
        routeNode("/pricing", { modifiedAt: "soon" }),
        post("/blog/a", { publishedAt: "2026-01-01", modifiedAt: "31/02/2026x" }),
        post("/blog/b", { publishedAt: "2026-01-01" }),
      ]),
    ).filter((violation) => violation.rule === "invalid-date");
    expect(violations).toEqual([
      expect.objectContaining({ path: "/pricing", severity: "structural", message: 'modifiedAt "soon" is not an ISO 8601 date on a real calendar day.' }),
      expect.objectContaining({ path: "/blog/a", severity: "structural" }),
    ]);
  });

  it("accepts only ISO dates on real calendar days", () => {
    const invalid = (value: string) =>
      checkGraph(graphOf([routeNode("/pricing", { modifiedAt: value })])).some(
        (violation) => violation.rule === "invalid-date",
      );
    for (const value of ["2026-02-30", "Sep 29, 2026", "2026-09-01T10:00", "2026-9-1"]) {
      expect(invalid(value), value).toBe(true);
    }
    for (const value of ["2026-02-28", "2024-02-29", "2026-09-01T10:00:00Z", "2026-09-01T10:00+05:30"]) {
      expect(invalid(value), value).toBe(false);
    }
  });

  it("emits editorial stale-page findings only when given a freshness policy", () => {
    const graph = graphOf([
      post("/blog/old", { publishedAt: "2025-01-01" }),
      post("/blog/new", { publishedAt: "2026-09-01" }),
    ]);
    expect(checkGraph(graph).some((violation) => violation.rule === "stale-page")).toBe(false);

    const stale = checkGraph(graph, { freshness: { maxAgeDays: 180 }, now: NOW }).filter(
      (violation) => violation.rule === "stale-page",
    );
    expect(stale).toEqual([
      expect.objectContaining({
        path: "/blog/old",
        severity: "editorial",
        message: "Last changed 2025-01-01, 636 days ago (limit 180).",
      }),
    ]);
  });
});
