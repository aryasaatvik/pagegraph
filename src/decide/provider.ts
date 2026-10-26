import { TypeSafeClient, TypeSafeDecisionModel } from "@effect/ai-typesafe";
import * as Config from "effect/Config";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import type { OpenRouterConfig } from "../config";

export const openRouterHeaders = (config?: OpenRouterConfig) => ({
  "HTTP-Referer": config?.referer ?? "https://github.com/aryasaatvik/pagegraph",
  "X-OpenRouter-Title": config?.title ?? "Pagegraph",
});

/** Neither decision provider key is configured. */
export class DecisionCredentialsMissing extends Data.TaggedError("DecisionCredentialsMissing")<{
  readonly message: string;
}> {}

/** A provider key, absent when unset or blank. */
const apiKey = (name: string) =>
  Config.option(Config.Redacted(name)).pipe(
    Config.map(Option.filter((key) => Redacted.value(key).trim() !== "")),
  );

/** Map transport IDs only; callers retain their logical model ID for durable cache identity. */
export const decisionModelLayer = (model: string, config?: OpenRouterConfig) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const openRouterKey = yield* apiKey("OPENROUTER_API_KEY");
      const key = Option.isSome(openRouterKey) ? openRouterKey : yield* apiKey("TYPESAFE_API_KEY");
      if (Option.isNone(key))
        return yield* new DecisionCredentialsMissing({
          message:
            "Missing decision provider credentials; set OPENROUTER_API_KEY or TYPESAFE_API_KEY.",
        });
      const openrouter = Option.isSome(openRouterKey);
      const id = model.startsWith("typesafe/") ? model.slice("typesafe/".length) : model;
      const logical = id === "jev" ? "jev-latest" : id;
      const routed = !openrouter
        ? logical
        : logical === "jev-latest"
          ? "~typesafe/jev-latest"
          : model.includes("/")
            ? model
            : logical;
      return TypeSafeDecisionModel.model(routed).pipe(
        Layer.provide(
          TypeSafeClient.layer({
            apiKey: key.value,
            ...(openrouter
              ? {
                  apiUrl: "https://openrouter.ai/api/v1",
                  transformClient: (client) =>
                    HttpClient.mapRequest(
                      client,
                      HttpClientRequest.setHeaders(openRouterHeaders(config)),
                    ),
                }
              : {}),
          }),
        ),
        Layer.provide(FetchHttpClient.layer),
      );
    }),
  );
