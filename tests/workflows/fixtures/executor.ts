import { Type } from "@earendil-works/pi-ai";

import type { ExecutorToolset, ExecutorTraceRecord } from "../../../src/workflows/executor";

export const completedExecutorTrace = (): ExecutorTraceRecord[] => [
  { kind: "search", query: "SEO", result: ["seo.search"], isError: false, durationMs: 1 },
  { kind: "execute", code: "await tools.seo.search()", result: { rows: [] }, isError: false, toolCalls: ["seo.search"], durationMs: 1 },
];

export const fakeExecutorToolset = (seed: ReadonlyArray<ExecutorTraceRecord> = []): ExecutorToolset => {
  const trace = [...seed];
  const searchParameters = Type.Object({ query: Type.String() });
  const executeParameters = Type.Object({ code: Type.String() });
  return {
    trace,
    tools: [
      {
        name: "executor_search", label: "Search Executor", description: "Discover fake provider tools.",
        parameters: searchParameters,
        execute: async (_id, params) => {
          if (typeof params !== "object" || params === null || !("query" in params) || typeof params.query !== "string") throw new Error("Expected query");
          const query = params.query;
          const result = ["seo.search"];
          trace.push({ kind: "search", query, result, isError: false, durationMs: 1 });
          return { content: [{ type: "text", text: JSON.stringify(result) }], details: undefined };
        },
      },
      {
        name: "executor_execute", label: "Execute Executor", description: "Complete a fake provider call.",
        parameters: executeParameters,
        execute: async (_id, params) => {
          if (typeof params !== "object" || params === null || !("code" in params) || typeof params.code !== "string") throw new Error("Expected code");
          const code = params.code;
          const result = { rows: [] };
          trace.push({ kind: "execute", code, result, isError: false, toolCalls: ["seo.search"], durationMs: 1 });
          return { content: [{ type: "text", text: JSON.stringify(result) }], details: undefined };
        },
      },
    ],
  };
};
