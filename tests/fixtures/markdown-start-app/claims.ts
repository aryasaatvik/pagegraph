import { claimsInput } from "pagegraph/claims";
import { Decision } from "effect/ai";

export const claims = {
  model: "fixture-claims",
  rules: Decision.make({
    input: claimsInput,
    decisions: {
      unsupportedPromise: Decision.probability({ instructions: "Does the section promise an unsupported capability?" }),
    },
  }),
};
