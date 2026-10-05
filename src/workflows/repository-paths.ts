import { execFile } from "node:child_process";
import { lstat, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

export interface RepositoryReadOptions {
  readonly runsDirectory?: string;
}

export const resolveWorkflowRepositoryRoot = async (appRoot: string, configuredRoot?: string): Promise<string> => {
  const root = await realpath(appRoot);
  if (configuredRoot !== undefined) return realpath(resolve(root, configuredRoot));
  try {
    const { stdout } = await promisify(execFile)("git", ["rev-parse", "--show-toplevel"], { cwd: root });
    return await realpath(stdout.trim());
  } catch {
    return root;
  }
};

const missingPath = (cause: unknown): boolean => cause instanceof Error && "code" in cause && cause.code === "ENOENT";

// Missing leaves retain the real target of their existing ancestor; dangling symlinks are rejected.
export const resolveWritablePath = async (path: string): Promise<string> => {
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

export const insideRoot = (root: string, path: string): boolean => {
  const pathFromRoot = relative(root, path);
  return pathFromRoot !== ".." && !pathFromRoot.startsWith(`..${sep}`) && !isAbsolute(pathFromRoot);
};

export const resolveRepositoryReadPath = async (root: string, path: string, options: RepositoryReadOptions = {}): Promise<string> => {
  const projectRoot = await realpath(root);
  const requested = resolve(projectRoot, path);
  const allowedRoots = [{ requested: resolve(root), actual: projectRoot }];
  if (options.runsDirectory !== undefined) {
    const runsDirectory = resolve(options.runsDirectory);
    // Runs are created after context collection; the existing ancestor still determines the real bound.
    allowedRoots.push({ requested: runsDirectory, actual: await resolveWritablePath(runsDirectory) });
  }
  const matchingRoots = allowedRoots.filter((allowed) => insideRoot(allowed.requested, requested) || insideRoot(allowed.actual, requested));
  if (matchingRoots.length === 0) {
    throw new Error(`Repository path escapes project root: ${path}`);
  }
  const resolved = await realpath(requested);
  if (!matchingRoots.some((allowed) => insideRoot(allowed.actual, resolved))) {
    throw new Error(`Repository path escapes project root through a symlink: ${path}`);
  }
  return resolved;
};

/** Directories, relative to the app root or absolute, that workflow edits must never write. */
export interface RepositoryWriteOptions {
  readonly presetDirectory: string;
  readonly runsDirectory: string;
}

/** Resolve an edit target inside the app root, rejecting escapes, protected directories, and hard links. */
export const resolveWorkflowWritePath = async (root: string, path: string, options: RepositoryWriteOptions): Promise<string> => {
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
    if (missingPath(error)) return undefined;
    throw error;
  });
  if (existing !== undefined && existing.nlink > 1) throw new Error(`Repository write targets a hard-linked file: ${path}`);
  return resolved;
};
