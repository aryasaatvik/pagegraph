import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { Decision, DecisionModel } from "effect/ai";
import { afterAll, describe, expect, it } from "vitest";

import { cacheKey, definitionFingerprint, inputHash } from "../../src/decide/answers";
import type { DecisionCache } from "../../src/decide/cache";
import { replayDecisions, runDecisions, type DecisionFamily } from "../../src/decide/run";

interface Claim {
  readonly id: string;
}
const Claim = Schema.Struct({ id: Schema.String });

const definition = (instructions: string) =>
  Decision.make({
    input: Claim,
    decisions: { falseClaim: Decision.probability({ instructions }) },
  });

/** One-sided like a gate: any probability at or above the cutoff is a violation. */
const gateFamily = (instructions = "The claim is false"): DecisionFamily<Claim> => ({
  name: "gate",
  input: Claim,
  definitionFor: () => definition(instructions),
  inputRef: (input) => input.id,
  evaluate: (_input, answers, cutoff) =>
    (answers as { falseClaim: { probability: number } }).falseClaim.probability >= cutoff ? "violation" : "pass",
});

const model = (value: number, calls: { count: number }) =>
  Layer.effect(
    DecisionModel.DecisionModel,
    DecisionModel.make({
      decide: ({ decisions }) =>
        Effect.sync(() => {
          calls.count += 1;
          return {
            answers: Object.fromEntries(
              Object.keys(decisions).map((key) => [key, { _tag: "Probability" as const, probability: value }]),
            ),
            usage: { inputTokens: 1, outputTokens: 1 },
          };
        }),
    }),
  );

const directories: Array<string> = [];
const committed = (): DecisionCache => {
  const directory = mkdtempSync(join(tmpdir(), "pagegraph-decide-cache-"));
  directories.push(directory);
  return { directory, policy: "committed" };
};
afterAll(() => {
  for (const directory of directories) rmSync(directory, { recursive: true, force: true });
});

const inputs: ReadonlyArray<Claim> = [{ id: "pricing › hero" }, { id: "about › story" }];
const options = (cache: DecisionCache, family = gateFamily()) =>
  ({ family, inputs, model: "jev-latest", threshold: 0.8, cache }) as const;

describe("committed cache", () => {
  it("replays committed answers without a model", async () => {
    const cache = committed();
    const asked = { count: 0 };
    await Effect.runPromise(runDecisions(options(cache)).pipe(Effect.provide(model(0.1, asked))));
    expect(asked.count).toBe(2);

    const report = await Effect.runPromise(replayDecisions(options(cache)));
    expect(report.verdicts).toEqual({ pass: 2 });
    expect(report.resolved.every((record) => record.usage === undefined)).toBe(true);
  });

  it("fails replay on a missing answer", async () => {
    const exit = await Effect.runPromiseExit(replayDecisions(options(committed())));
    expect(Exit.isFailure(exit)).toBe(true);
    expect(JSON.stringify(exit)).toContain("DecisionCacheMiss");
  });

  it("fails on a malformed committed answer instead of re-asking", async () => {
    const cache = committed();
    const family = gateFamily();
    const key = cacheKey({
      family: family.name,
      model: "jev-latest",
      decisions: family.definitionFor(inputs[0]!).decisions,
      inputHash: inputHash(inputs[0]),
    });
    writeFileSync(join(cache.directory, `${key}.json`), '{"falseClaim":{"probability":5}}\n');

    const asked = { count: 0 };
    const exit = await Effect.runPromiseExit(
      runDecisions(options(cache)).pipe(Effect.provide(model(0.1, asked))),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    expect(JSON.stringify(exit)).toContain("DecisionCacheInvalid");
  });

  it("fails on unreadable committed JSON but treats it as a miss in a scratch cache", async () => {
    const family = gateFamily();
    const key = cacheKey({
      family: family.name,
      model: "jev-latest",
      decisions: family.definitionFor(inputs[0]!).decisions,
      inputHash: inputHash(inputs[0]),
    });
    const strict = committed();
    writeFileSync(join(strict.directory, `${key}.json`), "{ not json");
    const exit = await Effect.runPromiseExit(
      runDecisions(options(strict)).pipe(Effect.provide(model(0.1, { count: 0 }))),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    expect(JSON.stringify(exit)).toContain("are not readable JSON");

    const scratch: DecisionCache = { directory: committed().directory, policy: "scratch" };
    writeFileSync(join(scratch.directory, `${key}.json`), "{ not json");
    const asked = { count: 0 };
    const report = await Effect.runPromise(runDecisions(options(scratch)).pipe(Effect.provide(model(0.1, asked))));
    expect(asked.count).toBe(2);
    expect(report.verdicts).toEqual({ pass: 2 });
  });

  it("writes atomically and leaves no staging files", async () => {
    const cache = committed();
    await Effect.runPromise(runDecisions(options(cache)).pipe(Effect.provide(model(0.9, { count: 0 }))));
    const files = readdirSync(cache.directory);
    expect(files).toHaveLength(2);
    expect(files.every((file) => file.endsWith(".json"))).toBe(true);
    const answers = JSON.parse(readFileSync(join(cache.directory, files[0]!), "utf8"));
    expect(answers).toEqual({ falseClaim: { probability: 0.9 } });
  });

  it("re-asks every input on refresh", async () => {
    const cache = committed();
    await Effect.runPromise(runDecisions(options(cache)).pipe(Effect.provide(model(0.1, { count: 0 }))));
    const asked = { count: 0 };
    const report = await Effect.runPromise(
      runDecisions({ ...options(cache), refresh: true }).pipe(Effect.provide(model(0.95, asked))),
    );
    expect(asked.count).toBe(2);
    expect(report.verdicts).toEqual({ violation: 2 });
    expect((await Effect.runPromise(replayDecisions(options(cache)))).verdicts).toEqual({ violation: 2 });
  });
});

describe("definition fingerprint", () => {
  it("invalidates answers when the instructions change", async () => {
    const cache = committed();
    await Effect.runPromise(runDecisions(options(cache)).pipe(Effect.provide(model(0.1, { count: 0 }))));
    const exit = await Effect.runPromiseExit(
      replayDecisions(options(cache, gateFamily("The claim overstates what ships"))),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    expect(JSON.stringify(exit)).toContain("DecisionCacheMiss");
  });

  it("does not depend on key order", () => {
    const left = { a: Decision.probability({ instructions: "A" }), b: Decision.probability({ instructions: "B" }) };
    const right = { b: Decision.probability({ instructions: "B" }), a: Decision.probability({ instructions: "A" }) };
    expect(definitionFingerprint(left)).toBe(definitionFingerprint(right));
  });

  it("separates criteria from instructions", () => {
    const plain = { a: Decision.probability({ instructions: "A" }) };
    const withCriteria = {
      a: Decision.probability({ instructions: "A", criteria: { false: "no", true: "yes" } }),
    };
    expect(definitionFingerprint(plain)).not.toBe(definitionFingerprint(withCriteria));
  });
});
