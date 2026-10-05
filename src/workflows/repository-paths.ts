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
