import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { evaluateGraph, planGraph, type GraphModuleRunner } from "../../src/tanstack-start/graph";

const root = fileURLToPath(new URL("../fixtures/tanstack-start-app", import.meta.url));

const plan = () => planGraph(root, {
  origin: "https://site.example",
  markdown: { origin: "https://documents.example", serverEntry: "dist/server/custom.js" },
  facts: "src/facts.ts",
  collections: "src/collections.ts",
  exclude: ["app-only.tsx"],
});

function runner(facts: unknown): GraphModuleRunner {
  return {
    async import(path) {
      if (path === resolve(root, "src/facts.ts")) return { facts };
      if (path === resolve(root, "src/collections.ts")) return { collections: [{
        route: "/blog/$slug", source: "blog", instances: [{ path: "/blog/first", title: "First post" }],
      }] };
      return { Route: { options: { staticData: {
        seo: { kind: "page" }, markdown: "rendered", llms: "Pages", privateSetting: "do not ship",
      } } } };
    },
  };
}

describe("graph document runtime evaluation", () => {
  it("evaluates document declarations and facts and ships only the named static data", async () => {
    const evaluated = await evaluateGraph(runner({ greeting: { kind: "text", value: "Hello", text: "Hello" } }), await plan());
    expect(evaluated.markdown).toEqual({ origin: "https://documents.example" });
    expect(evaluated.facts).toEqual({ greeting: { kind: "text", value: "Hello", text: "Hello" } });
    expect(evaluated.graph.nodes.get("/blog/first")).toMatchObject({ markdown: "rendered", llms: "Pages" });
    expect(JSON.stringify([...evaluated.graph.nodes.values()])).not.toContain("privateSetting");
  });

  it("names invalid or missing facts exports before they reach the runtime", async () => {
    await expect(evaluateGraph(runner(undefined), await plan())).rejects.toThrow("src/facts.ts has no `facts` export");
    await expect(evaluateGraph(runner({ broken: { kind: "text", value: Infinity, text: "x" } }), await plan()))
      .rejects.toThrow(/could not evaluate src\/facts.ts: Expected JSON value/);
  });

  it("leaves document configuration absent when the application does not opt in", async () => {
    const plain = await planGraph(root, { origin: "https://site.example", exclude: ["app-only.tsx"] });
    const evaluated = await evaluateGraph(runner({}), plain);
    expect(evaluated.markdown).toBeNull();
    expect(evaluated.facts).toBeUndefined();
  });
});
