import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { writeWorkflowProgress } from "../../src/workflows/artifact";
import type { WorkflowProgressV2 } from "../../src/workflows/model";

const fault = vi.hoisted(() => ({ enabled: false }));
vi.mock("node:fs", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs")>();
  return { ...fs, writeFileSync: (...args: Parameters<typeof fs.writeFileSync>) => {
    if (fault.enabled) {
      fs.writeFileSync(args[0], '{"incomplete":');
      throw new Error("fixture disk write interrupted");
    }
    return fs.writeFileSync(...args);
  } };
});
const directories: string[] = [];
afterEach(() => { fault.enabled = false; directories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })); });

it("preserves the usable checkpoint if the next write stops after partial bytes", () => {
  const root = mkdtempSync(join(tmpdir(), "pagegraph-atomic-")); directories.push(root);
  const progress: WorkflowProgressV2 = {
    kind: "pagegraph-workflow-progress", schemaVersion: 2, id: "run", workflow: "research.keywords", startedAt: "2026-10-05T00:00:00Z",
    project: { root, dirtyAtStart: false, filesAtStart: [] }, repositoryRoot: root,
    git: { dirty: false, files: [], fingerprints: {} },
    options: { pages: [], queries: [], kinds: [], competitors: [], domains: [], limit: 1, refresh: false, dryRun: false, allowDirty: false },
    evidence: { graph: { nodes: [], edges: [] }, neighborhood: { inbound: [], outbound: [] }, sources: [], executor: { searches: [], calls: [] } },
  };
  const path = writeWorkflowProgress(root, "runs", progress);
  const original = readFileSync(path, "utf8");
  fault.enabled = true;
  expect(() => writeWorkflowProgress(root, "runs", { ...progress, actionStarted: true })).toThrow("fixture disk write interrupted");
  fault.enabled = false;
  expect(readFileSync(path, "utf8")).toBe(original);
  expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(progress);
  expect(readdirSync(join(root, "runs/run"))).toEqual(["progress.json"]);
  writeWorkflowProgress(root, "runs", { ...progress, actionStarted: true });
  expect(JSON.parse(readFileSync(path, "utf8")).actionStarted).toBe(true);
});
