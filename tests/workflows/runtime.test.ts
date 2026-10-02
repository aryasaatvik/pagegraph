import { execFile } from "node:child_process";
import { chmod, copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { afterEach, describe, expect, it, vi } from "vitest";

import { ensureWorkflowRuntime } from "../../src/workflows/runtime";

const directories: Array<string> = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), "pagegraph-runtime-test-"));
  directories.push(root);
  const bunExecutable = join(root, "installer.mjs");
  await copyFile(new URL("../fixtures/opencode-install.mjs", import.meta.url), bunExecutable);
  await chmod(bunExecutable, 0o755);
  return { root, bunExecutable, cacheDirectory: join(root, "runtime") };
};

describe("isolated OpenCode runtime", () => {
  it("publishes once, reuses the verified cache, and excludes consumer installer configuration", async () => {
    const options = await fixture();
    vi.stubEnv("npm_config_registry", "https://consumer.invalid");
    vi.stubEnv("BUN_CONFIG_VERBOSE_FETCH", "1");
    const [first, second] = await Promise.all([ensureWorkflowRuntime(options), ensureWorkflowRuntime(options)]);
    expect(first).toBe(second);
    expect(await ensureWorkflowRuntime({ ...options, bunExecutable: "/missing-bun" })).toBe(first);
    const installations = (await readFile(join(options.root, "installations"), "utf8")).trim().split("\n");
    expect(installations).toHaveLength(1);
    expect(installations[0]).not.toContain(options.root);
    const manifest = JSON.parse(await readFile(join(options.cacheDirectory, "package.json"), "utf8"));
    expect(manifest.dependencies["@opencode/sdk"]).toBe("2.0.22");
    expect(manifest.overrides.effect).toBe("4.0.0-rc.112");
  });

  it("retains bounded undeclared HTTP error bodies and operation context", async () => {
    const options = await fixture();
    await ensureWorkflowRuntime(options);
    const client = await import(pathToFileURL(join(options.cacheDirectory,
      "node_modules/@opencode/client/dist/chunks/service-contender-50fct660.js")).href);
    const responseError = client.makeResponseError();
    await expect(responseError(new Response('{"error":"broken plugin"}', { status: 500 }), {
      method: "POST", path: "/session/abc/message", declaredStatuses: [],
    })).rejects.toMatchObject({ cause: {
      status: 500, method: "POST", path: "/session/abc/message", body: '{"error":"broken plugin"}',
    } });
    await expect(responseError(new Response("x".repeat(32_768), { status: 503 }), {
      method: "GET", path: "/plugins", declaredStatuses: [],
    })).rejects.toMatchObject({ cause: { body: "x".repeat(16_384) } });
    await expect(responseError(new Response('{"message":"declared"}', { status: 400 }), {
      method: "POST", path: "/session", declaredStatuses: [400],
    })).rejects.toMatchObject({ message: "declared", body: { message: "declared" }, cause: { status: 400, method: "POST", path: "/session", body: { message: "declared" } } });
  });

  it("rejects changed dependencies and partial caches without importing them", async () => {
    const options = await fixture();
    await ensureWorkflowRuntime(options);
    await writeFile(join(options.cacheDirectory, "node_modules/effect/package.json"), '{"version":"4.0.0-rc.117"}');
    await expect(ensureWorkflowRuntime(options)).rejects.toThrow("requires Effect 4.0.0-rc.112");
  });

  it("rejects a cache whose completed installation stamp was removed", async () => {
    const options = await fixture();
    await ensureWorkflowRuntime(options);
    await rm(join(options.cacheDirectory, ".ready"));
    await expect(ensureWorkflowRuntime(options)).rejects.toThrow();
  });

  it("cleans a failed installation and allows a later retry", async () => {
    const options = await fixture();
    await expect(ensureWorkflowRuntime({ ...options, bunExecutable: "/missing-bun" })).rejects.toThrow(
      "Could not install isolated OpenCode SDK 2.0.22",
    );
    await expect(ensureWorkflowRuntime(options)).resolves.toContain("node_modules/@opencode/sdk/dist/index.js");
  });

  it.runIf(process.env.PAGEGRAPH_TEST_OPENCODE_INSTALL === "1")(
    "boots a real host from a consumer with hostile Effect and Drizzle overrides",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "pagegraph-runtime-consumer-"));
      directories.push(root);
      await writeFile(join(root, "package.json"), JSON.stringify({
        private: true,
        overrides: {
          effect: "4.0.0-rc.117",
          "drizzle-orm": "https://consumer.invalid/incompatible-drizzle.tgz",
        },
      }));
      await writeFile(join(root, "bunfig.toml"), '[install]\nregistry = "https://consumer.invalid"\n');
      const runner = join(root, "probe.mjs");
      await writeFile(runner, `
import { ensureWorkflowRuntime } from ${JSON.stringify(new URL("../../src/workflows/runtime.ts", import.meta.url).href)};
import { pathToFileURL } from "node:url";
const entry = await ensureWorkflowRuntime({ cacheDirectory: ${JSON.stringify(join(root, "runtime"))} });
const { OpenCode } = await import(pathToFileURL(entry).href);
const host = await OpenCode.create({ config: { directory: ${JSON.stringify(root)}, project: false, content: "{}" } });
try {
  const info = await host.server.info();
  if (!info) throw new Error("Embedded host did not return server information.");
  console.log("isolated host ready");
} finally { await host.close(); }
`);
      const result = await promisify(execFile)("bun", [runner], {
        cwd: root, timeout: 240_000, maxBuffer: 2 * 1024 * 1024,
        env: { ...process.env, npm_config_registry: "https://consumer.invalid" },
      });
      expect(result.stdout).toContain("isolated host ready");
    },
    240_000,
  );
});
