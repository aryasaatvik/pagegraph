import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { loadPageHeads, pageHeads, selectPageHeadNodes, viteGraphLoader } from "../../src/config";
import type { SeoGraph, SeoNode } from "../../src/core/graph";

const node = (path: string): SeoNode => ({ path, kind: "page", source: "route", policy: { kind: "page", sitemap: false }, instance: { title: "Title", description: "Description" } });
const graph = (nodes: Array<SeoNode>): SeoGraph => ({ nodes: new Map(nodes.map((node) => [node.path, node])), edges: [] });

describe("page heads", () => {
  it("selects concrete indexable pages including sitemap-disabled hubs and caller-owned docs", () => {
    const hidden = node("/hidden"); hidden.policy.robots = "NOINDEX, follow";
    const redirect = node("/redirect"); redirect.policy.redirectTo = "/page";
    const layout = node("/layout"); layout.kind = "layout";
    const pages = graph([node("/page"), node("/docs"), node("/docs/api"), node("/captured"), node("/blog/$slug"), hidden, redirect, layout]);
    expect(pageHeads(pages, { exclude: ["/docs", "/docs/**", "/captured"] })).toEqual([{ path: "/page", title: "Title", description: "Description" }]);
    expect(selectPageHeadNodes(pages, { indexable: false })).toHaveLength(7);
    expect(pageHeads(graph([node("/docs")]))).toHaveLength(1);
  });
  it.each(["title", "description"] as const)("names the page missing %s and releases the loader", async (field) => {
    const page = node("/broken"); page.instance![field] = " ";
    const dispose = vi.fn(async () => {});
    await expect(loadPageHeads(async () => ({ graph: graph([page]), dispose }))).rejects.toThrow(`/broken: missing ${field}`);
    expect(dispose).toHaveBeenCalledOnce();
    expect(() => pageHeads(graph([{ ...page, instance: undefined }]))).toThrow("/broken: missing title");
  });
  it("releases a successful load", async () => {
    const dispose = vi.fn(async () => {});
    expect(await loadPageHeads(async () => ({ graph: graph([node("/page")]), dispose }))).toHaveLength(1);
    expect(dispose).toHaveBeenCalledOnce();
  });
  it("passes JSON input to a real Vite entry and preserves zero-argument exports", async () => {
    const root = mkdtempSync(join(tmpdir(), "pagegraph-input-"));
    writeFileSync(join(root, "graph.js"), `export function loadSeoGraph(input) { return { nodes: new Map([[input?.path ?? '/default', { path: input?.path ?? '/default', kind: 'page', source: 'route', policy: { kind: 'page', sitemap: false }, instance: {title: 'Title', description: 'Description'} }]]), edges: [] }; }`);
    try {
      const loader = viteGraphLoader<{ path: string }>({ root, entry: "/graph.js" });
      expect(await loadPageHeads(() => loader({ path: "/input" }))).toEqual([{ path: "/input", title: "Title", description: "Description" }]);
      expect((await loadPageHeads(viteGraphLoader({ root, entry: "/graph.js" })))[0]?.path).toBe("/default");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
