import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { build, type Rolldown } from "vite";
import { describe, expect, it } from "vitest";

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
  it.each([
    ["pagegraph", "src/core/index.ts", []],
    ["pagegraph/react", "src/react/index.ts", ["@tanstack/react-router", "react", "react/jsx-runtime"]],
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

  it.each(["vite", "config", "audit"])("pagegraph/%s resolves to a throwing stub in runtime bundles", async (entry) => {
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
    for (const entry of [".", "./react"]) {
      expect(Object.keys(manifest.exports[entry] ?? {})).toEqual(["types", "import"]);
    }
  });
});
