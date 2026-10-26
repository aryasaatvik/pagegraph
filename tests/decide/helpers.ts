/**
 * Deterministic decision-model doubles for family tests. `DecisionModel.make`
 * runs the same answer validation the live provider does, so a malformed mock
 * fails exactly as a malformed provider response would — and no test touches the
 * network or needs `TYPESAFE_API_KEY`.
 */

import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { DecisionModel } from "effect/ai";

/**
 * Provider answers as the doubles build them. Effect's provider answers make
 * `probabilities` optional; the doubles always supply a distribution so tests
 * can derive the validated answer they expect from the same value.
 */
export type ProviderAnswer = Data.TaggedEnum<{
  Probability: { readonly probability: number };
  Classify: { readonly label: string; readonly probabilities: Readonly<Record<string, number>> };
  Rate: { readonly rating: number; readonly probabilities: Readonly<Record<string, number>> };
}>;
export const ProviderAnswer = Data.taggedEnum<ProviderAnswer>();

/** A distribution that puts `confidence` on `label` and splits the rest. */
const distribution = (label: string, labels: ReadonlyArray<string>, confidence: number) => {
  const rest = (1 - confidence) / (labels.length - 1);
  return Object.fromEntries(labels.map((each) => [each, each === label ? confidence : rest]));
};

export const probability = (value: number) => ProviderAnswer.Probability({ probability: value });

/** A classify answer that puts `confidence` on `label` and splits the rest. */
export const classify = (label: string, labels: ReadonlyArray<string>, confidence = 0.9) =>
  ProviderAnswer.Classify({ label, probabilities: distribution(label, labels, confidence) });

/** A rate answer positioned at `level`, with its `rating` as the level index. */
export const rate = (level: string, levels: ReadonlyArray<string>, confidence = 0.9) =>
  ProviderAnswer.Rate({
    rating: levels.indexOf(level),
    probabilities: distribution(level, levels, confidence),
  });

/** A `DecisionModel` backed by `answer(key, state)`; never the network. */
export const mockDecisionModel = (
  answer: (key: string, state: Readonly<Record<string, unknown>>) => DecisionModel.ProviderAnswer,
) =>
  Layer.effect(
    DecisionModel.DecisionModel,
    DecisionModel.make({
      decide: ({ state, decisions }) =>
        Effect.sync(() => ({
          answers: Object.fromEntries(
            Object.keys(decisions).map((key) => [
              key,
              answer(key, state as Readonly<Record<string, unknown>>),
            ]),
          ),
          usage: { inputTokens: 1, outputTokens: 1 },
        })),
    }),
  );
