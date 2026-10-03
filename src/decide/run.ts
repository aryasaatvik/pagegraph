/**
 * The decision runner. A family supplies its input schema, a definition built
 * from the input (families with dynamic labels build one per input), a way to
 * reference the input in a report, and a pure `evaluate` that maps the model's
 * answers to a verdict. The runner hashes, reads and writes the answer cache,
 * dispatches with bounded concurrency, and buckets confident answers apart from
 * `review`. `runDecisions` asks the model on a miss; `replayDecisions` answers
 * from a committed cache alone and fails on a miss.
 *
 * Build and CLI entries reach Effect and the provider through this module;
 * runtime entries remain Effect-free and Node-free.
 */

import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { DecisionModel } from "effect/ai";
import type * as AiError from "effect/ai/AiError";
import type * as Decision from "effect/ai/Decision";

import { cacheKey, inputHash } from "./answers";
import { readAnswers, writeAnswers, type DecisionCache, type DecisionCacheInvalid } from "./cache";
import { DecisionRecord, type DecisionBatchReport } from "./record";

/**
 * One decision family. `answers` in `evaluate` is erased because each family
 * reads its own `Decision.Answers` shape; the family is the only place that
 * shape is known, and a `DecisionModel` validates it before it arrives.
 */
export interface DecisionFamily<Input> {
  readonly name: string;
  readonly input: Schema.ConstraintDecoder<Input>;
  /** Build the definition for one input; dynamic-label families build per input. */
  readonly definitionFor: (input: Input) => Decision.Definition<any, any>;
  /** Stable human reference for the input in a report. */
  readonly inputRef: (input: Input) => string;
  /** Map validated answers to a verdict; `"review"` means a human decides. */
  readonly evaluate: (input: Input, answers: any, threshold: number) => string;
  /**
   * Optional input-level guard for constraints a schema cannot express, such as
   * "dynamic-label families need at least two candidates". Returns a message to
   * fail the run, or `undefined` when the input is usable.
   */
  readonly validate?: (input: Input) => string | undefined;
}

/** A probability is confident when it is at or beyond `threshold` on either side. */
export const isConfident = (probability: number, threshold: number): boolean =>
  probability >= threshold || probability <= 1 - threshold;

/** True when a probability sits inside the review band `(1 - threshold, threshold)`. */
export const inReviewBand = (probability: number, threshold: number): boolean =>
  !isConfident(probability, threshold);

/** True when any probability sits inside the review band. */
export const anyInReviewBand = (
  probabilities: ReadonlyArray<number>,
  threshold: number,
): boolean => probabilities.some((probability) => inReviewBand(probability, threshold));

export interface RunOptions<Input> {
  readonly family: DecisionFamily<Input>;
  readonly inputs: ReadonlyArray<Input>;
  readonly model: string;
  readonly threshold: number;
  readonly concurrency?: number;
  /** Answer cache; absent means every input is asked. */
  readonly cache?: DecisionCache;
}

/** Replay found no committed answer for an input. */
export class DecisionCacheMiss extends Data.TaggedError("DecisionCacheMiss")<{
  readonly family: string;
  readonly inputRef: string;
  readonly key: string;
  readonly message: string;
}> {}

/** Group records into resolved/review buckets and count each verdict. */
export const buildDecisionReport = (options: {
  readonly family: string;
  readonly model: string;
  readonly threshold: number;
  readonly records: ReadonlyArray<DecisionRecord>;
}): DecisionBatchReport => {
  const verdicts: Record<string, number> = {};
  const resolved: Array<DecisionRecord> = [];
  const review: Array<DecisionRecord> = [];
  for (const record of options.records) {
    verdicts[record.verdict] = (verdicts[record.verdict] ?? 0) + 1;
    if (record.review) review.push(record);
    else resolved.push(record);
  }
  return {
    kind: "decide",
    schemaVersion: 1,
    family: options.family,
    model: options.model,
    threshold: options.threshold,
    counts: {
      inputs: options.records.length,
      resolved: resolved.length,
      review: review.length,
    },
    verdicts,
    resolved,
    review,
  };
};

interface Answered {
  readonly answers: unknown;
  readonly usage?: DecisionRecord["usage"];
}

/**
 * Answer each input from the cache, or through `ask` on a miss, and bucket the
 * results. Inputs run with bounded concurrency.
 */
const decideAll = <Input, E, R>(
  options: RunOptions<Input>,
  ask: (input: Input, key: string) => Effect.Effect<Answered, E, R>,
  reuseCache: boolean,
): Effect.Effect<DecisionBatchReport, E | DecisionCacheInvalid, R> =>
  Effect.gen(function* () {
    const records = yield* Effect.forEach(
      options.inputs,
      (input, index) =>
        Effect.gen(function* () {
          const definition = options.family.definitionFor(input);
          const hash = inputHash(input);
          const key = cacheKey({
            family: options.family.name,
            model: options.model,
            decisions: definition.decisions,
            inputHash: hash,
          });
          const cached =
            options.cache === undefined || !reuseCache
              ? undefined
              : yield* readAnswers(options.cache, key, definition.decisions);
          const answered: Answered = cached === undefined ? yield* ask(input, key) : { answers: cached };
          const verdict = options.family.evaluate(input, answered.answers, options.threshold);
          return {
            decisionId: `${options.family.name}:${index}`,
            schemaVersion: 1,
            family: options.family.name,
            model: options.model,
            threshold: options.threshold,
            inputHash: hash,
            inputRef: options.family.inputRef(input),
            verdict,
            review: verdict === "review",
            answers: answered.answers,
            ...(answered.usage === undefined ? {} : { usage: answered.usage }),
          } satisfies DecisionRecord;
        }),
      { concurrency: options.concurrency ?? 4 },
    );
    return buildDecisionReport({
      family: options.family.name,
      model: options.model,
      threshold: options.threshold,
      records,
    });
  });

/**
 * Answer every input through the ambient `DecisionModel`. One provider call
 * answers every decision for an input; a cached answer skips the provider unless
 * `refresh` asks again. New answers are written to the cache.
 */
export const runDecisions = <Input>(
  options: RunOptions<Input> & { readonly refresh?: boolean },
): Effect.Effect<
  DecisionBatchReport,
  AiError.AiError | DecisionCacheInvalid,
  DecisionModel.DecisionModel
> =>
  decideAll(
    options,
    (input, key) =>
      Effect.gen(function* () {
        const response = yield* DecisionModel.decide(options.family.definitionFor(input), { input });
        if (options.cache !== undefined) yield* writeAnswers(options.cache, key, response.answers);
        return {
          answers: response.answers,
          usage: { inputTokens: response.usage.inputTokens, outputTokens: response.usage.outputTokens },
        };
      }),
    options.refresh !== true,
  );

/**
 * Answer every input from the cache alone. Needs no model or credentials, so a
 * gate can run it offline; an input without an answer fails the replay.
 */
export const replayDecisions = <Input>(
  options: RunOptions<Input> & { readonly cache: DecisionCache },
): Effect.Effect<DecisionBatchReport, DecisionCacheMiss | DecisionCacheInvalid> =>
  decideAll(
    options,
    (input, key) =>
      Effect.fail(
        new DecisionCacheMiss({
          family: options.family.name,
          inputRef: options.family.inputRef(input),
          key,
          message: `No ${options.family.name} answer for ${options.family.inputRef(input)}; ask the model and commit the answers.`,
        }),
      ),
    true,
  );

export const decodeFamilyInputs = <Input>(
  family: DecisionFamily<Input>,
  raw: ReadonlyArray<unknown>,
): ReadonlyArray<Input> => {
  const decode = Schema.decodeUnknownSync(family.input);
  return raw.map((value) => decode(value));
};
