/**
 * Answer identity and validation shared by every decision family: how an input
 * and a definition hash into a cache key, and whether stored answers have the
 * shape the provider path would have validated.
 */

import { createHash } from "node:crypto";

import * as Schema from "effect/Schema";
import type * as Decision from "effect/ai/Decision";

const UnitInterval = Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 }));

/** A probability distribution over exactly `labels`: unit-range, summing to 1. */
const Distribution = (labels: ReadonlyArray<string>) =>
  Schema.Record(Schema.String, UnitInterval).check(
    Schema.makeFilter((probabilities) => {
      // Extra labels would be read by evaluators that scan the distribution, so
      // require the cached keys to match the declared labels exactly.
      const keys = Object.keys(probabilities);
      if (keys.length !== labels.length || !labels.every((label) => keys.includes(label)))
        return `expected exactly the labels ${labels.join(", ")}`;
      const total = labels.reduce((sum, label) => sum + probabilities[label]!, 0);
      return Math.abs(total - 1) <= 1e-6 || "expected probabilities that sum to 1";
    }),
  );

const Labeled = (labels: ReadonlyArray<string>) => ({
  label: Schema.Literals(labels),
  probabilities: Distribution(labels),
  confidence: Schema.optionalKey(Schema.Number),
});

const Answer = (decision: Decision.Any) => {
  switch (decision._tag) {
    case "Probability":
      return Schema.Struct({ probability: UnitInterval });
    case "Classify":
      return Schema.Struct(Labeled(Object.keys(decision.criteria)));
    case "Rate": {
      // Effect 4.0.6 stores each level as `{ label, description }`. String
      // criteria still describe themselves, so answers stay label-based.
      const levels = decision.criteria.map((level) => level.label);
      return Schema.Struct({
        rating: Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: levels.length - 1 })),
        ...Labeled(levels),
      });
    }
  }
};

/**
 * Answers in the shape `DecisionModel` would have validated for `decisions` —
 * the same labels, ranges, and distributions. A cache file is only trusted when
 * it decodes through this schema, so a partially malformed entry cannot produce
 * a confident verdict.
 */
export const CachedAnswers = (decisions: Readonly<Record<string, Decision.Any>>) =>
  Schema.Struct(
    Object.fromEntries(
      Object.entries(decisions).map(([name, decision]) => [name, Answer(decision)]),
    ),
  );

/** sha256 of the canonical input JSON — deterministic for a schema-decoded input. */
export const inputHash = (input: unknown): string =>
  createHash("sha256").update(JSON.stringify(input)).digest("hex");

/** Bump when a family's answer shape changes, so old cache files stop matching. */
export const DECISION_ANSWER_SCHEMA_VERSION = 1;

/** JSON with object keys sorted at every level, so key order never changes a hash. */
const canonicalJson = (value: unknown): string =>
  JSON.stringify(value, (_key, entry: unknown) =>
    entry !== null && typeof entry === "object" && !Array.isArray(entry)
      ? Object.fromEntries(
          Object.entries(entry).sort(([left], [right]) =>
            left < right ? -1 : left > right ? 1 : 0,
          ),
        )
      : entry,
  );

/**
 * Rate criteria are `{ label, description }` since Effect 4.0.6. A string level
 * is stored with `description === label`, which is the same question Effect
 * 4.0.0 hashed as that string. Keep that encoding so committed cache keys
 * survive the patch; a distinct description is part of the question.
 */
const criteriaFingerprint = (decision: Decision.Any): unknown => {
  if (decision._tag !== "Rate") return decision.criteria ?? null;
  return decision.criteria.map((level) =>
    level.description === level.label ? level.label : level,
  );
};

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
            {
              kind: decision._tag,
              instructions: decision.instructions,
              criteria: criteriaFingerprint(decision),
            },
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
