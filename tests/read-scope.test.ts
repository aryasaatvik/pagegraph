import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { BeforeToolCallContext } from "@earendil-works/pi-agent-core";
import * as Effect from "effect/Effect";
import { afterEach, describe, expect, it } from "vitest";

import { collectContextFiles } from "../src/workflows/evidence";
import { loadSeoProjectConfig } from "../src/cli/load-config";
import { createRepositoryTools, guardRepositoryToolCall } from "../src/workflows/repository-tools";
import { applyWorkflowEdits } from "../src/workflows/review";
import { resolveWorkflowRepositoryRoot } from "../src/workflows/repository-paths";

const directories: string[] = [];
const originalCwd = process.cwd();

const fixture = async () => {
  const parent = await realpath(await mkdtemp(join(tmpdir(), "pagegraph-read-scope-")));
  directories.push(parent);
  const repository = join(parent, "repository");
  const app = join(repository, "apps", "web");
  const runsDirectory = join(parent, "runs");
  await Promise.all([mkdir(app, { recursive: true }), mkdir(runsDirectory)]);
  await Promise.all([
    writeFile(join(repository, "AGENTS.md"), "repository context"),
    writeFile(join(app, "route.ts"), "app route"),
    writeFile(join(parent, "outside.txt"), "private outside"),
    writeFile(join(runsDirectory, "run.json"), "run context"),
    symlink(join(parent, "outside.txt"), join(repository, "escape.txt")),
    symlink(join(parent, "outside.txt"), join(runsDirectory, "escape.txt")),
  ]);
  return { parent, repository, app, runsDirectory };
};

const context = (name: string, path: string): BeforeToolCallContext => ({
  toolCall: { type: "toolCall", id: "call", name, arguments: { path } },
  args: { path }, context: { messages: [] },
  assistantMessage: {
    role: "assistant", content: [], api: "openai-completions", provider: "openai", model: "test", timestamp: 0,
    stopReason: "toolUse", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  },
});

const text = (result: Awaited<ReturnType<ReturnType<typeof createRepositoryTools>[number]["execute"]>>) =>
  result.content.filter((part) => part.type === "text").map((part) => part.text).join("\n");

afterEach(async () => {
  process.chdir(originalCwd);
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("workflow read scope", () => {
  it.each(["../..", undefined, "", "  ", 42])("validates repositoryRoot configuration %s", async (repositoryRoot) => {
    const { app } = await fixture();
    await writeFile(join(app, "pagegraph.config.mjs"), `export default {
      loadGraph: async () => {}, workflows: {
        agent: { presetDirectory: ".pagegraph/agent", defaultModel: "test/model" },
        ${repositoryRoot === undefined ? "" : `repositoryRoot: ${JSON.stringify(repositoryRoot)},`}
      },
    };`);
    process.chdir(app);
    if (repositoryRoot === undefined || repositoryRoot === "../..") {
      const project = await Effect.runPromise(loadSeoProjectConfig);
      expect(project.config.workflows?.repositoryRoot).toBe(repositoryRoot);
    } else {
      await expect(Effect.runPromise(loadSeoProjectConfig)).rejects.toThrow("must default-export");
    }
  });

  it("defaults to the Git top level, falls back outside Git, and honors a configured app-relative root", async () => {
    const { repository, app } = await fixture();
    expect(await resolveWorkflowRepositoryRoot(app)).toBe(app);
    execFileSync("git", ["init", "--quiet", repository]);
    expect(await resolveWorkflowRepositoryRoot(app)).toBe(repository);
    expect(await resolveWorkflowRepositoryRoot(app, "../..")).toBe(repository);
    expect(await resolveWorkflowRepositoryRoot(app, ".")).toBe(app);
    await expect(resolveWorkflowRepositoryRoot(app, "missing")).rejects.toThrow();
  });

  it("allows repository-wide reads while writes stay inside the config's app root", async () => {
    const { repository, app, runsDirectory } = await fixture();
    const tools = createRepositoryTools(repository, { runsDirectory });
    const read = tools.find((entry) => entry.name === "read_file")!;
    const list = tools.find((entry) => entry.name === "list_files")!;
    const search = tools.find((entry) => entry.name === "search_text")!;
    expect(text(await read.execute("read", { path: "AGENTS.md" }))).toBe("repository context");
    expect(text(await list.execute("list", { path: ".", recursive: true }))).toContain("apps/web/route.ts");
    expect(text(await search.execute("search", { path: ".", text: "repository context" }))).toContain("AGENTS.md:1:repository context");
    const writeOptions = { runsDirectory, presetDirectory: ".pagegraph/agent", check: false };
    const guard = guardRepositoryToolCall(app, { repositoryRoot: repository, runsDirectory })!;
    expect(await guard(context("read_file", join(repository, "AGENTS.md")))).toBeUndefined();
    const outcomes = await applyWorkflowEdits(app, [
      { id: "e1", path: "../../AGENTS.md", oldText: "repository context", newText: "changed" },
      { id: "e2", path: "new.ts", newText: "app change" },
    ], writeOptions);
    expect(outcomes.map(({ status }) => status)).toEqual(["failed", "applied"]);
    expect(outcomes[0]?.reason).toContain("escapes project root");
    expect(text(await read.execute("read", { path: "AGENTS.md" }))).toBe("repository context");
    expect(text(await read.execute("read", { path: "apps/web/new.ts" }))).toBe("app change");
  });

  it("uses the same lexical and symlink bounds for context files and all read tools, including run artifacts", async () => {
    const { parent, repository, app, runsDirectory } = await fixture();
    const readOptions = { runsDirectory };
    const tools = createRepositoryTools(repository, readOptions);
    const read = tools.find((entry) => entry.name === "read_file")!;
    const guard = guardRepositoryToolCall(app, { repositoryRoot: repository, runsDirectory })!;
    for (const path of ["../outside.txt", join(parent, "outside.txt"), "escape.txt", join(runsDirectory, "escape.txt"), join(runsDirectory, "../outside.txt")]) {
      expect((await guard(context("read_file", path)))?.block).toBe(true);
      await expect(read.execute("read", { path })).rejects.toThrow("escapes project root");
      await expect(collectContextFiles(repository, "research.keywords", { files: [path] }, readOptions)).rejects.toThrow("escapes project root");
      for (const name of ["list_files", "search_text"]) {
        expect((await guard(context(name, path)))?.block).toBe(true);
      }
    }
    const runPath = join(runsDirectory, "run.json");
    expect(await guard(context("read_file", runPath))).toBeUndefined();
    expect(text(await read.execute("read", { path: runPath }))).toBe("run context");
    expect(await collectContextFiles(repository, "research.keywords", {
      files: ["AGENTS.md"], byWorkflow: { "research.keywords": ["AGENTS.md", runPath] },
    }, readOptions)).toEqual([
      { path: "AGENTS.md", content: "repository context" }, { path: runPath, content: "run context" },
    ]);
    const list = tools.find((entry) => entry.name === "list_files")!;
    expect(text(await list.execute("list", { path: runsDirectory }))).toContain("run.json");
  });

  it("reads a full large UTF-8 artifact through byte pages without losing characters", async () => {
    const { repository, runsDirectory } = await fixture();
    const content = JSON.stringify({ rows: Array.from({ length: 5000 }, (_, index) => ({ index, keyword: "keyword 🙂 café" })) });
    expect(Buffer.byteLength(content)).toBeGreaterThan(100_000);
    const path = join(runsDirectory, "outcome.json");
    await writeFile(path, content);
    const read = createRepositoryTools(repository, { runsDirectory }).find((entry) => entry.name === "read_file")!;
    let offset = 0;
    let recovered = "";
    for (let page = 0; page < 10; page++) {
      const output = text(await read.execute("read", { path, offset }));
      const marker = /\n\[File truncated; continue with read_file offset=(\d+)\]$/.exec(output);
      if (!marker) {
        recovered += output;
        break;
      }
      recovered += output.slice(0, marker.index);
      offset = Number(marker[1]);
    }
    expect(recovered).toBe(content);
    expect(JSON.parse(recovered)).toEqual(JSON.parse(content));
    for (const params of [{ offset: -1 }, { offset: 1.5 }, { maxBytes: 0 }, { maxBytes: 65537 }]) {
      await expect(read.execute("read", { path, ...params })).rejects.toThrow("must be an integer");
    }
  });
});
