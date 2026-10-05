import { realpathSync } from "node:fs";
import { resolve } from "node:path";

import * as Effect from "effect/Effect";
import * as Argument from "effect/cli/Argument";
import * as Command from "effect/cli/Command";
import * as Flag from "effect/cli/Flag";

import { applyWorkflowEdits, readWorkflowEdits, type EditOutcome, type EditStatus } from "../../workflows/review";
import { loadSeoProjectConfig } from "../load-config";
import { jsonFlag, printJson, printText, SeoCliError } from "../output";

const runArgument = Argument.String("run").pipe(
  Argument.withDescription("Improve workflow run directory or run ID containing edits.json"),
);
const onlyFlag = Flag.String("only").pipe(
  Flag.withDescription("Edit ID to apply (repeatable or comma-separated; default: every edit)"),
  Flag.between(0, 256),
);
const checkFlag = Flag.Boolean("check").pipe(
  Flag.withDescription("Report which edits would apply without writing files"),
  Flag.withDefault(false),
);

/** Versioned `pagegraph apply --json` payload. */
export interface ApplyReport {
  readonly kind: "pagegraph-apply-report";
  readonly schemaVersion: 1;
  readonly run: string;
  readonly directory: string;
  readonly check: boolean;
  readonly edits: ReadonlyArray<EditOutcome>;
  readonly counts: Readonly<Record<EditStatus, number>>;
}

const symbols: Readonly<Record<EditStatus, string>> = { applied: "✓", applicable: "✓", stale: "✗", failed: "✗" };

const renderApplyReport = (report: ApplyReport): string => [
  ...report.edits.map((edit) => `${symbols[edit.status]} ${edit.id} ${edit.status} ${edit.path}${edit.reason === undefined ? "" : `: ${edit.reason}`}`),
  "",
  report.check
    ? `${report.counts.applicable} applicable, ${report.counts.stale} stale, ${report.counts.failed} failed (check only; no files changed)`
    : `${report.counts.applied} applied, ${report.counts.stale} stale, ${report.counts.failed} failed`,
].join("\n");

export const applyCommand = Command.make("apply", {
  run: runArgument,
  only: onlyFlag,
  check: checkFlag,
  json: jsonFlag,
}).pipe(
  Command.withDescription("Apply the edits an improve workflow recorded, refusing edits whose target text changed"),
  Command.withExamples([
    { command: "pagegraph apply <run-id> --check", description: "Report which recorded edits still apply" },
    { command: "pagegraph apply <run-id>", description: "Apply every recorded edit that still matches" },
    { command: "pagegraph apply .pagegraph/runs/<run-id> --only e1,e3", description: "Apply a subset of edits" },
  ]),
  Command.withHandler(
    Effect.fnUntraced(function* ({ run, only, check, json }) {
      const project = yield* loadSeoProjectConfig;
      const workflows = project.config.workflows;
      if (workflows === undefined) {
        return yield* new SeoCliError({ message: "pagegraph.config.ts has no workflows configuration; run `pagegraph init` and configure workflows." });
      }
      const runsDirectory = workflows.runsDirectory ?? ".pagegraph/runs";
      const loaded = yield* Effect.try({
        try: () => readWorkflowEdits(project.root, runsDirectory, run),
        catch: (cause) => new SeoCliError({ message: cause instanceof Error ? cause.message : String(cause) }),
      });
      const recordedRoot = yield* Effect.try({
        try: () => realpathSync(loaded.edits.root),
        catch: () => new SeoCliError({ message: `The run's recorded app root no longer exists: ${loaded.edits.root}` }),
      });
      if (recordedRoot !== realpathSync(project.root)) {
        return yield* new SeoCliError({ message: `Run ${loaded.edits.id} recorded edits for ${loaded.edits.root}; run apply from that app's pagegraph.config.ts directory.` });
      }
      const ids = only.flatMap((value) => value.split(",")).map((value) => value.trim()).filter((value) => value.length > 0);
      const unknown = ids.filter((id) => !loaded.edits.edits.some((edit) => edit.id === id));
      if (unknown.length > 0) {
        return yield* new SeoCliError({ message: `Unknown edit ID(s) for run ${loaded.edits.id}: ${unknown.join(", ")}. Recorded: ${loaded.edits.edits.map((edit) => edit.id).join(", ") || "none"}.` });
      }
      const selected = ids.length === 0 ? loaded.edits.edits : loaded.edits.edits.filter((edit) => ids.includes(edit.id));
      const outcomes = yield* Effect.tryPromise({
        try: () => applyWorkflowEdits(project.root, selected, {
          presetDirectory: resolve(project.root, workflows.agent.presetDirectory),
          runsDirectory: resolve(project.root, runsDirectory),
          check,
        }),
        catch: (cause) => new SeoCliError({ message: cause instanceof Error ? cause.message : String(cause) }),
      });
      const count = (status: EditStatus) => outcomes.filter((outcome) => outcome.status === status).length;
      const report: ApplyReport = {
        kind: "pagegraph-apply-report", schemaVersion: 1, run: loaded.edits.id, directory: loaded.directory, check, edits: outcomes,
        counts: { applied: count("applied"), applicable: count("applicable"), stale: count("stale"), failed: count("failed") },
      };
      if (json) yield* printJson(report);
      else yield* printText(selected.length === 0 ? `Run ${loaded.edits.id} recorded no edits.` : renderApplyReport(report));
      if (report.counts.stale + report.counts.failed > 0) {
        return yield* new SeoCliError({ message: `${report.counts.stale} stale and ${report.counts.failed} failed edit(s) were not applied; see the report above.` });
      }
    }),
  ),
);
