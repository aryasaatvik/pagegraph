import { link, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { BeforeToolCallContext } from "@earendil-works/pi-agent-core";
import { afterEach, describe, expect, it } from "vitest";

import { createRepositoryTools, createRepositoryWriteTools, guardRepositoryToolCall } from "../../src/workflows/repository-tools";

const directories: Array<string> = [];
const fixture = async () => {
  const parent = await mkdtemp(join(tmpdir(), "pagegraph-repository-"));
  directories.push(parent);
  const root = join(parent, "project");
  await mkdir(root);
  await writeFile(join(root, "inside.txt"), "project evidence\nsecond line\n");
  await writeFile(join(parent, "outside.txt"), "outside evidence");
  await symlink(join(parent, "outside.txt"), join(root, "escape.txt"));
  return { parent, root };
};

const context = (name: string, path: string): BeforeToolCallContext => ({
  toolCall: { type: "toolCall", id: "call", name, arguments: { path } },
  args: { path },
  context: { messages: [] },
  assistantMessage: {
    role: "assistant", content: [], api: "openai-completions", provider: "openai", model: "test", timestamp: 0,
    stopReason: "toolUse",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  },
});

const tool = (root: string, name: string) => {
  const found = createRepositoryTools(root).find((entry) => entry.name === name);
  if (!found) throw new Error(`Missing tool ${name}`);
  return found;
};

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("repository tools", () => {
  it("blocks relative, absolute and symlink escapes before execution", async () => {
    const { parent, root } = await fixture();
    const guard = guardRepositoryToolCall(root)!;
    for (const path of ["../outside.txt", join(parent, "outside.txt"), "escape.txt"]) {
      const blocked = await guard(context("read_file", path));
      expect(blocked?.block).toBe(true);
      expect(blocked?.reason).toContain("escapes project root");
    }
    expect(await guard(context("read_file", "inside.txt"))).toBeUndefined();
    expect(await guard(context("read_file", join(root, "inside.txt")))).toBeUndefined();
    expect(await guard(context("executor_search", "../outside.txt"))).toBeUndefined();
  });

  it("reads inside the project and revalidates paths during execution", async () => {
    const { root } = await fixture();
    const read = tool(root, "read_file");
    expect((await read.execute("call", { path: "inside.txt" })).content).toEqual([
      { type: "text", text: "project evidence\nsecond line\n" },
    ]);
    await expect(read.execute("call", { path: "escape.txt" })).rejects.toThrow("symlink");
    await expect(read.execute("call", { path: "../outside.txt" })).rejects.toThrow("escapes project root");
  });

  it("lists and searches scoped files without traversing symlinks", async () => {
    const { parent, root } = await fixture();
    await mkdir(join(root, "nested"));
    await writeFile(join(root, "nested", "details.txt"), "project evidence details\n");
    await symlink(parent, join(root, "outside-directory"));
    const listed = await tool(root, "list_files").execute("call", { path: ".", recursive: true });
    expect(listed.content).toEqual([{ type: "text", text: "inside.txt\nnested/details.txt" }]);
    const searched = await tool(root, "search_text").execute("call", { path: ".", text: "evidence" });
    expect(searched.content).toEqual([{ type: "text", text: "inside.txt:1:project evidence\nnested/details.txt:1:project evidence details" }]);
  });

  it("bounds file reads and observes abort signals", async () => {
    const { root } = await fixture();
    await writeFile(join(root, "large.txt"), "a".repeat(100_000));
    const read = tool(root, "read_file");
    const result = await read.execute("call", { path: "large.txt" });
    expect(result.content[0]).toEqual({ type: "text", text: "a".repeat(64 * 1024) + "\n[File truncated; continue with read_file offset=65536]" });
    await expect(read.execute("call", { path: "inside.txt" }, AbortSignal.abort())).rejects.toThrow();
  });
});

describe("repository write tools", () => {
  const tools = (root: string) => createRepositoryWriteTools(root, { presetDirectory: "preset", runsDirectory: "runs" });

  it("creates and edits files and rejects ambiguous or absent matches", async () => {
    const { root } = await fixture();
    const [write, edit] = tools(root);
    await write.execute("write", { path: "nested/page.txt", content: "one two one" });
    await expect(edit.execute("edit", { path: "nested/page.txt", oldText: "one", newText: "three" })).rejects.toThrow("exactly once");
    await expect(edit.execute("edit", { path: "nested/page.txt", oldText: "absent", newText: "three" })).rejects.toThrow("exactly once");
    await edit.execute("edit", { path: "nested/page.txt", oldText: "two", newText: "three" });
    expect(await readFile(join(root, "nested/page.txt"), "utf8")).toBe("one three one");
  });

  it("blocks protected directories, outside paths, symlink escapes and dangling symlinks", async () => {
    const { root, parent } = await fixture();
    await symlink(parent, join(root, "outside-directory"));
    await symlink(join(parent, "not-created.txt"), join(root, "dangling.txt"));
    await mkdir(join(root, "preset"));
    await symlink(join(root, "preset"), join(root, "preset-alias"));
    const [write] = tools(root);
    const guard = guardRepositoryToolCall(root, { presetDirectory: "preset", runsDirectory: "runs" })!;
    for (const path of [".git/config", "node_modules/pkg/file", "nested/node_modules/file", "runs/id/run.json", "preset/AGENTS.md", "preset-alias/new.txt", "../outside.txt", join(parent, "outside.txt"), "escape.txt", "outside-directory/new.txt", "dangling.txt"]) {
      expect((await guard(context("write_file", path)))?.block).toBe(true);
      await expect(write.execute("write", { path, content: "blocked" })).rejects.toThrow();
    }
    expect(await readFile(join(parent, "outside.txt"), "utf8")).toBe("outside evidence");
  });

  it("blocks aliases into a protected directory whose final path does not yet exist", async () => {
    const { root } = await fixture();
    await mkdir(join(root, "storage"));
    await symlink(join(root, "storage"), join(root, "alias"));
    const [write] = createRepositoryWriteTools(root, { presetDirectory: "alias/preset", runsDirectory: "alias/runs" });
    await expect(write.execute("write", { path: "storage/preset/file", content: "blocked" })).rejects.toThrow("protected");
    await expect(write.execute("write", { path: "storage/runs/file", content: "blocked" })).rejects.toThrow("protected");
  });

  it("refuses to write through a hard link shared with a file outside the project", async () => {
    const { root, parent } = await fixture();
    await link(join(parent, "outside.txt"), join(root, "shared.txt"));
    const [write, edit] = tools(root);
    const guard = guardRepositoryToolCall(root, { presetDirectory: "preset", runsDirectory: "runs" })!;
    expect((await guard(context("write_file", "shared.txt")))?.block).toBe(true);
    await expect(write.execute("write", { path: "shared.txt", content: "changed" })).rejects.toThrow("hard-linked");
    await expect(edit.execute("edit", { path: "shared.txt", oldText: "outside", newText: "changed" })).rejects.toThrow("hard-linked");
    expect(await readFile(join(parent, "outside.txt"), "utf8")).toBe("outside evidence");
  });
});
