import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { SeoCliConfig } from "../../src/config";
import type { SeoGraph } from "../../src/core/graph";
import type { DecisionBatchReport } from "../../src/decide/record";
import { runWorkflow } from "../../src/workflows/run";
import type { RunnerResult } from "../../src/workflows/runner";

vi.mock("../../src/workflows/prompts/research.md", async () => {
  const { readFile } = await import("node:fs/promises");
  return { default: await readFile(new URL("../../src/workflows/prompts/research.md", import.meta.url), "utf8") };
});
vi.mock("../../src/workflows/prompts/action.md", async () => {
  const { readFile } = await import("node:fs/promises");
  return { default: await readFile(new URL("../../src/workflows/prompts/action.md", import.meta.url), "utf8") };
});

const cli = fileURLToPath(new URL("../../src/cli/bin.ts", import.meta.url));
const directories: Array<string> = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const route = "src/routes/pricing.tsx";
const before = 'export const title = "Old pricing";\nexport const description = "Old description.";\n';
const usage: RunnerResult["usage"] = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const executor = {
  searches: [{ tool: "executor_search", input: { query: "SEO" }, output: [] }],
  calls: [{ tool: "executor_execute", input: { code: "return tools.gsc.performance({})" }, output: { rows: [] } }],
};
const decisions: DecisionBatchReport = {
  kind: "decide", schemaVersion: 1, family: "meta", model: "jev-latest", threshold: 0.7,
  counts: { inputs: 2, resolved: 1, review: 1 }, verdicts: { "choose:a": 1, review: 1 }, resolved: [],
  review: [{ decisionId: "meta:1", schemaVersion: 1, family: "meta", model: "jev-latest", threshold: 0.7, inputHash: "hash",
    inputRef: "/enterprise", verdict: "review", review: true, answers: { intentFit: { probability: 0.6 } } }],
};
const state = { summary: "Two candidates.", items: [{ url: "/pricing", intent: "pricing", categoryLock: "email API",
  candidates: [{ id: "a", title: "Email API pricing", description: "Plans." }, { id: "b", title: "Pricing", description: "Plans." }] }] };

/** Run improve metadata in dry-run with an offline runner that submits two edits and one review item. */
const dryRun = async () => {
  vi.stubEnv("TYPESAFE_API_KEY", "offline-test-key");
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pagegraph-apply-")));
  directories.push(root);
  mkdirSync(join(root, "src/routes"), { recursive: true });
  writeFileSync(join(root, route), before);
  writeFileSync(join(root, "pagegraph.config.ts"), `export default {
    loadGraph: async () => { throw new Error("apply must not load the graph"); },
    workflows: { agent: { presetDirectory: ".pagegraph/agent", defaultModel: "test/model" } },
  };\n`);
  writeFileSync(join(root, ".gitignore"), ".pagegraph/\n");
  const git = (...args: Array<string>) => execFileSync("git", args, { cwd: root, stdio: "ignore" });
  git("init"); git("add", "."); git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "fixture");
  const graph: SeoGraph = { nodes: new Map([["/pricing", { path: "/pricing", kind: "page", source: "route",
    policy: { kind: "page", sitemap: { priority: 0.8, changeFrequency: "monthly" } } }]]), edges: [] };
  const site = { origin: "https://example.com", indexable: true, robots: { disallow: [] } };
  const config: SeoCliConfig = { loadGraph: async () => ({ graph, site, dispose: async () => {} }),
    workflows: { agent: { presetDirectory: ".pagegraph/agent", defaultModel: "test/model" } } };
  const messages: RunnerResult["messages"] = [{ role: "user", content: "research", timestamp: 1 }];
  const result = await runWorkflow({
    root, graph, site, config, workflow: "improve.metadata",
    options: { pages: [], queries: [], kinds: [], competitors: [], domains: [], limit: 2, refresh: false, dryRun: true, allowDirty: false },
  }, {
    acquireRunner: async () => ({
      model: { provider: "test", id: "model" },
      research: async () => ({ state, messages, usage, executor }),
      act: async () => ({ messages, usage, executor, state: {
        summary: "Sharper pricing metadata.",
        edits: [
          { path: route, oldText: '"Old pricing"', newText: '"Email API pricing"', reason: "Candidate a won.", evidence: ["Jev choose:a"] },
          { path: route, oldText: '"Old description."', newText: '"Plans for product teams."', reason: "Matches intent.", evidence: ["GSC CTR 0.4%"] },
        ],
        reviewItems: [{ path: "src/routeTree.gen.ts", reason: "Generated; titles live in the route.", evidence: [] }],
      } }),
      close: async () => {},
    }),
    decide: async () => decisions,
  });
  return { root, ...result };
};

const run = (root: string, args: ReadonlyArray<string>) =>
  spawnSync("bun", [cli, "apply", ...args], { cwd: root, encoding: "utf8", timeout: 20_000, env: { ...process.env, NO_COLOR: "1" } });

describe("improve dry-run and pagegraph apply", () => {
  it("records edits.json and review.md in dry-run without touching source files", async () => {
    const { root, run: recorded, directory } = await dryRun();
    expect(readFileSync(join(root, route), "utf8")).toBe(before);
    expect(recorded.changes.files).toEqual([]);
    expect(recorded.result).toMatchObject({ outcome: "dry-run", edits: [{ id: "e1" }, { id: "e2" }] });
    const edits = JSON.parse(readFileSync(join(directory, "edits.json"), "utf8"));
    expect(edits).toMatchObject({ kind: "pagegraph-workflow-edits", schemaVersion: 1, mode: "dry-run", root });
    expect(edits.reviewItems).toEqual([
      { source: "agent", path: "src/routeTree.gen.ts", reason: "Generated; titles live in the route.", evidence: [] },
      { source: "decision", path: "/enterprise", reason: expect.stringContaining("meta:1"), evidence: ["intentFit: 0.60"] },
    ]);
    const review = readFileSync(join(directory, "review.md"), "utf8");
    expect(review).toContain("dry-run (source files are unchanged)");
    expect(review).toContain(`- "Old pricing"\n+ "Email API pricing"`);
    expect(review).toContain("Generated; titles live in the route.");
  });

  it("checks, applies a subset, then applies the rest and refuses stale targets", async () => {
    const { root, run: recorded } = await dryRun();
    const check = run(root, [recorded.id, "--check"]);
    expect(check.status, check.stderr).toBe(0);
    expect(check.stdout).toContain("2 applicable, 0 stale, 0 failed (check only; no files changed)");
    expect(readFileSync(join(root, route), "utf8")).toBe(before);

    const subset = run(root, [recorded.id, "--only", "e2", "--json"]);
    expect(subset.status, subset.stderr).toBe(0);
    expect(JSON.parse(subset.stdout)).toMatchObject({
      kind: "pagegraph-apply-report", schemaVersion: 1, run: recorded.id, check: false,
      edits: [{ id: "e2", path: route, status: "applied" }], counts: { applied: 1, stale: 0, failed: 0 },
    });
    expect(readFileSync(join(root, route), "utf8")).toContain('"Plans for product teams."');
    expect(readFileSync(join(root, route), "utf8")).toContain('"Old pricing"');

    const rest = run(root, [`.pagegraph/runs/${recorded.id}`]);
    expect(rest.status).toBe(1);
    expect(rest.stdout).toContain("✓ e1 applied");
    expect(rest.stdout).toContain(`✗ e2 stale ${route}: target text not found`);
    expect(rest.stderr).toContain("1 stale and 0 failed edit(s) were not applied");
    expect(readFileSync(join(root, route), "utf8")).toBe('export const title = "Email API pricing";\nexport const description = "Plans for product teams.";\n');
  });

  it("refuses an edit whose target changed after the run and leaves the file as edited", async () => {
    const { root, run: recorded } = await dryRun();
    const edited = 'export const title = "Hand-tuned pricing";\nexport const description = "Old description.";\n';
    writeFileSync(join(root, route), edited);
    const result = run(root, [recorded.id, "--only", "e1", "--json"]);
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).edits).toEqual([{ id: "e1", path: route, status: "stale", reason: "target text not found" }]);
    expect(readFileSync(join(root, route), "utf8")).toBe(edited);
  });

  it("rejects unknown edit IDs and runs without edits.json", async () => {
    const { root, run: recorded } = await dryRun();
    const unknown = run(root, [recorded.id, "--only", "e1,e9"]);
    expect(unknown.status).toBe(1);
    expect(unknown.stderr).toContain("Unknown edit ID(s)");
    expect(unknown.stderr).toContain("e9");
    expect(readFileSync(join(root, route), "utf8")).toBe(before);
    const missing = run(root, ["no-such-run"]);
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("No edits.json");
  });
});
