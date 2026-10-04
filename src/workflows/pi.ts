import { Agent, type AgentMessage, type AgentOptions, type AgentTool } from "@earendil-works/pi-agent-core";
import { Type, type Model, type Usage } from "@earendil-works/pi-ai";
import { findEnvKeys, getEnvApiKey, streamSimple } from "@earendil-works/pi-ai/compat";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { SeoWorkflowAgentConfig } from "../config";
import { createExecutorToolset, executorEvidence, type ExecutorToolset } from "./executor";
import { createRepositoryTools, guardRepositoryToolCall } from "./repository-tools";
import type { RunnerResult, WorkflowRunner } from "./runner";
import type { AnyWorkflowSpec } from "./specs/types";
import { decodeResearchState, normalizeResearchState } from "./state";

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
  readonly presetDirectory: string;
  readonly model: Model<string>;
  readonly limit: number;
  readonly executor: ExecutorToolset;
  readonly streamFn?: AgentOptions["streamFn"];
}

export const createPiRunner = (options: PiRunnerOptions): WorkflowRunner => {
  let agent: Agent | undefined;
  return {
    model: { provider: options.model.provider, id: options.model.id },
    async research(spec, prompt, { signal }) {
      const assertDeadline = (messages: ReadonlyArray<AgentMessage> = []): void => {
        if (signal.aborted) throw new WorkflowRunnerError(`Workflow deadline exceeded or run aborted: ${String(signal.reason)}`, {
          messages, usage: totalUsage(messages), executor: executorEvidence(options.executor.trace),
        }, { cause: signal.reason });
      };
      assertDeadline();
      const systemPrompt = await composeSystemPrompt(options.presetDirectory, spec);
      assertDeadline();
      let state: unknown;
      let submitted = false;
      let rejected = 0;
      let lastIssues = "No structured result was submitted.";
      const rawSubmissions = new Map<string, unknown>();
      const submit: AgentTool = {
        name: "submit_result", label: "Submit workflow result", description: "Validate and submit the final workflow state after collecting Executor evidence.",
        parameters: Type.Unsafe(spec.stateJsonSchema),
        prepareArguments: (args) => normalizeResearchState(args, options.limit),
        execute: async (_id, params) => {
          try {
            const decoded = decodeResearchState(spec, rawSubmissions.get(_id) ?? params, options.limit);
            const evidence = executorEvidence(options.executor.trace);
            if (evidence.searches.length === 0 || evidence.calls.length === 0) {
              throw new Error([
                `Your research returned without completed Executor provider evidence (searches: ${evidence.searches.length}, calls: ${evidence.calls.length}).`,
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
      agent = new Agent({
        initialState: { systemPrompt, model: options.model, tools: [...options.executor.tools, ...createRepositoryTools(options.root), submit] },
        streamFn: options.streamFn ?? streamSimple,
        getApiKey: getEnvApiKey,
        toolExecution: "sequential",
        beforeToolCall: async (context, signal) => {
          if (submitted || rejected >= MAX_REJECTED_SUBMISSIONS) return { block: true, reason: "Workflow submission is closed.", terminate: true };
          if (context.toolCall.name === "submit_result") rawSubmissions.set(context.toolCall.id, context.toolCall.arguments);
          return guardRepositoryToolCall(options.root)?.(context, signal);
        },
        finishTurn: () => submitted || rejected >= MAX_REJECTED_SUBMISSIONS ? { action: "end" } : undefined,
      });
      const current = agent;
      // Parameter validation can reject before execute; sequential result events count every submission.
      current.subscribe((event) => {
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
        const result = { messages: current.state.messages, usage: totalUsage(current.state.messages), executor: executorEvidence(options.executor.trace) };
        if (signal.aborted) throw new WorkflowRunnerError(`Workflow deadline exceeded or run aborted: ${String(signal.reason)}`, result, { cause: signal.reason });
        if (!submitted) throw new WorkflowRunnerError(`Workflow result rejected: ${lastIssues}${current.state.errorMessage ? `\n${current.state.errorMessage}` : ""}`, result);
        return { ...result, state };
      } finally { signal.removeEventListener("abort", abort); }
    },
    async close() { agent?.abort(); await agent?.waitForIdle(); },
  };
};

export const acquireWorkflowRunner = async (options: {
  readonly root: string;
  readonly config: SeoWorkflowAgentConfig;
  readonly model?: string | undefined;
  readonly limit: number;
  readonly executor?: ExecutorToolset;
}): Promise<WorkflowRunner> => {
  const id = options.model ?? options.config.defaultModel;
  const slash = id.indexOf("/");
  if (slash < 1 || slash === id.length - 1) throw new Error(`Workflow model must use provider/id: ${id}`);
  const provider = id.slice(0, slash);
  const model = builtinModels().getModel(provider, id.slice(slash + 1));
  if (!model) throw new Error(`Unknown Pi model: ${id}`);
  if (!getEnvApiKey(provider)) {
    const names = findEnvKeys(provider, new Proxy<Record<string, string>>({}, { get: (_target, key) => typeof key === "string" ? "configured" : undefined }));
    throw new Error(`Missing Pi credentials for ${provider}; set ${names?.join(" or ") ?? `${provider} provider credentials`}.`);
  }
  return createPiRunner({ root: options.root, presetDirectory: resolve(options.root, options.config.presetDirectory),
    model, limit: options.limit, executor: options.executor ?? await createExecutorToolset({ policy: "decline" }) });
};
