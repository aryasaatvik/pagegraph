import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Usage } from "@earendil-works/pi-ai";
import type { ExecutorEvidence } from "./model";
import type { AnyWorkflowSpec } from "./specs/types";

export interface WorkflowRunner {
  readonly model: { readonly provider: string; readonly id: string };
  research(spec: AnyWorkflowSpec, prompt: string, options: { readonly signal: AbortSignal }): Promise<RunnerResult>;
  act(spec: AnyWorkflowSpec, prompt: string, options: { readonly mode: "write" | "dry-run"; readonly signal: AbortSignal }): Promise<RunnerResult>;
  close(): Promise<void>;
}

export interface RunnerResult {
  readonly state: unknown;
  readonly messages: ReadonlyArray<AgentMessage>;
  readonly usage: Usage;
  readonly executor: ExecutorEvidence;
}
