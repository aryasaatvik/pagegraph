import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SeoCliConfig } from "../src/config";
import type { SeoGraph } from "../src/core/graph";
import type { DecisionBatchReport } from "../src/decide/record";
import type { WorkflowId } from "../src/workflows/model";
import { WorkflowRunnerError } from "../src/workflows/pi";
import { runWorkflow } from "../src/workflows/run";
import type { RunnerResult, WorkflowRunner } from "../src/workflows/runner";

vi.mock("../src/workflows/prompts/research.md", async () => {
  const { readFile } = await import("node:fs/promises");
  return { default: await readFile(new URL("../src/workflows/prompts/research.md", import.meta.url), "utf8") };
});
vi.mock("../src/workflows/prompts/action.md", async () => {
  const { readFile } = await import("node:fs/promises");
  return { default: await readFile(new URL("../src/workflows/prompts/action.md", import.meta.url), "utf8") };
});
const directories: string[] = [];
const usage: RunnerResult["usage"] = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const evidence = { searches: [{ tool: "executor_search", input: { query: "SEO" }, output: [] }],
  calls: [{ tool: "executor_execute", input: { code: "return await tools.seo.search()" }, output: { rows: [{ keyword: "api" }] } }] };
const messages: RunnerResult["messages"] = [{ role: "user", content: "recorded research", timestamp: 1 }];
const decisionReport: DecisionBatchReport = { kind: "decide", schemaVersion: 1, family: "workflow-keywords", model: "jev-latest", threshold: 0.7,
  counts: { inputs: 0, resolved: 0, review: 0 }, verdicts: {}, resolved: [], review: [] };
const fixture = (workflow: WorkflowId = "research.keywords", gitRepository = true) => {
  const root = mkdtempSync(join(tmpdir(), "pagegraph-resume-"));
  directories.push(root);
  writeFileSync(join(root, "context.md"), "Original source\n");
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "ignore" });
  if (gitRepository) { git("init"); git("add", "context.md"); git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "fixture"); }
  const graph: SeoGraph = { nodes: new Map(), edges: [] };
  const site = { origin: "https://example.com", indexable: true, robots: { disallow: [] } };
  const config: SeoCliConfig = { loadGraph: async () => ({ graph, site, dispose: async () => {} }), workflows: { agent: { presetDirectory: ".pagegraph/agent", defaultModel: "test/model" }, context: { files: ["context.md"] } } };
  const options = { pages: [], queries: ["api"], kinds: [], competitors: [], domains: [], limit: 10, refresh: false, dryRun: false, allowDirty: false };
  const input = { root, graph, site, config, workflow, options };
  const researchResult: RunnerResult = { state: workflow === "research.keywords" ? { summary: "Research", opportunities: [] } : { summary: "Metadata", items: [] }, messages, usage, executor: evidence };
  const research = vi.fn<WorkflowRunner["research"]>(async () => researchResult);
  const act = vi.fn<WorkflowRunner["act"]>(async (): Promise<RunnerResult> => ({ ...researchResult, state: { summary: "Applied", edits: [], reviewItems: [] } }));
  const runner: WorkflowRunner = { model: { provider: "test", id: "model" }, research, act, close: async () => {} };
  const acquireRunner = vi.fn(async () => runner);
  const directory = () => join(root, ".pagegraph/runs", readdirSync(join(root, ".pagegraph/runs"))[0]!);
  return { input, runner, acquireRunner, research, act, researchResult, directory };
};
const failedDecision = async (f: ReturnType<typeof fixture>) => {
  await expect(runWorkflow(f.input, { acquireRunner: f.acquireRunner, decide: async () => { throw new Error("decision failed"); } })).rejects.toThrow("decision failed");
  return f.directory();
};
const patchProgress = (directory: string, patch: Record<string, unknown>) => {
  const path = join(directory, "progress.json");
  writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, "utf8")), ...patch }));
};
afterEach(() => { vi.unstubAllEnvs(); for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }); });

describe("workflow resume", () => {
  it("resumes accepted research by run ID, retaining targets/evidence/session without another research turn", async () => {
    const f = fixture();
    const directory = await failedDecision(f);
    const acquire = vi.fn(async () => { throw new Error("Unexpected paid model acquisition"); });
    const decide = vi.fn(async () => decisionReport);
    const result = await runWorkflow({ ...f.input, from: directory.split("/").at(-1), options: { ...f.input.options, queries: ["new target"] } }, { acquireRunner: acquire, decide });
    expect(result.directory).toBe(directory);
    expect(result.run.options.queries).toEqual(["api"]);
    expect(result.run.evidence.sources[0]?.content).toBe("Original source\n");
    expect(result.run.evidence.executor).toEqual(evidence);
    expect(result.run.agent.messages).toEqual(messages);
    expect(f.research).toHaveBeenCalledTimes(1);
    expect(acquire).not.toHaveBeenCalled();
    expect(decide).toHaveBeenCalledTimes(1);
  });

  it("returns a completed run with zero model, decision, or Executor acquisition", async () => {
    const f = fixture();
    const first = await runWorkflow(f.input, { acquireRunner: f.acquireRunner, decide: async () => decisionReport });
    const acquire = vi.fn(async () => { throw new Error("must not acquire"); });
    const decide = vi.fn(async () => { throw new Error("must not decide"); });
    vi.stubEnv("TYPESAFE_API_KEY", "");
    const resumed = await runWorkflow({ ...f.input, from: first.directory }, { acquireRunner: acquire, decide });
    expect(resumed).toEqual(first);
    expect(acquire).not.toHaveBeenCalled(); expect(decide).not.toHaveBeenCalled();
  });

  it("accepts --from on the actual CLI and emits the fixture completed run without credentials", async () => {
    const f = fixture();
    const first = await runWorkflow(f.input, { acquireRunner: f.acquireRunner, decide: async () => decisionReport });
    writeFileSync(join(f.input.root, "pagegraph.config.ts"), `export default {
      loadGraph: async () => ({ graph: { nodes: new Map(), edges: [] }, site: { origin: "https://example.com", indexable: true, robots: { disallow: [] } }, dispose: async () => {} }),
      workflows: { agent: { presetDirectory: ".pagegraph/agent", defaultModel: "missing/model" } }
    };`);
    const cli = new URL("../src/cli/bin.ts", import.meta.url).pathname;
    const command = spawnSync("bun", [cli, "research", "keywords", "--from", first.run.id, "--json"], {
      cwd: f.input.root, encoding: "utf8", timeout: 10_000, env: { ...process.env, TYPESAFE_API_KEY: "", NO_COLOR: "1" },
    });
    expect(command.status, command.stderr).toBe(0);
    expect(JSON.parse(command.stdout)).toEqual(first.run);
  });

  it("restores failed research messages and completed Executor outcomes before continuing", async () => {
    const f = fixture();
    f.research.mockRejectedValueOnce(new WorkflowRunnerError("interrupted research", f.researchResult));
    await expect(runWorkflow(f.input, { acquireRunner: f.acquireRunner, decide: async () => decisionReport })).rejects.toThrow("interrupted research");
    const acquire = vi.fn(async (options) => {
      expect(options.resume).toEqual({ phase: "research", agent: { runtime: "pi", model: f.runner.model, messages, usage }, executor: evidence });
      return f.runner;
    });
    const result = await runWorkflow({ ...f.input, from: f.directory() }, { acquireRunner: acquire, decide: async () => decisionReport });
    expect(f.research.mock.calls[1]?.[1]).toContain("Reuse completed Executor calls");
    expect(result.run.evidence.executor).toEqual(evidence);
  });

  it("skips recorded decisions and resumes only the remaining action in its restored conversation", async () => {
    const f = fixture("improve.metadata");
    const directory = await failedDecision(f);
    patchProgress(directory, { decisions: { ...decisionReport, family: "meta" } });
    const decide = vi.fn(async () => { throw new Error("decision was already completed"); });
    const acquire = vi.fn(async (options) => {
      expect(options.resume?.phase).toBe("action");
      expect(options.resume?.agent.messages).toEqual(messages);
      return f.runner;
    });
    const result = await runWorkflow({ ...f.input, from: directory }, { acquireRunner: acquire, decide });
    expect(result.run.decisions[0]?.report.family).toBe("meta");
    expect(f.research).toHaveBeenCalledTimes(1); expect(f.act).toHaveBeenCalledTimes(1); expect(decide).not.toHaveBeenCalled();
  });

  it("finishes artifacts from a completed action without replaying its edits or any paid turn", async () => {
    const f = fixture("improve.metadata");
    f.act.mockImplementationOnce(async () => ({ ...f.researchResult, state: { summary: "Applied", reviewItems: [],
      edits: [{ path: "context.md", oldText: "Original source", newText: "Applied metadata edit", reason: "r", evidence: [] }] } }));
    const first = await runWorkflow(f.input, { acquireRunner: f.acquireRunner, decide: async () => decisionReport });
    rmSync(join(first.directory, "run.json"));
    const acquire = vi.fn(async () => { throw new Error("must not acquire"); });
    const decide = vi.fn(async () => { throw new Error("must not decide"); });
    const result = await runWorkflow({ ...f.input, from: first.directory, options: { ...f.input.options, dryRun: true } }, { acquireRunner: acquire, decide });
    expect(result.run.result).toEqual(first.run.result);
    expect(result.run.options.dryRun).toBe(false);
    expect(result.run.changes.files).toEqual(["context.md"]);
    expect(readFileSync(join(f.input.root, "context.md"), "utf8")).toBe("Applied metadata edit\n");
    expect(f.act).toHaveBeenCalledTimes(1); expect(acquire).not.toHaveBeenCalled(); expect(decide).not.toHaveBeenCalled();
  });

  it("allows --dry-run to suppress remaining writes without escalating a recorded dry run", async () => {
    const f = fixture("improve.metadata"); const directory = await failedDecision(f);
    patchProgress(directory, { decisions: { ...decisionReport, family: "meta" } });
    f.act.mockImplementationOnce(async (_spec, prompt) => {
      expect(prompt).toContain("Repository mutation mode: dry-run");
      return { ...f.researchResult, state: { summary: "Preview", reviewItems: [],
        edits: [{ path: "context.md", oldText: "Original source", newText: "Previewed edit", reason: "r", evidence: [] }] } };
    });
    const result = await runWorkflow({ ...f.input, from: directory, options: { ...f.input.options, dryRun: true } }, { acquireRunner: f.acquireRunner, decide: async () => decisionReport });
    expect(result.run.options.dryRun).toBe(true);
    expect(result.run.result).toMatchObject({ outcome: "dry-run" });
    expect(result.run.changes.files).toEqual([]);
    expect(readFileSync(join(f.input.root, "context.md"), "utf8")).toBe("Original source\n");
    expect(JSON.parse(readFileSync(join(directory, "edits.json"), "utf8"))).toMatchObject({ mode: "dry-run", edits: [{ id: "e1", path: "context.md" }] });
  });

  it("refuses interrupted actions, even if they left no visible file edit", async () => {
    const f = fixture("improve.metadata");
    f.act.mockRejectedValueOnce(new Error("action interrupted"));
    await expect(runWorkflow(f.input, { acquireRunner: f.acquireRunner, decide: async () => decisionReport })).rejects.toThrow("action interrupted");
    await expect(runWorkflow({ ...f.input, from: f.directory() }, { acquireRunner: f.acquireRunner, decide: async () => decisionReport })).rejects.toThrow("action started but did not record completion");
    expect(f.act).toHaveBeenCalledTimes(1);
  });

  it("refuses source drift and a mismatched workflow before acquiring anything", async () => {
    const f = fixture(); const directory = await failedDecision(f);
    await expect(runWorkflow({ ...f.input, workflow: "analyze.content", from: directory })).rejects.toThrow("workflow or run ID differs");
    writeFileSync(join(f.input.root, "context.md"), "Changed source\n");
    await expect(runWorkflow({ ...f.input, from: directory })).rejects.toThrow("repository HEAD or file contents changed");
    expect(f.acquireRunner).toHaveBeenCalledTimes(1);
  });

  it("refuses changed context in a non-Git project before another paid call", async () => {
    const f = fixture("research.keywords", false); const directory = await failedDecision(f);
    writeFileSync(join(f.input.root, "context.md"), "Changed untracked source\n");
    const decide = vi.fn(async () => decisionReport);
    await expect(runWorkflow({ ...f.input, from: directory }, { acquireRunner: f.acquireRunner, decide })).rejects.toThrow("recorded context source changed");
    expect(f.acquireRunner).toHaveBeenCalledTimes(1); expect(decide).not.toHaveBeenCalled();
  });

  it("refuses changed ignored context even when Git reports the same clean source state", async () => {
    const f = fixture();
    writeFileSync(join(f.input.root, ".gitignore"), "context.md\n.pagegraph/\n");
    const git = (...args: string[]) => execFileSync("git", args, { cwd: f.input.root, stdio: "ignore" });
    git("rm", "--cached", "context.md"); git("add", ".gitignore");
    git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "Ignore context source");
    const directory = await failedDecision(f);
    writeFileSync(join(f.input.root, "context.md"), "Changed ignored source\n");
    await expect(runWorkflow({ ...f.input, from: directory })).rejects.toThrow("recorded context source changed");
    expect(f.acquireRunner).toHaveBeenCalledTimes(1);
  });

  it("checks the recorded external repository root rather than the current context configuration", async () => {
    const f = fixture();
    const repositoryRoot = mkdtempSync(join(tmpdir(), "pagegraph-shared-context-")); directories.push(repositoryRoot);
    writeFileSync(join(repositoryRoot, "shared.md"), "Shared outside-Git evidence\n");
    f.input.config = { ...f.input.config, workflows: { ...f.input.config.workflows!, repositoryRoot, context: { files: ["shared.md"] } } };
    const directory = await failedDecision(f);
    f.input.config = { ...f.input.config, workflows: { ...f.input.config.workflows!, repositoryRoot: f.input.root, context: { files: ["missing-current-context.md"] } } };
    writeFileSync(join(repositoryRoot, "shared.md"), "Changed shared evidence\n");
    await expect(runWorkflow({ ...f.input, from: directory })).rejects.toThrow("recorded context source changed");
    expect(f.acquireRunner).toHaveBeenCalledTimes(1);
  });

  it("restores the recorded read root after config changes when its context remains unchanged", async () => {
    const f = fixture("research.keywords", false);
    const directory = await failedDecision(f);
    f.input.config = { ...f.input.config, workflows: { ...f.input.config.workflows!, repositoryRoot: "missing-read-root", context: { files: ["missing-current-context.md"] } } };
    const result = await runWorkflow({ ...f.input, from: directory }, { decide: async () => decisionReport });
    expect(result.run.evidence.sources).toEqual([{ path: "context.md", content: "Original source\n" }]);
  });

  it("refuses a saved context path replaced by a symlink outside its recorded read root", async () => {
    const f = fixture("research.keywords", false); const directory = await failedDecision(f);
    const outside = mkdtempSync(join(tmpdir(), "pagegraph-context-escape-")); directories.push(outside);
    writeFileSync(join(outside, "context.md"), "Original source\n");
    rmSync(join(f.input.root, "context.md")); symlinkSync(join(outside, "context.md"), join(f.input.root, "context.md"));
    await expect(runWorkflow({ ...f.input, from: directory })).rejects.toThrow("outside its original read bounds");
    expect(f.acquireRunner).toHaveBeenCalledTimes(1);
  });

  it("refuses ignored context drift after a completed action while allowing that action's recorded edits", async () => {
    const f = fixture("improve.metadata", false);
    f.act.mockImplementationOnce(async () => ({ ...f.researchResult, state: { summary: "Applied", reviewItems: [],
      edits: [{ path: "context.md", oldText: "Original source", newText: "Recorded action edit", reason: "r", evidence: [] }] } }));
    const first = await runWorkflow(f.input, { acquireRunner: f.acquireRunner, decide: async () => decisionReport });
    rmSync(join(first.directory, "run.json"));
    const result = await runWorkflow({ ...f.input, from: first.directory }, { decide: async () => { throw new Error("must not decide"); } });
    expect(result.run.result).toEqual(first.run.result); expect(f.act).toHaveBeenCalledTimes(1);
    rmSync(join(first.directory, "run.json")); writeFileSync(join(f.input.root, "context.md"), "Changed after action completion\n");
    await expect(runWorkflow({ ...f.input, from: first.directory })).rejects.toThrow("recorded context source changed");
  });

  it.each([{ actionStarted: "false" }, { research: { agent: { runtime: "other" } } }, { git: { fingerprints: {} } }])("rejects malformed nested artifacts: %j", async (patch) => {
    const f = fixture(); const directory = await failedDecision(f); patchProgress(directory, patch);
    await expect(runWorkflow({ ...f.input, from: directory })).rejects.toThrow("invalid or unsupported schema-version-2 artifact");
  });

  it("refuses missing decision credentials before acquiring a runner or making a model call", async () => {
    const f = fixture(); vi.stubEnv("TYPESAFE_API_KEY", "");
    await expect(runWorkflow(f.input, { acquireRunner: f.acquireRunner })).rejects.toThrow("set TYPESAFE_API_KEY before starting");
    expect(f.acquireRunner).not.toHaveBeenCalled(); expect(f.research).not.toHaveBeenCalled();
  });
});
