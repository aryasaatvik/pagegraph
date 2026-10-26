import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Schema from "effect/Schema";
import { Decision, DecisionModel } from "effect/ai";
import { afterEach, expect, it, vi } from "vitest";
import { decisionModelLayer } from "../../src/decide/provider";

const definition = Decision.make({
  input: Schema.String,
  decisions: { supported: Decision.probability({ instructions: "Is it supported?" }) },
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it.each([
  ["jev", "~typesafe/jev-latest"],
  ["jev-latest", "~typesafe/jev-latest"],
  ["typesafe/jev-latest", "~typesafe/jev-latest"],
  ["~typesafe/jev-latest", "~typesafe/jev-latest"],
  ["typesafe/jev-1.13", "typesafe/jev-1.13"],
])("routes %s through OpenRouter with attribution", async (model, routed) => {
  vi.stubEnv("OPENROUTER_API_KEY", "openrouter-test-key");
  vi.stubEnv("TYPESAFE_API_KEY", "unused-typesafe-key");
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    expect(request.url).toBe("https://openrouter.ai/api/v1/systemone");
    expect(request.headers.get("authorization")).toBe("Bearer openrouter-test-key");
    expect(request.headers.get("http-referer")).toBe("https://github.com/aryasaatvik/pagegraph");
    expect(request.headers.get("x-openrouter-title")).toBe("Pagegraph");
    expect(request.headers.has("x-title")).toBe(false);
    expect(await request.json()).toMatchObject({ model: routed });
    return Response.json({
      model: routed,
      answers: { supported: { type: "noul", noul: 0.9 } },
      usage: { input_tokens: 1, output_tokens: 1 },
    });
  });
  vi.stubGlobal("fetch", fetch);
  await Effect.runPromise(
    DecisionModel.decide(definition, { input: "Evidence" }).pipe(
      Effect.provide(decisionModelLayer(model)),
      Effect.provideService(FetchHttpClient.Fetch, globalThis.fetch),
      Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromEnv()),
    ),
  );
  expect(fetch).toHaveBeenCalledTimes(1);
});

it.each([true, false])(
  "applies overrides only on the OpenRouter route (%s)",
  async (openrouter) => {
    vi.stubEnv("OPENROUTER_API_KEY", openrouter ? "router-key" : "");
    vi.stubEnv("TYPESAFE_API_KEY", "typesafe-key");
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init);
      expect(request.url).toBe(
        openrouter
          ? "https://openrouter.ai/api/v1/systemone"
          : "https://api.typesafe.ai/v1/systemone",
      );
      expect(request.headers.get("authorization")).toBe(
        openrouter ? "Bearer router-key" : "Bearer typesafe-key",
      );
      expect(request.headers.get("http-referer")).toBe(openrouter ? "https://example.com" : null);
      expect(request.headers.get("x-openrouter-title")).toBe(openrouter ? "Example" : null);
      expect(await request.json()).toMatchObject({
        model: openrouter ? "~typesafe/jev-latest" : "jev-latest",
      });
      return Response.json({
        model: "jev-latest",
        answers: { supported: { type: "noul", noul: 0.9 } },
        usage: { input_tokens: 1, output_tokens: 1 },
      });
    });
    await Effect.runPromise(
      DecisionModel.decide(definition, { input: "Evidence" }).pipe(
        Effect.provide(
          decisionModelLayer("typesafe/jev", { referer: "https://example.com", title: "Example" }),
        ),
        Effect.provideService(FetchHttpClient.Fetch, globalThis.fetch),
        Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromEnv()),
      ),
    );
  },
);

it("treats a blank OpenRouter key as unset", async () => {
  vi.stubEnv("OPENROUTER_API_KEY", "   ");
  vi.stubEnv("TYPESAFE_API_KEY", "typesafe-key");
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    expect(request.url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(request.headers.get("authorization")).toBe("Bearer typesafe-key");
    return Response.json({
      model: "jev-latest",
      answers: { supported: { type: "noul", noul: 0.9 } },
      usage: { input_tokens: 1, output_tokens: 1 },
    });
  });
  await Effect.runPromise(
    DecisionModel.decide(definition, { input: "Evidence" }).pipe(
      Effect.provide(decisionModelLayer("jev")),
      Effect.provideService(FetchHttpClient.Fetch, globalThis.fetch),
      Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromEnv()),
    ),
  );
});

it("names both keys when neither is configured", async () => {
  vi.stubEnv("OPENROUTER_API_KEY", "");
  vi.stubEnv("TYPESAFE_API_KEY", " ");
  const error = await Effect.runPromise(
    DecisionModel.decide(definition, { input: "Evidence" }).pipe(
      Effect.provide(decisionModelLayer("jev")),
      Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromEnv()),
      Effect.flip,
    ),
  );
  expect(error).toMatchObject({ _tag: "DecisionCredentialsMissing" });
  expect(error.message).toContain("OPENROUTER_API_KEY or TYPESAFE_API_KEY");
});
