import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

import * as Schema from "effect/Schema";

import type { DecisionBatchReport } from "../decide/record";
import type { WorkflowId } from "./model";
import { writeJsonArtifact } from "./artifact";
import { insideRoot, resolveWorkflowWritePath, type RepositoryWriteOptions } from "./repository-paths";

/**
 * One source change. `oldText` is copied exactly from the current file and must match once;
 * omitting it creates `path`, which must not exist yet.
 */
export const WorkflowEdit = Schema.Struct({
  path: Schema.String,
  oldText: Schema.optional(Schema.NonEmptyString),
  newText: Schema.String,
  reason: Schema.String,
  evidence: Schema.Array(Schema.String),
});
export type WorkflowEdit = Schema.Schema.Type<typeof WorkflowEdit>;

/** A recommendation a human must handle because the agent cannot or should not edit it. */
export const WorkflowReviewItem = Schema.Struct({
  path: Schema.String,
  reason: Schema.String,
  evidence: Schema.Array(Schema.String),
});
export type WorkflowReviewItem = Schema.Schema.Type<typeof WorkflowReviewItem>;

/** The structured result an improve workflow's action turn submits. */
export const ActionState = Schema.Struct({
  summary: Schema.String,
  edits: Schema.Array(WorkflowEdit),
  reviewItems: Schema.Array(WorkflowReviewItem),
});
export type ActionState = Schema.Schema.Type<typeof ActionState>;
export const decodeActionState = Schema.decodeUnknownSync(ActionState, { errors: "all" });
const actionDocument = Schema.toJsonSchemaDocument(ActionState);
export const actionStateJsonSchema = { ...actionDocument.schema, $defs: actionDocument.definitions };

const RecordedEdit = Schema.Struct({ id: Schema.String, ...WorkflowEdit.fields });
const RecordedReviewItem = Schema.Struct({ source: Schema.Literals(["agent", "decision"]), ...WorkflowReviewItem.fields });

/** `<run>/edits.json`: the reviewable, applicable record of an improve workflow's action. */
export const WorkflowEditsV1 = Schema.Struct({
  kind: Schema.Literal("pagegraph-workflow-edits"),
  schemaVersion: Schema.Literal(1),
  id: Schema.String,
  workflow: Schema.String,
  /** `write` runs applied these edits before recording them; `dry-run` runs left sources untouched. */
  mode: Schema.Literals(["write", "dry-run"]),
  /** The app root containing `pagegraph.config.ts`; edit paths are relative to it. */
  root: Schema.String,
  summary: Schema.String,
  edits: Schema.Array(RecordedEdit),
  reviewItems: Schema.Array(RecordedReviewItem),
});
export type WorkflowEditsV1 = Schema.Schema.Type<typeof WorkflowEditsV1>;
export type RecordedEdit = WorkflowEditsV1["edits"][number];
const decodeWorkflowEdits = Schema.decodeUnknownSync(WorkflowEditsV1, { errors: "all" });

/**
 * Re-express agent edit paths relative to the app root. Agents read through the repository read
 * root, so they submit paths in that frame; edits.json and `pagegraph apply` use the app root.
 */
export const normalizeEditPaths = (state: ActionState, readRoot: string, root: string): ActionState => {
  const repositoryRoot = realpathSync(readRoot);
  const appRoot = realpathSync(root);
  return { ...state, edits: state.edits.map((edit) => {
    const absolute = resolve(repositoryRoot, edit.path);
    if (!insideRoot(appRoot, absolute)) {
      throw new Error(`Edit path is outside the app root ${relative(repositoryRoot, appRoot) || "."}: ${edit.path}`);
    }
    return { ...edit, path: relative(appRoot, absolute) };
  }) };
};

const answerSummary = (answers: unknown): ReadonlyArray<string> => {
  if (answers === null || typeof answers !== "object") return [];
  return Object.entries(answers).map(([name, answer]) => {
    if (answer !== null && typeof answer === "object") {
      const value = answer as { readonly probability?: unknown; readonly label?: unknown; readonly probabilities?: unknown };
      if (typeof value.probability === "number") return `${name}: ${value.probability.toFixed(2)}`;
      if (typeof value.label === "string") {
        const probability = value.probabilities !== null && typeof value.probabilities === "object"
          ? (value.probabilities as Record<string, unknown>)[value.label] : undefined;
        return `${name}: ${value.label}${typeof probability === "number" ? ` (${probability.toFixed(2)})` : ""}`;
      }
    }
    return `${name}: ${JSON.stringify(answer)}`;
  });
};

/** The researched proposal a review decision judged, so a reviewer can act without opening research.json. */
const decisionProposal = (decisionId: string, inputs: ReadonlyArray<unknown>): ReadonlyArray<string> => {
  const match = /:(\d+)$/.exec(decisionId);
  const proposal = match === null ? undefined : inputs[Number(match[1])];
  return proposal === undefined ? [] : [`proposal: ${JSON.stringify(proposal)}`];
};

export const workflowEditsArtifact = (input: {
  readonly id: string;
  readonly workflow: WorkflowId;
  readonly mode: "write" | "dry-run";
  readonly root: string;
  readonly action: ActionState;
  readonly decisions: DecisionBatchReport;
  /** Research decision inputs, indexed by the `<family>:<index>` decision ID. */
  readonly decisionInputs: ReadonlyArray<unknown>;
}): WorkflowEditsV1 => ({
  kind: "pagegraph-workflow-edits",
  schemaVersion: 1,
  id: input.id,
  workflow: input.workflow,
  mode: input.mode,
  root: input.root,
  summary: input.action.summary,
  edits: input.action.edits.map((edit, index) => ({ id: `e${index + 1}`, ...edit })),
  reviewItems: [
    ...input.action.reviewItems.map((item) => ({ source: "agent" as const, ...item })),
    ...input.decisions.review.map((record) => ({
      source: "decision" as const,
      path: record.inputRef,
      reason: `Jev returned ${record.verdict} for ${record.decisionId} at threshold ${record.threshold}; a human decides whether to change it.`,
      evidence: [...decisionProposal(record.decisionId, input.decisionInputs), ...answerSummary(record.answers)],
    })),
  ],
});

const fenceFor = (text: string): string => {
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((match) => match[0].length));
  return "`".repeat(longest + 1);
};

const prefixed = (prefix: string, text: string): string =>
  text.split("\n").map((line) => `${prefix}${line}`).join("\n");

const evidenceList = (evidence: ReadonlyArray<string>): string =>
  evidence.length === 0 ? "Evidence: none recorded." : `Evidence:\n\n${evidence.map((item) => `- ${item}`).join("\n")}`;

export const renderReview = (edits: WorkflowEditsV1, runDirectory: string): string => {
  const body = edits.edits.map((edit) => {
    const diff = edit.oldText === undefined ? prefixed("+ ", edit.newText) : `${prefixed("- ", edit.oldText)}\n${prefixed("+ ", edit.newText)}`;
    const fence = fenceFor(diff);
    return [
      `### ${edit.id} · \`${edit.path}\`${edit.oldText === undefined ? " (new file)" : ""}`,
      edit.reason,
      evidenceList(edit.evidence),
      `${fence}diff\n${diff}\n${fence}`,
    ].join("\n\n");
  });
  const review = edits.reviewItems.map((item) => [
    `### \`${item.path}\` (${item.source})`, item.reason, evidenceList(item.evidence),
  ].join("\n\n"));
  return [
    `# PageGraph ${edits.workflow} review`,
    [
      `- Run: \`${edits.id}\``,
      `- Mode: ${edits.mode === "write" ? "write (PageGraph applies these edits during the run)" : "dry-run (source files are unchanged)"}`,
      `- Edits: ${edits.edits.length}`,
      `- Review items: ${edits.reviewItems.length}`,
    ].join("\n"),
    edits.summary,
    `## Edits\n\n${body.length === 0 ? "No edits." : body.join("\n\n")}`,
    `## Review items\n\n${review.length === 0 ? "No review items." : review.join("\n\n")}`,
    ...(edits.mode === "dry-run" && edits.edits.length > 0 ? [[
      "## Apply",
      "Check and apply from the directory containing `pagegraph.config.ts`. Edits whose target text changed are refused as stale.",
      ["```sh", `pagegraph apply ${runDirectory} --check`, `pagegraph apply ${runDirectory}`, `pagegraph apply ${runDirectory} --only e1`, "```"].join("\n"),
    ].join("\n\n")] : []),
  ].join("\n\n") + "\n";
};

/** Write `edits.json` and `review.md` into the run directory. */
export const writeWorkflowEdits = (runDirectory: string, edits: WorkflowEditsV1): string => {
  mkdirSync(runDirectory, { recursive: true });
  const path = resolve(runDirectory, "edits.json");
  writeJsonArtifact(path, edits);
  writeFileSync(resolve(runDirectory, "review.md"), renderReview(edits, runDirectory), "utf8");
  return path;
};

/** Resolve `<run-dir|run-id>` the same way `--from` does and decode its `edits.json`. */
export const readWorkflowEdits = (root: string, runsDirectory: string, run: string): { readonly directory: string; readonly edits: WorkflowEditsV1 } => {
  const directory = isAbsolute(run) || run.includes("/") || run.includes("\\") ? resolve(root, run) : resolve(root, runsDirectory, run);
  const path = resolve(directory, "edits.json");
  if (!existsSync(path)) throw new Error(`No edits.json in ${directory}; only completed improve workflow runs record edits.`);
  try {
    return { directory, edits: decodeWorkflowEdits(JSON.parse(readFileSync(path, "utf8"))) };
  } catch (cause) {
    throw new Error(`Invalid edits artifact ${path}: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
  }
};

export type EditStatus = "applied" | "applicable" | "stale" | "failed";

export interface EditOutcome {
  readonly id: string;
  readonly path: string;
  readonly status: EditStatus;
  readonly reason?: string | undefined;
}

const occurrences = (content: string, text: string): number => {
  let count = 0;
  // Overlapping matches count: "---" occurs twice in "----", so that target is ambiguous.
  for (let index = content.indexOf(text); index >= 0; index = content.indexOf(text, index + 1)) count++;
  return count;
};

const readOptional = async (path: string): Promise<string | undefined> => {
  try { return await readFile(path, "utf8"); }
  catch (cause) {
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") return undefined;
    throw cause;
  }
};

/**
 * Apply edits in order against current files. Each edit is checked independently: a target that
 * no longer matches exactly once (or a new file that now exists) is `stale` and skipped; a path the
 * write policy refuses or an I/O error is `failed`. `check` reports `applicable` without writing.
 */
export const applyWorkflowEdits = async (
  root: string,
  edits: ReadonlyArray<Pick<RecordedEdit, "id" | "path" | "oldText" | "newText">>,
  options: RepositoryWriteOptions & { readonly check: boolean },
): Promise<ReadonlyArray<EditOutcome>> => {
  const outcomes = new Map<string, EditOutcome>();
  const fail = (edit: (typeof edits)[number], cause: unknown) =>
    outcomes.set(edit.id, { id: edit.id, path: edit.path, status: "failed", reason: cause instanceof Error ? cause.message : String(cause) });
  // Group by resolved file so every name of one file (for example an allowed symlink) shares one simulation.
  const byTarget = new Map<string, Array<(typeof edits)[number]>>();
  for (const edit of edits) {
    try {
      const target = await resolveWorkflowWritePath(root, edit.path, options);
      byTarget.set(target, [...(byTarget.get(target) ?? []), edit]);
    } catch (cause) { fail(edit, cause); }
  }
  for (const [target, targetEdits] of byTarget) {
    let content: string | undefined;
    try { content = await readOptional(target); }
    catch (cause) { for (const edit of targetEdits) fail(edit, cause); continue; }
    const matched: Array<(typeof edits)[number]> = [];
    for (const edit of targetEdits) {
      const stale = (reason: string) => outcomes.set(edit.id, { id: edit.id, path: edit.path, status: "stale", reason });
      if (edit.oldText === undefined) {
        if (content !== undefined) { stale("file already exists"); continue; }
        content = edit.newText;
      } else {
        if (content === undefined) { stale("file not found"); continue; }
        const count = occurrences(content, edit.oldText);
        if (count !== 1) { stale(count === 0 ? "target text not found" : `target text matches ${count} times`); continue; }
        const index = content.indexOf(edit.oldText);
        content = content.slice(0, index) + edit.newText + content.slice(index + edit.oldText.length);
      }
      matched.push(edit);
    }
    if (matched.length === 0) continue;
    if (!options.check) {
      try {
        await mkdir(dirname(target), { recursive: true });
        // Re-resolve after creating parents so a directory swapped for a symlink is still refused.
        const writable = await resolveWorkflowWritePath(root, matched[0]!.path, options);
        if (writable !== target) throw new Error(`Repository path changed while applying: ${matched[0]!.path}`);
        await writeFile(writable, content!, "utf8");
      } catch (cause) {
        for (const edit of matched) fail(edit, cause);
        continue;
      }
    }
    for (const edit of matched) outcomes.set(edit.id, { id: edit.id, path: edit.path, status: options.check ? "applicable" : "applied" });
  }
  return edits.map((edit) => outcomes.get(edit.id)!);
};
