import { TypeSafeSchema } from "@effect/ai-typesafe";
import * as Schema from "effect/Schema";

const probability = Number(process.env.PAGEGRAPH_FIXTURE_PROBABILITY);
if (!Number.isFinite(probability) || probability < 0 || probability > 1)
  throw new Error("The claims fixture requires a probability between zero and one");

// Exercise the real CLI and provider client without sending requests to the provider.
globalThis.fetch = async (input, init) => {
  const request = new Request(input, init);
  if (request.url !== "https://api.typesafe.ai/v1/systemone" || request.method !== "POST")
    throw new Error(`Unscripted claims fixture request: ${request.method} ${request.url}`);
  const payload = Schema.decodeUnknownSync(TypeSafeSchema.SystemOneRequest)(await request.json());
  if (payload.model !== "fixture-claims" || Object.values(payload.questions).some((question) => question.type !== "noul"))
    throw new Error("Unscripted claims fixture model or question");
  return Response.json({
    model: payload.model,
    answers: Object.fromEntries(Object.keys(payload.questions).map((rule) => [rule, { type: "noul", noul: probability }])),
    usage: { input_tokens: 1, output_tokens: 1 },
  });
};
