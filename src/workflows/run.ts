import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { LinksSuggestionReport } from "../core/link-suggestions";

import { TypeSafeClient, TypeSafeDecisionModel } from "@effect/ai-typesafe";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import * as FetchHttpClient from "effect/http/FetchHttpClient";

import type { SeoCliConfig, SiteRuntime } from "../config";
import { allowedByRobots, robotsRules } from "../audit/crawl";
import { probeHttp } from "../audit/scanners/http";
import type { SeoGraph } from "../core/graph";
import { decodeLinksSuggestionReport, extractPageSentences } from "../core/link-suggestions";
import type { DecisionBatchReport } from "../decide/record";
import { serializeCause, createRunId, writeResearchCheckpoint, writeWorkflowFailure, writeRunBundle, writeWorkflowProgress } from "./artifact";
import { getWorkflowSpec } from "./catalog";
import { collectWorkflowEvidence, selectGraph } from "./evidence";
import { changedFiles } from "./git";
import type { WorkflowMutationPolicy } from "./mutation";
import { createWorkflowMutationPolicy } from "./mutation";
import type { WorkflowId, WorkflowResearchCheckpointV2, WorkflowRunV2, WorkflowTargetOptions } from "./model";
import actionPromptSource from "./prompts/action.md" with { type: "text" };
import researchPromptSource from "./prompts/research.md" with { type: "text" };
import type { AnyWorkflowSpec } from "./specs/types";
import { decodeResearchState } from "./state";
import type { WorkflowRunner, RunnerResult } from "./runner";
import type { ExecutorToolset } from "./executor";
import type { WorkflowAgentArtifact } from "./model";
import { inspectWorkflowGit, loadWorkflowResume } from "./resume";
import { resolveWorkflowRepositoryRoot } from "./repository-paths";
import { TextTemplate } from "./template";

export { dropNulls } from "./state";

export interface WorkflowInput {
  readonly config: SeoCliConfig;
  readonly graph: SeoGraph;
  readonly site: SiteRuntime;
  readonly root: string;
  readonly workflow: WorkflowId;
  readonly options: WorkflowTargetOptions;
  readonly model?: string | undefined;
  readonly out?: string | undefined;
  readonly from?: string | undefined;
}

export interface WorkflowDependencies {
  readonly acquireRunner?: typeof import("./pi").acquireWorkflowRunner;
  readonly executor?: ExecutorToolset;
  readonly decide?: (
    inputs: ReadonlyArray<unknown>,
    spec: AnyWorkflowSpec,
  ) => Promise<DecisionBatchReport>;
  readonly now?: () => Date;
  /** Test seam for current served-copy validation before an accepted link edit. */
  readonly readSuggestionSentences?: (origin: string, path: string, allowPrivate: boolean, maxBodyBytes: number, signal?: AbortSignal) => Promise<ReadonlyArray<string>>;
}

const readCurrentSuggestionSentences = async (origin: string, path: string, allowPrivate: boolean, maxBodyBytes: number, signal?: AbortSignal): Promise<ReadonlyArray<string>> => {
  const options = { sameOrigin: origin, allowPrivate, timeoutMs: 15_000, maxBodyBytes, signal };
  const robots = await probeHttp({ kind: "robots", method: "GET", accept: "text/plain", url: new URL("/robots.txt", origin) }, { ...options, captureBody: true });
  if ((!robots.ok && robots.status !== 404) || robots.bodyTruncated) throw new Error("Could not verify current robots policy for suggestion freshness");
  const rules = robots.ok ? robotsRules(robots.body ?? "").rules : [];
  const url = new URL(path, origin);
  if (!allowedByRobots(`${url.pathname}${url.search}`, rules)) throw new Error(`Suggestion page is robots-disallowed: ${path}`);
  const probe = await probeHttp({ kind: "page-html", method: "GET", accept: "text/html", url }, {
    ...options, captureBody: true, allowUrl: (next) => allowedByRobots(`${next.pathname}${next.search}`, rules),
  });
  const contentType = probe.responseHeaders["content-type"];
  if (!probe.ok || probe.bodyTruncated || !probe.body || !probe.finalUrl
    || (contentType !== undefined && !/text\/html|application\/xhtml\+xml/i.test(contentType))
    || new URL(probe.finalUrl).pathname.replace(/\/+$/, "") !== url.pathname.replace(/\/+$/, "")) {
    throw new Error(`Could not verify current served copy for suggestion page ${path}: ${probe.error ?? "unreadable or redirected page"}`);
  }
  return extractPageSentences(probe.body);
};

/** Served-page reads use only the report origin and the same bounded robots checks as freshness validation. */
export const createFetchPageTool = async (
  report: Pick<LinksSuggestionReport, "origin" | "maxBodyBytes">,
  allowPrivate: boolean,
  readSentences: NonNullable<WorkflowDependencies["readSuggestionSentences"]> = readCurrentSuggestionSentences,
): Promise<AgentTool> => {
  const { Type } = await import("@earendil-works/pi-ai");
  return {
    name: "fetch_page", label: "Read served page",
    description: "Read extracted sentences from a served page on the suggestion report origin, respecting robots policy and the report body size bound.",
    parameters: Type.Object({ url: Type.String() }),
    execute: async (_id, args, signal) => {
      signal?.throwIfAborted();
      if (typeof args !== "object" || args === null || !("url" in args) || typeof args.url !== "string") {
        throw new Error("fetch_page requires a string url");
      }
      const url = new URL(args.url, report.origin);
      if (url.origin !== new URL(report.origin).origin || url.username || url.password) {
        throw new Error("fetch_page requires the suggestion report origin");
      }
      const sentences = await readSentences(report.origin, `${url.pathname}${url.search}`, allowPrivate, report.maxBodyBytes, signal);
      signal?.throwIfAborted();
      return { content: [{ type: "text", text: JSON.stringify(sentences) }], details: undefined };
    },
  };
};

const defaultDecide = async (
  inputs: ReadonlyArray<unknown>,
  spec: AnyWorkflowSpec,
): Promise<DecisionBatchReport> => {
  const layer = TypeSafeDecisionModel.model("jev-latest").pipe(
    Layer.provide(TypeSafeClient.layerConfig()),
    Layer.provide(FetchHttpClient.layer),
  );
  return Effect.runPromise(
    Effect.gen(function* () {
      yield* Config.Redacted("TYPESAFE_API_KEY");
      return yield* spec.runDecisions({ inputs, model: "jev-latest", threshold: 0.7 });
    }).pipe(Effect.provide(layer)),
  );
};

const researchPrompt = (
  spec: AnyWorkflowSpec,
  evidence: Awaited<ReturnType<typeof collectWorkflowEvidence>>,
  options: WorkflowTargetOptions,
): string =>
  TextTemplate.from(researchPromptSource)
    .values({
      workflow: spec.id,
      limit: options.limit,
      instructions: spec.researchInstructions,
      skills: spec.skills.join(", "),
      stateSchema: JSON.stringify(spec.stateJsonSchema),
      resultInstruction: "Call submit_result with a state",
      market: options.market ?? "unspecified",
      language: options.language ?? "unspecified",
      device: options.device ?? "unspecified",
      refresh: options.refresh,
      queries: JSON.stringify(options.queries),
      competitors: JSON.stringify(options.competitors),
      domains: JSON.stringify(options.domains),
      evidence: JSON.stringify(evidence),
    })
    .render();

const actionPrompt = (
  spec: AnyWorkflowSpec,
  state: unknown,
  decisions: DecisionBatchReport,
  policy: WorkflowMutationPolicy,
): string =>
  TextTemplate.from(actionPromptSource)
    .values({
      workflow: spec.id,
      instructions: spec.actionInstructions ?? "Produce the final recommendation.",
      state: JSON.stringify(state),
      decisions: JSON.stringify(decisions),
      mutationMode: policy.mode,
      mutationInstruction:
        policy.mode === "dry-run"
          ? "Do not edit files. Describe the exact intended changes only."
          : "Edit the owning source files through edit_file or write_file and inspect the resulting files.",
    })
    .render();

const decisionArtifact = (
  spec: AnyWorkflowSpec,
  inputs: ReadonlyArray<unknown>,
  report: DecisionBatchReport,
) => ({ family: spec.familyName, questions: spec.decisionQuestions(inputs), report });

const failureRecovery = (stage: string, runDirectory: string): string => {
  if (stage === "acquire") return "inspect that file; check the agent preset and Executor tools configuration";
  if (stage === "decide") return `inspect that file and research.json; check the decision provider configuration and resume with --from ${runDirectory}`;
  if (stage === "action") return "inspect the agent messages and repository edits; interrupted actions cannot be resumed safely";
  return `inspect the agent messages in that file; resume with --from ${runDirectory}, optionally --model <id>, or raise workflows.agent.timeoutMs`;
};

export const runWorkflow = async (
  input: WorkflowInput,
  dependencies: WorkflowDependencies = {},
): Promise<{ readonly run: WorkflowRunV2; readonly directory: string }> => {
  const workflows = input.config.workflows;
  if (workflows === undefined) {
    throw new Error("pagegraph.config.ts has no workflows configuration; run `pagegraph init` and configure workflows.");
  }
  const spec = getWorkflowSpec(input.workflow);
  const now = dependencies.now ?? (() => new Date());
  let runsDirectory = input.out ?? workflows.runsDirectory ?? ".pagegraph/runs";
  const resumed = input.from === undefined ? undefined : loadWorkflowResume(input.root, runsDirectory, input.from, spec.id);
  if (resumed?.run !== undefined) return { run: resumed.run, directory: resumed.directory };
  if (resumed !== undefined) {
    runsDirectory = dirname(resumed.directory);
    input = { ...input, options: { ...resumed.progress!.options, dryRun: resumed.progress!.options.dryRun || (resumed.progress!.action === undefined && input.options.dryRun) } };
  }
  const started = resumed?.progress === undefined ? now() : new Date(resumed.progress.startedAt);
  const id = resumed?.progress?.id ?? createRunId(started, spec.id);
  const runDirectory = resolve(input.root, runsDirectory, id);
  let progress = resumed?.progress;
  let executorEvidence: RunnerResult["executor"] | undefined;
  let stage: "acquire" | "research" | "decide" | "action" = "acquire";
  let agentArtifact: WorkflowAgentArtifact | undefined;
  let pi: typeof import("./pi") | undefined;
  let selectedModel: WorkflowRunner["model"] | undefined;
  try {
    const gitAtStart = progress?.git ?? inspectWorkflowGit(input.root, runDirectory);
    const mutation = createWorkflowMutationPolicy({
      dirtyAtStart: gitAtStart.dirty,
      dryRun: spec.mutatesFiles ? input.options.dryRun : true,
      allowDirty: input.options.allowDirty,
    });
    if (spec.mutatesFiles) mutation.assertStartAllowed();

    const repositoryRoot = await resolveWorkflowRepositoryRoot(input.root, workflows.repositoryRoot);
    const evidence = progress?.evidence ?? await collectWorkflowEvidence(
      input.graph,
      input.options,
      repositoryRoot,
      spec.id,
      workflows.context,
      { runsDirectory: resolve(input.root, runsDirectory) },
    );
    const suggestionReport = progress?.evidence.suggestions ?? (input.options.suggestions === undefined ? undefined : (() => {
      if (spec.id !== "improve.links") throw new Error("--suggestions is only valid for improve links");
      const report = decodeLinksSuggestionReport(JSON.parse(readFileSync(resolve(input.root, input.options.suggestions), "utf8")), new URL(input.site.origin).origin);
      const selectedSources = selectGraph(input.graph, input.options).nodes;
      for (const candidate of report.candidates) {
        if (!input.graph.nodes.has(candidate.source) || !input.graph.nodes.has(candidate.destination)) {
          throw new Error(`Suggestion references a path absent from pagegraph.config.ts: ${candidate.source} → ${candidate.destination}`);
        }
        if (!selectedSources.has(candidate.source)) {
          throw new Error(`Suggestion source is outside workflow page/kind/limit targets: ${candidate.source}`);
        }
      }
      return report;
    })());
    const suppliedEvidence = suggestionReport === undefined ? evidence : { ...evidence, suggestions: suggestionReport };
    progress ??= {
      kind: "pagegraph-workflow-progress", schemaVersion: 2, id, workflow: spec.id,
      startedAt: started.toISOString(),
      project: { root: input.root, head: gitAtStart.head, dirtyAtStart: gitAtStart.dirty, filesAtStart: gitAtStart.files },
      options: input.options, evidence: { ...suppliedEvidence, executor: { searches: [], calls: [] } }, git: gitAtStart,
    };
    const restoredAgent = progress.research?.agent ?? resumed?.failure?.agent;
    const restoredExecutor = progress.research?.evidence.executor ?? resumed?.failure?.executor;
    if (!dependencies.decide && progress?.decisions === undefined && !process.env.TYPESAFE_API_KEY?.trim()) {
      throw new Error("Missing decision provider credentials; set TYPESAFE_API_KEY before starting this workflow.");
    }
    // Loading Pi at acquisition keeps unrelated CLI commands lightweight.
    pi = await import("./pi");
    const runner: WorkflowRunner = progress.research !== undefined && (!spec.mutatesFiles || progress.action !== undefined)
      ? {
          model: progress.research.agent.model,
          research: async () => { throw new Error("Recorded research must not be repeated."); },
          act: async () => { throw new Error("Recorded action must not be repeated."); },
          close: async () => {},
        }
      : await (dependencies.acquireRunner ?? pi.acquireWorkflowRunner)({
      root: input.root, repositoryRoot, runDirectory, config: workflows.agent, model: input.model ?? (restoredAgent === undefined ? workflows.agent.models?.[spec.id] : `${restoredAgent.model.provider}/${restoredAgent.model.id}`),
      limit: input.options.limit, executor: dependencies.executor, runsDirectory: resolve(input.root, runsDirectory),
      ...(restoredAgent === undefined || restoredExecutor === undefined ? {} : { resume: { agent: restoredAgent, executor: restoredExecutor, phase: progress.research === undefined ? "research" as const : "action" as const } }),
      additionalTools: spec.id === "improve.links" && suggestionReport !== undefined
        ? [await createFetchPageTool(suggestionReport, input.options.allowPrivate === true, dependencies.readSuggestionSentences)] : [],
    });
    const model = runner.model;
    selectedModel = model;
    const retainRunnerResult = (result: Omit<RunnerResult, "state">): void => {
      agentArtifact = { runtime: "pi", model, messages: result.messages, usage: result.usage };
      executorEvidence = result.executor;
    };
    retainRunnerResult({ messages: [], usage: pi.totalUsage([]), executor: { searches: [], calls: [] } });
    let turnFailed = false;
    try {
      stage = "research";
      const researched: RunnerResult = progress.research === undefined
        ? await runner.research(spec, `${resumed === undefined ? "" : "Resume the recorded research conversation. Reuse completed Executor calls and their evidence; finish only the remaining research and submission.\n\n"}${researchPrompt(spec, suppliedEvidence, input.options)}`,
          { signal: AbortSignal.timeout(workflows.agent.timeoutMs ?? 180_000) })
        : { state: progress.research.state, messages: progress.research.agent.messages, usage: progress.research.agent.usage,
            executor: progress.research.evidence.executor, rejectedItems: progress.research.rejectedItems };
      retainRunnerResult(researched);
      const assertResearchReadOnly = (): void => {
        const researchFiles = changedFiles(gitAtStart, inspectWorkflowGit(input.root, runDirectory));
        if (researchFiles.length > 0) throw new Error(`${spec.id} changed repository files during its read-only research turn: ${researchFiles.join(", ")}`);
      };
      if (progress.action === undefined) assertResearchReadOnly();
      const state = decodeResearchState(spec, researched.state, input.options.limit);
      const decisionInputs = spec.decisionInputs(state);
      if (suggestionReport !== undefined) {
        const valid = new Set(suggestionReport.candidates.map((item) => `${item.source}\u0000${item.destination}\u0000${item.anchor}\u0000${item.sentence}`));
        for (const item of decisionInputs) {
          const link = item as { from?: unknown; to?: unknown; anchor?: unknown; context?: unknown };
          if (!valid.has(`${link.from}\u0000${link.to}\u0000${link.anchor}\u0000${link.context}`)) {
            throw new Error("Research proposed a link absent from the supplied suggestions");
          }
        }
      }

      const checkpoint: WorkflowResearchCheckpointV2 = {
        kind: "pagegraph-workflow-research-checkpoint",
        schemaVersion: 2,
        id,
        workflow: spec.id,
        startedAt: started.toISOString(),
        checkpointedAt: now().toISOString(),
        project: {
          root: input.root,
          head: gitAtStart.head,
          dirtyAtStart: gitAtStart.dirty,
          filesAtStart: gitAtStart.files,
        },
        options: input.options,
        evidence: { ...suppliedEvidence, executor: researched.executor },
        state,
        decisionInputs,
        agent: agentArtifact!,
        ...(researched.rejectedItems === undefined ? {} : { rejectedItems: researched.rejectedItems }),
      };
      const checkpointPath = writeResearchCheckpoint(input.root, runsDirectory, checkpoint);
      const checkpointContents = readFileSync(checkpointPath, "utf8");
      progress = { ...progress, research: checkpoint };
      writeWorkflowProgress(input.root, runsDirectory, progress);
      const gitAtCheckpoint = progress.git;

      stage = "decide";
      try {
        const decisionReport = progress.decisions ?? await (dependencies.decide ?? defaultDecide)(decisionInputs, spec);
        progress = { ...progress, decisions: decisionReport };
        writeWorkflowProgress(input.root, runsDirectory, progress);
        const accepted = spec.id === "improve.links"
          ? decisionReport.resolved.filter((record) => record.verdict === "add" || record.verdict === "update")
          : undefined;
        const acceptedIndexes = new Set<number>();
        if (accepted !== undefined) {
          for (const record of accepted) {
            const match = /^workflow-links:(\d+)$/.exec(record.decisionId);
            const index = match === null ? -1 : Number(match[1]);
            const item = decisionInputs[index] as { from?: string; to?: string } | undefined;
            if (!item || record.inputRef !== `${item.from} → ${item.to}`) {
              throw new Error(`Decision does not match a researched link: ${record.decisionId}`);
            }
            acceptedIndexes.add(index);
          }
        }
        const actionItems = accepted === undefined ? undefined : (state as { items: ReadonlyArray<unknown> }).items.filter((_, index) => acceptedIndexes.has(index));
        if (actionItems !== undefined && actionItems.length > 0 && suggestionReport !== undefined) {
          const readSentences = dependencies.readSuggestionSentences ?? readCurrentSuggestionSentences;
          const current = new Map<string, ReadonlyArray<string>>();
          for (const item of actionItems as ReadonlyArray<{ from: string; to: string; anchor: string; context: string }>) {
            const candidate = suggestionReport.candidates.find((entry) => entry.source === item.from && entry.destination === item.to
              && entry.anchor === item.anchor && entry.sentence === item.context);
            if (!candidate) throw new Error("Accepted link is absent from the supplied suggestions");
            for (const path of [candidate.source, candidate.destination]) {
              if (!current.has(path)) current.set(path, await readSentences(suggestionReport.origin, path, input.options.allowPrivate === true, suggestionReport.maxBodyBytes));
            }
            if (!current.get(candidate.source)!.includes(candidate.sentence) || !current.get(candidate.destination)!.includes(candidate.targetSentence)) {
              throw new Error(`Suggestion is stale; served copy changed for ${candidate.source} → ${candidate.destination}. Regenerate links candidates --site.`);
            }
          }
        }
        const actionState = actionItems === undefined ? state : { ...(state as Record<string, unknown>), items: actionItems };
        const actionDecisions = accepted === undefined ? decisionReport : {
          ...decisionReport,
          resolved: accepted,
          review: [],
          counts: { inputs: accepted.length, resolved: accepted.length, review: 0 },
          verdicts: { add: accepted.filter((record) => record.verdict === "add").length,
            update: accepted.filter((record) => record.verdict === "update").length },
        };
        const mayAct = spec.mutatesFiles && (actionItems === undefined || actionItems.length > 0);
        if (mayAct) {
          stage = "action";
          if (progress.action === undefined) {
            progress = { ...progress, actionStarted: true };
            writeWorkflowProgress(input.root, runsDirectory, progress);
          }
        }
        const acted = progress.action ?? (mayAct
          ? await runner.act(spec, actionPrompt(spec, actionState, actionDecisions, mutation), {
              mode: mutation.mode, signal: AbortSignal.timeout(workflows.agent.timeoutMs ?? 180_000),
            })
          : researched);
        retainRunnerResult(acted);
        if (readFileSync(checkpointPath, "utf8") !== checkpointContents) {
          throw new Error(`${spec.id} changed repository files while running in read-only mode: ${checkpointPath}`);
        }
        const gitAfter = inspectWorkflowGit(input.root, runDirectory);
        const files = changedFiles(gitAtCheckpoint, gitAfter);
        if ((!spec.mutatesFiles || input.options.dryRun) && files.length > 0) {
          throw new Error(`${spec.id} changed repository files while running in read-only mode: ${files.join(", ")}`);
        }
        if (mayAct) {
          progress = { ...progress, action: acted, actionGit: gitAfter };
          writeWorkflowProgress(input.root, runsDirectory, progress);
        }
        const run: WorkflowRunV2 = {
          kind: "pagegraph-workflow-run",
          schemaVersion: 2,
          id,
          workflow: spec.id,
          startedAt: started.toISOString(),
          finishedAt: now().toISOString(),
          project: { root: input.root, head: gitAtStart.head, dirtyAtStart: gitAtStart.dirty },
          options: input.options,
          model,
          targets: {
            pages: evidence.graph.nodes.map((node) => node.path),
            queries: input.options.queries,
            kinds: input.options.kinds,
          },
          evidence: { ...suppliedEvidence, executor: acted.executor },
          decisions: [decisionArtifact(spec, decisionInputs, decisionReport)],
          changes: {
            files,
            providerCalls: acted.executor.calls.map((call) => call.tool),
          },
          result: mayAct ? acted.state : accepted !== undefined ? { summary: "No link suggestions accepted.", outcome: "no-change", files: [] } : state,
          agent: agentArtifact!,
          ...(researched.rejectedItems === undefined ? {} : { rejectedItems: researched.rejectedItems }),
        };
        return { run, directory: writeRunBundle(input.root, runsDirectory, run) };
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        throw new Error(`${message}\nResearch checkpoint: ${checkpointPath}`, { cause });
      }
    } catch (cause) {
      turnFailed = true;
      throw cause;
    } finally {
      try {
        await runner.close();
      } catch (cause) {
        if (!turnFailed) throw cause;
      }
    }
  } catch (cause) {
    const seen = new Set<unknown>();
    let current = cause;
    while (current instanceof Error && !seen.has(current)) {
      seen.add(current);
      if (pi !== undefined && current instanceof pi.WorkflowRunnerError && selectedModel) {
        agentArtifact = { runtime: "pi", model: selectedModel, messages: current.result.messages, usage: current.result.usage };
        executorEvidence = current.result.executor;
        break;
      }
      current = current.cause;
    }
    const message = cause instanceof Error ? cause.message : String(cause);
    let path: string;
    try {
      if (progress !== undefined) writeWorkflowProgress(input.root, runsDirectory, progress);
      path = writeWorkflowFailure(input.root, runsDirectory, id, {
        kind: "pagegraph-workflow-failure", schemaVersion: 2, id, workflow: spec.id,
        stage, ...(agentArtifact === undefined ? {} : { agent: agentArtifact }),
        ...(executorEvidence === undefined ? {} : { executor: executorEvidence }), cause: serializeCause(cause),
      });
    } catch (writeError) {
      if (cause instanceof Error) {
        cause.message += `\nCould not write failure artifact: ${writeError instanceof Error ? writeError.message : String(writeError)}`;
        throw cause;
      }
      throw new Error(`${message}\nCould not write failure artifact: ${String(writeError)}`, { cause });
    }
    const next = failureRecovery(stage, runDirectory);
    throw new Error(`${message}\nFailure artifact: ${path}\nNext: ${next}`, { cause });
  }
};

export type KeywordWorkflowInput = Omit<WorkflowInput, "workflow">;
export type KeywordWorkflowDependencies = WorkflowDependencies;

export const runKeywordWorkflow = (
  input: KeywordWorkflowInput,
  dependencies: KeywordWorkflowDependencies = {},
): Promise<{ readonly run: WorkflowRunV2; readonly directory: string }> =>
  runWorkflow({ ...input, workflow: "research.keywords" }, dependencies);
