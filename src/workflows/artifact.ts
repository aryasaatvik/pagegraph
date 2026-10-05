import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import type { WorkflowFailureV2, WorkflowProgressV2, WorkflowResearchCheckpointV2, WorkflowRunV2 } from "./model";
import summaryTemplate from "./prompts/summary.md" with { type: "text" };
import { TextTemplate } from "./template";

export const createRunId = (
  date = new Date(),
  workflow = "workflow",
  nonce = randomUUID(),
): string =>
  `${date.toISOString().replaceAll(":", "-").replace(".", "-")}-${nonce.slice(0, 8)}-${workflow.replaceAll(".", "-")}`;

const resultSummary = (result: unknown): string => {
  if (result !== null && typeof result === "object") {
    const summary = (result as Record<string, unknown>)["summary"];
    if (typeof summary === "string") return summary;
  }
  return "Workflow completed; inspect run.json for the structured result.";
};

const summary = (run: WorkflowRunV2): string => {
  const counts = run.decisions[0]?.report.counts;
  return TextTemplate.from(summaryTemplate)
    .values({
      workflow: run.workflow,
      runId: run.id,
      model: `${run.model.provider}/${run.model.id}`,
      pages: run.targets.pages.length,
      decisions: counts?.inputs ?? 0,
      review: counts?.review ?? 0,
      executorSearches: run.evidence.executor.searches.length,
      executorCalls: run.evidence.executor.calls.length,
      changedFiles: run.changes.files.length,
      summary: resultSummary(run.result),
    })
    .render();
};

export const writeRunBundle = (
  root: string,
  runsDirectory: string,
  run: WorkflowRunV2,
): string => {
  const directory = resolve(root, runsDirectory, run.id);
  mkdirSync(directory, { recursive: true });
  writeFileSync(resolve(directory, "run.json"), `${JSON.stringify(run, null, 2)}\n`, "utf8");
  writeFileSync(resolve(directory, "summary.md"), summary(run), "utf8");
  return directory;
};

export const writeResearchCheckpoint = (
  root: string,
  runsDirectory: string,
  checkpoint: WorkflowResearchCheckpointV2,
): string => {
  const directory = resolve(root, runsDirectory, checkpoint.id);
  mkdirSync(directory, { recursive: true });
  const path = resolve(directory, "research.json");
  writeFileSync(path, `${JSON.stringify(checkpoint, null, 2)}\n`, "utf8");
  return path;
};

export const writeWorkflowFailure = (
  root: string,
  runsDirectory: string,
  id: string,
  details: WorkflowFailureV2,
): string => {
  const directory = resolve(root, runsDirectory, id);
  mkdirSync(directory, { recursive: true });
  const path = resolve(directory, "failure.json");
  writeFileSync(path, `${JSON.stringify(details, null, 2)}\n`, "utf8");
  return path;
};

export const serializeCause = (value: unknown, top = true, seen = new Set<unknown>()): unknown => {
  if (seen.has(value)) return { name: "CircularCause", message: "Circular error cause" };
  if (value !== null && typeof value === "object") {
    seen.add(value);
    const message = value instanceof Error ? value.message : "message" in value ? String(value.message) : JSON.stringify(value);
    const name = value instanceof Error ? value.name : "name" in value ? String(value.name) : "Error";
    return {
      message, name,
      ...(top && value instanceof Error ? { stack: value.stack } : {}),
      ...("cause" in value ? { cause: serializeCause(value.cause, false, seen) } : {}),
      ...(value instanceof AggregateError ? { errors: value.errors.map((error) => serializeCause(error, false, new Set(seen))) } : {}),
    };
  }
  return { name: "Error", message: String(value) };
};

export const writeWorkflowProgress = (
  root: string,
  runsDirectory: string,
  progress: WorkflowProgressV2,
): string => {
  const directory = resolve(root, runsDirectory, progress.id);
  mkdirSync(directory, { recursive: true });
  const path = resolve(directory, "progress.json");
  writeFileSync(path, `${JSON.stringify(progress, null, 2)}\n`, "utf8");
  return path;
};
