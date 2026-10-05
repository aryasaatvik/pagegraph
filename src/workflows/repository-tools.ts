import { open, readdir, realpath } from "node:fs/promises";
import { relative, resolve } from "node:path";

import type { AgentOptions, AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";

import { resolveRepositoryReadPath, type RepositoryReadOptions } from "./repository-paths";

const MAX_FILE_BYTES = 64 * 1024;
const MAX_ENTRIES = 500;
const MAX_MATCHES = 200;
const MAX_OUTPUT_CHARACTERS = 32 * 1024;
const repositoryToolNames = new Set(["read_file", "list_files", "search_text"]);

const pathArgument = (args: unknown): string => {
  if (typeof args !== "object" || args === null || !("path" in args) || typeof args.path !== "string") {
    throw new Error("Repository tools require a string path");
  }
  return args.path;
};

export const guardRepositoryToolCall = (
  root: string,
  readOptions?: RepositoryReadOptions & { readonly repositoryRoot: string },
): AgentOptions["beforeToolCall"] => async ({ toolCall, args }, signal) => {
  if (!repositoryToolNames.has(toolCall.name)) return undefined;
  try {
    signal?.throwIfAborted();
    await resolveRepositoryReadPath(readOptions?.repositoryRoot ?? root, pathArgument(args), readOptions);
    return undefined;
  } catch (error) {
    return { block: true, reason: error instanceof Error ? error.message : String(error) };
  }
};

const readBoundedFile = async (path: string, signal?: AbortSignal, offset = 0, maxBytes = MAX_FILE_BYTES): Promise<string> => {
  signal?.throwIfAborted();
  const file = await open(path, "r");
  try {
    if (!(await file.stat()).isFile()) throw new Error(`Repository path is not a regular file: ${path}`);
    const buffer = Buffer.alloc(maxBytes + 1);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, offset);
    signal?.throwIfAborted();
    let consumed = Math.min(bytesRead, maxBytes);
    // Keep a UTF-8 character together so concatenating byte pages reproduces the original text.
    if (bytesRead > maxBytes) {
      while (consumed > 0 && (buffer[consumed] & 0xc0) === 0x80) consumed--;
      if (consumed === 0) throw new Error("read_file maxBytes cannot fit the next UTF-8 character; increase maxBytes");
    }
    return buffer.subarray(0, consumed).toString("utf8") +
      (bytesRead > maxBytes ? `\n[File truncated; continue with read_file offset=${offset + consumed}]` : "");
  } finally {
    await file.close();
  }
};

const result = (text: string) => ({ content: [{ type: "text" as const, text }], details: undefined });

// Symlinks are never traversed during discovery; explicit reads still validate their real target.
const discoverFiles = async (root: string, directory: string, recursive: boolean, signal?: AbortSignal, options?: RepositoryReadOptions): Promise<Array<string>> => {
  const files: Array<string> = [];
  const pending = [directory];
  let inspected = 0;
  while (pending.length > 0 && inspected < MAX_ENTRIES) {
    signal?.throwIfAborted();
    const next = pending.shift()!;
    const entries = (await readdir(await resolveRepositoryReadPath(root, next, options), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (++inspected > MAX_ENTRIES) break;
      const path = resolve(next, entry.name);
      if (entry.isFile()) files.push(path);
      else if (entry.isDirectory() && recursive && entry.name !== ".git" && entry.name !== "node_modules") pending.push(path);
    }
  }
  return files;
};

const byteArgument = (args: unknown, key: string, fallback: number, minimum: number, maximum: number): number => {
  const value = typeof args === "object" && args !== null ? Reflect.get(args, key) : undefined;
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`read_file ${key} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
};

export const createRepositoryTools = (root: string, options: RepositoryReadOptions = {}): AgentTool[] => [
  {
    name: "read_file",
    label: "Read repository file",
    description: "Read a UTF-8 repository or run-artifact file. offset is a byte offset (default 0); maxBytes is at most 65536. A truncated page tells you the next offset.",
    parameters: Type.Object({ path: Type.String(), offset: Type.Optional(Type.Integer({ minimum: 0 })),
      maxBytes: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_FILE_BYTES })) }),
    execute: async (_id, args, signal) => result(await readBoundedFile(
      await resolveRepositoryReadPath(root, pathArgument(args), options), signal,
      byteArgument(args, "offset", 0, 0, Number.MAX_SAFE_INTEGER), byteArgument(args, "maxBytes", MAX_FILE_BYTES, 1, MAX_FILE_BYTES),
    )),
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
      const directory = await resolveRepositoryReadPath(root, path, options);
      const files = await discoverFiles(root, directory, recursive, signal, options);
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
      const directory = await resolveRepositoryReadPath(root, path, options);
      const files = await discoverFiles(root, directory, true, signal, options);
      const matches: Array<string> = [];
      for (const file of files) {
        const content = await readBoundedFile(await resolveRepositoryReadPath(root, file, options), signal);
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
