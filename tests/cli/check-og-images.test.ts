import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { checkLocalOgImages } from "../../src/cli/og-images";
import type { SeoGraph } from "../../src/core/graph";

const cli = fileURLToPath(new URL("../../src/cli/bin.ts", import.meta.url));
const graphModule = new URL("../../src/core/graph.ts", import.meta.url).href;
const roots: Array<string> = [];
const project = (image?: string, policy = "", directory = "public"): string => {
  const root = mkdtempSync(join(tmpdir(), "pagegraph-og-check-"));
  roots.push(root);
  mkdirSync(join(root, directory));
  writeFileSync(join(root, "pagegraph.config.mjs"), `export default {
    ${policy}
    loadGraph: async () => ({
      site: { origin: "https://example.com", indexable: true, robots: { disallow: [] } },
      graph: { nodes: new Map([["/pricing", {
        path: "/pricing", kind: "page", source: "route",
        policy: { kind: "page", sitemap: { priority: 0.5, changeFrequency: "monthly" } },
        head: { title: "Pricing"${image === undefined ? "" : `, image: { url: ${JSON.stringify(image)} }`} },
      }]]), edges: [] }, dispose: async () => {},
    }),
  };`);
  return root;
};
const run = (root: string) => spawnSync("bun", [cli, "check", "--json"], { cwd: root, encoding: "utf8", timeout: 20_000 });
afterAll(() => roots.forEach((root) => rmSync(root, { recursive: true, force: true })));

describe("pagegraph check — OG images", () => {
  it("fails missing images with a page and actionable fix", () => {
    const result = run(project());
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).violations).toEqual([
      expect.objectContaining({ path: "/pricing", rule: "missing-og-image", severity: "structural", fix: expect.stringContaining("ogImage resolver") }),
    ]);
  });
  it("fails missing same-origin files and passes an existing encoded path from a nested cwd", () => {
    const root = project("https://example.com/social%20card.png?version=1");
    expect(run(root).status).toBe(1);
    expect(JSON.parse(run(root).stdout).violations[0].rule).toBe("missing-og-image-file");
    writeFileSync(join(root, "public/social card.png"), "image");
    const nested = join(root, "nested");
    mkdirSync(nested);
    expect(run(nested).status).toBe(0);
  });
  it("checks relative paths and a configured public directory", () => {
    const root = project("/card.png", 'ogImage: { publicDirectory: "static" },', "static");
    writeFileSync(join(root, "static/card.png"), "image");
    expect(run(root).status).toBe(0);
  });
  it("compares canonical origins when callers supply a trailing slash", async () => {
    const root = project();
    const graph: SeoGraph = { nodes: new Map([["/pricing", {
      path: "/pricing", kind: "page", source: "route",
      policy: { kind: "page", sitemap: { priority: 0.5, changeFrequency: "monthly" } },
      head: { title: "Pricing", image: { url: "https://example.com/missing.png" } },
    }]]), edges: [] };
    expect(await checkLocalOgImages(graph, "https://example.com/", root)).toEqual([
      expect.objectContaining({ rule: "missing-og-image-file" }),
    ]);
  });
  it("rejects non-http image protocols", () => {
    for (const url of ["data:image/png;base64,AA==", "javascript:alert(1)", "file:///tmp/card.png"]) {
      const result = run(project(url));
      expect(result.status).toBe(1);
      expect(JSON.parse(result.stdout).violations[0].rule).toBe("invalid-og-image");
    }
  });
  it("does not fetch external images", () => {
    expect(run(project("https://invalid.example.test/card.png")).status).toBe(0);
  });
  it("supports warning/off policy and rejects invalid severity", () => {
    const warning = run(project(undefined, 'ogImage: { severity: "editorial" },'));
    expect(warning.status).toBe(0);
    expect(JSON.parse(warning.stdout).violations[0].severity).toBe("editorial");
    expect(run(project("/missing.png", 'ogImage: { severity: "off" },')).status).toBe(0);
    expect(run(project(undefined, 'ogImage: { severity: "oops" },')).status).toBe(1);
  });
  it.each(["structural", "editorial", "off"] as const)(
    "reports malformed URLs from actual graph loading under %s policy",
    (severity) => {
      const root = project();
      writeFileSync(join(root, "pagegraph.config.mjs"), `
        import { buildSeoGraph } from ${JSON.stringify(graphModule)};
        export default {
          ogImage: { severity: ${JSON.stringify(severity)} },
          loadGraph: async () => ({
            site: { origin: "https://example.com", indexable: true, robots: { disallow: [] } },
            graph: buildSeoGraph({
              origin: "https://example.com",
              routeTree: { options: {}, children: [{ options: { path: "pricing", staticData: { seo: {
                kind: "page", sitemap: { priority: 0.5, changeFrequency: "monthly" },
                head: { title: "Pricing", image: { url: "http://[" } },
              } } } }] },
            }),
            dispose: async () => {},
          }),
        };
      `);
      const result = run(root);
      expect(result.status).toBe(severity === "structural" ? 1 : 0);
      expect(result.stdout).not.toBe("");
      const report = JSON.parse(result.stdout);
      expect(report.ok).toBe(severity !== "structural");
      expect(report.violations).toEqual(severity === "off" ? [] : [
        expect.objectContaining({ path: "/pricing", rule: "invalid-og-image", severity }),
      ]);
    },
  );
  it("rejects directories, decoded traversal, malformed encoding, and escaping symlinks", () => {
    for (const image of ["/folder", "/%2e%2e%2foutside.png", "/%ff.png", "/escape.png"]) {
      const root = project(image);
      mkdirSync(join(root, "public/folder"));
      writeFileSync(join(root, "outside.png"), "outside");
      symlinkSync(join(root, "outside.png"), join(root, "public/escape.png"));
      expect(run(root).status).toBe(1);
    }
  });
});
