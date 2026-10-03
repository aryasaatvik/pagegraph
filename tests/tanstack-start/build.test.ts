import { execFile, spawn, type ChildProcess } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, realpath, rm, symlink } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Decision, DecisionModel } from "effect/ai";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { claimsInput, replayClaims, runClaims } from "../../src/claims";
import type { PageHead } from "../../src/core/page-heads";
import type { PageDocument } from "../../src/markdown/document";
import { fact } from "../../src/markdown/facts";

const exec = promisify(execFile);
const packageRoot = resolve(import.meta.dirname, "../..");
const fixture = join(packageRoot, "tests/fixtures/markdown-start-app");
let root: string;
let production: ChildProcess | undefined;
let origin: string;
let node: string;

const claims = {
  model: "fixture-claims",
  rules: Decision.make({
    input: claimsInput,
    decisions: {
      unsupportedPromise: Decision.probability({ instructions: "Does the section promise an unsupported capability?" }),
    },
  }),
};

function claimsModel(probability: number) {
  return Layer.effect(DecisionModel.DecisionModel, DecisionModel.make({
    decide: ({ decisions }) => Effect.succeed({
      answers: Object.fromEntries(Object.keys(decisions).map((rule) => [rule, { _tag: "Probability" as const, probability }])),
      usage: { inputTokens: 1, outputTokens: 1 },
    }),
  }));
}

async function buildFixture(directory: string, claimsEnabled = false): Promise<void> {
  await exec(node, [join(packageRoot, "node_modules/vite/bin/vite.js"), "build"], {
    cwd: directory,
    env: { ...process.env, NODE_ENV: "production", CI: "1", PAGEGRAPH_FIXTURE_CLAIMS: claimsEnabled ? "1" : undefined },
    maxBuffer: 5_000_000,
    timeout: 90_000,
  }).catch((cause: unknown) => {
    if (cause instanceof Error && "stdout" in cause && "stderr" in cause)
      throw new Error(`${cause.message}\n${String(cause.stdout)}\n${String(cause.stderr)}`, { cause });
    throw cause;
  });
}

async function nodeExecutable(): Promise<string> {
  if (!("bun" in process.versions)) return process.execPath;
  // `bun --bun vitest` puts a Bun-backed `node` shim first on PATH.
  const current = await realpath(process.execPath);
  for (const directory of (process.env.PATH ?? "").split(":")) {
    const candidate = join(directory, "node");
    const binary = await realpath(candidate).catch(() => undefined);
    if (binary === undefined || binary === current) continue;
    const { stdout } = await exec(candidate, ["-p", "JSON.stringify({ path: process.execPath, bun: Boolean(process.versions.bun) })"]);
    const result: unknown = JSON.parse(stdout);
    if (typeof result === "object" && result !== null && "bun" in result && result.bun === false &&
        "path" in result && typeof result.path === "string") return result.path;
  }
  throw new Error("The Cloudflare Start build fixture needs a Node executable on PATH");
}

async function startFixture(mode: "preview" | "dev" | "static"): Promise<{ process: ChildProcess; origin: string }> {
  const child = spawn(node, [join(root, "serve.mjs"), mode], {
    cwd: root,
    env: { ...process.env, NODE_ENV: mode === "dev" ? "development" : "production", TSS_PRERENDERING: undefined },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  try {
    const url = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Fixture ${mode} startup timed out\n${output}`)), 30_000);
      child.on("error", (cause) => { clearTimeout(timeout); reject(cause); });
      child.on("exit", (code) => { clearTimeout(timeout); reject(new Error(`Fixture ${mode} exited ${code}\n${output}`)); });
      child.stderr?.on("data", (chunk: Buffer) => { output += chunk.toString(); });
      child.stdout?.on("data", (chunk: Buffer) => {
        output += chunk.toString();
        const match = output.match(/PAGEGRAPH_FIXTURE_ORIGIN=(https?:\/\/[^\s]+)/);
        if (match?.[1] !== undefined) { clearTimeout(timeout); resolve(match[1]); }
      });
    });
    return { process: child, origin: url };
  } catch (cause) {
    await stopFixture(child);
    throw cause;
  }
}

async function stopFixture(child: ChildProcess | undefined): Promise<void> {
  if (child === undefined || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => child.kill("SIGKILL"), 5000);
    child.once("exit", () => { clearTimeout(timeout); resolve(); });
    child.kill("SIGTERM");
  });
}

beforeAll(async () => {
  // Test the shipped entries; a self-reference in the copied app resolves this package's exports.
  await exec("bun", ["run", "build"], { cwd: packageRoot, maxBuffer: 5_000_000 });
  root = await mkdtemp(join(packageRoot, "tests/.markdown-start-"));
  await cp(fixture, root, {
    recursive: true,
    filter: (file) => !["dist", ".wrangler", "node_modules", "routeTree.gen.ts"].includes(basename(file)),
  });
  await mkdir(join(root, "node_modules"));
  await symlink(packageRoot, join(root, "node_modules/pagegraph"), "dir");
  // Cloudflare's prerender preview runs its HTTP bridge in Node; Bun's bridge stalls.
  node = await nodeExecutable();
  await buildFixture(root);
  const server = await startFixture("preview");
  production = server.process;
  origin = server.origin;
}, 120_000);

afterAll(async () => {
  await stopFixture(production);
  if (root !== undefined) await rm(root, { recursive: true, force: true });
});

describe("rendered markdown in a real Start Worker build", () => {
  it("requires committed passing claims answers during prerender without asking a model", async () => {
    const claimsRoot = await mkdtemp(join(packageRoot, "tests/.claims-start-"));
    try {
      await cp(fixture, claimsRoot, {
        recursive: true,
        filter: (file) => !["dist", ".wrangler", "node_modules", "routeTree.gen.ts"].includes(basename(file)),
      });
      await mkdir(join(claimsRoot, "node_modules"));
      await symlink(packageRoot, join(claimsRoot, "node_modules/pagegraph"), "dir");

      await expect(buildFixture(claimsRoot, true)).rejects.toThrow(/\/.*hero.*unsupportedPromise[\s\S]*pagegraph claims check/);

      const documents = await Promise.all(["index", "guides/email", "guides/replies"].map(async (name) =>
        JSON.parse(await readFile(join(claimsRoot, `.pagegraph/documents/${name}.json`), "utf8")) as PageDocument));
      const heads = JSON.parse(await readFile(join(claimsRoot, ".pagegraph/heads.json"), "utf8")) as Array<PageHead>;
      const facts = { emails: fact.number(3000), runtime: fact.text("workerd") };
      const decide = vi.fn(() => Effect.die(new Error("Prerender replay must not ask the model")));
      const neverAsk = Layer.effect(DecisionModel.DecisionModel, DecisionModel.make({ decide }));
      await expect(Effect.runPromise(replayClaims(claimsRoot, documents, heads, facts, claims)
        .pipe(Effect.provide(neverAsk)))).rejects.toThrow("pagegraph claims check");
      await Effect.runPromise(runClaims(claimsRoot, documents, heads, facts, claims)
        .pipe(Effect.provide(claimsModel(0.95))));
      await expect(Effect.runPromise(replayClaims(claimsRoot, documents, heads, facts, claims)
        .pipe(Effect.provide(neverAsk)))).rejects.toThrow("unsupportedPromise");
      await expect(buildFixture(claimsRoot, true)).rejects.toThrow(/\/.*hero.*unsupportedPromise[\s\S]*pagegraph claims check/);

      await Effect.runPromise(runClaims(claimsRoot, documents, heads, facts, claims, { refresh: true })
        .pipe(Effect.provide(claimsModel(0.05))));
      await expect(Effect.runPromise(replayClaims(claimsRoot, documents, heads, facts, claims)
        .pipe(Effect.provide(neverAsk)))).resolves.toMatchObject({ asked: 0, findings: [] });
      expect(decide).not.toHaveBeenCalled();
      await expect(buildFixture(claimsRoot, true)).resolves.toBeUndefined();
    } finally {
      await rm(claimsRoot, { recursive: true, force: true });
    }
  }, 270_000);

  it("publishes rendered twins and keeps complete documents outside client assets", async () => {
    const twin = await readFile(join(root, "dist/client/index.md"), "utf8");
    expect(twin).toContain("# Email, in one call.");
    expect(twin).toContain("Start with 3,000 emails.");
    expect(twin).toContain("[Read more](https://example.com/plain)");
    expect(twin).toContain("Runtime: workerd.");
    expect(twin).toContain("The email arrives in the inbox.");
    expect(twin).not.toContain("Scroll to compare");
    expect(twin).not.toContain("Shared shell text");

    const document = JSON.parse(await readFile(join(root, ".pagegraph/documents/index.json"), "utf8")) as PageDocument;
    expect(document.path).toBe("/");
    expect(document.title).toBe("Mail for teams");
    expect(document.facts).toEqual(["emails", "runtime"]);
    expect(document.messages.some((message) => message.source.startsWith("src/routes/index.tsx:"))).toBe(true);
    expect(document.messages.filter((message) => message.text === "Email, in one call.")).toHaveLength(1);
    expect(document.messages.some((message) => message.audience === "humans")).toBe(true);

    for (const path of ["__pagegraph/markdown.json", "index.document.json", "plain.md", "guides/$slug.md"])
      await expect(readFile(join(root, "dist/client", path))).rejects.toMatchObject({ code: "ENOENT" });
    expect(JSON.parse(await readFile(join(root, ".pagegraph/heads.json"), "utf8"))).toEqual([
      { path: "/plain", title: "Plain page", description: "An ordinary HTML page." },
    ]);
  });

  it("captures collection instances through their actual route loaders with forwarded context", async () => {
    for (const slug of ["email", "replies"]) {
      const document = JSON.parse(await readFile(join(root, `.pagegraph/documents/guides/${slug}.json`), "utf8")) as PageDocument;
      expect(document.path).toBe(`/guides/${slug}`);
      expect(document.title).toBe(`Guide: ${slug}`);
      expect(document.description).toBe(`Loaded ${slug}`);
      expect(document.messages.map((message) => message.text)).toEqual(["Start with 3,000 emails."]);
      expect(await readFile(join(root, `dist/client/guides/${slug}.md`), "utf8")).not.toContain("Shared shell text");
      const html = await fetch(new URL(`guides/${slug}`, origin)).then((response) => response.text());
      expect(html).toContain(`data-slug="${slug}"`);
      expect(html).toContain("Shared shell text");
      expect(html).not.toContain("data-document-record");
    }
  });

  it("forwards ordinary prerenders and composes llms.txt from graph metadata", async () => {
    expect(await readFile(join(root, "dist/client/plain/index.html"), "utf8")).toContain("Plain page");
    const llms = await readFile(join(root, "dist/client/llms.txt"), "utf8");
    expect(llms).toContain("[Mail for teams](https://example.com/index.md): Send product email.");
    expect(llms).toContain("[Guide: email](https://example.com/guides/email.md): Loaded email");
    expect(llms).not.toContain("Plain page");
    expect(llms).not.toContain("$slug");
  });

  it("serves static twins and refuses private capture paths on the production Worker", async () => {
    const twin = await fetch(new URL("index.md", origin));
    expect(twin.status).toBe(200);
    expect(await twin.text()).toContain("Runtime: workerd.");
    for (const path of ["__pagegraph/markdown.json", "guides/email.document.json", "index.document.json"]) {
      const response = await fetch(new URL(path, origin), { headers: { TSS_PRERENDERING: "true" } });
      expect(response.status).toBe(404);
      expect(await response.text()).not.toContain("src/routes/");
    }
  });

  it("serves encoded Unicode and space paths from decoded files in Vite and Cloudflare", async () => {
    const staticServer = await startFixture("static");
    try {
      for (const [decoded, encoded] of [["café", "caf%C3%A9"], ["hello world", "hello%20world"]]) {
        expect(JSON.parse(await readFile(join(root, `.pagegraph/documents/guides/${decoded}.json`), "utf8")).path)
          .toBe(`/guides/${decoded}`);
        const markdown = await readFile(join(root, `dist/client/guides/${decoded}.md`), "utf8");
        for (const host of [origin, staticServer.origin]) {
          const response = await fetch(new URL(`guides/${encoded}.md`, host), { signal: AbortSignal.timeout(15_000) });
          expect(response.status).toBe(200);
          expect(await response.text()).toBe(markdown);
        }
      }
    } finally { await stopFixture(staticServer.process); }
  });

  it("serves isolated live captures in dev, strips credentials, and reports render failures", async () => {
    await cp(join(root, "negative/broken.tsx"), join(root, "src/routes/broken.tsx"));
    const dev = await startFixture("dev");
    try {
      const documents = await Promise.all(["email", "replies", "email"].map(async (slug) => {
        const response = await fetch(new URL(`guides/${slug}.document.json?private=1`, dev.origin), {
          headers: {
            cookie: "session=private", authorization: "Bearer private",
            "accept-language": "fr", "user-agent": "Personalized crawler",
            "x-requester-identity": "private", "x-forwarded-host": "personalized.example",
          },
          signal: AbortSignal.timeout(15_000),
        });
        expect(response.status).toBe(200);
        return await response.json() as PageDocument;
      }));
      expect(documents.map((document) => document.title)).toEqual(["Guide: email", "Guide: replies", "Guide: email"]);
      expect(documents[0]?.messages.map((message) => message.text)).toEqual(["Start with 3,000 emails."]);
      expect(documents[2]).toEqual(documents[0]);
      for (const [decoded, encoded] of [["café", "caf%C3%A9"], ["hello world", "hello%20world"]]) {
        for (const method of ["GET", "HEAD"]) {
          const twin = await fetch(new URL(`guides/${encoded}.md`, dev.origin), { method, signal: AbortSignal.timeout(15_000) });
          expect(twin.status).toBe(200);
          expect(await twin.text()).toBe(method === "HEAD" ? "" : await readFile(join(root, `dist/client/guides/${decoded}.md`), "utf8"));
          const document = await fetch(new URL(`guides/${encoded}.document.json`, dev.origin), { method, signal: AbortSignal.timeout(15_000) });
          expect(document.status).toBe(200);
          if (method === "HEAD") expect(await document.text()).toBe("");
          else expect((await document.json()).path).toBe(`/guides/${decoded}`);
        }
      }
      const malformed = await fetch(new URL("guides/%ZZ.md", dev.origin), { signal: AbortSignal.timeout(15_000) });
      expect(malformed.status).toBe(400);
      expect(malformed.headers.get("x-pagegraph-error")).toBeNull();
      const twin = await fetch(new URL("index.md", dev.origin), { signal: AbortSignal.timeout(15_000) });
      expect(twin.status).toBe(200);
      expect(await twin.text()).toContain("Runtime: workerd.");
      for (const path of ["index.md", "guides/email.document.json"]) {
        const head = await fetch(new URL(path, dev.origin), { method: "HEAD", signal: AbortSignal.timeout(15_000) });
        expect(head.status).toBe(200);
        expect(await head.text()).toBe("");
      }
      const failed = await fetch(new URL("broken.document.json", dev.origin), { signal: AbortSignal.timeout(15_000) });
      expect(failed.status).toBe(500);
      expect(decodeURIComponent(failed.headers.get("x-pagegraph-error") ?? "")).toContain("Intentional fixture render failure");
      const failedHead = await fetch(new URL("broken.document.json", dev.origin), { method: "HEAD", signal: AbortSignal.timeout(15_000) });
      expect(failedHead.status).toBe(500);
      expect(await failedHead.text()).toBe("");
      expect(decodeURIComponent(failedHead.headers.get("x-pagegraph-error") ?? "")).toContain("Intentional fixture render failure");
    } finally {
      await stopFixture(dev.process);
    }
  }, 60_000);
  it("fails the build when rendered pages declare metadata only in head()", async () => {
    await rm(join(root, "src/routes/broken.tsx"), { force: true });
    await cp(join(root, "negative/missing-graph-head.tsx"), join(root, "src/routes/missing-graph-head.tsx"));
    let failure: unknown;
    try {
      await exec(node, [join(packageRoot, "node_modules/vite/bin/vite.js"), "build"], {
        cwd: root, env: { ...process.env, NODE_ENV: "production", CI: "1" },
        maxBuffer: 5_000_000, timeout: 90_000,
      });
    } catch (cause) { failure = cause; }
    expect(failure).toBeInstanceOf(Error);
    if (typeof failure !== "object" || failure === null || !("stdout" in failure) || !("stderr" in failure))
      throw new Error("Expected a failed Vite build with capture diagnostics");
    expect(String(failure.stdout) + String(failure.stderr)).toContain(
      "Markdown page /missing-graph-head must declare a graph head with title and description for llms.txt",
    );
  }, 120_000);

});
