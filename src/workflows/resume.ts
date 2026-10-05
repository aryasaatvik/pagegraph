import { readFile, realpath } from "node:fs/promises";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { GitState } from "./git";
import { resolveRepositoryReadPath } from "./repository-paths";
import { inspectGit } from "./git";
import { decodeWorkflowFailure, decodeWorkflowProgress, decodeWorkflowRun } from "./resume-codecs";
import type { WorkflowFailureV2, WorkflowId, WorkflowProgressV2, WorkflowRunV2 } from "./model";

interface ArtifactIdentity {
  readonly id: string;
  readonly workflow: WorkflowId;
}

const readArtifact = <T extends ArtifactIdentity>(directory: string, filename: string, decode: (value: unknown) => T, workflow: WorkflowId): T | undefined => {
  const path = resolve(directory, filename);
  if (!existsSync(path)) return undefined;
  let value: T;
  try { value = decode(JSON.parse(readFileSync(path, "utf8"))); }
  catch (cause) { throw new Error(`Cannot resume ${path}: invalid or unsupported schema-version-2 artifact. ${cause instanceof Error ? cause.message : String(cause)}`, { cause }); }
  if (value.workflow !== workflow || value.id !== basename(directory)) {
    throw new Error(`Cannot resume ${path}: workflow or run ID differs from the requested ${workflow} run directory.`);
  }
  return value;
};

const assertProjectRoot = (root: string, recordedRoot: string, directory: string): void => {
  if (realpathSync(root) !== realpathSync(recordedRoot)) {
    throw new Error(`Cannot resume ${directory}: the recorded project root differs from this config directory.`);
  }
};

export const inspectWorkflowGit = (root: string, runDirectory: string): GitState => {
  const git = inspectGit(root);
  const canonicalRoot = realpathSync(root);
  let existing = runDirectory;
  while (!existsSync(existing)) existing = dirname(existing);
  const canonicalRun = resolve(realpathSync(existing), relative(existing, runDirectory));
  // Owned run artifacts are expected to change between checkpoints, including when they are not ignored by Git.
  const files = git.files.filter((path) => {
    const within = relative(canonicalRun, resolve(canonicalRoot, path));
    return within === ".." || within.startsWith(`..${sep}`) || isAbsolute(within);
  });
  return { ...git, files, dirty: files.length > 0, fingerprints: Object.fromEntries(files.map((path) => [path, git.fingerprints[path]!])) };
};

export interface ResumedWorkflow {
  readonly directory: string;
  readonly run?: WorkflowRunV2 | undefined;
  readonly progress?: WorkflowProgressV2 | undefined;
  readonly failure?: WorkflowFailureV2 | undefined;
}

const resumeDirectory = (root: string, runsDirectory: string, from: string): string =>
  isAbsolute(from) || from.includes("/") || from.includes("\\") ? resolve(root, from) : resolve(root, runsDirectory, from);

export const loadCompletedWorkflowRun = (root: string, runsDirectory: string, from: string, workflow: WorkflowId): { readonly directory: string; readonly run: WorkflowRunV2 } | undefined => {
  const directory = resumeDirectory(root, runsDirectory, from);
  const run = readArtifact(directory, "run.json", decodeWorkflowRun, workflow);
  if (run === undefined) return undefined;
  assertProjectRoot(root, run.project.root, directory);
  return { directory, run };
};

export const readRecordedWorkflowSources = async (
  repositoryRoot: string,
  sources: WorkflowProgressV2["evidence"]["sources"],
  runsDirectory: string,
): Promise<WorkflowProgressV2["evidence"]["sources"]> => {
  if (await realpath(repositoryRoot) !== repositoryRoot) {
    throw new Error("The recorded repository read root is no longer its original canonical directory.");
  }
  return Promise.all(sources.map(async ({ path }) => ({
    path, content: await readFile(await resolveRepositoryReadPath(repositoryRoot, path, { runsDirectory }), "utf8"),
  })));
};

export const loadWorkflowResume = async (root: string, runsDirectory: string, from: string, workflow: WorkflowId): Promise<ResumedWorkflow> => {
  const completed = loadCompletedWorkflowRun(root, runsDirectory, from, workflow);
  if (completed !== undefined) return completed;
  const directory = resumeDirectory(root, runsDirectory, from);
  const progress = readArtifact(directory, "progress.json", decodeWorkflowProgress, workflow);
  if (progress === undefined) {
    throw new Error(`Cannot resume ${directory}: no resumable progress.json is recorded. Completed run.json artifacts can also be reused.`);
  }
  assertProjectRoot(root, progress.project.root, directory);
  const failure = readArtifact(directory, "failure.json", decodeWorkflowFailure, workflow);
  if (progress.actionStarted === true && progress.action === undefined) {
    throw new Error(`Cannot resume ${directory}: its action started but did not record completion. Inspect repository edits before starting a new run; an interrupted action cannot be replayed safely.`);
  }
  if (progress.action !== undefined && (progress.actionStarted !== true || progress.research === undefined || progress.decisions === undefined)) {
    throw new Error(`Cannot resume ${directory}: action completion is missing its stage boundaries.`);
  }
  const checkpointGit = progress.action === undefined ? progress.git : progress.actionGit;
  if (checkpointGit === undefined) throw new Error(`Cannot resume ${directory}: action completion lacks its repository snapshot.`);
  const currentGit = inspectWorkflowGit(root, directory);
  if (checkpointGit.head !== currentGit.head
    || JSON.stringify(checkpointGit.fingerprints) !== JSON.stringify(currentGit.fingerprints)) {
    throw new Error(`Cannot resume ${directory}: repository HEAD or file contents changed since the recorded checkpoint. Restore the recorded source state or start a new run.`);
  }
  const expectedSources = progress.action === undefined ? progress.evidence.sources : progress.actionSources;
  if (expectedSources === undefined) throw new Error(`Cannot resume ${directory}: action completion lacks its context source snapshot.`);
  let currentSources: WorkflowProgressV2["evidence"]["sources"];
  try { currentSources = await readRecordedWorkflowSources(progress.repositoryRoot, expectedSources, dirname(directory)); }
  catch (cause) { throw new Error(`Cannot resume ${directory}: a recorded context source is unreadable or outside its original read bounds. ${cause instanceof Error ? cause.message : String(cause)}`, { cause }); }
  for (const [index, source] of expectedSources.entries()) {
    if (source.content !== currentSources[index]!.content) {
      throw new Error(`Cannot resume ${directory}: recorded context source changed since the checkpoint: ${source.path}. Restore the recorded context or start a new run.`);
    }
  }
  if (progress.research !== undefined) {
    assertProjectRoot(root, progress.research.project.root, directory);
    if (progress.research.workflow !== workflow || progress.research.id !== progress.id) {
      throw new Error(`Cannot resume ${directory}: research checkpoint differs from its progress artifact.`);
    }
  } else if (failure?.agent === undefined || failure.executor === undefined || failure.stage !== "research") {
    throw new Error(`Cannot resume ${directory}: its failed research did not record a Pi session and Executor evidence.`);
  }
  return { directory, progress, ...(failure === undefined ? {} : { failure }) };
};
