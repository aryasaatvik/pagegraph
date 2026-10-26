import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

import { renderRobots } from "../../src/core/projections";
import { tanstackStartGraph } from "../../src/tanstack-start/load";

const fixture = fileURLToPath(new URL("../fixtures/tanstack-start-app", import.meta.url));
const cli = fileURLToPath(new URL("../../src/cli/bin.ts", import.meta.url));
const roots: Array<string> = [];
afterAll(() => roots.forEach((root) => rmSync(root, { recursive: true, force: true })));

const route = (path: string, extra = "") =>
  `import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("${path}")({
  staticData: { seo: { kind: "page", ${extra} head: { title: "T | Example", description: "D.", image: { url: "/og/default.png" } } } },
});
`;

/**
 * The Samva shape: a public `/solutions` page and the sitemap route beside a
 * disallowed group that holds a dynamic `/s/$formKey` route.
 */
const samvaApp = (): string => {
  const root = mkdtempSync(join(fixture, "..", ".tmp-robots-"));
  roots.push(root);
  cpSync(fixture, root, { recursive: true });
  const config = join(root, "vite.config.ts");
  writeFileSync(
    config,
    readFileSync(config, "utf8")
      .replace('indexable: command === "build"', "indexable: true")
      .replace(
        "exclude:",
        `routeConfig: {
        outputPath: new URL("./src/route-config.gen.ts", import.meta.url).pathname,
        publicGroups: ["(marketing)", "(forms)"],
        enforceCoverageIn: [],
        disallowGroups: ["(forms)"],
      },
      exclude:`,
      ),
  );
  mkdirSync(join(root, "src/routes/(forms)/s"), { recursive: true });
  writeFileSync(join(root, "src/routes/(forms)/s/$formKey.tsx"), route("/(forms)/s/$formKey"));
  writeFileSync(
    join(root, "src/routes/(marketing)/solutions.tsx"),
    route("/(marketing)/solutions", 'sitemap: { priority: 0.5, changeFrequency: "monthly" },'),
  );
  return root;
};

describe("robots exclusions for a dynamic disallowed route", () => {
  it("disallows only paths under the dynamic segment's directory", async () => {
    const loaded = await tanstackStartGraph({ root: samvaApp() })();
    try {
      expect(loaded.site.robots.disallow).toEqual(["/app", "/s/"]);
      expect(
        renderRobots(loaded.graph, { ...loaded.site, indexable: true, ...loaded.site.robots }),
      ).toBe(
        [
          "User-agent: *",
          "Content-Signal: search=yes",
          "Allow: /",
          "Disallow: /app",
          "Disallow: /s/",
          "",
          "Sitemap: https://example.com/sitemap.xml",
          "Host: https://example.com",
          "",
        ].join("\n"),
      );
    } finally {
      await loaded.dispose();
    }
  });

  it("fails `pagegraph check` when a Disallow prefix blocks /solutions and the sitemap", () => {
    const root = samvaApp();
    const ok = spawnSync("bun", [cli, "check", "--json"], { cwd: root, encoding: "utf8" });
    expect(JSON.parse(ok.stdout).structural).toBe(0);
    expect(ok.status).toBe(0);

    const vite = join(root, "vite.config.ts");
    writeFileSync(
      vite,
      readFileSync(vite, "utf8").replace('disallow: ["/app"]', 'disallow: ["/app", "/s"]'),
    );
    const bad = spawnSync("bun", [cli, "check", "--json"], { cwd: root, encoding: "utf8" });
    expect(bad.status).toBe(1);
    const violations = (
      JSON.parse(bad.stdout).violations as Array<{ rule: string; path: string }>
    ).filter((v) => v.rule === "robots-blocks-sitemap-url");
    expect(violations.map((v) => `${v.rule} ${v.path}`)).toEqual([
      "robots-blocks-sitemap-url /solutions",
      "robots-blocks-sitemap-url /sitemap.xml",
    ]);
  });
});
