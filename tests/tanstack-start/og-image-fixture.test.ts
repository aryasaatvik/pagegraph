import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { graphFromJson, graphToJson } from "../../src/core/wire";
import { tanstackStartGraph } from "../../src/tanstack-start/load";

const exec = promisify(execFile);
const packageRoot = resolve(import.meta.dirname, "../..");
const fixture = join(packageRoot, "tests/fixtures/tanstack-start-app");

async function check(root: string) {
  return exec("bun", [join(packageRoot, "src/cli/bin.ts"), "check", "--json"], {
    cwd: root, timeout: 30_000, maxBuffer: 1_000_000,
  });
}

async function expectImageFailure(root: string, rule: string, path: string) {
  try {
    await check(root);
    throw new Error("Expected the fixture's image check to fail");
  } catch (cause) {
    expect(cause).toMatchObject({ code: 1 });
    if (!(cause instanceof Error) || !("stdout" in cause)) throw cause;
    expect(JSON.parse(String(cause.stdout))).toMatchObject({
      ok: false,
      violations: expect.arrayContaining([expect.objectContaining({ rule, path, severity: "structural" })]),
    });
  }
}

describe("OG image fixture", () => {
  it("resolves collection fallbacks and a page override into the shipped graph", async () => {
    const loaded = await tanstackStartGraph({ root: fixture })();
    try {
      const graph = graphFromJson(graphToJson(loaded.graph));
      expect(graph.nodes.get("/blog/first")?.head?.image).toEqual({
        url: "https://example.com/og/default.png", width: 1200, height: 630,
        alt: "First post | Example Blog",
      });
      expect(graph.nodes.get("/pricing")?.head?.image).toEqual({
        url: "https://example.com/og/pricing.png", width: 1200, height: 630,
        alt: "Example pricing",
      });
    } finally { await loaded.dispose(); }
  });

  it("passes the real CLI, then names missing local files and uncovered pages", async () => {
    const root = await mkdtemp(join(packageRoot, "tests/fixtures/.tmp-og-"));
    try {
      await cp(fixture, root, { recursive: true });
      const passing = await check(root);
      expect(JSON.parse(passing.stdout)).toMatchObject({ ok: true, structural: 0 });

      await rm(join(root, "public/og/pricing.png"));
      await expectImageFailure(root, "missing-og-image-file", "/pricing");

      const config = join(root, "vite.config.ts");
      await writeFile(config, (await readFile(config, "utf8")).replace("      ogImage,", ""));
      await expectImageFailure(root, "missing-og-image", "/");
    } finally { await rm(root, { recursive: true, force: true }); }
  }, 90_000);
});
