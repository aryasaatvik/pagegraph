import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { DecisionBatchReport } from "../../src/decide/record";
import { applyWorkflowEdits, normalizeEditPaths, readWorkflowEdits, renderReview, workflowEditsArtifact, writeWorkflowEdits } from "../../src/workflows/review";

const directories: Array<string> = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const fixture = () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pagegraph-review-")));
  directories.push(root);
  writeFileSync(join(root, "page.mdx"), "# Pricing\n\nOld intro. Old intro.\n\nSee plans.\n");
  return root;
};
const options = { presetDirectory: ".pagegraph/agent", runsDirectory: ".pagegraph/runs" };

const decisions: DecisionBatchReport = {
  kind: "decide", schemaVersion: 1, family: "workflow-links", model: "jev-latest", threshold: 0.7,
  counts: { inputs: 1, resolved: 0, review: 1 }, verdicts: { review: 1 }, resolved: [],
  review: [{ decisionId: "workflow-links:0", schemaVersion: 1, family: "workflow-links", model: "jev-latest", threshold: 0.7,
    inputHash: "hash", inputRef: "/docs/email → /pricing", verdict: "review", review: true,
    answers: { useful: { probability: 0.62 }, action: { label: "add", probabilities: { add: 0.55, skip: 0.45 } } } }],
};

describe("workflow edits", () => {
  it("applies replacements and new files in order and reports each edit", async () => {
    const root = fixture();
    const outcomes = await applyWorkflowEdits(root, [
      { id: "e1", path: "page.mdx", oldText: "See plans.", newText: "See [plans](/pricing)." },
      { id: "e2", path: "page.mdx", oldText: "[plans](/pricing)", newText: "[pricing plans](/pricing)" },
      { id: "e3", path: "src/schema.ts", newText: "export const schema = [];\n" },
    ], { ...options, check: false });
    expect(outcomes).toEqual([
      { id: "e1", path: "page.mdx", status: "applied" },
      { id: "e2", path: "page.mdx", status: "applied" },
      { id: "e3", path: "src/schema.ts", status: "applied" },
    ]);
    expect(readFileSync(join(root, "page.mdx"), "utf8")).toContain("See [pricing plans](/pricing).");
    expect(readFileSync(join(root, "src/schema.ts"), "utf8")).toBe("export const schema = [];\n");
  });

  it("refuses stale targets while applying the edits that still match", async () => {
    const root = fixture();
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src/exists.ts"), "existing\n");
    const outcomes = await applyWorkflowEdits(root, [
      { id: "e1", path: "page.mdx", oldText: "Missing text", newText: "x" },
      { id: "e2", path: "page.mdx", oldText: "Old intro.", newText: "x" },
      { id: "e3", path: "missing.mdx", oldText: "anything", newText: "x" },
      { id: "e4", path: "src/exists.ts", newText: "replaced\n" },
      { id: "e5", path: "page.mdx", oldText: "# Pricing", newText: "# Email API pricing" },
    ], { ...options, check: false });
    expect(outcomes.map(({ id, status, reason }) => ({ id, status, reason }))).toEqual([
      { id: "e1", status: "stale", reason: "target text not found" },
      { id: "e2", status: "stale", reason: "target text matches 2 times" },
      { id: "e3", status: "stale", reason: "file not found" },
      { id: "e4", status: "stale", reason: "file already exists" },
      { id: "e5", status: "applied", reason: undefined },
    ]);
    expect(readFileSync(join(root, "page.mdx"), "utf8")).toBe("# Email API pricing\n\nOld intro. Old intro.\n\nSee plans.\n");
    expect(readFileSync(join(root, "src/exists.ts"), "utf8")).toBe("existing\n");
  });

  it("reports applicable edits in check mode without writing", async () => {
    const root = fixture();
    const before = readFileSync(join(root, "page.mdx"), "utf8");
    const outcomes = await applyWorkflowEdits(root, [
      { id: "e1", path: "page.mdx", oldText: "See plans.", newText: "See pricing." },
      { id: "e2", path: "new.mdx", newText: "new" },
    ], { ...options, check: true });
    expect(outcomes.map(({ status }) => status)).toEqual(["applicable", "applicable"]);
    expect(readFileSync(join(root, "page.mdx"), "utf8")).toBe(before);
    expect(() => readFileSync(join(root, "new.mdx"))).toThrow();
  });

  it("normalizes read-root paths to the app root and refuses paths outside it", () => {
    const repository = fixture();
    const app = join(repository, "apps/web");
    mkdirSync(app, { recursive: true });
    const edit = { oldText: "a", newText: "b", reason: "r", evidence: [] };
    expect(normalizeEditPaths({ summary: "s", edits: [{ path: "apps/web/src/page.tsx", ...edit }], reviewItems: [] }, repository, app).edits[0]?.path)
      .toBe("src/page.tsx");
    expect(() => normalizeEditPaths({ summary: "s", edits: [{ path: "AGENTS.md", ...edit }], reviewItems: [] }, repository, app))
      .toThrow("outside the app root apps/web");
  });

  it("records edits and agent and decision review items in edits.json and review.md", () => {
    const root = fixture();
    const directory = join(root, ".pagegraph/runs/run-1");
    const artifact = workflowEditsArtifact({
      id: "run-1", workflow: "improve.links", mode: "dry-run", root,
      decisions,
      action: {
        summary: "One link and one manual follow-up.",
        edits: [{ path: "page.mdx", oldText: "See plans.", newText: "See ```plans```.", reason: "Pricing is the next step.", evidence: ["GSC: 40 impressions"] }],
        reviewItems: [{ path: "src/generated/routes.ts", reason: "Generated file; change the route declaration.", evidence: ["header: generated"] }],
      },
    });
    writeWorkflowEdits(directory, artifact);
    const read = readWorkflowEdits(root, ".pagegraph/runs", "run-1");
    expect(read.directory).toBe(directory);
    expect(read.edits).toEqual(artifact);
    expect(read.edits.edits.map(({ id }) => id)).toEqual(["e1"]);
    expect(read.edits.reviewItems).toEqual([
      { source: "agent", path: "src/generated/routes.ts", reason: "Generated file; change the route declaration.", evidence: ["header: generated"] },
      { source: "decision", path: "/docs/email → /pricing", reason: expect.stringContaining("workflow-links:0"), evidence: ["useful: 0.62", "action: add (0.55)"] },
    ]);
    const review = readFileSync(join(directory, "review.md"), "utf8");
    expect(review).toBe(renderReview(artifact, directory));
    expect(review).toContain("### e1 · `page.mdx`");
    expect(review).toContain("````diff\n- See plans.\n+ See ```plans```.\n````");
    expect(review).toContain("- GSC: 40 impressions");
    expect(review).toContain("### `/docs/email → /pricing` (decision)");
    expect(review).toContain(`pagegraph apply ${directory} --only e1`);
  });

  it("names a run without edits.json", () => {
    const root = fixture();
    expect(() => readWorkflowEdits(root, ".pagegraph/runs", "missing")).toThrow("No edits.json");
  });
});
