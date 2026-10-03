import { describe, expect, it } from "vitest";

import { createExecutorToolset, executorEvidence } from "../../src/workflows/executor";
import type { ExecutorTraceRecord, ExecutorToolset } from "../../src/workflows/executor";

describe("Executor toolset", () => {
  it("maps discovery and completed execution records to workflow evidence", () => {
    const trace: Array<ExecutorTraceRecord> = [
      { kind: "search", query: "search analytics", result: { tools: ["analytics_query"] }, isError: false, durationMs: 2 },
      { kind: "execute", code: "await analytics_query()", toolCalls: ["analytics_query", "analytics_events"],
        result: { visits: 42 }, isError: false, durationMs: 4 },
      { kind: "execute", code: "return 42", result: 42, isError: false, durationMs: 1 },
      { kind: "execute", code: "return []", toolCalls: [], result: [], isError: false, durationMs: 1 },
    ];

    expect(executorEvidence(trace)).toEqual({
      searches: [{ tool: "executor_search", input: { query: "search analytics" }, output: { tools: ["analytics_query"] } }],
      calls: [
        { tool: "analytics_query, analytics_events", input: { code: "await analytics_query()" }, output: { visits: 42 } },
        { tool: "execute", input: { code: "return 42" }, output: 42 },
        { tool: "execute", input: { code: "return []" }, output: [] },
      ],
    });
  });

  it("retains failed trace records while excluding failed execution from completed evidence", () => {
    const failedSearch: ExecutorTraceRecord = {
      kind: "search", query: "unavailable service", result: { error: "service unavailable" }, isError: true, durationMs: 1,
    };
    const failedExecute: ExecutorTraceRecord = {
      kind: "execute", code: "await unavailable()", toolCalls: ["unavailable"],
      result: { error: "execution declined" }, isError: true, durationMs: 1,
    };
    const toolset: ExecutorToolset = { tools: [], trace: [failedSearch, failedExecute] };
    const evidence = executorEvidence(toolset.trace);

    expect(evidence).toEqual({
      searches: [{ tool: "executor_search", input: { query: "unavailable service" }, output: { error: "service unavailable" } }],
      calls: [],
    });
    expect(toolset.trace).toEqual([failedSearch, failedExecute]);
    expect(toolset.trace[1].isError).toBe(true);
  });

  it("fails clearly when decline-policy research has no configured Executor tools", () => {
    expect(() => createExecutorToolset({ policy: "decline" })).toThrow("Executor tools are not configured");
  });
});
