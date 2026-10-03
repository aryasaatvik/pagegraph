/**
 * Answer cache keyed by {@link cacheKey}: one JSON file per key in a directory.
 *
 * Only model answers are cached; verdicts are recomputed from answers and the
 * current threshold, so changing a threshold never serves a stale verdict.
 *
 * Two policies:
 * - `scratch`: a working cache for agentic runs. A missing, unreadable, or
 *   malformed file is a miss, and the provider answers again.
 * - `committed`: answers reviewed and committed with the code they judge, read
 *   by gates that replay without a model. Only absence is a miss; an unreadable
 *   or malformed file fails, so a corrupted answer can never pass silently.
 *   Writes are atomic, so an interrupted refresh cannot leave a partial file.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import type * as Decision from "effect/ai/Decision";

import { validCachedAnswers } from "./answers";

export type DecisionCachePolicy = "scratch" | "committed";

export interface DecisionCache {
  readonly directory: string;
  readonly policy: DecisionCachePolicy;
}

/** A committed answer that exists but cannot be trusted. */
export class DecisionCacheInvalid extends Data.TaggedError("DecisionCacheInvalid")<{
  readonly file: string;
  readonly message: string;
}> {}

const answerFile = (cache: DecisionCache, key: string): string => join(cache.directory, `${key}.json`);

/**
 * Cached answers for `key` when they match `decisions`, `undefined` on a miss.
 * Under `committed`, an unreadable or mismatched file fails instead of missing.
 */
export const readAnswers = (
  cache: DecisionCache,
  key: string,
  decisions: Readonly<Record<string, Decision.Any>>,
): Effect.Effect<unknown | undefined, DecisionCacheInvalid> =>
  Effect.gen(function* () {
    const file = answerFile(cache, key);
    if (!existsSync(file)) return undefined;
    const invalid = (reason: string) =>
      cache.policy === "scratch"
        ? Effect.succeed(undefined)
        : Effect.fail(
            new DecisionCacheInvalid({
              file,
              message: `Committed decision answers in ${file} ${reason}; re-ask them and commit the result.`,
            }),
          );
    const parsed = yield* Effect.try({
      try: (): unknown => JSON.parse(readFileSync(file, "utf8")),
      catch: () => file,
    }).pipe(Effect.option);
    if (parsed._tag === "None") return yield* invalid("are not readable JSON");
    if (!validCachedAnswers(decisions, parsed.value)) return yield* invalid("do not match the decision definition");
    return parsed.value;
  });

/** Persist answers for `key`, creating the directory on first write. */
export const writeAnswers = (cache: DecisionCache, key: string, answers: unknown): Effect.Effect<void> =>
  Effect.sync(() => {
    mkdirSync(cache.directory, { recursive: true });
    const contents = `${JSON.stringify(answers, null, 2)}\n`;
    if (cache.policy === "scratch") {
      writeFileSync(answerFile(cache, key), contents, "utf8");
      return;
    }
    // Stage beside the target so the rename stays on one filesystem.
    const staging = mkdtempSync(join(cache.directory, ".answer-"));
    try {
      const staged = join(staging, "answer.json");
      writeFileSync(staged, contents, "utf8");
      renameSync(staged, answerFile(cache, key));
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
  });
