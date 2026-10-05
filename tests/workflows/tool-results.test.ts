import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { Type } from "@earendil-works/pi-ai";
import { persistExecutorToolResults, type ExecutorToolset } from "../../src/workflows/executor";
import { createRepositoryTools } from "../../src/workflows/repository-tools";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

it("retains an Executor outcome over 30k and points the agent to readable full JSON", async () => {
  const root = await mkdtemp(join(tmpdir(), "pagegraph-results-"));
  directories.push(root);
  const details = { outcome: { rows: Array.from({ length: 1500 }, (_, index) => ({ keyword: `keyword ${index}`, text: "x".repeat(80) })) }, approvals: [] };
  const full = JSON.stringify(details);
  const toolset: ExecutorToolset = { trace: [], tools: [{
    name: "executor_execute", label: "Execute", description: "Fixture", parameters: Type.Object({}),
    execute: async () => ({ content: [{ type: "text", text: `${full.slice(0, 30_000)}\n... [truncated ${full.length - 30_000} chars]` }], details }),
  }] };
  const wrapped = persistExecutorToolResults(toolset, root);
  const result = await wrapped.tools[0]!.execute("id", {}, undefined);
  const path = join(root, "tool-results/1.json");
  expect(JSON.parse(await readFile(path, "utf8"))).toEqual(details);
  expect(result.content).toContainEqual({ type: "text", text: `Full Executor result: ${path}. Use read_file to read it; paginate with offset and maxBytes when needed.` });
  const read = createRepositoryTools(root).find((tool) => tool.name === "read_file")!;
  const first = await read.execute("read", { path }, undefined);
  expect(first.content[0]).toMatchObject({ type: "text", text: expect.stringContaining('"keyword": "keyword 0"') });
  const stored = await readFile(path, "utf8");
  let reconstructed = "";
  for (let offset = 0; offset < Buffer.byteLength(stored); offset += 64 * 1024) {
    const chunk = await read.execute("read-chunk", { path, offset, maxBytes: 64 * 1024 }, undefined);
    const text = chunk.content.filter((part) => part.type === "text").map((part) => part.text).join("");
    reconstructed += text.replace(/\n\[File truncated; continue with read_file offset=\d+\]$/, "");
  }
  expect(JSON.parse(reconstructed)).toEqual(details);
  await persistExecutorToolResults(toolset, root).tools[0]!.execute("resumed", {}, undefined);
  expect(JSON.parse(await readFile(join(root, "tool-results/2.json"), "utf8"))).toEqual(details);
});

it("writes every execute outcome and leaves untruncated text unchanged", async () => {
  const root = await mkdtemp(join(tmpdir(), "pagegraph-results-"));
  directories.push(root);
  const toolset: ExecutorToolset = { trace: [], tools: [{
    name: "executor_execute", label: "Execute", description: "Fixture", parameters: Type.Object({}),
    execute: async () => ({ content: [{ type: "text", text: "ok" }], details: { outcome: [] } }),
  }] };
  const wrapped = persistExecutorToolResults(toolset, root);
  expect((await wrapped.tools[0]!.execute("id", {}, undefined)).content).toEqual([{ type: "text", text: "ok" }]);
  expect(JSON.parse(await readFile(join(root, "tool-results/1.json"), "utf8"))).toEqual({ outcome: [] });
});
