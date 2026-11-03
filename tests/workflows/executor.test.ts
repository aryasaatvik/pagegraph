import { createServer } from "node:http";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createExecutorToolset, executorEvidence } from "../../src/workflows/executor";
import type { ExecutorTraceRecord, ExecutorToolset } from "../../src/workflows/executor";

const call = (path: string, isError = false) => ({ path, isError, durationMs: 1 });

describe("Executor toolset", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("maps discovery and completed execution records to workflow evidence", () => {
    const trace: Array<ExecutorTraceRecord> = [
      { kind: "search", query: "search analytics", result: [], isError: false, durationMs: 2 },
      {
        kind: "execute",
        code: "await analytics_query()",
        toolCalls: [call("analytics.query"), call("analytics.events")],
        result: { visits: 42 },
        isError: false,
        approvals: [],
        durationMs: 4,
      },
    ];

    expect(executorEvidence(trace)).toEqual({
      searches: [{ tool: "executor_search", input: { query: "search analytics" }, output: [] }],
      calls: [
        {
          tool: "analytics.query, analytics.events",
          input: { code: "await analytics_query()" },
          output: { visits: 42 },
        },
      ],
    });
  });

  it("names only successful provider calls and drops executions without a reported success", () => {
    const trace: Array<ExecutorTraceRecord> = [
      {
        kind: "execute",
        code: "partial",
        toolCalls: [call("github.repos.get"), call("github.repos.get", true)],
        result: { name: "pagegraph" },
        isError: false,
        approvals: [],
        durationMs: 2,
      },
      {
        kind: "execute",
        code: "all failed",
        toolCalls: [call("github.repos.get", true)],
        result: null,
        isError: false,
        approvals: [],
        durationMs: 1,
      },
      {
        kind: "execute",
        code: "return []",
        toolCalls: [],
        result: [],
        isError: false,
        approvals: [],
        durationMs: 1,
      },
      {
        kind: "execute",
        code: "unreported",
        result: 42,
        isError: false,
        approvals: [],
        durationMs: 1,
      },
    ];

    expect(executorEvidence(trace).calls).toEqual([
      { tool: "github.repos.get", input: { code: "partial" }, output: { name: "pagegraph" } },
    ]);
  });

  it("retains failed trace records while excluding failed execution from completed evidence", () => {
    const failedSearch: ExecutorTraceRecord = {
      kind: "search",
      query: "unavailable service",
      result: "service unavailable",
      isError: true,
      durationMs: 1,
    };
    const failedExecute: ExecutorTraceRecord = {
      kind: "execute",
      code: "await unavailable()",
      toolCalls: [call("unavailable", true)],
      result: { error: "execution declined" },
      isError: true,
      approvals: [],
      durationMs: 1,
    };
    const toolset: ExecutorToolset = { tools: [], trace: [failedSearch, failedExecute] };
    const evidence = executorEvidence(toolset.trace);

    expect(evidence).toEqual({
      searches: [
        {
          tool: "executor_search",
          input: { query: "unavailable service" },
          output: "service unavailable",
        },
      ],
      calls: [],
    });
    expect(toolset.trace).toEqual([failedSearch, failedExecute]);
  });

  it("fails clearly when the Executor server is not configured", async () => {
    vi.stubEnv("EXECUTOR_BASE_URL", undefined);
    await expect(createExecutorToolset({ policy: "decline" })).rejects.toThrow(/EXECUTOR_BASE_URL/);
  });

  it("builds the Executor tools from the environment", async () => {
    vi.stubEnv("EXECUTOR_BASE_URL", "https://executor.test");
    vi.stubEnv("EXECUTOR_CLIENT_ID", undefined);
    vi.stubEnv("EXECUTOR_CLIENT_ID_FILE", undefined);
    vi.stubEnv("EXECUTOR_CLIENT_SECRET", undefined);
    vi.stubEnv("EXECUTOR_CLIENT_SECRET_FILE", undefined);
    const toolset = await createExecutorToolset({ policy: "decline" });

    expect(toolset.tools.map((tool) => tool.name)).toEqual(["executor_search", "executor_execute"]);
    expect(toolset.trace).toEqual([]);
  });

  it("runs the installed Executor search tool over local HTTP with the shared Effect runtime", async () => {
    const requests: string[] = [];
    const server = createServer((request, response) => {
      requests.push(request.url ?? "");
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ items: [] }));
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    try {
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("Fixture did not bind");
      vi.stubEnv("EXECUTOR_BASE_URL", `http://127.0.0.1:${address.port}`);
      for (const key of [
        "EXECUTOR_CLIENT_ID",
        "EXECUTOR_CLIENT_ID_FILE",
        "EXECUTOR_CLIENT_SECRET",
        "EXECUTOR_CLIENT_SECRET_FILE",
      ]) {
        vi.stubEnv(key, undefined);
      }
      const toolset = await createExecutorToolset({ policy: "decline" });
      const search = toolset.tools.find((tool) => tool.name === "executor_search")!;
      await search.execute("local-search", { query: "fixture", limit: 2 }, undefined);
      expect(requests).toEqual(["/api/semantic-search/search?q=fixture&limit=2"]);
      expect(toolset.trace).toEqual([
        expect.objectContaining({ kind: "search", query: "fixture", result: [], isError: false }),
      ]);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
