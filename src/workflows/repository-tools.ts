import { open, readdir, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import type { AgentOptions, AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";

const MAX_FILE_BYTES = 64 * 1024;
const MAX_ENTRIES = 500;
const MAX_MATCHES = 200;
const MAX_OUTPUT_CHARACTERS = 32 * 1024;
const repositoryToolNames = new Set(["read_file", "list_files", "search_text"]);

const insideRoot = (root: string, path: string): boolean => {
  const pathFromRoot = relative(root, path);
  return pathFromRoot !== ".." && !pathFromRoot.startsWith(`..${sep}`) && !isAbsolute(pathFromRoot);
};

const repositoryPath = async (root: string, path: string): Promise<string> => {
  const projectRoot = await realpath(root);
  const requested = resolve(projectRoot, path);
  if (!insideRoot(projectRoot, requested) && !insideRoot(resolve(root), requested)) {
    throw new Error(`Repository path escapes project root: ${path}`);
  }
  const resolved = await realpath(requested);
  if (!insideRoot(projectRoot, resolved)) throw new Error(`Repository path escapes project root through a symlink: ${path}`);
  return resolved;
};

const pathArgument = (args: unknown): string => {
  if (typeof args !== "object" || args === null || !("path" in args) || typeof args.path !== "string") {
    throw new Error("Repository tools require a string path");
  }
  return args.path;
};

export const guardRepositoryToolCall = (root: string): AgentOptions["beforeToolCall"] => async ({ toolCall, args }, signal) => {
  if (!repositoryToolNames.has(toolCall.name)) return undefined;
  try {
    signal?.throwIfAborted();
    await repositoryPath(root, pathArgument(args));
    return undefined;
  } catch (error) {
    return { block: true, reason: error instanceof Error ? error.message : String(error) };
  }
};

const readBoundedFile = async (path: string, signal?: AbortSignal): Promise<string> => {
  signal?.throwIfAborted();
  const file = await open(path, "r");
  try {
    if (!(await file.stat()).isFile()) throw new Error(`Repository path is not a regular file: ${path}`);
    const buffer = Buffer.alloc(MAX_FILE_BYTES + 1);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    signal?.throwIfAborted();
    return buffer.subarray(0, Math.min(bytesRead, MAX_FILE_BYTES)).toString("utf8") +
      (bytesRead > MAX_FILE_BYTES ? "\n[File truncated at 64 KiB]" : "");
  } finally {
    await file.close();
  }
};

const result = (text: string) => ({ content: [{ type: "text" as const, text }], details: undefined });

// Symlinks are never traversed during discovery; explicit reads still validate their real target.
const discoverFiles = async (root: string, directory: string, recursive: boolean, signal?: AbortSignal): Promise<Array<string>> => {
  const files: Array<string> = [];
  const pending = [directory];
  let inspected = 0;
  while (pending.length > 0 && inspected < MAX_ENTRIES) {
    signal?.throwIfAborted();
    const next = pending.shift()!;
    const entries = (await readdir(await repositoryPath(root, next), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (++inspected > MAX_ENTRIES) break;
      const path = resolve(next, entry.name);
      if (entry.isFile()) files.push(path);
      else if (entry.isDirectory() && recursive && entry.name !== ".git" && entry.name !== "node_modules") pending.push(path);
    }
  }
  return files;
};

export const createRepositoryTools = (root: string): AgentTool[] => [
  {
    name: "read_file",
    label: "Read repository file",
    description: "Read a UTF-8 file within the project root, limited to 64 KiB.",
    parameters: Type.Object({ path: Type.String() }),
    execute: async (_id, args, signal) => result(await readBoundedFile(await repositoryPath(root, pathArgument(args)), signal)),
  },
  {
    name: "list_files",
    label: "List repository files",
    description: "List files within a project directory, inspecting at most 500 entries. Symlinks are skipped.",
    parameters: Type.Object({ path: Type.String(), recursive: Type.Optional(Type.Boolean()) }),
    execute: async (_id, args, signal) => {
      const path = pathArgument(args);
      const recursive = typeof args === "object" && args !== null && "recursive" in args ? args.recursive : false;
      if (typeof recursive !== "boolean") throw new Error("list_files recursive must be a boolean");
      const projectRoot = await realpath(root);
      const directory = await repositoryPath(root, path);
      const files = await discoverFiles(root, directory, recursive, signal);
      return result(files.map((file) => relative(projectRoot, file)).join("\n").slice(0, MAX_OUTPUT_CHARACTERS));
    },
  },
  {
    name: "search_text",
    label: "Search repository text",
    description: "Find literal text in project files, inspecting at most 500 entries and 64 KiB per file, with at most 200 matches.",
    parameters: Type.Object({ path: Type.String(), text: Type.String({ minLength: 1 }) }),
    execute: async (_id, args, signal) => {
      const path = pathArgument(args);
      const text = typeof args === "object" && args !== null && "text" in args ? args.text : undefined;
      if (typeof text !== "string" || text.length === 0) throw new Error("search_text requires nonempty literal text");
      const projectRoot = await realpath(root);
      const directory = await repositoryPath(root, path);
      const files = await discoverFiles(root, directory, true, signal);
      const matches: Array<string> = [];
      for (const file of files) {
        const content = await readBoundedFile(await repositoryPath(root, file), signal);
        if (content.includes("\0")) continue;
        for (const [index, line] of content.split("\n").entries()) {
          if (line.includes(text)) matches.push(`${relative(projectRoot, file)}:${index + 1}:${line}`);
          if (matches.length >= MAX_MATCHES) break;
        }
        if (matches.length >= MAX_MATCHES) break;
      }
      return result(matches.join("\n").slice(0, MAX_OUTPUT_CHARACTERS));
    },
  },
];
