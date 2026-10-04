import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createRunId, writeResearchCheckpoint, writeRunBundle, writeWorkflowFailure } from "../../src/workflows/artifact";
import type { WorkflowAgentArtifact, WorkflowRunV2 } from "../../src/workflows/model";

vi.mock("../../src/workflows/prompts/summary.md", async () => {
  const { readFile } = await import("node:fs/promises");
  return { default: await readFile(new URL("../../src/workflows/prompts/summary.md", import.meta.url), "utf8") };
});

const directories: Array<string> = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const agents: ReadonlyArray<WorkflowAgentArtifact> = [
  {
    runtime: "pi",
    model: { provider: "test", id: "model" },
    messages: [{ role: "user", content: "Research the target.", timestamp: 1 }],
    usage: {
      input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15,
      cost: { input: 0.01, output: 0.02, cacheRead: 0, cacheWrite: 0, total: 0.03 },
    },
  },
  {
    runtime: "opencode",
    model: { provider: "test", id: "model" },
    sessionId: "session-1",
    transcript: [{ text: "Applied the approved changes." }],
  },
];

const fixture = (agent: WorkflowAgentArtifact): WorkflowRunV2 => ({
  kind: "pagegraph-workflow-run", schemaVersion: 2, id: "run-1", workflow: "research.keywords",
  startedAt: "2026-10-03T10:00:00.000Z", finishedAt: "2026-10-03T10:01:00.000Z",
  project: { root: "/project", dirtyAtStart: false },
  options: { pages: [], queries: [], kinds: [], competitors: [], domains: [], limit: 1, refresh: false, dryRun: false, allowDirty: false },
  model: agent.model,
  targets: { pages: [], queries: [], kinds: [] },
  evidence: { graph: { nodes: [], edges: [] }, neighborhood: { inbound: [], outbound: [] }, sources: [], executor: { searches: [], calls: [] } },
  decisions: [], changes: { files: [], providerCalls: [] }, result: { summary: "Completed research." }, agent,
});

describe("workflow artifacts", () => {
  it("uses a collision-resistant suffix when timestamps match", () => {
    const started = new Date("2026-09-21T10:00:00.000Z");

    expect(createRunId(started, "research.keywords", "aaaaaaaa-0000-4000-8000-000000000000")).not.toBe(
      createRunId(started, "research.keywords", "bbbbbbbb-0000-4000-8000-000000000000"),
    );
  });

  it.each(agents)("persists $runtime runtime details in v2 run, checkpoint, and failure artifacts", (agent) => {
    const root = mkdtempSync(join(tmpdir(), "pagegraph-artifact-"));
    directories.push(root);
    const run = fixture(agent);
    const directory = writeRunBundle(root, "runs", run);
    const checkpointPath = writeResearchCheckpoint(root, "runs", {
      kind: "pagegraph-workflow-research-checkpoint", schemaVersion: 2,
      id: run.id, workflow: run.workflow, startedAt: run.startedAt, checkpointedAt: run.finishedAt,
      project: { ...run.project, filesAtStart: [] }, options: run.options, evidence: run.evidence,
      state: run.result, decisionInputs: [], agent,
    });
    const failurePath = writeWorkflowFailure(root, "runs", run.id, {
      kind: "pagegraph-workflow-failure", schemaVersion: 2, id: run.id, workflow: run.workflow,
      stage: "decide", agent, cause: { message: "Decision unavailable" },
    });
    for (const path of [join(directory, "run.json"), checkpointPath, failurePath]) {
      const artifact = JSON.parse(readFileSync(path, "utf8"));
      expect(artifact.schemaVersion).toBe(2);
      expect(artifact.agent).toEqual(agent);
      expect(artifact).not.toHaveProperty("opencode");
    }
    expect(readFileSync(join(directory, "summary.md"), "utf8")).toContain("Completed research.");
  });

  it("records acquisition failures before an agent exists", () => {
    const root = mkdtempSync(join(tmpdir(), "pagegraph-artifact-"));
    directories.push(root);
    const path = writeWorkflowFailure(root, "runs", "run-1", {
      kind: "pagegraph-workflow-failure", schemaVersion: 2, id: "run-1", workflow: "research.keywords",
      stage: "acquire", cause: { message: "Executor tools are not configured" },
    });
    expect(JSON.parse(readFileSync(path, "utf8"))).not.toHaveProperty("agent");
  });
});
