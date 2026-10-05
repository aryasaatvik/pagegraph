import { Agent, type AgentMessage, type AgentOptions, type AgentTool } from "@earendil-works/pi-agent-core";
import { Type, type Model, type Usage } from "@earendil-works/pi-ai";
import { findEnvKeys, getEnvApiKey, streamSimple } from "@earendil-works/pi-ai/compat";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { SeoWorkflowAgentConfig } from "../config";
import { createExecutorToolset, executorEvidence, persistExecutorToolResults, type ExecutorToolset } from "./executor";
import type { ExecutorEvidence, WorkflowAgentArtifact } from "./model";
import { createRepositoryTools, guardRepositoryToolCall } from "./repository-tools";
import { actionStateJsonSchema, applyWorkflowEdits, decodeActionState, normalizeEditPaths } from "./review";
import type { RunnerResult, WorkflowRunner } from "./runner";
import type { AnyWorkflowSpec } from "./specs/types";
import { decodeResearchState, dropNulls, normalizeResearchState, salvageResearchState } from "./state";

const MAX_REJECTED_SUBMISSIONS = 3;

export const composeSystemPrompt = async (directory: string, spec: AnyWorkflowSpec): Promise<string> => {
  const paths = ["agents/seo.md", "AGENTS.md", ...spec.skills.flatMap((skill) => [
    `skills/${skill}/SKILL.md`, `skills/${skill}/references/executor.md`,
  ])];
  return (await Promise.all(paths.map(async (path) => {
    const file = resolve(directory, path);
    try { return await readFile(file, "utf8"); }
    catch (cause) { throw new Error(`Could not read workflow preset file: ${file}`, { cause }); }
  }))).join("\n\n") + "\n\nSubmit the final structured state with submit_result. Research tools are read-only.";
};

export const totalUsage = (messages: ReadonlyArray<AgentMessage>): Usage => {
  const total: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const key of ["input", "output", "cacheRead", "cacheWrite", "totalTokens"] as const) total[key] += message.usage[key];
    for (const key of ["input", "output", "cacheRead", "cacheWrite", "total"] as const) total.cost[key] += message.usage.cost[key];
  }
  return total;
};

export class WorkflowRunnerError extends Error {
  constructor(message: string, readonly result: Omit<RunnerResult, "state">, options?: ErrorOptions) {
    super(message, options);
  }
}

export interface PiRunnerOptions {
  readonly root: string;
  readonly repositoryRoot?: string;
  readonly presetDirectory: string;
  readonly model: Model<string>;
  readonly limit: number;
  readonly executor: ExecutorToolset;
  readonly streamFn?: AgentOptions["streamFn"];
  readonly runsDirectory?: string;
  readonly runDirectory?: string;
  readonly additionalTools?: ReadonlyArray<AgentTool>;
  readonly resume?: WorkflowRunnerResume;
}

export interface WorkflowRunnerResume {
  readonly agent: WorkflowAgentArtifact;
  readonly executor: ExecutorEvidence;
  readonly phase: "research" | "action";
}

export const createPiRunner = (options: PiRunnerOptions): WorkflowRunner => {
  let agent: Agent | undefined;
  let researched = options.resume?.phase === "action";
  let resume = options.resume;
  const priorEvidence = options.resume?.executor;
  const evidence = (): ExecutorEvidence => {
    const current = executorEvidence(options.executor.trace);
    return priorEvidence === undefined ? current : {
      searches: [...priorEvidence.searches, ...current.searches], calls: [...priorEvidence.calls, ...current.calls],
    };
  };
  const replayTools = options.executor.tools.map((tool): AgentTool => ({
    ...tool,
    execute: async (id, params, signal, onUpdate) => {
      if (priorEvidence !== undefined && typeof params === "object" && params !== null) {
        // Exact code/query signatures reuse the latest recorded snapshot; changed inputs are new calls.
        const recorded = tool.name === "executor_execute" && "code" in params
          ? priorEvidence.calls.findLast((call) => typeof call.input === "object" && call.input !== null && "code" in call.input && call.input.code === params.code)
          : tool.name === "executor_search" && "query" in params
            ? priorEvidence.searches.findLast((call) => typeof call.input === "object" && call.input !== null && "query" in call.input && call.input.query === params.query)
            : undefined;
        if (recorded !== undefined) {
          const text = JSON.stringify(recorded.output) ?? "null";
          return {
            content: [{ type: "text", text: `Recorded completed Executor result (reused without a provider call):\n${text.length > 30_000 ? `${text.slice(0, 30_000)}... [truncated ${text.length - 30_000} chars]` : text}` }],
            details: recorded.output,
          };
        }
      }
      return tool.execute(id, params, signal, onUpdate);
    },
  }));
  const executor = options.runDirectory === undefined ? { ...options.executor, tools: replayTools }
    : persistExecutorToolResults({ ...options.executor, tools: replayTools }, options.runDirectory);
  const writeOptions = { presetDirectory: options.presetDirectory, runsDirectory: options.runsDirectory ?? resolve(options.root, ".pagegraph/runs") };
  const readOptions = { repositoryRoot: options.repositoryRoot ?? options.root, runsDirectory: options.runsDirectory ?? resolve(options.root, ".pagegraph/runs") };
  const phase = async (spec: AnyWorkflowSpec, prompt: string, signal: AbortSignal, action = false): Promise<RunnerResult> => {
    const assertDeadline = (messages: ReadonlyArray<AgentMessage> = []): void => {
      if (signal.aborted) throw new WorkflowRunnerError(`Workflow deadline exceeded or run aborted: ${String(signal.reason)}`, {
        messages, usage: totalUsage(messages), executor: evidence(),
      }, { cause: signal.reason });
    };
    assertDeadline(agent?.state.messages);
    if (action && !researched) throw new Error("Workflow action requires a completed research conversation");
    const systemPrompt = !action || agent === undefined ? await composeSystemPrompt(options.presetDirectory, spec) : undefined;
    assertDeadline();
    // Edits must apply cleanly to the current files when submitted, so recorded edits start applicable.
    const validateAction = async (raw: unknown) => {
      const state = normalizeEditPaths(decodeActionState(dropNulls(raw)), readOptions.repositoryRoot, options.root);
      const outcomes = await applyWorkflowEdits(options.root, state.edits.map((edit, index) => ({ id: `edits[${index}]`, ...edit })), { ...writeOptions, check: true });
      const refused = outcomes.filter((outcome) => outcome.status !== "applicable");
      if (refused.length > 0) {
        throw new Error(`Edits must apply to the current files:\n${refused.map((outcome) => `${outcome.id} (${outcome.path}): ${outcome.status}, ${outcome.reason}`).join("\n")}\nCopy oldText exactly from a fresh read_file result, with enough context to match once.`);
      }
      return state;
    };
    let state: unknown;
    let submitted = false;
    let rejected = 0;
    let lastIssues = "No structured result was submitted.";
    let lastSubmission: unknown;
    let rejectedItems: RunnerResult["rejectedItems"];
    const rawSubmissions = new Map<string, unknown>();
    const submit: AgentTool = {
      name: "submit_result", label: "Submit workflow result", description: "Validate and submit the final workflow state after collecting Executor evidence.",
      parameters: Type.Unsafe(action ? actionStateJsonSchema : spec.stateJsonSchema),
      prepareArguments: (args) => {
        // Pi validates parameters before beforeToolCall, so retain raw values at this boundary.
        lastSubmission = args;
        return action ? dropNulls(args) : normalizeResearchState(args, options.limit);
      },
      execute: async (_id, params) => {
        try {
          const raw = rawSubmissions.get(_id) ?? lastSubmission ?? params;
          const decoded = action ? await validateAction(raw) : decodeResearchState(spec, raw, options.limit);
          const collected = evidence();
          if (!action && (collected.searches.length === 0 || collected.calls.length === 0)) {
            throw new Error([
              `Your research returned without completed Executor provider evidence (searches: ${collected.searches.length}, calls: ${collected.calls.length}).`,
              "Catalog searches and schema discovery alone do not satisfy this workflow.",
              "Use the catalog results already collected, inspect the exact discovered tool schema, and complete at least one relevant read-only provider call before submitting the original workflow state.",
              "Preserve provider errors and empty datasets honestly; do not invent evidence or mutate provider state.",
            ].join(" "));
          }
          state = decoded;
          submitted = true;
          return { content: [{ type: "text", text: "Workflow result accepted." }], details: undefined, terminate: true };
        } catch (cause) {
          lastIssues = cause instanceof Error ? cause.message : String(cause);
          return { content: [{ type: "text", text: lastIssues }], details: undefined, isError: true,
            terminate: rejected + 1 >= MAX_REJECTED_SUBMISSIONS };
        }
      },
    };
    const tools = [...executor.tools, ...createRepositoryTools(readOptions.repositoryRoot, readOptions), ...(options.additionalTools ?? []), submit];
    if (systemPrompt !== undefined) {
      if (!action) researched = false;
      agent = new Agent({
        initialState: { systemPrompt, model: options.model, tools, ...(resume === undefined ? {} : { messages: [...resume.agent.messages] }) },
        streamFn: options.streamFn ?? streamSimple,
        getApiKey: getEnvApiKey,
        toolExecution: "sequential",
      });
      resume = undefined;
    }
    if (!agent) throw new Error("Workflow action requires a research conversation");
    agent.state.tools = tools;
    agent.beforeToolCall = async (context, signal) => {
      if (submitted || rejected >= MAX_REJECTED_SUBMISSIONS) return { block: true, reason: "Workflow submission is closed.", terminate: true };
      if (context.toolCall.name === "submit_result") rawSubmissions.set(context.toolCall.id, context.toolCall.arguments);
      return guardRepositoryToolCall(options.root, readOptions)?.(context, signal);
    };
    agent.finishTurn = () => submitted || rejected >= MAX_REJECTED_SUBMISSIONS ? { action: "end" } : undefined;
    const current = agent;
    // Parameter validation can reject before execute; sequential result events count every submission.
    const unsubscribe = current.subscribe((event) => {
      if (event.type !== "message_end" || event.message.role !== "toolResult" || event.message.toolName !== "submit_result" || !event.message.isError) return;
      rejected++;
      lastIssues = event.message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
      if (rejected >= MAX_REJECTED_SUBMISSIONS) current.abort();
    });
    const abort = () => current.abort();
    signal.addEventListener("abort", abort, { once: true });
    try {
      assertDeadline(current.state.messages);
      await current.prompt(prompt);
      const result = { messages: current.state.messages, usage: totalUsage(current.state.messages), executor: evidence() };
      if (signal.aborted) throw new WorkflowRunnerError(`Workflow deadline exceeded or run aborted: ${String(signal.reason)}`, result, { cause: signal.reason });
      if (!submitted && !action && rejected >= MAX_REJECTED_SUBMISSIONS && result.executor.searches.length > 0 && result.executor.calls.length > 0) {
        try {
          const salvaged = salvageResearchState(spec, lastSubmission, options.limit);
          state = salvaged.state;
          rejectedItems = salvaged.rejectedItems;
          submitted = true;
        } catch { /* Keep the original submission diagnostics when no recommendations survive. */ }
      }
      if (!submitted) throw new WorkflowRunnerError(`Workflow result rejected: ${lastIssues}${current.state.errorMessage ? `\n${current.state.errorMessage}` : ""}`, result);
      if (!action) researched = true;
      return { ...result, state, ...(rejectedItems === undefined ? {} : { rejectedItems }) };
    } catch (cause) {
      if (cause instanceof WorkflowRunnerError) throw cause;
      const messages = current.state.messages;
      throw new WorkflowRunnerError(`Workflow agent turn failed: ${cause instanceof Error ? cause.message : String(cause)}`, {
        messages, usage: totalUsage(messages), executor: evidence(),
      }, { cause });
    } finally { signal.removeEventListener("abort", abort); unsubscribe(); }
  };
  return {
    model: { provider: options.model.provider, id: options.model.id },
    research: (spec, prompt, { signal }) => phase(spec, prompt, signal),
    act: (spec, prompt, { signal }) => phase(spec, prompt, signal, true),
    async close() { agent?.abort(); await agent?.waitForIdle(); },
  };
};

export const acquireWorkflowRunner = async (options: {
  readonly root: string;
  readonly repositoryRoot?: string;
  readonly config: SeoWorkflowAgentConfig;
  readonly model?: string | undefined;
  readonly limit: number;
  readonly executor?: ExecutorToolset;
  readonly runsDirectory?: string;
  readonly runDirectory?: string;
  readonly additionalTools?: ReadonlyArray<AgentTool>;
  readonly resume?: WorkflowRunnerResume;
}): Promise<WorkflowRunner> => {
  const id = options.model ?? options.config.defaultModel;
  const slash = id.indexOf("/");
  if (slash < 1 || slash === id.length - 1) throw new Error(`Workflow model must use provider/id: ${id}`);
  const provider = id.slice(0, slash);
  const model = builtinModels().getModel(provider, id.slice(slash + 1));
  if (!model) throw new Error(`Unknown Pi model: ${id}`);
  if (!getEnvApiKey(provider)?.trim()) {
    const names = findEnvKeys(provider, new Proxy<Record<string, string>>({}, { get: (_target, key) => typeof key === "string" ? "configured" : undefined }));
    throw new Error(`Missing Pi credentials for ${provider}; set ${names?.join(" or ") ?? `${provider} provider credentials`}.`);
  }
  let executor = options.executor;
  if (executor === undefined) {
    const baseUrl = process.env["EXECUTOR_BASE_URL"]?.trim();
    if (!baseUrl) throw new Error("Missing Executor configuration; set EXECUTOR_BASE_URL before starting a workflow.");
    try {
      const url = new URL(baseUrl);
      if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("expected http: or https:");
      executor = await createExecutorToolset({ policy: "decline" });
    } catch (cause) {
      throw new Error(`Invalid workflow Executor configuration: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    }
  }
  return createPiRunner({ root: options.root, presetDirectory: resolve(options.root, options.config.presetDirectory),
    model, limit: options.limit, ...(options.runsDirectory === undefined ? {} : { runsDirectory: options.runsDirectory }),
    ...(options.repositoryRoot === undefined ? {} : { repositoryRoot: options.repositoryRoot }),
    ...(options.runDirectory === undefined ? {} : { runDirectory: options.runDirectory }),
    ...(options.resume === undefined ? {} : { resume: options.resume }),
    ...(options.additionalTools === undefined ? {} : { additionalTools: options.additionalTools }), executor });
};
