import type { AgentTool } from "@earendil-works/pi-agent-core";
import { ExecutorClient, executorTools, type ExecutorTraceRecord } from "@pi-ext/executor";
import { ConfigProvider, Effect } from "effect";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ExecutorEvidence, ExecutorEvidenceRecord } from "./model";

export type { ExecutorTraceRecord };

export interface ExecutorToolset {
  readonly tools: AgentTool[];
  readonly trace: ExecutorTraceRecord[];
}

/** Retains complete Executor outcomes even when the model-facing preview is truncated. */
export const persistExecutorToolResults = (toolset: ExecutorToolset, runDirectory: string): ExecutorToolset => {
  const directory = resolve(runDirectory, "tool-results");
  let sequence: number | undefined;
  return {
    trace: toolset.trace,
    tools: toolset.tools.map((tool) => tool.name !== "executor_execute" ? tool : {
      ...tool,
      execute: async (...args) => {
        const result = await tool.execute(...args);
        await mkdir(directory, { recursive: true });
        if (sequence === undefined) {
          const entries = await readdir(directory);
          sequence = Math.max(0, ...entries.flatMap((name) => /^\d+\.json$/.test(name) ? [Number(name.slice(0, -5))] : []));
        }
        const path = resolve(directory, `${++sequence}.json`);
        // Exclusive creation prevents a resumed run from replacing existing evidence.
        await writeFile(path, JSON.stringify(result.details ?? null, null, 2) + "\n", { flag: "wx" });
        const truncated = result.content.some((part) => part.type === "text" && /\[truncated \d+ chars\]/.test(part.text));
        return truncated ? { ...result, content: [...result.content, {
          type: "text" as const,
          text: `Full Executor result: ${path}. Use read_file to read it; paginate with offset and maxBytes when needed.`,
        }] } : result;
      },
    }),
  };
};

// Evidence is a provider call that succeeded. A completed script can still contain failed calls,
// and an execution without a call report proves nothing.
const executionEvidence = (record: Extract<ExecutorTraceRecord, { kind: "execute" }>): ExecutorEvidenceRecord | undefined => {
  if (record.isError) return undefined;
  const succeeded = (record.toolCalls ?? []).filter((call) => !call.isError).map((call) => call.path);
  if (succeeded.length === 0) return undefined;
  return { tool: succeeded.join(", "), input: { code: record.code }, output: record.result };
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
