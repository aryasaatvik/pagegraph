import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Agent, type AgentTool } from "@earendil-works/pi-agent-core";
import { fauxAssistantMessage, fauxToolCall, registerFauxProvider, type FauxProviderRegistration, type JsonObject } from "@earendil-works/pi-ai/compat";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getWorkflowSpec } from "../src/workflows/catalog";
import { executorEvidence } from "../src/workflows/executor";
import { acquireWorkflowRunner, createPiRunner, totalUsage, WorkflowRunnerError, type WorkflowRunnerResume } from "../src/workflows/pi";
import type { WorkflowRunner } from "../src/workflows/runner";
import type { AnyWorkflowSpec } from "../src/workflows/specs/types";
import { completedExecutorTrace, fakeExecutorToolset } from "./workflows/fixtures/executor";

const providers: FauxProviderRegistration[] = [];
const directories: string[] = [];
const runners: WorkflowRunner[] = [];
afterEach(async () => {
  for (const runner of runners.splice(0)) await runner.close();
  for (const provider of providers.splice(0)) provider.unregister();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
const submit = (value: JsonObject) => fauxAssistantMessage(fauxToolCall("submit_result", value), { stopReason: "toolUse" });
const keyword = { query: "email api", intent: "commercial", rationale: "Product fit", candidates: [], evidence: ["seo.search"] };
const fixture = (spec: AnyWorkflowSpec, options: { evidence?: boolean; resume?: WorkflowRunnerResume } = {}) => {
  const root = mkdtempSync(join(tmpdir(), "pagegraph-reliability-pi-"));
  directories.push(root);
  const presetDirectory = join(root, "preset");
  for (const file of ["agents/seo.md", "AGENTS.md", ...spec.skills.flatMap((skill) => [`skills/${skill}/SKILL.md`, `skills/${skill}/references/executor.md`])]) {
    const path = join(presetDirectory, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `Project instructions: ${file}`);
  }
  const provider = registerFauxProvider({ api: `reliability-${providers.length}-${Date.now()}` });
  providers.push(provider);
  const executor = fakeExecutorToolset(options.evidence === false ? [] : completedExecutorTrace());
  const spies = executor.tools.map((tool: AgentTool) => vi.spyOn(tool, "execute"));
  const runner = createPiRunner({ root, presetDirectory, model: provider.getModel(), limit: 5, executor, runDirectory: join(root, ".pagegraph/runs/current"),
    ...(options.resume === undefined ? {} : { resume: options.resume }) });
  runners.push(runner);
  return { root, provider, runner, executor, spies };
};

describe("workflow recommendation salvage", () => {
  it("salvages schema-valid items after three schema rejections before tool execute", async () => {
    const spec = getWorkflowSpec("research.keywords");
    const { provider, runner } = fixture(spec);
    const mixed = { summary: "Research complete", opportunities: [keyword, { query: 42 }] };
    provider.setResponses([submit(mixed), submit(mixed), submit(mixed), submit({ summary: "Unexpected extra turn", opportunities: [] })]);
    const result = await runner.research(spec, "Research", { signal: AbortSignal.timeout(2000) });
    expect(result.state).toEqual({ summary: mixed.summary, opportunities: [keyword] });
    expect(result.rejectedItems).toEqual([{ index: 1, reason: expect.stringContaining("query") }]);
    expect(result.messages.filter((message) => message.role === "toolResult" && message.isError)).toHaveLength(3);
    expect(provider.state.callCount).toBe(3);
    expect(provider.getPendingResponseCount()).toBe(1);
  });

  it("salvages semantically valid items and reports failed decision-input validation", async () => {
    const spec = getWorkflowSpec("improve.metadata");
    const { provider, runner } = fixture(spec);
    const valid = { url: "/pricing", intent: "commercial", categoryLock: "email", candidates: [
      { id: "one", title: "Email API", description: "Send email" },
      { id: "two", title: "Email delivery", description: "Reliable delivery" },
    ] };
    const invalid = { ...valid, url: "/docs", candidates: [valid.candidates[0]] };
    const mixed = { summary: "Improve metadata", items: [invalid, valid] };
    provider.setResponses([submit(mixed), submit(mixed), submit(mixed)]);
    const result = await runner.research(spec, "Research", { signal: AbortSignal.timeout(2000) });
    expect(result.state).toEqual({ summary: mixed.summary, items: [valid] });
    expect(result.rejectedItems).toEqual([{ index: 0, reason: expect.stringContaining("at least two candidates") }]);
    expect(provider.state.callCount).toBe(3);
  });

  it("reports submitted indexes even when null placeholders were normalized away", async () => {
    const spec = getWorkflowSpec("research.keywords");
    const { provider, runner } = fixture(spec);
    const mixed = { summary: "Research complete", opportunities: [null, keyword, { query: 42 }] };
    provider.setResponses([submit(mixed), submit(mixed), submit(mixed)]);
    const result = await runner.research(spec, "Research", { signal: AbortSignal.timeout(2000) });
    expect(result.state).toEqual({ summary: mixed.summary, opportunities: [keyword] });
    expect(result.rejectedItems).toEqual([{ index: 2, reason: expect.stringContaining("query") }]);
  });

  it("retains the evidence prerequisite even when some recommendations could survive", async () => {
    const spec = getWorkflowSpec("research.keywords");
    const { provider, runner } = fixture(spec, { evidence: false });
    const mixed = { summary: "Research complete", opportunities: [keyword, { query: 42 }] };
    provider.setResponses([submit(mixed), submit(mixed), submit(mixed)]);
    await expect(runner.research(spec, "Research", { signal: AbortSignal.timeout(2000) })).rejects.toThrow("Workflow result rejected");
    expect(provider.state.callCount).toBe(3);
  });

  it("keeps envelope errors fatal instead of inventing a summary", async () => {
    const spec = getWorkflowSpec("research.keywords");
    const { provider, runner } = fixture(spec);
    const invalid = { summary: 42, opportunities: [keyword] };
    provider.setResponses([submit(invalid), submit(invalid), submit(invalid)]);
    await expect(runner.research(spec, "Research", { signal: AbortSignal.timeout(2000) })).rejects.toThrow("summary");
  });
});

describe("workflow configuration preflight", () => {
  const model = builtinModels().getModels("openai")[0]!;
  const acquire = () => acquireWorkflowRunner({ root: "/project", config: { presetDirectory: "preset", defaultModel: `openai/${model.id}` }, limit: 5 });
  it.each([undefined, "   "])("refuses missing provider credentials (%s) before any network request", async (key) => {
    vi.stubEnv("OPENAI_API_KEY", key);
    const network = vi.spyOn(globalThis, "fetch");
    await expect(acquire()).rejects.toThrow("set OPENAI_API_KEY");
    expect(network).not.toHaveBeenCalled();
  });
  it.each([undefined, "   ", "file:///tmp/executor"])("refuses missing or invalid Executor configuration (%s) before any network request", async (baseUrl) => {
    vi.stubEnv("OPENAI_API_KEY", "offline-test-key");
    vi.stubEnv("EXECUTOR_BASE_URL", baseUrl);
    const network = vi.spyOn(globalThis, "fetch");
    await expect(acquire()).rejects.toThrow(/Executor configuration/);
    expect(network).not.toHaveBeenCalled();
  });
  it("refuses unpaired Executor Access credentials before any network request", async () => {
    vi.stubEnv("OPENAI_API_KEY", "offline-test-key");
    vi.stubEnv("EXECUTOR_BASE_URL", "https://executor.example.test");
    vi.stubEnv("EXECUTOR_CLIENT_ID", "offline-client");
    vi.stubEnv("EXECUTOR_CLIENT_SECRET", undefined);
    vi.stubEnv("EXECUTOR_CLIENT_SECRET_FILE", undefined);
    const network = vi.spyOn(globalThis, "fetch");
    await expect(acquire()).rejects.toThrow(/Set both an Executor client id/);
    expect(network).not.toHaveBeenCalled();
  });
});

describe("restored Pi conversation", () => {
  it.each(["executor_execute", "executor_search"])("reuses the most recent recorded result for duplicate %s signatures", async (toolName) => {
    const spec = getWorkflowSpec("research.keywords");
    const recorded = executorEvidence(completedExecutorTrace());
    const resume: WorkflowRunnerResume = { phase: "research", executor: {
      searches: [{ ...recorded.searches[0]!, output: { version: "A" } }, { ...recorded.searches[0]!, output: { version: "B" } }],
      calls: [{ ...recorded.calls[0]!, output: { version: "A" } }, { ...recorded.calls[0]!, output: { version: "B" } }],
    }, agent: { runtime: "pi", model: { provider: "faux", id: "faux" }, messages: [], usage: totalUsage([]) } };
    const { provider, runner, executor, spies } = fixture(spec, { evidence: false, resume });
    provider.setResponses([
      fauxAssistantMessage(fauxToolCall(toolName, toolName === "executor_execute" ? { code: "await tools.seo.search()" } : { query: "SEO" }), { stopReason: "toolUse" }),
      submit({ summary: "Research complete", opportunities: [keyword] }),
    ]);
    const result = await runner.research(spec, "Finish", { signal: AbortSignal.timeout(2000) });
    const replay = result.messages.find((message) => message.role === "toolResult" && message.toolName === toolName);
    if (replay?.role !== "toolResult") throw new Error("Missing replay result");
    expect(replay.details).toEqual({ version: "B" });
    expect(executor.trace).toEqual([]);
    expect(spies.every((spy) => spy.mock.calls.length === 0)).toBe(true);
  });

  it("retains recorded messages and evidence if the agent prompt rejects unexpectedly", async () => {
    const spec = getWorkflowSpec("research.keywords");
    const prior = fauxAssistantMessage("Completed provider research.");
    const resume: WorkflowRunnerResume = { phase: "research", executor: executorEvidence(completedExecutorTrace()), agent: {
      runtime: "pi", model: { provider: "faux", id: "faux" }, messages: [prior], usage: totalUsage([prior]),
    } };
    const { runner } = fixture(spec, { evidence: false, resume });
    const cause = new Error("Agent prompt failure");
    vi.spyOn(Agent.prototype, "prompt").mockRejectedValueOnce(cause);
    const failure = await runner.research(spec, "Finish", { signal: AbortSignal.timeout(2000) }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(WorkflowRunnerError);
    if (!(failure instanceof WorkflowRunnerError)) throw new Error("Expected runner failure");
    expect(failure.cause).toBe(cause);
    expect(failure.result.executor).toEqual(resume.executor);
    expect(failure.result.messages).toContainEqual(prior);
  });

  it("keeps replay previews bounded and retains the full recorded output artifact", async () => {
    const spec = getWorkflowSpec("research.keywords");
    const output = { rows: [{ detail: "large result ".repeat(10_000) }] };
    const recorded = executorEvidence(completedExecutorTrace());
    const resume: WorkflowRunnerResume = { phase: "research", executor: {
      searches: recorded.searches, calls: [{ ...recorded.calls[0]!, output }],
    }, agent: { runtime: "pi", model: { provider: "faux", id: "faux" }, messages: [], usage: totalUsage([]) } };
    const { root, provider, runner, spies } = fixture(spec, { evidence: false, resume });
    provider.setResponses([
      fauxAssistantMessage(fauxToolCall("executor_execute", { code: "await tools.seo.search()" }), { stopReason: "toolUse" }),
      submit({ summary: "Research complete", opportunities: [keyword] }),
    ]);
    const result = await runner.research(spec, "Finish", { signal: AbortSignal.timeout(2000) });
    const replay = result.messages.find((message) => message.role === "toolResult" && message.toolName === "executor_execute");
    expect(JSON.stringify(replay?.content)).toContain("[truncated");
    expect(JSON.stringify(replay?.content)).toContain("Use read_file");
    expect(JSON.stringify(replay?.content).length).toBeLessThan(31_000);
    expect(JSON.parse(readFileSync(join(root, ".pagegraph/runs/current/tool-results/1.json"), "utf8"))).toEqual(output);
    expect(spies.every((spy) => spy.mock.calls.length === 0)).toBe(true);
  });

  it("reuses evidence, conversation, and completed provider calls in partial research", async () => {
    const spec = getWorkflowSpec("research.keywords");
    const prior = fauxAssistantMessage("I collected the completed keyword response.");
    const resume: WorkflowRunnerResume = { phase: "research", executor: executorEvidence(completedExecutorTrace()), agent: {
      runtime: "pi", model: { provider: "faux", id: "faux" }, messages: [prior], usage: totalUsage([prior]),
    } };
    const { provider, runner, executor, spies } = fixture(spec, { evidence: false, resume });
    provider.setResponses([
      (context) => {
        expect(JSON.stringify(context)).toContain("I collected the completed keyword response.");
        return fauxAssistantMessage(fauxToolCall("executor_execute", { code: "await tools.seo.search()" }), { stopReason: "toolUse" });
      },
      submit({ summary: "Research complete", opportunities: [keyword] }),
    ]);
    const result = await runner.research(spec, "Finish research", { signal: AbortSignal.timeout(2000) });
    expect(result.executor).toEqual(resume.executor);
    expect(result.messages).toContainEqual(prior);
    expect(executor.trace).toEqual([]);
    expect(spies.every((spy) => spy.mock.calls.length === 0)).toBe(true);
    expect(result.messages.some((message) => message.role === "toolResult" && JSON.stringify(message.content).includes("reused without a provider call"))).toBe(true);
  });

  it("continues action directly from an accepted research checkpoint", async () => {
    const spec = getWorkflowSpec("improve.metadata");
    const prior = fauxAssistantMessage("Accepted research checkpoint.");
    const resume: WorkflowRunnerResume = { phase: "action", executor: executorEvidence(completedExecutorTrace()), agent: {
      runtime: "pi", model: { provider: "faux", id: "faux" }, messages: [prior], usage: totalUsage([prior]),
    } };
    const { provider, runner } = fixture(spec, { evidence: false, resume });
    provider.setResponses([submit({ summary: "No change needed", files: [], outcome: "no-change" })]);
    const result = await runner.act(spec, "Finish action", { mode: "dry-run", signal: AbortSignal.timeout(2000) });
    expect(result.state).toEqual({ summary: "No change needed", files: [], outcome: "no-change" });
    expect(result.messages).toContainEqual(prior);
    expect(result.executor).toEqual(resume.executor);
    expect(provider.state.callCount).toBe(1);
  });
});
