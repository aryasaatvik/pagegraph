import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { SeoCliConfig } from "../../src/config";
import type { SeoGraph } from "../../src/core/graph";
import type { DecisionBatchReport } from "../../src/decide/record";
import { getWorkflowSpec } from "../../src/workflows/catalog";
import type { WorkflowId } from "../../src/workflows/model";
import type { RunnerResult } from "../../src/workflows/runner";
import { WorkflowRunnerError } from "../../src/workflows/pi";
import { dropNulls, runKeywordWorkflow, runWorkflow } from "../../src/workflows/run";

// Vite treats Markdown imports as asset URLs even when Vitest runs under Bun.
vi.mock("../../src/workflows/prompts/research.md", async () => {
  const { readFile } = await import("node:fs/promises");
  return { default: await readFile(new URL("../../src/workflows/prompts/research.md", import.meta.url), "utf8") };
});
vi.mock("../../src/workflows/prompts/action.md", async () => {
  const { readFile } = await import("node:fs/promises");
  return { default: await readFile(new URL("../../src/workflows/prompts/action.md", import.meta.url), "utf8") };
});

const directories: Array<string> = [];
const git = (root: string, ...args: ReadonlyArray<string>): void => {
  execFileSync("git", args, { cwd: root, stdio: "ignore" });
};

const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), "pagegraph-workflow-"));
  directories.push(root);
  const graph: SeoGraph = {
    nodes: new Map([
      [
        "/pricing",
        {
          path: "/pricing",
          kind: "page",
          source: "route",
          policy: { kind: "page", sitemap: { priority: 0.8, changeFrequency: "monthly" } },
        },
      ],
    ]),
    edges: [],
  };
  const site = { origin: "https://example.com", indexable: true, robots: { disallow: [] } };
  const config: SeoCliConfig = {
    loadGraph: async () => ({ graph, site, dispose: async () => {} }),
    workflows: {
      agent: { presetDirectory: ".pagegraph/agent", defaultModel: "test/model" },
      context: { files: ["AGENTS.md"] },
      runsDirectory: ".pagegraph/runs",
    },
  };
  writeFileSync(join(root, "AGENTS.md"), "Use primary evidence.\n");
  git(root, "init");
  git(root, "config", "user.name", "PageGraph Test");
  git(root, "config", "user.email", "pagegraph@example.com");
  git(root, "add", "AGENTS.md");
  git(root, "commit", "-m", "test fixture");
  return { root, graph, site, config };
};

const options = {
  pages: [] as ReadonlyArray<string>,
  queries: ["email api"] as ReadonlyArray<string>,
  kinds: [] as ReadonlyArray<string>,
  competitors: [] as ReadonlyArray<string>,
  domains: [] as ReadonlyArray<string>,
  limit: 1,
  refresh: false,
  dryRun: false,
  allowDirty: false,
};

const report = (family: string): DecisionBatchReport => ({
  kind: "decide",
  schemaVersion: 1,
  family,
  model: "jev-latest",
  threshold: 0.7,
  counts: { inputs: 1, resolved: 1, review: 0 },
  verdicts: { apply: 1 },
  resolved: [],
  review: [],
});

const executorEvidence = {
  searches: [{ tool: "executor_search", input: { query: "SEO" }, output: ["tools.gsc.performance"] }],
  calls: [{ tool: "executor_execute", input: { code: "return tools.gsc.performance({});" }, output: { rows: [] } }],
};

const noAction = { act: async (): Promise<RunnerResult> => { throw new Error("unexpected action"); } };

const messages: RunnerResult["messages"] = [{ role: "user", content: "Research evidence", timestamp: 1 }];
const usage: RunnerResult["usage"] = {
  input: 100, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 120,
  cost: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0, total: 0.3 },
};

const mutationCases: ReadonlyArray<{
  readonly name: string;
  readonly workflow: WorkflowId;
  readonly family: string;
  readonly file: string;
  readonly before: string;
  readonly after: string;
  readonly state: unknown;
}> = [
  {
    name: "content in Fumadocs-like MDX",
    workflow: "improve.content",
    family: "content",
    file: "content/docs/email.mdx",
    before: "# Email API\n\nOld overview.\n",
    after: "# Email API\n\nSend and observe transactional email from one API.\n",
    state: {
      summary: "The docs overview is thin.",
      items: [{
        url: "/docs/email",
        query: "email api",
        title: "Email API",
        h1: "Email API",
        first150Words: "Old overview.",
        headings: ["Email API"],
        wordCount: 3,
        structuredData: [],
        categoryLock: "email API",
        siblingIntents: ["email pricing"],
        competitorExcerpts: ["A concrete competing overview."],
      }],
    },
  },
  {
    name: "metadata in a TanStack route",
    workflow: "improve.metadata",
    family: "meta",
    file: "src/routes/(marketing)/pricing.tsx",
    before: 'export const title = "Old pricing";\n',
    after: 'export const title = "Email API pricing";\n',
    state: {
      summary: "Two metadata candidates.",
      items: [{
        url: "/pricing",
        intent: "commercial email API pricing",
        categoryLock: "AI-native email for product teams",
        candidates: [
          { id: "a", title: "Email API pricing", description: "Clear pricing for product teams." },
          { id: "b", title: "Samva pricing", description: "Plans for AI-native email." },
        ],
      }],
    },
  },
  {
    name: "schema in a TanStack route",
    workflow: "improve.schema",
    family: "workflow-schema",
    file: "src/routes/(marketing)/pricing.tsx",
    before: "export const jsonLd = [];\n",
    after: 'export const jsonLd = [{ "@type": "OfferCatalog" }];\n',
    state: {
      summary: "Pricing visibly supports an offer catalog.",
      items: [{
        url: "/pricing",
        pageKind: "page",
        routeSource: "src/routes/(marketing)/pricing.tsx",
        existingTypes: [],
        proposedTypes: ["OfferCatalog"],
        evidence: ["Visible pricing tiers"],
      }],
    },
  },
  {
    name: "contextual links in Fumadocs-like MDX",
    workflow: "improve.links",
    family: "workflow-links",
    file: "content/docs/email.mdx",
    before: "See the pricing options.\n",
    after: "See the [pricing options](/pricing).\n",
    state: {
      summary: "The docs page has a useful pricing transition.",
      items: [{
        from: "/docs/email",
        to: "/pricing",
        anchor: "pricing options",
        context: "See the pricing options.",
        relation: "commercial next step",
      }],
    },
  },
];

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("workflow runner", () => {
  it("runs default TypeSafe decisions through HTTP and persists their verdict", async () => {
    const { root, graph, site, config } = fixture();
    const opportunity = {
      query: "email api",
      intent: "commercial",
      rationale: "Matches the pricing page.",
      candidates: [{ path: "/pricing", title: "Pricing", excerpt: "Email API pricing" }],
      evidence: ["executor.search -> keyword tool"],
    };
    vi.stubEnv("TYPESAFE_API_KEY", "test-typesafe-key");
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init);
      expect(request.url).toBe("https://api.typesafe.ai/v1/systemone");
      expect(request.method).toBe("POST");
      expect(request.headers.get("authorization")).toBe("Bearer test-typesafe-key");
      expect(request.headers.get("content-type")).toContain("application/json");
      expect(await request.json()).toMatchObject({
        model: "jev-latest",
        state: opportunity,
        questions: {
          supportedDemand: { type: "noul", criteria: { false: expect.any(String), true: expect.any(String) } },
          productFit: { type: "noul" },
          ownership: { type: "choice", criteria: { existing: expect.any(String), expand: expect.any(String), new: expect.any(String) } },
        },
      });
      return Response.json({
        model: "jev-latest",
        answers: {
          supportedDemand: { type: "noul", noul: 0.95 },
          productFit: { type: "noul", noul: 0.9 },
          ownership: { type: "choice", choice: "expand", probabilities: { existing: 0.05, expand: 0.9, new: 0.05 }, confidence: 0.9 },
        },
        usage: { input_tokens: 123, output_tokens: 45 },
      });
    });
    vi.stubGlobal("fetch", fetch);
    const close = vi.fn(async () => {});
    const result = await runKeywordWorkflow({ config, graph, site, root, options }, {
      acquireRunner: async () => ({ ...noAction,
        model: { provider: "test", id: "model" },
        research: async () => ({
          state: { summary: "One supported opportunity.", opportunities: [opportunity] },
          messages,
          usage, executor: executorEvidence,
        }),
        close,
      }),
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(result.run.result).toEqual({ summary: "One supported opportunity.", opportunities: [opportunity] });
    expect(result.run.decisions[0]?.report).toMatchObject({
      family: "workflow-keywords",
      model: "jev-latest",
      counts: { inputs: 1, resolved: 1, review: 0 },
      verdicts: { expand: 1 },
      resolved: [{
        inputRef: "query:email api",
        verdict: "expand",
        review: false,
        answers: {
          supportedDemand: { probability: 0.95 },
          productFit: { probability: 0.9 },
          ownership: { label: "expand", probabilities: { existing: 0.05, expand: 0.9, new: 0.05 } },
        },
        usage: { inputTokens: 123, outputTokens: 45 },
      }],
    });
    expect(JSON.parse(readFileSync(join(result.directory, "run.json"), "utf8")).decisions).toEqual(result.run.decisions);
  });

  it("persists bounded read-only evidence without changing a dirty tree", async () => {
    const { root, graph, site, config } = fixture();
    writeFileSync(join(root, "AGENTS.md"), "Use primary evidence.\nExisting user change.\n");
    let closed = false;
    const researched: RunnerResult = {
      state: {
        summary: "One supported opportunity.",
        opportunities: [
          {
            query: "email api",
            intent: "commercial",
            rationale: "Matches the pricing page.",
            candidates: [{ path: "/pricing", title: "Pricing", excerpt: "Email API pricing" }],
            evidence: ["executor.search -> keyword tool"],
          },
          {
            query: "second query",
            intent: "informational",
            rationale: "Should be truncated by --limit.",
            candidates: [],
            evidence: ["executor.search -> keyword tool"],
          },
        ],
      },
      messages,
      usage, executor: executorEvidence,
    };

    const result = await runKeywordWorkflow(
      { config, graph, site, root, options },
      {
        now: (() => {
          const dates = [new Date("2026-09-21T10:00:00.000Z"), new Date("2026-09-21T10:00:01.000Z")];
          return () => dates.shift() ?? new Date("2026-09-21T10:00:01.000Z");
        })(),
        acquireRunner: async () => ({ ...noAction,
          model: { provider: "test", id: "model" },
          research: async (spec, prompt, workflowOptions) => {
            expect(prompt).toContain("Return at most 1 items or opportunities.");
            expect(spec.skills).toEqual(["keyword-research"]);
            expect(workflowOptions.signal).toBeInstanceOf(AbortSignal);
            expect(prompt).toContain("Call submit_result");
            return researched;
          },
          close: async () => {
            closed = true;
          },
        }),
        decide: async () => report("workflow-keywords"),
      },
    );

    expect(closed).toBe(true);
    expect(result.run).toMatchObject({
      kind: "pagegraph-workflow-run",
      schemaVersion: 2,
      workflow: "research.keywords",
      model: { provider: "test", id: "model" },
      agent: { runtime: "pi", model: { provider: "test", id: "model" }, messages, usage },
      changes: { files: [] },
      result: { opportunities: [{ query: "email api" }] },
    });
    expect(existsSync(join(result.directory, "summary.md"))).toBe(true);
    expect(existsSync(join(result.directory, "research.json"))).toBe(true);
    expect(JSON.parse(readFileSync(join(result.directory, "run.json"), "utf8"))).toMatchObject({
      evidence: { executor: executorEvidence },
      decisions: [{ family: "workflow-keywords" }],
    });
  });

  it("preserves validated research when the decision provider fails", async () => {
    const { root, graph, site, config } = fixture();
    const providerError = new Error("decision transport failed");
    let closed = false;

    let thrown: unknown;
    try {
      await runKeywordWorkflow(
        { config, graph, site, root, options },
        {
          now: () => new Date("2026-09-21T10:00:00.000Z"),
          acquireRunner: async () => ({ ...noAction,
            model: { provider: "test", id: "model" },
            research: async () => ({
              state: { summary: "One supported opportunity.", opportunities: [{
                query: "email api",
                intent: "commercial",
                rationale: "Matches the pricing page.",
                candidates: [{ path: "/pricing", title: "Pricing", excerpt: "Email API pricing" }],
                evidence: ["executor.search -> keyword tool"],
              }] },
              messages,
              usage, executor: executorEvidence,
            }),
            close: async () => {
              closed = true;
            },
          }),
          decide: async () => {
            throw providerError;
          },
        },
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect(((thrown as Error).cause as Error).cause).toBe(providerError);
    const message = (thrown as Error).message;
    const match = message.match(/Research checkpoint: (.+)$/m);
    expect(match).not.toBeNull();
    const checkpointPath = match?.[1];
    expect(checkpointPath).toBeDefined();
    expect(closed).toBe(true);

    const checkpoint = JSON.parse(readFileSync(checkpointPath!, "utf8")) as Record<string, any>;
    expect(checkpoint).toMatchObject({
      kind: "pagegraph-workflow-research-checkpoint",
      schemaVersion: 2,
      workflow: "research.keywords",
      project: { root, dirtyAtStart: false, filesAtStart: [] },
      evidence: { executor: executorEvidence },
      state: { summary: "One supported opportunity." },
      decisionInputs: [{ query: "email api" }],
      agent: { runtime: "pi", model: { provider: "test", id: "model" }, messages, usage },
    });
    const directory = dirname(checkpointPath!);
    expect(existsSync(join(directory, "run.json"))).toBe(false);
    expect(existsSync(join(directory, "summary.md"))).toBe(false);
  });

  it("detects checkpoint edits made after research during a read-only workflow", async () => {
    const { root, graph, site, config } = fixture();
    let thrown: unknown;

    try {
      await runKeywordWorkflow(
        { config, graph, site, root, options },
        {
          acquireRunner: async () => ({ ...noAction,
            model: { provider: "test", id: "model" },
            research: async () => ({
              state: { summary: "One supported opportunity.", opportunities: [{
                query: "email api",
                intent: "commercial",
                rationale: "Matches the pricing page.",
                candidates: [{ path: "/pricing", title: "Pricing", excerpt: "Email API pricing" }],
                evidence: ["executor.search -> keyword tool"],
              }] },
              messages,
              usage, executor: executorEvidence,
            }),
            close: async () => {},
          }),
          decide: async () => {
            const runId = readdirSync(join(root, ".pagegraph", "runs"))[0];
            const checkpointPath = join(root, ".pagegraph", "runs", runId!, "research.json");
            writeFileSync(checkpointPath, `${readFileSync(checkpointPath, "utf8")}\nchanged after checkpoint\n`);
            return report("workflow-keywords");
          },
        },
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).cause).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain("changed repository files while running in read-only mode");
    expect((thrown as Error).message).toContain("Research checkpoint:");
  });

  it("rejects repository edits made during Pi research and closes the runner", async () => {
    const { root, graph, site, config } = fixture();
    const decide = vi.fn(async () => report("workflow-keywords"));
    const close = vi.fn(async () => {});
    await expect(runKeywordWorkflow({ config, graph, site, root, options }, {
      acquireRunner: async () => ({ ...noAction,
        model: { provider: "test", id: "model" },
        research: async () => {
          writeFileSync(join(root, "AGENTS.md"), "Unexpected edit\n");
          return { state: { summary: "No opportunities", opportunities: [] }, messages, usage, executor: executorEvidence };
        },
        close,
      }),
      decide,
    })).rejects.toThrow("changed repository files during its read-only research turn");
    expect(decide).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("refuses a dirty improve workflow before acquiring its runner", async () => {
    const { root, graph, site, config } = fixture();
    writeFileSync(join(root, "AGENTS.md"), "Existing user edit\n");
    const acquireRunner = vi.fn(async () => { throw new Error("unexpected acquisition"); });
    await expect(runWorkflow({ root, graph, site, config, workflow: "improve.metadata", options }, { acquireRunner }))
      .rejects.toThrow("dirty Git tree");
    expect(acquireRunner).not.toHaveBeenCalled();
    expect(readFileSync(join(root, "AGENTS.md"), "utf8")).toBe("Existing user edit\n");
  });

  it("records changed files in an improve dry-run as a failure", async () => {
    const { root, graph, site, config } = fixture();
    await expect(runWorkflow({ root, graph, site, config, workflow: "improve.metadata", options: { ...options, dryRun: true } }, {
      acquireRunner: async () => ({
        model: { provider: "test", id: "model" },
        research: async () => ({ state: mutationCases[1]!.state, messages, usage, executor: executorEvidence }),
        act: async (_spec, _prompt, actionOptions) => {
          expect(actionOptions.mode).toBe("dry-run");
          writeFileSync(join(root, "AGENTS.md"), "Unexpected action edit\n");
          return { state: { summary: "Preview", files: [], outcome: "dry-run" }, messages, usage, executor: executorEvidence };
        },
        close: async () => {},
      }),
      decide: async () => report("meta"),
    })).rejects.toThrow("changed repository files while running in read-only mode");
  });

  it.each(mutationCases)("applies $name in the same runner and records its source diff", async (testCase) => {
    const { root, graph, site, config } = fixture();
    mkdirSync(dirname(join(root, testCase.file)), { recursive: true });
    writeFileSync(join(root, testCase.file), testCase.before);
    git(root, "add", testCase.file);
    git(root, "commit", "-m", "add workflow source");
    let acted = false;

    const result = await runWorkflow(
      { config, graph, site, root, workflow: testCase.workflow, options },
      {
        acquireRunner: async () => ({ ...noAction,
          model: { provider: "test", id: "model" },
          research: async (_spec, _prompt, workflowOptions) => {
            expect(workflowOptions.signal).toBeInstanceOf(AbortSignal);
            return {
              state: testCase.state,
              messages, usage, executor: executorEvidence,
            };
          },
          act: async (_spec, _prompt, workflowOptions) => {
            acted = true;
            expect(workflowOptions.mode).toBe("write");
            expect(workflowOptions.signal).toBeInstanceOf(AbortSignal);
            writeFileSync(join(root, testCase.file), testCase.after);
            return {
              state: { summary: `Updated ${testCase.workflow}.`, files: [testCase.file], outcome: "applied" },
              messages, usage, executor: executorEvidence,
            };
          },
          close: async () => {},
        }),
        decide: async () => testCase.workflow === "improve.links"
          ? { ...report(testCase.family), resolved: [{ decisionId: "workflow-links:0", schemaVersion: 1, family: "workflow-links", model: "jev-latest", threshold: 0.7, inputHash: "fixture", inputRef: "/docs/email → /pricing", verdict: "add", review: false, answers: {} }] }
          : report(testCase.family),
      },
    );

    expect(result.run.agent).toMatchObject({ runtime: "pi", messages, usage });
    expect(acted).toBe(true);
    expect(result.run.changes.files).toEqual([testCase.file]);
    expect(result.run.result).toEqual({
      summary: `Updated ${testCase.workflow}.`,
      files: [testCase.file],
      outcome: "applied",
    });
    expect(readFileSync(join(root, testCase.file), "utf8")).toBe(testCase.after);
  });

  it.each(["skip", "review"])("never opens an edit turn for %s link suggestions", async (verdict) => {
    const { root, graph, site, config } = fixture();
    graph.nodes.set("/docs/email", { path: "/docs/email", kind: "page", source: "route", policy: { kind: "page", sitemap: { priority: 0.5, changeFrequency: "monthly" } } });
    const suggestion = { source: "/docs/email", destination: "/pricing", cluster: "kind:page", reason: "same kind; pricing options are relevant", sentence: "See the pricing options for transactional email teams.", anchor: "pricing options", targetSentence: "Pricing options include usage based plans for teams.", score: 4, scores: { topical: 2, rarity: 1, inboundNeed: 1, graph: 0.5 } };
    const path = join(root, "suggestions.json");
    writeFileSync(path, JSON.stringify({ kind: "links-candidates", schemaVersion: 2, origin: site.origin, limit: 1, pageLimit: 2, maxBodyBytes: 3_000_000, total: 1, truncated: false, skipped: [], candidates: [suggestion] }));
    git(root, "add", "suggestions.json"); git(root, "commit", "-m", "add suggestions");
    const state = { summary: "One candidate", items: [{ from: suggestion.source, to: suggestion.destination, anchor: suggestion.anchor, context: suggestion.sentence, relation: "pricing" }] };
    let continued = false;
    const result = await runWorkflow({ config, graph, site, root, workflow: "improve.links", options: { ...options, limit: 2, suggestions: path } }, {
      acquireRunner: async (runnerOptions) => {
        expect(runnerOptions.runsDirectory).toBe(join(root, ".pagegraph/runs"));
        expect(runnerOptions.additionalTools?.map((tool) => tool.name)).toEqual(["fetch_page"]);
        return { ...noAction,
        model: { provider: "test", id: "model" },
        research: async (_spec, prompt) => { expect(prompt).toContain(suggestion.sentence); return { state, messages, usage, executor: executorEvidence }; },
        act: async () => { continued = true; throw new Error("edit turn opened"); },
        close: async () => {},
        };
      },
      decide: async () => ({ ...report("workflow-links"), resolved: verdict === "skip" ? [{ decisionId: "workflow-links:0", schemaVersion: 1, family: "workflow-links", model: "jev-latest", threshold: 0.7, inputHash: "fixture", inputRef: "/docs/email → /pricing", verdict, review: false, answers: {} }] : [], review: verdict === "review" ? [{ decisionId: "workflow-links:0", schemaVersion: 1, family: "workflow-links", model: "jev-latest", threshold: 0.7, inputHash: "fixture", inputRef: "/docs/email → /pricing", verdict, review: true, answers: {} }] : [] }),
    });
    expect(continued).toBe(false);
    expect(result.run.result).toMatchObject({ outcome: "no-change" });
    expect(result.run.evidence.suggestions?.candidates[0]).toMatchObject({ sentence: suggestion.sentence, anchor: suggestion.anchor });
    expect(result.run.changes.files).toEqual([]);
  });

  it("rejects a wrong-origin suggestion before acquiring a runner", async () => {
    const { root, graph, site, config } = fixture();
    const path = join(root, "wrong.json");
    writeFileSync(path, JSON.stringify({ kind: "links-candidates", schemaVersion: 2, origin: "https://other.example", candidates: [] }));
    git(root, "add", "wrong.json"); git(root, "commit", "-m", "add wrong suggestions");
    let acquired = false;
    await expect(runWorkflow({ config, graph, site, root, workflow: "improve.links", options: { ...options, suggestions: path } }, {
      acquireRunner: async () => { acquired = true; throw new Error("runner acquired"); },
    })).rejects.toThrow("Expected schema-version-2 suggestions");
    expect(acquired).toBe(false);
  });

  it("rejects suggestions outside --page targets before acquiring a runner", async () => {
    const { root, graph, site, config } = fixture();
    graph.nodes.set("/docs/email", { path: "/docs/email", kind: "page", source: "route", policy: { kind: "page", sitemap: { priority: 0.5, changeFrequency: "monthly" } } });
    const path = join(root, "suggestions.json");
    writeFileSync(path, JSON.stringify({ kind: "links-candidates", schemaVersion: 2, origin: site.origin, limit: 1, pageLimit: 2, maxBodyBytes: 3_000_000, total: 1, truncated: false, skipped: [], candidates: [{ source: "/docs/email", destination: "/pricing", cluster: "kind:page", reason: "same kind", sentence: "See the pricing options for transactional email teams.", anchor: "pricing options", targetSentence: "Pricing options include usage based plans for teams.", score: 4, scores: { topical: 2, rarity: 1, inboundNeed: 1, graph: 0.5 } }] }));
    git(root, "add", "suggestions.json"); git(root, "commit", "-m", "add suggestions");
    let acquired = false;
    await expect(runWorkflow({ config, graph, site, root, workflow: "improve.links", options: { ...options, pages: ["/pricing"], suggestions: path } }, {
      acquireRunner: async () => { acquired = true; throw new Error("runner acquired"); },
    })).rejects.toThrow("outside workflow page/kind/limit targets");
    expect(acquired).toBe(false);
  });

  it("blocks an accepted edit when served suggestion copy has changed", async () => {
    const { root, graph, site, config } = fixture();
    graph.nodes.set("/docs/email", { path: "/docs/email", kind: "page", source: "route", policy: { kind: "page", sitemap: { priority: 0.5, changeFrequency: "monthly" } } });
    const candidate = { source: "/docs/email", destination: "/pricing", cluster: "kind:page", reason: "same kind", sentence: "See the pricing options for transactional email teams.", anchor: "pricing options", targetSentence: "Pricing options include usage based plans for teams.", score: 4, scores: { topical: 2, rarity: 1, inboundNeed: 1, graph: 0.5 } };
    const path = join(root, "suggestions.json");
    writeFileSync(path, JSON.stringify({ kind: "links-candidates", schemaVersion: 2, origin: site.origin, limit: 1, pageLimit: 2, maxBodyBytes: 3_000_000, total: 1, truncated: false, skipped: [], candidates: [candidate] }));
    git(root, "add", "suggestions.json"); git(root, "commit", "-m", "add suggestions");
    let continued = false;
    await expect(runWorkflow({ config, graph, site, root, workflow: "improve.links", options: { ...options, limit: 2, suggestions: path } }, {
      acquireRunner: async () => ({ ...noAction,
        model: { provider: "test", id: "model" },
        research: async () => ({ state: { summary: "One suggestion", items: [{ from: candidate.source, to: candidate.destination, anchor: candidate.anchor, context: candidate.sentence, relation: "plans" }] }, messages, usage, executor: executorEvidence }),
        act: async () => { continued = true; throw new Error("edit turn opened"); },
        close: async () => {},
      }),
      decide: async () => ({ ...report("workflow-links"), resolved: [{ decisionId: "workflow-links:0", schemaVersion: 1, family: "workflow-links", model: "jev-latest", threshold: 0.7, inputHash: "fixture", inputRef: "/docs/email → /pricing", verdict: "add", review: false, answers: {} }] }),
      readSuggestionSentences: async (_origin, page, _allowPrivate, maxBodyBytes) => {
        expect(maxBodyBytes).toBe(3_000_000);
        return page === candidate.source ? ["The source page no longer mentions plans."] : [candidate.targetSentence];
      },
    })).rejects.toThrow("Suggestion is stale");
    expect(continued).toBe(false);
  });

  it("passes only the accepted item when links share the same source and target", async () => {
    const { root, graph, site, config } = fixture();
    const accepted = { from: "/docs/email", to: "/pricing", anchor: "pricing options", context: "See pricing options for teams.", relation: "plans" };
    const rejected = { ...accepted, anchor: "cheap offers", context: "Find cheap offers today." };
    let actionPrompt = "";
    await runWorkflow({ config, graph, site, root, workflow: "improve.links", options }, {
      acquireRunner: async () => ({ ...noAction,
        model: { provider: "test", id: "model" },
        research: async () => ({ state: { summary: "Two proposals", items: [accepted, rejected] }, messages, usage, executor: executorEvidence }),
        act: async (_spec, prompt) => { actionPrompt = prompt; return { state: { summary: "One edit", files: [], outcome: "applied" }, messages, usage, executor: executorEvidence }; },
        close: async () => {},
      }),
      decide: async () => ({ ...report("workflow-links"), resolved: [{ decisionId: "workflow-links:0", schemaVersion: 1, family: "workflow-links", model: "jev-latest", threshold: 0.7, inputHash: "fixture", inputRef: "/docs/email → /pricing", verdict: "add", review: false, answers: {} }],
        review: [{ decisionId: "workflow-links:1", schemaVersion: 1, family: "workflow-links", model: "jev-latest", threshold: 0.7, inputHash: "fixture", inputRef: "/docs/email → /pricing", verdict: "review", review: true, answers: {} }] }),
    });
    expect(actionPrompt).toContain(accepted.anchor);
    expect(actionPrompt).not.toContain(rejected.anchor);
  });

  it("keeps an accepted suggestion read-only in dry-run mode", async () => {
    const { root, graph, site, config } = fixture();
    const item = { from: "/docs/email", to: "/pricing", anchor: "pricing options", context: "See pricing options for teams.", relation: "plans" };
    let continued = false;
    const result = await runWorkflow({ config, graph, site, root, workflow: "improve.links", options: { ...options, dryRun: true } }, {
      acquireRunner: async () => ({ ...noAction,
        model: { provider: "test", id: "model" },
        research: async () => ({ state: { summary: "One proposal", items: [item] }, messages, usage, executor: executorEvidence }),
        act: async (_spec, prompt, workflowOptions) => {
          continued = true;
          expect(prompt).toContain("Do not edit files");
          expect(workflowOptions.mode).toBe("dry-run");
          return { state: { summary: "Preview", files: [], outcome: "dry-run" }, messages, usage, executor: executorEvidence };
        },
        close: async () => {},
      }),
      decide: async () => ({ ...report("workflow-links"), resolved: [{ decisionId: "workflow-links:0", schemaVersion: 1, family: "workflow-links", model: "jev-latest", threshold: 0.7, inputHash: "fixture", inputRef: "/docs/email → /pricing", verdict: "add", review: false, answers: {} }] }),
    });
    expect(continued).toBe(true);
    expect(result.run.changes.files).toEqual([]);
  });

});

 describe("workflow research failures", () => {
  it("persists the actual messages when discovery has no completed provider call", async () => {
    const { root, graph, site, config } = fixture();
    const result = { messages, usage, executor: { searches: [], calls: [] } };
    let closed = false;
    await expect(runWorkflow({ root, graph, site, config, workflow: "improve.links", options }, {
      acquireRunner: async () => ({ ...noAction, model: { provider: "test", id: "model" },
        research: async () => { throw new WorkflowRunnerError("Missing completed Executor evidence", result); },
        act: async () => { throw new Error("unexpected continuation"); },
        close: async () => { closed = true; },
      }),
    })).rejects.toThrow("Failure artifact:");
    const directory = join(root, ".pagegraph/runs", readdirSync(join(root, ".pagegraph/runs"))[0]!);
    expect(JSON.parse(readFileSync(join(directory, "failure.json"), "utf8")).agent.messages).toEqual(result.messages);
    expect(closed).toBe(true);
  });


});


describe("workflow wire JSON normalization", () => {
  it("drops null object properties and array elements at every depth without mutating input", () => {
    const input = { demand: null, nested: { retained: 0, empty: null }, values: [null, { absent: null, present: false }, [null, { name: "kept", ignored: null }], ""] };
    expect(dropNulls(input)).toEqual({ nested: { retained: 0 }, values: [{ present: false }, [{ name: "kept" }], ""] });
    expect(input.demand).toBeNull();
    expect(input.values[0]).toBeNull();
  });

  it("decodes null optional demand from a Pi runner before decisions", async () => {
    const { root, graph, site, config } = fixture();
    const state = { summary: "Supported", opportunities: [{ query: "email api", intent: "commercial", rationale: "Fits pricing", demand: null, candidates: [], evidence: [] }] };
    const decide = vi.fn(async (inputs: ReadonlyArray<unknown>) => {
      expect(inputs).toEqual([{ query: "email api", intent: "commercial", rationale: "Fits pricing", candidates: [], evidence: [] }]);
      return report("workflow-keywords");
    });
    await runKeywordWorkflow({ root, graph, site, config, options }, {
      acquireRunner: async () => ({ ...noAction, model: { provider: "test", id: "model" }, research: async () => ({ state, messages, usage, executor: executorEvidence }), close: async () => {} }),
      decide,
    });
    expect(decide).toHaveBeenCalledTimes(1);
  });

});

describe("workflow failure artifacts", () => {
  const readFailure = (root: string) => {
    const runs = join(root, ".pagegraph/runs");
    expect(readdirSync(runs)).toHaveLength(1);
    const directory = join(runs, readdirSync(runs)[0]!);
    expect(readdirSync(directory).filter((name) => name.includes("failure"))).toEqual(["failure.json"]);
    const path = join(directory, "failure.json");
    return { path, artifact: JSON.parse(readFileSync(path, "utf8")) };
  };

  it.each([
    { name: "research deadline", message: "Pi turn did not complete within 180000ms", underlying: new Error("Transport aborted") },
    { name: "no JSON", message: "The SEO agent did not return a valid workflow JSON object.", underlying: new SyntaxError("Unexpected end of JSON input") },
    { name: "UnexpectedStatus", message: "Pi request: UnexpectedStatus (HTTP 500)", underlying: new Error("UnexpectedStatus", { cause: new Error("provider unavailable") }) },
  ])("persists messages, usage and the full cause for $name", async ({ message, underlying }) => {
    const { root, graph, site, config } = fixture();
    const error = new WorkflowRunnerError(message, { messages, usage, executor: executorEvidence }, { cause: underlying });
    const close = vi.fn(async () => {});
    const thrown = await runWorkflow({ root, graph, site, config, workflow: "improve.links", options }, {
      acquireRunner: async () => ({ ...noAction, model: { provider: "test", id: "model" }, research: async () => { throw error; }, act: async () => { throw new Error("unexpected continuation"); }, close }),
    }).catch((cause: unknown) => cause);
    const { path, artifact } = readFailure(root);
    expect(artifact).toMatchObject({ kind: "pagegraph-workflow-failure", schemaVersion: 2, id: expect.any(String), workflow: "improve.links", stage: "research", agent: { runtime: "pi", messages, usage }, cause: { message, name: error.name, stack: expect.any(String), cause: { message: underlying.message, name: underlying.name } } });
    if (underlying.cause instanceof Error) expect(artifact.cause.cause.cause).toMatchObject({ message: "provider unavailable", name: "Error" });
    expect((thrown as Error).message).toContain(`Failure artifact: ${path}\nNext:`);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("persists partial Pi messages and usage when research fails", async () => {
    const { root, graph, site, config } = fixture();
    const underlying = new Error("model transport failed");
    const original = new WorkflowRunnerError("Pi research aborted", { messages, usage, executor: executorEvidence }, { cause: underlying });
    const close = vi.fn(async () => {});
    const thrown = await runKeywordWorkflow({ root, graph, site, config, options }, {
      acquireRunner: async () => ({ ...noAction, model: { provider: "test", id: "model" }, research: async () => { throw original; }, close }),
    }).catch((cause: unknown) => cause);
    const { artifact } = readFailure(root);
    expect(artifact).toMatchObject({
      schemaVersion: 2, stage: "research", workflow: "research.keywords",
      agent: { runtime: "pi", model: { provider: "test", id: "model" }, messages, usage },
      cause: { message: original.message, cause: { message: underlying.message } },
    });
    expect((thrown as Error).cause).toBe(original);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("writes an acquire failure even when no session exists", async () => {
    const { root, graph, site, config } = fixture();
    const original = new Error("host unavailable", { cause: new Error("connection refused") });
    const thrown = await runKeywordWorkflow({ root, graph, site, config, options }, { acquireRunner: async () => { throw original; } }).catch((cause: unknown) => cause);
    const { path, artifact } = readFailure(root);
    expect(artifact).toMatchObject({ stage: "acquire", cause: { message: original.message, name: "Error", cause: { message: "connection refused" } } });
    expect(artifact.agent).toBeUndefined();
    expect((thrown as Error).message).toContain(`Failure artifact: ${path}\nNext:`);
  });

  it.each(["decide", "action"] as const)("writes a %s failure with the research messages and usage", async (stage) => {
    const { root, graph, site, config } = fixture();
    const testCase = mutationCases[1]!;
    const original = new Error(`${stage} failed`, { cause: new Error("provider unavailable") });
    const thrown = await runWorkflow({ root, graph, site, config, workflow: testCase.workflow, options: { ...options, dryRun: true } }, {
      acquireRunner: async () => ({ ...noAction, model: { provider: "test", id: "model" }, research: async () => ({ state: testCase.state, messages, usage, executor: executorEvidence }), act: async () => { throw original; }, close: async () => {} }),
      decide: async () => { if (stage === "decide") throw original; return report(testCase.family); },
    }).catch((cause: unknown) => cause);
    const { path, artifact } = readFailure(root);
    expect(artifact).toMatchObject({ stage, agent: { runtime: "pi", messages, usage }, cause: { message: expect.stringContaining(`${stage} failed`), cause: { message: original.message, cause: { message: "provider unavailable" } } } });
    expect((thrown as Error).message).toContain(`Failure artifact: ${path}\nNext:`);
  });
});


describe("workflow error boundaries", () => {
  it("reports all schema issues within an individual decision input", () => {
    const spec = getWorkflowSpec("improve.metadata");
    let thrown: unknown;
    try { spec.validateDecisionInput({ url: 42, intent: false, categoryLock: "email API", candidates: [] }); } catch (cause) { thrown = cause; }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain("url");
    expect((thrown as Error).message).toContain("intent");
  });

  it("keeps the original error when writing its failure artifact is impossible", async () => {
    const { root, graph, site, config } = fixture();
    const original = new Error("host unavailable");
    const thrown = await runKeywordWorkflow({ root, graph, site, config, options, out: "AGENTS.md" }, {
      acquireRunner: async () => { throw original; },
    }).catch((cause: unknown) => cause);
    expect(thrown).toBe(original);
    expect(original.message).toContain("host unavailable");
    expect(original.message).toContain("Could not write failure artifact:");
  });

  it("keeps a research failure when closing the runner also fails", async () => {
    const { root, graph, site, config } = fixture();
    const original = new WorkflowRunnerError("research failed", { messages, usage, executor: executorEvidence }, { cause: new Error("provider unavailable") });
    const thrown = await runWorkflow({ root, graph, site, config, workflow: "improve.links", options }, {
      acquireRunner: async () => ({ ...noAction, model: { provider: "test", id: "model" }, research: async () => { throw original; }, act: async () => { throw new Error("unexpected continuation"); }, close: async () => { throw new Error("cleanup failed"); } }),
    }).catch((cause: unknown) => cause);
    expect((thrown as Error).cause).toBe(original);
    expect((thrown as Error).message).toContain("research failed");
    const directory = join(root, ".pagegraph/runs", readdirSync(join(root, ".pagegraph/runs"))[0]!);
    const artifact = JSON.parse(readFileSync(join(directory, "failure.json"), "utf8"));
    expect(artifact).toMatchObject({ stage: "research", agent: { runtime: "pi", messages, usage }, cause: { message: "research failed", cause: { message: "provider unavailable" } } });
  });
});
