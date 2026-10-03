import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Decision, DecisionModel } from "effect/ai";
import { afterAll, describe, expect, it } from "vitest";

import { claimsInput, claimsInputs, claimsRunOptions, replayClaims, resolveClaimsDocuments, runClaims, type ClaimsOptions } from "../../src/claims";
import { hashDocument, type PageDocument } from "../../src/markdown/document";

const directories: Array<string> = [];
const directory = () => {
  const root = mkdtempSync(join(tmpdir(), "pagegraph-claims-"));
  directories.push(root);
  return root;
};
afterAll(() => directories.forEach((root) => rmSync(root, { recursive: true, force: true })));
const document: PageDocument = {
  path: "/pricing", title: "Pricing", description: "Usage based pricing",
  hash: "a".repeat(64), messages: [], facts: [],
  sections: [{ id: "offer", kind: "hero", claimsMarkdown: "All plans include support.", body: [], items: [], source: "pricing.tsx:2", audience: "all" }],
};
const rules = (instructions = "Does this promise an unavailable feature?") => Decision.make({
  input: claimsInput,
  decisions: { unavailable: Decision.probability({ instructions }) },
});
const options: ClaimsOptions = { rules: rules(), model: "mock" };
const model = (probability: number, called = () => {}) => Layer.effect(
  DecisionModel.DecisionModel,
  DecisionModel.make({ decide: ({ decisions }) => Effect.sync(() => {
    called();
    return { answers: Object.fromEntries(Object.keys(decisions).map((name) => [name, { _tag: "Probability" as const, probability }])), usage: { inputTokens: 1, outputTokens: 1 } };
  }) }),
);
const run = (root: string, probability: number, config = options, refresh = false, called = () => {}) =>
  Effect.runPromise(runClaims(root, [document], [], {}, config, { refresh }).pipe(Effect.provide(model(probability, called))));

describe("claims", () => {
  it("uses a one-sided cutoff with inclusive violation boundary and preserves explicit zero", async () => {
    const root = directory();
    expect((await run(root, 0.79)).findings).toEqual([]);
    const violation = await run(root, 0.8, options, true);
    expect(violation.findings).toHaveLength(2);
    expect(violation.findings[0]).toMatchObject({ path: "/pricing", section: "offer", source: "pricing.tsx:2", rule: "unavailable", probability: 0.8 });
    expect((await run(root, 0.5, { ...options, cutoff: 0.6 }, true)).findings).toEqual([]);
    expect((await run(root, 0, { ...options, cutoff: 0 }, true)).findings).toHaveLength(2);
  });
  it("reuses committed answers, refreshes when requested, and fails replay misses without a model", async () => {
    const root = directory();
    const missing = await Effect.runPromise(Effect.flip(replayClaims(root, [document], [], {}, options)));
    expect(missing).toMatchObject({ _tag: "DecisionCacheMiss" });
    expect(missing.message).toContain("/pricing › offer");
    expect(missing.message).toContain("unavailable");
    expect(missing.message).toContain("pagegraph claims check");
    let calls = 0;
    expect(await run(root, 0.1, options, false, () => calls++)).toMatchObject({ cached: 0, asked: 2 });
    expect(await run(root, 1, options, false, () => calls++)).toMatchObject({ cached: 2, asked: 0, findings: [] });
    expect(calls).toBe(2);
    expect(await Effect.runPromise(replayClaims(root, [document], [], {}, options))).toMatchObject({ cached: 2, asked: 0 });
    await run(root, 0.9, options, true, () => calls++);
    expect(calls).toBe(4);
    const failed = await Effect.runPromise(Effect.flip(replayClaims(root, [document], [], {}, options)));
    expect(failed).toMatchObject({ _tag: "ClaimsFailed", report: { cached: 2, asked: 0 } });
    expect(failed.message).toContain("/pricing › offer: unavailable");
  });
  it("fingerprints rule instructions, model, authored input, context and facts while cutoff stays reusable", async () => {
    const root = directory();
    await run(root, 0.7);
    expect((await Effect.runPromise(replayClaims(root, [document], [], {}, { ...options, cutoff: 0.75 }))).findings).toEqual([]);
    for (const config of [{ ...options, rules: rules("Different instructions") }, { ...options, model: "other" }, { ...options, context: "Policy" }]) {
      expect(await Effect.runPromise(Effect.flip(replayClaims(root, [document], [], {}, config)))).toMatchObject({ _tag: "DecisionCacheMiss" });
    }
    expect(await Effect.runPromise(Effect.flip(replayClaims(root, [document], [], { plan: { kind: "text", value: "Free", text: "Free" } }, options)))).toMatchObject({ _tag: "DecisionCacheMiss" });
    expect(await Effect.runPromise(Effect.flip(replayClaims(root, [{ ...document, title: "Plans" }], [], {}, options)))).toMatchObject({ _tag: "DecisionCacheMiss" });
  });
  it("uses authored evidence and metadata while ignoring source relocation", () => {
    const evidence = { ...document.sections[0]!, id: "proof", claimsMarkdown: "Dated primary source", evidence: true };
    const captured = { ...document, sections: [...document.sections, evidence] };
    const inputs = claimsInputs([captured], [{ path: "/about", title: "About", description: "Founder support" }], {}, options);
    expect(inputs).toHaveLength(4);
    expect(inputs[0]).toMatchObject({ evidence: "Dated primary source", section: { markdown: "All plans include support." } });
    expect(inputs[1]?.evidence).toBeUndefined();
    expect(inputs[3]).toMatchObject({ path: "/about", section: { id: "head", markdown: "About\n\nFounder support" } });
    expect(claimsInputs([{ ...document, sections: document.sections.map((section) => ({ ...section, source: "other.tsx" })) }], [], {}, options)).toEqual(claimsInputs([document], [], {}, options));
    const resolved = resolveClaimsDocuments([], [{ path: "/about", title: "About", description: "Founder support" }]);
    const { hash, ...content } = resolved[0]!;
    expect(hash).toBe(hashDocument(content));
    expect(() => resolveClaimsDocuments([document], [{ path: document.path, title: document.title, description: document.description }])).toThrow("Duplicate claims page");
    expect(() => resolveClaimsDocuments([], [content, content])).toThrow("Duplicate claims head");
    expect(claimsInputs([document], [{ path: "/docs/start", title: "Docs", description: "Read docs" }], {}, { excludeHeads: ["/docs/**", "/pricing"] })).toHaveLength(1);
  });
  it("validates explicit cutoffs and required configuration", () => {
    for (const cutoff of [-1, 2, NaN]) expect(() => claimsRunOptions(directory(), [], [], {}, { ...options, cutoff })).toThrow("cutoff");
    // @ts-expect-error JavaScript config must reject an explicitly null cutoff.
    expect(() => claimsRunOptions(directory(), [], [], {}, { ...options, cutoff: null })).toThrow("cutoff");
    expect(() => claimsRunOptions(directory(), [], [], {}, { ...options, model: "" })).toThrow("model");
    expect(() => claimsRunOptions(directory(), [], [], {}, { ...options, rules: Decision.make({ input: claimsInput, decisions: {} }) })).toThrow("decisions");
  });
});
