import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Usage } from "@earendil-works/pi-ai";

import type { DecisionBatchReport } from "../decide/record";
import type { SerializedGraph } from "../cli/serialize";
import type { GitState } from "./git";
import type { RunnerResult } from "./runner";
import type { LinksSuggestionReport } from "../core/link-suggestions";

/** A selected page's direct relationship to a page outside the workflow target set. */
export interface WorkflowGraphNeighbor {
  readonly edge: SerializedGraph["edges"][number];
  readonly node: SerializedGraph["nodes"][number];
}

/** Contextual graph relationships kept outside the bounded target graph. */
export interface WorkflowGraphNeighborhood {
  readonly inbound: ReadonlyArray<WorkflowGraphNeighbor>;
  readonly outbound: ReadonlyArray<WorkflowGraphNeighbor>;
}

export interface ExecutorEvidenceRecord {
  readonly tool: string;
  readonly input: unknown;
  readonly output: unknown;
}

export interface ExecutorEvidence {
  readonly searches: ReadonlyArray<ExecutorEvidenceRecord>;
  readonly calls: ReadonlyArray<ExecutorEvidenceRecord>;
}

export const workflowIds = [
  "research.keywords",
  "research.competitors",
  "research.authority",
  "analyze.serp",
  "analyze.content",
  "analyze.ai-search",
  "plan.architecture",
  "improve.content",
  "improve.metadata",
  "improve.schema",
  "improve.links",
] as const;
export type WorkflowId = (typeof workflowIds)[number];

export interface WorkflowTargetOptions {
  readonly pages: ReadonlyArray<string>;
  readonly queries: ReadonlyArray<string>;
  readonly kinds: ReadonlyArray<string>;
  readonly competitors: ReadonlyArray<string>;
  readonly domains: ReadonlyArray<string>;
  readonly limit: number;
  readonly market?: string | undefined;
  readonly language?: string | undefined;
  readonly device?: "desktop" | "mobile" | undefined;
  readonly refresh: boolean;
  readonly dryRun: boolean;
  readonly allowDirty: boolean;
  readonly allowPrivate?: boolean | undefined;
  readonly suggestions?: string | undefined;
}

export interface KeywordCandidate {
  readonly path: string;
  readonly title: string;
  readonly excerpt: string;
}

export interface KeywordOpportunity {
  readonly query: string;
  readonly intent: string;
  readonly rationale: string;
  readonly demand?: number | undefined;
  readonly candidates: ReadonlyArray<KeywordCandidate>;
  readonly evidence: ReadonlyArray<string>;
}

export interface KeywordResearchState {
  readonly summary: string;
  readonly opportunities: ReadonlyArray<KeywordOpportunity>;
}

export interface WorkflowAgentArtifact {
  readonly runtime: "pi";
  readonly model: { readonly provider: string; readonly id: string };
  readonly messages: ReadonlyArray<AgentMessage>;
  readonly usage: Usage;
}

export interface WorkflowRunV2 {
  readonly kind: "pagegraph-workflow-run";
  readonly schemaVersion: 2;
  readonly id: string;
  readonly workflow: WorkflowId;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly project: { readonly root: string; readonly head?: string; readonly dirtyAtStart: boolean };
  readonly options: WorkflowTargetOptions;
  readonly model: { readonly provider: string; readonly id: string };
  readonly targets: {
    readonly pages: ReadonlyArray<string>;
    readonly queries: ReadonlyArray<string>;
    readonly kinds: ReadonlyArray<string>;
  };
  readonly evidence: {
    readonly graph: SerializedGraph;
    readonly neighborhood: WorkflowGraphNeighborhood;
    readonly sources: ReadonlyArray<{ readonly path: string; readonly content: string }>;
    readonly suggestions?: LinksSuggestionReport | undefined;
    readonly executor: ExecutorEvidence;
  };
  readonly decisions: ReadonlyArray<{
    readonly family: string;
    readonly questions: ReadonlyArray<{
      readonly inputRef: string;
      readonly decisions: Readonly<Record<string, unknown>>;
    }>;
    readonly report: DecisionBatchReport;
  }>;
  readonly changes: {
    readonly files: ReadonlyArray<string>;
    readonly providerCalls: ReadonlyArray<string>;
  };
  readonly result: unknown;
  readonly agent: WorkflowAgentArtifact;
  readonly rejectedItems?: ReadonlyArray<{ readonly index: number; readonly reason: string }> | undefined;
}

/** Incomplete research-stage evidence; it is not a final workflow recommendation. */
export interface WorkflowResearchCheckpointV2 {
  readonly kind: "pagegraph-workflow-research-checkpoint";
  readonly schemaVersion: 2;
  readonly id: string;
  readonly workflow: WorkflowId;
  readonly startedAt: string;
  readonly checkpointedAt: string;
  readonly project: {
    readonly root: string;
    readonly head?: string | undefined;
    readonly dirtyAtStart: boolean;
    readonly filesAtStart: ReadonlyArray<string>;
  };
  readonly options: WorkflowTargetOptions;
  readonly evidence: {
    readonly graph: SerializedGraph;
    readonly neighborhood: WorkflowGraphNeighborhood;
    readonly sources: ReadonlyArray<{ readonly path: string; readonly content: string }>;
    readonly suggestions?: LinksSuggestionReport | undefined;
    readonly executor: ExecutorEvidence;
  };
  readonly state: unknown;
  readonly decisionInputs: ReadonlyArray<unknown>;
  readonly agent: WorkflowAgentArtifact;
  readonly rejectedItems?: ReadonlyArray<{ readonly index: number; readonly reason: string }> | undefined;
}

export interface WorkflowFailureV2 {
  readonly kind: "pagegraph-workflow-failure";
  readonly schemaVersion: 2;
  readonly id: string;
  readonly workflow: WorkflowId;
  readonly stage: string;
  /** Acquisition can fail before a runtime has produced an agent record. */
  readonly agent?: WorkflowAgentArtifact | undefined;
  readonly executor?: ExecutorEvidence | undefined;
  readonly cause: unknown;
}

/** Durable stage boundaries. An interrupted action is deliberately not replayed. */
export interface WorkflowProgressV2 {
  readonly kind: "pagegraph-workflow-progress";
  readonly schemaVersion: 2;
  readonly id: string;
  readonly workflow: WorkflowId;
  readonly startedAt: string;
  readonly project: WorkflowResearchCheckpointV2["project"];
  readonly options: WorkflowTargetOptions;
  readonly evidence: WorkflowResearchCheckpointV2["evidence"];
  readonly git: GitState;
  readonly research?: WorkflowResearchCheckpointV2 | undefined;
  readonly decisions?: DecisionBatchReport | undefined;
  readonly actionStarted?: boolean | undefined;
  readonly action?: RunnerResult | undefined;
  readonly actionGit?: GitState | undefined;
}
