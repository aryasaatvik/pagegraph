import { mkdirSync, readFileSync, symlinkSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { fauxAssistantMessage, fauxToolCall, registerFauxProvider, type FauxProviderRegistration, type JsonObject } from "@earendil-works/pi-ai/compat";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getWorkflowSpec } from "../../src/workflows/catalog";
import { acquireWorkflowRunner, composeSystemPrompt, createPiRunner, totalUsage, WorkflowRunnerError } from "../../src/workflows/pi";
import type { WorkflowRunner } from "../../src/workflows/runner";
import type { AnyWorkflowSpec } from "../../src/workflows/specs/types";
import { completedExecutorTrace, fakeExecutorToolset } from "./fixtures/executor";

const spec = getWorkflowSpec("research.keywords");
const validState = { summary: "Evidence supports the query.", opportunities: [{
  query: "email api", intent: "commercial", rationale: "Fits the product", demand: 10,
  candidates: [{ path: "/pricing", title: "Email API", excerpt: "An email API" }], evidence: ["seo.search"],
}] };
const submit = (state: JsonObject) => fauxAssistantMessage(fauxToolCall("submit_result", state), { stopReason: "toolUse" });
const directories: string[] = [];
const providers: FauxProviderRegistration[] = [];
const runners: WorkflowRunner[] = [];

afterEach(async () => {
  for (const runner of runners.splice(0)) await runner.close();
  for (const provider of providers.splice(0)) provider.unregister();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

const fixture = (withEvidence = true, tokensPerSecond?: number, workflowSpec: AnyWorkflowSpec = spec) => {
  const root = mkdtempSync(join(tmpdir(), "pagegraph-pi-"));
  directories.push(root);
  const presetDirectory = join(root, "preset");
  const files = ["agents/seo.md", "AGENTS.md", ...workflowSpec.skills.flatMap((skill) => [
    `skills/${skill}/SKILL.md`, `skills/${skill}/references/executor.md`,
  ])];
  for (const file of files) {
    const path = join(presetDirectory, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `Project instructions: ${file}`);
  }
  const provider = registerFauxProvider({ api: `pagegraph-test-${providers.length}-${Date.now()}`, tokensPerSecond });
  providers.push(provider);
  const executor = fakeExecutorToolset(withEvidence ? completedExecutorTrace() : []);
  const runner = createPiRunner({ root, presetDirectory, model: provider.getModel(), limit: 1, executor });
  runners.push(runner);
  return { root, presetDirectory, provider, executor, runner, files };
};
const research = (runner: WorkflowRunner, signal = AbortSignal.timeout(2000)) => runner.research(spec, "Research email APIs.", { signal });

describe("Pi workflow runner", () => {
  it("accepts a valid first submission and retains message usage and total cost", async () => {
    const { runner, provider } = fixture();
    provider.setResponses([submit(validState)]);
    const result = await research(runner);
    expect(result.state).toEqual(validState);
    expect(provider.state.callCount).toBe(1);
    expect(result.executor.calls).toHaveLength(1);
    expect(result.messages.some((message) => message.role === "toolResult")).toBe(true);
    expect(result.usage.totalTokens).toBeGreaterThan(0);
    expect(result.usage).toEqual(totalUsage(result.messages));
  });

  it("continues research context with write tools and submits the action schema", async () => {
    const { runner, provider, root } = fixture();
    writeFileSync(join(root, "page.txt"), "Original page");
    provider.setResponses([submit({}), submit(validState)]);
    const researched = await research(runner);
    provider.setResponses([
      (context) => {
        expect(JSON.stringify(context)).toContain("Evidence supports the query.");
        expect(JSON.stringify(context)).toContain("edit_file");
        return fauxAssistantMessage(fauxToolCall("edit_file", { path: "page.txt", oldText: "Original", newText: "Improved" }), { stopReason: "toolUse" });
      },
      submit({}),
      submit({ summary: "Improved page", files: ["page.txt"], outcome: "applied" }),
    ]);
    const acted = await runner.act(spec, "Apply the resolved changes.", { mode: "write", signal: AbortSignal.timeout(2000) });
    expect(readFileSync(join(root, "page.txt"), "utf8")).toBe("Improved page");
    expect(acted.state).toEqual({ summary: "Improved page", files: ["page.txt"], outcome: "applied" });
    expect(acted.messages.slice(0, researched.messages.length)).toEqual(researched.messages);
    expect(acted.messages.filter((message) => message.role === "toolResult" && message.isError)).toHaveLength(2);
  });

  it("blocks unsafe action writes before tool execution", async () => {
    const { runner, provider, root } = fixture();
    const outside = join(root, "..", `${root.split("/").at(-1)}-outside.txt`);
    directories.push(outside);
    writeFileSync(outside, "Outside evidence");
    symlinkSync(outside, join(root, "escape.txt"));
    provider.setResponses([submit(validState)]);
    await research(runner);
    const blockedPaths = [".git/config", "node_modules/pkg/file", outside, "escape.txt", "preset/AGENTS.md", ".pagegraph/runs/result.json"];
    provider.setResponses([
      ...blockedPaths.map((path) => fauxAssistantMessage(fauxToolCall("write_file", { path, content: "unsafe" }), { stopReason: "toolUse" })),
      submit({ summary: "No safe change", files: [], outcome: "no-change" }),
    ]);
    const result = await runner.act(spec, "Apply changes", { mode: "write", signal: AbortSignal.timeout(2000) });
    expect(result.messages.filter((message) => message.role === "toolResult" && message.toolName === "write_file" && message.isError))
      .toHaveLength(blockedPaths.length);
    expect(readFileSync(outside, "utf8")).toBe("Outside evidence");
  });

  it("offers only read and Executor tools in dry-run action mode", async () => {
    const { runner, provider } = fixture();
    provider.setResponses([submit(validState)]);
    await research(runner);
    provider.setResponses([(context) => {
      expect(JSON.stringify(context)).not.toContain("edit_file");
      expect(JSON.stringify(context)).not.toContain("write_file");
      expect(JSON.stringify(context)).toContain("read_file");
      expect(JSON.stringify(context)).toContain("executor_execute");
      return submit({ summary: "Would improve the page", files: ["page.txt"], outcome: "dry-run" });
    }]);
    expect((await runner.act(spec, "Describe changes", { mode: "dry-run", signal: AbortSignal.timeout(2000) })).state)
      .toEqual({ summary: "Would improve the page", files: ["page.txt"], outcome: "dry-run" });
  });

  it("returns invalid submission issues in-loop and accepts the correction", async () => {
    const { runner, provider } = fixture();
    provider.setResponses([submit({ opportunities: [] }), submit(validState)]);
    const result = await research(runner);
    expect(result.state).toEqual(validState);
    expect(provider.state.callCount).toBe(2);
    const rejection = result.messages.find((message) => message.role === "toolResult" && message.isError);
    expect(rejection?.content).toEqual(expect.arrayContaining([expect.objectContaining({ type: "text", text: expect.stringContaining("summary") })]));
  });

  it("decodes raw submissions so a numeric summary is rejected before correction", async () => {
    const { runner, provider } = fixture();
    provider.setResponses([submit({ summary: 42, opportunities: [] }), submit(validState)]);
    const result = await research(runner);
    expect(result.state).toEqual(validState);
    expect(provider.state.callCount).toBe(2);
    expect(result.messages.filter((message) => message.role === "toolResult" && message.isError)).toHaveLength(1);
  });

  it("drops nulls and caps opportunities before validating tool arguments", async () => {
    const { runner, provider } = fixture();
    const opportunity = { ...validState.opportunities[0], demand: null, evidence: [null, "seo.search"] };
    provider.setResponses([submit({ summary: validState.summary, opportunities: [null, opportunity, { invalid: "beyond limit" }] })]);
    const result = await research(runner);
    const { demand: _demand, ...expected } = validState.opportunities[0];
    expect(result.state).toEqual({ summary: validState.summary, opportunities: [expected] });
    expect(provider.state.callCount).toBe(1);
    expect(result.messages.filter((message) => message.role === "toolResult" && message.isError)).toHaveLength(0);
  });

  it("bounds semantically invalid metadata submissions and retains decision input issues", async () => {
    const metadata = getWorkflowSpec("improve.metadata");
    const { runner, provider } = fixture(true, undefined, metadata);
    const invalid = { summary: "Update metadata", items: [{
      url: "/pricing", intent: "commercial", categoryLock: "email",
      candidates: [{ id: "one", title: "Email API", description: "Send email" }],
    }] };
    provider.setResponses([submit(invalid), submit(invalid), submit(invalid), submit({ summary: "Empty", items: [] })]);
    const error = await runner.research(metadata, "Inspect metadata", { signal: AbortSignal.timeout(2000) }).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(WorkflowRunnerError);
    expect((error as Error).message).toContain("decisionInputs[0]");
    expect((error as Error).message).toContain("at least two candidates");
    expect(provider.state.callCount).toBe(3);
    expect(provider.getPendingResponseCount()).toBe(1);
  });

  it("rejects missing Executor evidence then accepts after completed fake provider calls", async () => {
    const { runner, provider, executor } = fixture(false);
    provider.setResponses([
      submit(validState),
      fauxAssistantMessage(fauxToolCall("executor_search", { query: "SEO" }), { stopReason: "toolUse" }),
      fauxAssistantMessage(fauxToolCall("executor_execute", { code: "await tools.seo.search()" }), { stopReason: "toolUse" }),
      submit(validState),
    ]);
    const result = await research(runner);
    expect(result.state).toEqual(validState);
    expect(executor.trace.map((record) => record.kind)).toEqual(["search", "execute"]);
    expect(result.executor.searches).toHaveLength(1);
    expect(result.executor.calls).toHaveLength(1);
    const rejection = result.messages.find((message) => message.role === "toolResult" && message.isError);
    expect(rejection?.content).toEqual(expect.arrayContaining([expect.objectContaining({ text: expect.stringContaining("completed Executor provider evidence") })]));
  });

  it("stops at three rejected submissions and reports the last decode issues", async () => {
    const { runner, provider } = fixture();
    provider.setResponses([submit({}), submit({}), submit({ opportunities: [] }), submit(validState)]);
    const error = await research(runner).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(WorkflowRunnerError);
    expect((error as Error).message).toContain("summary");
    expect(provider.state.callCount).toBe(3);
    expect(provider.getPendingResponseCount()).toBe(1);
  });

  it("enforces the rejection bound within one assistant tool-call batch", async () => {
    const { runner, provider } = fixture();
    provider.setResponses([fauxAssistantMessage([
      fauxToolCall("submit_result", { summary: 42, opportunities: [] }),
      fauxToolCall("submit_result", { summary: 42, opportunities: [] }),
      fauxToolCall("submit_result", { summary: 42, opportunities: [] }),
      fauxToolCall("submit_result", validState),
    ], { stopReason: "toolUse" })]);
    await expect(research(runner)).rejects.toThrow("Workflow result rejected");
    expect(provider.state.callCount).toBe(1);
  });

  it("aborts an active run when its deadline expires", async () => {
    const { runner, provider } = fixture(true, 100);
    let started!: () => void;
    const ready = new Promise<void>((resolve) => { started = resolve; });
    provider.setResponses([() => { started(); return fauxAssistantMessage("Researching " + "evidence ".repeat(100)); }]);
    const controller = new AbortController();
    const pending = research(runner, controller.signal);
    await ready;
    const deadline = AbortSignal.timeout(40);
    deadline.addEventListener("abort", () => controller.abort(deadline.reason), { once: true });
    await expect(pending).rejects.toThrow("deadline exceeded or run aborted");
    expect(provider.state.callCount).toBe(1);
  });

  it("retains structured failure details when the deadline expires before agent construction", async () => {
    const { runner, provider } = fixture();
    const error = await research(runner, AbortSignal.abort(new DOMException("Timed out", "TimeoutError"))).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(WorkflowRunnerError);
    if (!(error instanceof WorkflowRunnerError)) throw new Error("Expected runner failure");
    expect(error.message).toContain("deadline exceeded or run aborted");
    expect(error.result.messages).toEqual([]);
    expect(error.result.usage.totalTokens).toBe(0);
    expect(provider.state.callCount).toBe(0);
  });

  it("composes project-owned preset instructions and reports the missing skill path", async () => {
    const { presetDirectory, files } = fixture();
    const prompt = await composeSystemPrompt(presetDirectory, spec);
    for (const file of files) expect(prompt).toContain(`Project instructions: ${file}`);
    const missing = join(presetDirectory, "skills/keyword-research/SKILL.md");
    rmSync(missing);
    await expect(composeSystemPrompt(presetDirectory, spec)).rejects.toThrow(missing);
  });

  it("sums assistant token usage and cost across messages", () => {
    const first = fauxAssistantMessage("First result");
    first.usage = {
      input: 10, output: 4, cacheRead: 2, cacheWrite: 3, totalTokens: 19,
      cost: { input: 0.1, output: 0.2, cacheRead: 0.3, cacheWrite: 0.4, total: 1 },
    };
    const second = fauxAssistantMessage("Second result");
    second.usage = {
      input: 20, output: 8, cacheRead: 4, cacheWrite: 6, totalTokens: 38,
      cost: { input: 0.2, output: 0.4, cacheRead: 0.6, cacheWrite: 0.8, total: 2 },
    };
    expect(totalUsage([{ role: "user", content: "Request", timestamp: 0 }, first, second])).toEqual({
      input: 30, output: 12, cacheRead: 6, cacheWrite: 9, totalTokens: 57,
      cost: { input: expect.closeTo(0.3), output: expect.closeTo(0.6), cacheRead: expect.closeTo(0.9), cacheWrite: expect.closeTo(1.2), total: 3 },
    });
  });
});

describe("Pi runner acquisition", () => {
  const acquire = (model: string) => acquireWorkflowRunner({ root: "/project", limit: 1,
    config: { presetDirectory: "preset", defaultModel: model },
  });

  it.each(["model", "/model", "openai/"])("rejects malformed provider/id model %s", async (model) => {
    await expect(acquire(model)).rejects.toThrow("Workflow model must use provider/id");
  });

  it("names the provider environment variable when credentials are missing", async () => {
    vi.stubEnv("OPENAI_API_KEY", undefined);
    const model = builtinModels().getModels("openai")[0];
    expect(model).toBeDefined();
    await expect(acquire(`openai/${model.id}`)).rejects.toThrow("set OPENAI_API_KEY");
  });

  it("fails clearly when the Executor server is not configured", async () => {
    vi.stubEnv("OPENAI_API_KEY", "pagegraph-test-key");
    vi.stubEnv("EXECUTOR_BASE_URL", undefined);
    const model = builtinModels().getModels("openai")[0];
    await expect(acquire(`openai/${model.id}`)).rejects.toThrow(/EXECUTOR_BASE_URL/);
  });
});
