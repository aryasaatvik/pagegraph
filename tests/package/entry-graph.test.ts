import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { build, type Rolldown } from "vite";
import { describe, expect, it } from "vitest";
import { libraryAlwaysBundle } from "../../scripts/bundle-policy.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));

/**
 * Bundle one entry the way tsdown does and collect every specifier that leaves
 * the package. Type-only imports erase during the transform, so this is the
 * import graph a consumer's bundler actually follows.
 */
const externalImports = async (entry: string): Promise<Array<string>> => {
  const external = new Set<string>();
  await build({
    root,
    configFile: false,
    mode: "production",
    oxc: { jsx: { runtime: "automatic", development: false } },
    logLevel: "silent",
    build: {
      write: false,
      minify: false,
      rolldownOptions: { input: `${root}/${entry}` },
    },
    plugins: [
      {
        name: "collect-externals",
        enforce: "pre",
        resolveId(source, importer) {
          if (importer === undefined || source.startsWith(".") || source.startsWith("/") || source.startsWith("\0")) return null;
          if (libraryAlwaysBundle.some((pattern) => pattern.test(source))) return null;
          external.add(source);
          return { id: source, external: true };
        },
      },
    ],
  }) as Rolldown.RolldownOutput;
  return [...external].sort();
};

/** Anything that cannot run in workerd or a browser. */
const buildOnly = /^(node:|vite$|vite\/|@tanstack\/router-generator|@tanstack\/start-plugin-core|effect|@effect\/|lighthouse|@opencode\/)|\.node$/;

describe("runtime entries", () => {
  it("keeps non-bundled dependencies visible to the external-import assertions", async () => {
    expect(await externalImports("tests/package/fixtures/non-bundled.ts")).toEqual(["react"]);
  });

  it.each([
    ["pagegraph", "src/core/index.ts", []],
    ["pagegraph/react", "src/react/index.ts", ["@tanstack/react-router", "react", "react/jsx-runtime"]],
    ["pagegraph/tanstack-start/server", "src/tanstack-start/server.ts", ["virtual:pagegraph/runtime"]],
    ["pagegraph/tanstack-start/markdown", "src/tanstack-start/markdown.tsx", ["@tanstack/react-router", "@tanstack/react-router/ssr/server", "@tanstack/react-start/server", "react", "react-dom/server", "react/jsx-runtime", "virtual:pagegraph/runtime"]],
    ["pagegraph/tanstack-start/react", "src/tanstack-start/react.tsx", ["@tanstack/react-router", "react", "react/jsx-runtime"]],
    ["pagegraph/tanstack-start/prerender-worker", "src/tanstack-start/prerender-worker.ts", ["virtual:pagegraph/prerender-server"]],
  ] as const)("%s imports only its runtime peers", async (_name, entry, allowed) => {
    const imports = await externalImports(entry);
    expect(imports.filter((specifier) => buildOnly.test(specifier))).toEqual([]);
    expect(imports).toEqual(allowed);
  });
});

describe("build entries", () => {
  const manifest = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
    readonly exports: Record<string, Record<string, string>>;
  };

  it.each(["vite", "config", "audit", "tanstack-start", "oxlint"])("pagegraph/%s resolves to a throwing stub in runtime bundles", async (entry) => {
    const conditions = manifest.exports[`./${entry}`];
    for (const condition of ["workerd", "worker", "browser"]) {
      expect(conditions?.[condition], condition).toBe(`./dist/build-only/${entry}.js`);
    }
    // Runtime conditions must precede `import`: export maps match in key order.
    const keys = Object.keys(conditions ?? {});
    expect(keys.indexOf("workerd")).toBeLessThan(keys.indexOf("import"));
    await expect(import(`../../src/build-only/${entry}.ts`)).rejects.toThrow(
      `"pagegraph/${entry}" is build-time only`,
    );
  });

  it("keeps runtime entries free of build-only conditions", () => {
    for (const entry of [".", "./react", "./tanstack-start/server", "./tanstack-start/markdown", "./tanstack-start/react", "./tanstack-start/prerender-worker"]) {
      expect(Object.keys(manifest.exports[entry] ?? {})).toEqual(["types", "import"]);
    }
  });
});
