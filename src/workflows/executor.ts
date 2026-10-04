import type { AgentTool } from "@earendil-works/pi-agent-core";
import { ExecutorClient, executorTools, type ExecutorTraceRecord } from "@pi-ext/executor";
import { ConfigProvider, Effect } from "effect";
import type { ExecutorEvidence, ExecutorEvidenceRecord } from "./model";

export type { ExecutorTraceRecord };

export interface ExecutorToolset {
  readonly tools: AgentTool[];
  readonly trace: ExecutorTraceRecord[];
}

// A completed script can still contain failed provider calls; only successful calls are evidence.
// When the server reports tool calls and none succeeded, the execution produced no provider data.
const executionEvidence = (record: Extract<ExecutorTraceRecord, { kind: "execute" }>): ExecutorEvidenceRecord | undefined => {
  if (record.isError) return undefined;
  const succeeded = record.toolCalls?.filter((call) => !call.isError).map((call) => call.path);
  if (succeeded !== undefined && succeeded.length === 0) return undefined;
  return { tool: succeeded?.join(", ") ?? "execute", input: { code: record.code }, output: record.result };
};

export const executorEvidence = (trace: ReadonlyArray<ExecutorTraceRecord>): ExecutorEvidence => ({
  searches: trace.flatMap((record) => record.kind === "search"
    ? [{ tool: "executor_search", input: { query: record.query }, output: record.result }]
    : []),
  calls: trace.flatMap((record) => {
    if (record.kind !== "execute") return [];
    const evidence = executionEvidence(record);
    return evidence ? [evidence] : [];
  }),
});

/** Connects to the Executor named by `EXECUTOR_BASE_URL` (and Cloudflare Access credentials, when set). */
export const createExecutorToolset = async (options: { readonly policy: "decline" }): Promise<ExecutorToolset> => {
  // Effect caches its default environment provider on first read; read the environment as it is now.
  const config = ExecutorClient.optionsFromEnv.pipe(Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromEnv()));
  const client = ExecutorClient.create(await Effect.runPromise(config));
  const trace: ExecutorTraceRecord[] = [];
  return { tools: executorTools({ client, policy: options.policy, trace }), trace };
};
