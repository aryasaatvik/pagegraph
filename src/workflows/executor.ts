import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { ExecutorEvidence } from "./model";

export interface ExecutorTraceRecord {
  readonly kind: "search" | "execute";
  readonly query?: string;
  readonly code?: string;
  readonly result: unknown;
  readonly isError: boolean;
  readonly toolCalls?: ReadonlyArray<string>;
  readonly durationMs: number;
}

export interface ExecutorToolset {
  readonly tools: AgentTool[];
  readonly trace: ExecutorTraceRecord[];
}

export const executorEvidence = (trace: ReadonlyArray<ExecutorTraceRecord>): ExecutorEvidence => ({
  searches: trace.filter((record) => record.kind === "search").map((record) => ({
    tool: "executor_search", input: { query: record.query }, output: record.result,
  })),
  calls: trace.filter((record) => record.kind === "execute" && !record.isError).map((record) => ({
    tool: record.toolCalls?.join(", ") || "execute", input: { code: record.code }, output: record.result,
  })),
});

export const createExecutorToolset = (_options: { readonly policy: "decline" }): ExecutorToolset => {
  throw new Error("Executor tools are not configured. Configure createExecutorToolset with @pi-ext/executor before running research workflows.");
};
