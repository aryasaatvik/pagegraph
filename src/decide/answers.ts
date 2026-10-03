/**
 * Answer identity and validation shared by every decision family: how an input
 * and a definition hash into a cache key, and whether stored answers have the
 * shape the provider path would have validated.
 */

import { createHash } from "node:crypto";

import type * as Decision from "effect/ai/Decision";

const isUnitInterval = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** A probability distribution over exactly `labels`: unit-range, summing to 1. */
const isDistribution = (labels: ReadonlyArray<string>, value: unknown): boolean => {
  // Extra labels would be read by evaluators that scan the distribution, so
  // require the cached keys to match the declared labels exactly.
  if (!isPlainObject(value) || Object.keys(value).length !== labels.length) return false;
  let total = 0;
  for (const label of labels) {
    const probability = value[label];
    if (!isUnitInterval(probability)) return false;
    total += probability;
  }
  return Math.abs(total - 1) <= 1e-6;
};

/**
 * Whether cached answers have the shape `DecisionModel` would have validated —
 * the same labels, ranges, and distributions. A cache file is only trusted when
 * it round-trips through this check, so a partially malformed entry cannot
 * produce a confident verdict.
 */
export const validCachedAnswers = (
  decisions: Readonly<Record<string, Decision.Any>>,
  answers: unknown,
): boolean => {
  if (!isPlainObject(answers)) return false;
  for (const key of Object.keys(decisions)) {
    const answer = answers[key];
    if (!isPlainObject(answer)) return false;
    const decision = decisions[key]!;
    switch (decision._tag) {
      case "Probability":
        if (!isUnitInterval(answer.probability)) return false;
        break;
      case "Classify":
        if (
          typeof answer.label !== "string" ||
          !Object.hasOwn(decision.criteria, answer.label) ||
          !isDistribution(Object.keys(decision.criteria), answer.probabilities)
        ) {
          return false;
        }
        break;
      case "Rate":
        if (
          typeof answer.rating !== "number" ||
          !Number.isFinite(answer.rating) ||
          answer.rating < 0 ||
          answer.rating > decision.criteria.length - 1 ||
          typeof answer.label !== "string" ||
          !decision.criteria.includes(answer.label) ||
          !isDistribution(decision.criteria, answer.probabilities)
        ) {
          return false;
        }
        break;
    }
  }
  return true;
};

/** sha256 of the canonical input JSON — deterministic for a schema-decoded input. */
export const inputHash = (input: unknown): string =>
  createHash("sha256").update(JSON.stringify(input)).digest("hex");

/** Bump when a family's answer shape changes, so old cache files stop matching. */
export const DECISION_ANSWER_SCHEMA_VERSION = 1;

/** JSON with object keys sorted at every level, so key order never changes a hash. */
const canonicalJson = (value: unknown): string =>
  JSON.stringify(value, (_key, entry: unknown) =>
    entry !== null && typeof entry === "object" && !Array.isArray(entry)
      ? Object.fromEntries(Object.entries(entry).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)))
      : entry,
  );

/**
 * sha256 of what the model is asked: each decision's kind, instructions, and
 * criteria. Editing a prompt or a label therefore invalidates its answers.
 */
export const definitionFingerprint = (decisions: Readonly<Record<string, Decision.Any>>): string =>
  createHash("sha256")
    .update(
      canonicalJson(
        Object.fromEntries(
          Object.entries(decisions).map(([name, decision]) => [
            name,
            { kind: decision._tag, instructions: decision.instructions, criteria: decision.criteria ?? null },
          ]),
        ),
      ),
    )
    .digest("hex");

/**
 * Cache identity. Answers depend on the family, the model, the question asked,
 * and the input; the answer-schema version guards shape changes.
 */
export const cacheKey = (parts: {
  readonly family: string;
  readonly model: string;
  readonly decisions: Readonly<Record<string, Decision.Any>>;
  readonly inputHash: string;
}): string =>
  createHash("sha256")
    .update(
      [
        parts.family,
        parts.model,
        `v${DECISION_ANSWER_SCHEMA_VERSION}`,
        definitionFingerprint(parts.decisions),
        parts.inputHash,
      ].join("\u0000"),
    )
    .digest("hex");
