import { lstat, mkdir, open, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

import type { AgentOptions, AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";

const MAX_FILE_BYTES = 64 * 1024;
const MAX_ENTRIES = 500;
const MAX_MATCHES = 200;
const MAX_OUTPUT_CHARACTERS = 32 * 1024;
const repositoryToolNames = new Set(["read_file", "list_files", "search_text"]);
const writeToolNames = new Set(["write_file", "edit_file"]);

export interface RepositoryWriteOptions {
  readonly presetDirectory: string;
  readonly runsDirectory: string;
}

const missingPath = (cause: unknown): boolean => cause instanceof Error && "code" in cause && cause.code === "ENOENT";

// Missing leaves retain the real target of their existing ancestor; dangling symlinks are rejected.
const resolveWritablePath = async (path: string): Promise<string> => {
  let ancestor = path;
  const suffix: string[] = [];
  while (true) {
    try { return resolve(await realpath(ancestor), ...suffix); }
    catch (cause) {
      if (!missingPath(cause)) throw cause;
      try {
        if ((await lstat(ancestor)).isSymbolicLink()) throw new Error(`Repository path has a dangling symlink: ${path}`);
      } catch (statCause) { if (!missingPath(statCause)) throw statCause; }
      const parent = dirname(ancestor);
      if (parent === ancestor) throw cause;
      suffix.unshift(relative(parent, ancestor));
      ancestor = parent;
    }
  }
};

const writableRepositoryPath = async (root: string, path: string, options: RepositoryWriteOptions): Promise<string> => {
  const projectRoot = await realpath(root);
  const requested = resolve(projectRoot, path);
  if (!insideRoot(projectRoot, requested)) throw new Error(`Repository path escapes project root: ${path}`);
  const resolved = await resolveWritablePath(requested);
  if (!insideRoot(projectRoot, resolved)) throw new Error(`Repository path escapes project root through a symlink: ${path}`);
  if ([requested, resolved].some((target) => relative(projectRoot, target).split(sep).some((part) => part === ".git" || part === "node_modules"))) {
    throw new Error(`Repository write targets a protected directory: ${path}`);
  }
  const forbidden = [resolve(projectRoot, ".git"), resolve(projectRoot, "node_modules"),
    resolve(projectRoot, options.runsDirectory), resolve(projectRoot, options.presetDirectory)];
  for (const directory of forbidden) {
    const actual = await resolveWritablePath(directory);
    if (insideRoot(directory, requested) || insideRoot(actual, resolved)) throw new Error(`Repository write targets a protected directory: ${path}`);
  }
  // A hard link passes the path checks but writing through it changes every linked copy, which may live outside the project.
  const existing = await lstat(resolved).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  });
  if (existing !== undefined && existing.nlink > 1) throw new Error(`Repository write targets a hard-linked file: ${path}`);
  return resolved;
};

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

export const guardRepositoryToolCall = (root: string, writeOptions?: RepositoryWriteOptions): AgentOptions["beforeToolCall"] => async ({ toolCall, args }, signal) => {
  if (!repositoryToolNames.has(toolCall.name) && !writeToolNames.has(toolCall.name)) return undefined;
  try {
    signal?.throwIfAborted();
    if (writeToolNames.has(toolCall.name)) {
      if (!writeOptions) throw new Error("Repository writes are unavailable in this workflow phase");
      await writableRepositoryPath(root, pathArgument(args), writeOptions);
    } else await repositoryPath(root, pathArgument(args));
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

const stringArgument = (args: unknown, key: string): string => {
  if (typeof args !== "object" || args === null || !(key in args) || typeof Reflect.get(args, key) !== "string") {
    throw new Error(`Repository tools require a string ${key}`);
  }
  return Reflect.get(args, key);
};

export const createRepositoryWriteTools = (root: string, options: RepositoryWriteOptions): AgentTool[] => [
  {
    name: "write_file", label: "Write repository file",
    description: "Create or overwrite a UTF-8 repository file. Protected directories and symlink escapes are blocked.",
    parameters: Type.Object({ path: Type.String(), content: Type.String() }),
    execute: async (_id, args, signal) => {
      signal?.throwIfAborted();
      const requested = pathArgument(args);
      const path = await writableRepositoryPath(root, requested, options);
      await mkdir(dirname(path), { recursive: true });
      signal?.throwIfAborted();
      await writeFile(await writableRepositoryPath(root, pathArgument(args), options), stringArgument(args, "content"), "utf8");
      return result(`Wrote ${pathArgument(args)}`);
    },
  },
  {
    name: "edit_file", label: "Edit repository file",
    description: "Replace exact text in a UTF-8 repository file. oldText must match exactly one region; protected directories and symlink escapes are blocked.",
    parameters: Type.Object({ path: Type.String(), oldText: Type.String({ minLength: 1 }), newText: Type.String() }),
    execute: async (_id, args, signal) => {
      signal?.throwIfAborted();
      const oldText = stringArgument(args, "oldText");
      const newText = stringArgument(args, "newText");
      if (oldText.length === 0) throw new Error("edit_file oldText must be nonempty");
      const requested = pathArgument(args);
      const path = await writableRepositoryPath(root, requested, options);
      const content = await readFile(path, "utf8");
      const index = content.indexOf(oldText);
      if (index < 0 || content.indexOf(oldText, index + 1) >= 0) throw new Error("edit_file oldText must match exactly once");
      signal?.throwIfAborted();
      await writeFile(await writableRepositoryPath(root, pathArgument(args), options), content.slice(0, index) + newText + content.slice(index + oldText.length), "utf8");
      return result(`Edited ${pathArgument(args)}`);
    },
  },
];
