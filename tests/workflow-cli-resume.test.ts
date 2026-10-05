import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import type { WorkflowRunV2 } from "../src/workflows/model";

const cli = fileURLToPath(new URL("../src/cli/bin.ts", import.meta.url));
const directories: string[] = [];

const fixture = (runsDirectory = ".pagegraph/runs") => {
  const root = mkdtempSync(join(tmpdir(), "pagegraph-cli-resume-"));
  directories.push(root);
  const directory = join(root, runsDirectory, "completed-run");
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(root, "pagegraph.config.mjs"), `
    import { appendFileSync } from "node:fs";
    export default {
      loadGraph: async () => { appendFileSync(${JSON.stringify(join(root, "graph-loaded.txt"))}, "loaded"); throw new Error("GRAPH_REQUIRED"); },
      workflows: { agent: { presetDirectory: "missing-preset", defaultModel: "missing/model" }, runsDirectory: ${JSON.stringify(runsDirectory)} }
    };
  `);
  const run: WorkflowRunV2 = {
    kind: "pagegraph-workflow-run", schemaVersion: 2, id: "completed-run", workflow: "research.keywords",
    startedAt: "2026-10-05T10:00:00.000Z", finishedAt: "2026-10-05T10:01:00.000Z",
    project: { root, dirtyAtStart: false },
    options: { pages: [], queries: ["recorded query"], kinds: [], competitors: [], domains: [], limit: 1, refresh: false, dryRun: false, allowDirty: false },
    model: { provider: "test", id: "model" }, targets: { pages: [], queries: ["recorded query"], kinds: [] },
    evidence: { graph: { nodes: [], edges: [] }, neighborhood: { inbound: [], outbound: [] }, sources: [], executor: { searches: [], calls: [] } },
    decisions: [], changes: { files: [], providerCalls: [] }, result: { summary: "Previously completed research." },
    agent: { runtime: "pi", model: { provider: "test", id: "model" }, messages: [],
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } },
  };
  const path = join(directory, "run.json");
  writeFileSync(path, JSON.stringify(run));
  const invoke = (from: string, args: string[] = []) => spawnSync("bun", [cli, "research", "keywords", "--from", from, "--json", ...args], {
    cwd: root, encoding: "utf8", timeout: 15_000,
    env: { ...process.env, NO_COLOR: "1", TYPESAFE_API_KEY: "", EXECUTOR_BASE_URL: "", EXECUTOR_TOKEN: "", OPENAI_API_KEY: "", ANTHROPIC_API_KEY: "" },
  });
  return { root, directory, path, run, invoke, graphLoaded: join(root, "graph-loaded.txt") };
};

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("completed workflow resume on the CLI", () => {
  it.each(["run ID", "run directory"])("prints the validated recorded run by %s without acquiring the graph or provider credentials", (selector) => {
    const f = fixture();
    const result = f.invoke(selector === "run ID" ? f.run.id : f.directory);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(f.run);
    expect(existsSync(f.graphLoaded)).toBe(false);
  });

  it("resolves a run ID using --out before acquiring the graph", () => {
    const f = fixture("alternate-runs");
    writeFileSync(join(f.root, "pagegraph.config.mjs"), readFileSync(join(f.root, "pagegraph.config.mjs"), "utf8").replace('"alternate-runs"', '"config-runs"'));
    const result = f.invoke(f.run.id, ["--out", "alternate-runs"]);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(f.run);
    expect(existsSync(f.graphLoaded)).toBe(false);
  });

  it("still acquires the graph when the run has only incomplete progress", () => {
    const f = fixture();
    rmSync(f.path);
    writeFileSync(join(f.directory, "progress.json"), JSON.stringify({
      kind: "pagegraph-workflow-progress", schemaVersion: 2, id: f.run.id, workflow: f.run.workflow,
      startedAt: f.run.startedAt, repositoryRoot: f.root, project: { ...f.run.project, filesAtStart: [] },
      options: f.run.options, evidence: f.run.evidence, git: { dirty: false, files: [], fingerprints: {} },
    }));
    const result = f.invoke(f.run.id);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("GRAPH_REQUIRED");
    expect(readFileSync(f.graphLoaded, "utf8")).toBe("loaded");
  });

  it.each(["schema", "workflow", "run ID", "project root"])("validates the completed artifact's %s before returning it", (field) => {
    const f = fixture();
    const run = {
      ...f.run,
      ...(field === "schema" ? { schemaVersion: 999 } : {}),
      ...(field === "workflow" ? { workflow: "research.authority" } : {}),
      ...(field === "run ID" ? { id: "different-run" } : {}),
      ...(field === "project root" ? { project: { ...f.run.project, root: tmpdir() } } : {}),
    };
    writeFileSync(f.path, JSON.stringify(run));
    const result = f.invoke(f.run.id);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Cannot resume");
    expect(existsSync(f.graphLoaded)).toBe(false);
  });
});
