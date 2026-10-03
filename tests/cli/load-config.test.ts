import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as Effect from "effect/Effect";
import { afterEach, describe, expect, it } from "vitest";

import { acquireLoadedGraph, loadSeoProjectConfig } from "../../src/cli/load-config";

const directories: Array<string> = [];
const originalCwd = process.cwd();
afterEach(() => {
  process.chdir(originalCwd);
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const load = (timeoutMs?: string) => {
  const root = mkdtempSync(join(tmpdir(), "pagegraph-workflow-config-"));
  directories.push(root);
  writeFileSync(
    join(root, "pagegraph.config.mjs"),
    `export default {
      loadGraph: async () => ({ graph: { nodes: new Map(), edges: [] }, site: { origin: "https://example.com", indexable: true, robots: { disallow: [] } }, dispose: async () => {} }),
      workflows: {
        opencode: {
          configDirectory: ".pagegraph/opencode",
          defaultModel: "test/model",
          ${timeoutMs === undefined ? "" : `timeoutMs: ${timeoutMs},`}
        },
      },
    };`,
  );
  process.chdir(root);
  return Effect.runPromise(loadSeoProjectConfig);
};

describe("OpenCode timeout configuration", () => {
  it("loads the maximum supported per-completion timeout", async () => {
    const project = await load("2147483647");

    expect(project.config.workflows?.opencode.timeoutMs).toBe(2_147_483_647);
  });

  it.each(["0", "-1", "1.5", "2147483648", "NaN"])(
    "rejects invalid timeoutMs %s in plain JavaScript config",
    async (value) => {
      await expect(load(value)).rejects.toThrow("must default-export");
    },
  );

  it("keeps timeoutMs optional for existing config", async () => {
    const project = await load();

    expect(project.config.workflows?.opencode.timeoutMs).toBeUndefined();
  });
});

describe("config filename migration", () => {
  it("explains the breaking rename when only seo.config.* exists", async () => {
    const root = mkdtempSync(join(tmpdir(), "pagegraph-legacy-config-"));
    directories.push(root);
    writeFileSync(join(root, "seo.config.ts"), "export default {};\n");
    process.chdir(root);

    await expect(Effect.runPromise(loadSeoProjectConfig)).rejects.toThrow(
      "seo.config.ts was renamed to pagegraph.config.ts; rename the file",
    );
  });
});

const loadFixtureConfig = (source: string) => {
  const root = mkdtempSync(join(tmpdir(), "pagegraph-site-config-"));
  directories.push(root);
  writeFileSync(join(root, "pagegraph.config.mjs"), source);
  process.chdir(root);
  return { root, project: Effect.runPromise(loadSeoProjectConfig) };
};

describe("site identity ownership", () => {
  it.each([
    "origin", "indexable", "site", "robots", "disallow", "contentSignal", "directives",
    "collections", "exclude", "routeConfig", "markdown", "facts",
  ])("rejects duplicate host setting %s in CLI config", async (field) => {
    const { project } = loadFixtureConfig(`export default { ${field}: undefined, loadGraph: async () => {} };`);
    await expect(project).rejects.toThrow(`unsupported field "${field}"`);
  });

  it.each([
    "undefined",
    "null",
    '{ origin: "https://example.com", robots: { disallow: [] } }',
    '{ origin: "https://example.com", indexable: "false", robots: { disallow: [] } }',
    '{ origin: "https://example.com", indexable: true }',
    '{ origin: "https://example.com", indexable: true, robots: { disallow: [1] } }',
    '{ origin: "https://example.com", indexable: true, robots: { contentSignal: false } }',
  ])("rejects malformed loaded site %s and disposes once", async (site) => {
    const { root, project } = loadFixtureConfig(`
      import { appendFileSync } from "node:fs";
      export default { loadGraph: async () => ({
        graph: { nodes: new Map(), edges: [] }, site: ${site},
        dispose: async () => appendFileSync(new URL("./disposed", import.meta.url), "disposed\\n"),
      }) };
    `);
    const { config } = await project;
    await expect(Effect.runPromise(Effect.scoped(acquireLoadedGraph(config))))
      .rejects.toThrow("graph loader must return");
    expect(readFileSync(join(root, "disposed"), "utf8")).toBe("disposed\n");
  });

  it("loads graph and site once and releases after command failure", async () => {
    const { root, project } = loadFixtureConfig(`
      import { appendFileSync } from "node:fs";
      export default { loadGraph: async () => {
        appendFileSync(new URL("./loads", import.meta.url), "loaded\\n");
        return { graph: { nodes: new Map(), edges: [] },
          site: { origin: "https://preview.example.com", indexable: false, robots: { disallow: [] } },
          dispose: async () => appendFileSync(new URL("./disposed", import.meta.url), "disposed\\n"),
        };
      } };
    `);
    const { config } = await project;
    await expect(Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const loaded = yield* acquireLoadedGraph(config);
      expect(loaded.site.indexable).toBe(false);
      return yield* Effect.fail(new Error("command failed"));
    })))).rejects.toThrow("command failed");
    expect(readFileSync(join(root, "loads"), "utf8")).toBe("loaded\n");
    expect(readFileSync(join(root, "disposed"), "utf8")).toBe("disposed\n");
  });
});
