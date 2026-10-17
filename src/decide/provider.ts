import { TypeSafeClient, TypeSafeDecisionModel } from "@effect/ai-typesafe";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import type { OpenRouterConfig } from "../config";

export const openRouterHeaders = (config?: OpenRouterConfig) => ({
  "HTTP-Referer": config?.referer ?? "https://github.com/aryasaatvik/pagegraph",
  "X-OpenRouter-Title": config?.title ?? "Pagegraph",
});

/** Map transport IDs only; callers retain their logical model ID for durable cache identity. */
export const decisionModelLayer = (model: string, config?: OpenRouterConfig) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const openrouter = Boolean(process.env.OPENROUTER_API_KEY?.trim());
      if (!openrouter && !process.env.TYPESAFE_API_KEY?.trim())
        return yield* Effect.fail(
          new Error(
            "Missing decision provider credentials; set OPENROUTER_API_KEY or TYPESAFE_API_KEY.",
          ),
        );
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
          TypeSafeClient.layerConfig({
            apiKey: Config.Redacted(openrouter ? "OPENROUTER_API_KEY" : "TYPESAFE_API_KEY"),
            ...(openrouter
              ? {
                  apiUrl: Config.succeed("https://openrouter.ai/api/v1"),
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
