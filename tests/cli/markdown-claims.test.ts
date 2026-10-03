import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import * as Effect from "effect/Effect";
import { Decision } from "effect/ai";
import { afterAll, describe, expect, it } from "vitest";

import { claimsInput, claimsRunOptions } from "../../src/claims";
import { writeAnswers } from "../../src/decide/cache";
import { cacheKey, inputHash } from "../../src/decide/answers";
import { createServer } from "node:http";
import { hashDocument, type PageDocument } from "../../src/markdown/document";
import { readMarkdownCapture, readDevMarkdownCapture } from "../../src/markdown/documents";

const cli = fileURLToPath(new URL("../../src/cli/bin.ts", import.meta.url));
const repository = fileURLToPath(new URL("../../", import.meta.url));
const directories: Array<string> = [];
const content = {
  path: "/", title: "Reliable messages", description: "Messages for teams",
  sections: [{ kind: "prose", id: "intro", body: [{ type: "visual" as const, text: "Reliable delivery", source: "home.tsx:1", audience: "all" as const }], items: [], source: "home.tsx:1", audience: "all" as const }], messages: [], facts: [],
};
const document: PageDocument = { ...content, hash: hashDocument(content) };
const heads = [{ path: "/about", title: "About the team", description: "Our people" }];
const rules = Decision.make({ input: claimsInput, decisions: { unsupported: Decision.probability({ instructions: "Is this claim unsupported?" }) } });
const claims = { rules, model: "typesafe/jev" };

function app(withClaims = false): string {
  const root = mkdtempSync(join(tmpdir(), "pagegraph-markdown-cli-"));
  directories.push(root);
  mkdirSync(join(root, "src/routes"), { recursive: true });
  mkdirSync(join(root, ".pagegraph/documents"), { recursive: true });
  writeFileSync(join(root, ".pagegraph/documents/index.json"), JSON.stringify(document));
  writeFileSync(join(root, ".pagegraph/heads.json"), JSON.stringify(heads));
  writeFileSync(join(root, "vite.config.ts"), `
import { pagegraph } from ${JSON.stringify(resolve(repository, "src/tanstack-start/plugin.ts"))};
${withClaims ? `import { Decision } from ${JSON.stringify(resolve(repository, "node_modules/effect/dist/ai/index.js"))};
import { claimsInput } from ${JSON.stringify(resolve(repository, "src/claims.ts"))};` : ""}
export default { plugins: [pagegraph({ origin: "https://example.com", markdown: { origin: "https://example.com" }${withClaims ? ', claims: { model: "typesafe/jev", rules: Decision.make({ input: claimsInput, decisions: { unsupported: Decision.probability({ instructions: "Is this claim unsupported?" }) } }) }' : ""} })] };
`);
  return root;
}
function run(root: string, args: ReadonlyArray<string>) {
  return spawnSync("bun", [cli, ...args], { cwd: root, encoding: "utf8", timeout: 30_000, env: Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== "TYPESAFE_API_KEY")) });
}
function runAsync(root: string, args: ReadonlyArray<string>) {
  return new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn("bun", [cli, ...args], { cwd: root, env: Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== "TYPESAFE_API_KEY")) });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data) => { stdout += data.toString(); });
    child.stderr.on("data", (data) => { stderr += data.toString(); });
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

async function cache(root: string, probability: number, model = claims.model) {
  const options = claimsRunOptions(root, [document], heads, {}, { ...claims, model });
  for (const input of options.inputs) {
    const key = cacheKey({ family: options.family.name, decisions: options.family.definitionFor(input).decisions, inputHash: inputHash(input), model });
    await Effect.runPromise(writeAnswers(options.cache, key, { unsupported: { probability } }));
  }
}

afterAll(() => directories.forEach((directory) => rmSync(directory, { recursive: true, force: true })));

describe("markdown CLI", () => {
  it("prints the twin and finds section and head-only matches", () => {
    const root = app();
    const show = run(root, ["markdown", "show", "/"]);
    expect(show.status, show.stderr).toBe(0);
    expect(show.stdout).toContain("# Reliable messages\n\nURL: https://example.com/");
    expect(show.stdout).toContain("Reliable delivery");
    const find = run(root, ["markdown", "find", "reliable", "--json"]);
    expect(find.status, find.stderr).toBe(0);
    expect(JSON.parse(find.stdout).matches.map((match: { section: string }) => match.section)).toEqual(["head", "intro"]);
    const about = run(root, ["markdown", "show", "/about"]);
    expect(about.stdout).toContain("# About the team");
  }, 90_000);

  it("writes and checks a lock including head-only pages, then fails on drift", () => {
    const root = app();
    const missing = run(root, ["markdown", "lock", "--check"]);
    expect(missing.status).toBe(1);
    const write = run(root, ["markdown", "lock", "--json"]);
    expect(write.status, write.stderr).toBe(0);
    expect(JSON.parse(write.stdout).pages).toBe(2);
    const check = run(root, ["markdown", "lock", "--check"]);
    expect(check.status, check.stderr).toBe(0);
    writeFileSync(join(root, ".pagegraph/heads.json"), JSON.stringify([...heads, { path: "/new", title: "New", description: "Added" }]));
    const stale = run(root, ["markdown", "lock", "--check"]);
    expect(stale.status).toBe(1);
    expect(stale.stderr).toContain("out of date");
  }, 120_000);

  it("rejects tampered document hashes", async () => {
    const root = app();
    writeFileSync(join(root, ".pagegraph/documents/index.json"), JSON.stringify({ ...document, title: "Changed" }));
    await expect(readMarkdownCapture(root, "https://example.com")).rejects.toThrow("hash");
  });

  it("reads decoded Unicode and space paths from stored captures", async () => {
    const root = app();
    mkdirSync(join(root, ".pagegraph/documents/guides"));
    for (const path of ["/guides/café", "/guides/hello world"]) {
      const page = { ...content, path };
      writeFileSync(join(root, `.pagegraph/documents${path}.json`), JSON.stringify({ ...page, hash: hashDocument(page) }));
    }
    writeFileSync(join(root, ".pagegraph/heads.json"), JSON.stringify([{ ...heads[0], path: "/équipe" }]));
    const capture = await readMarkdownCapture(root, "https://example.com");
    expect(capture.documents.map((document) => document.path)).toEqual(["/", "/guides/café", "/guides/hello world"]);
    const shown = run(root, ["markdown", "show", "/guides/hello world"]);
    expect(shown.status, shown.stderr).toBe(0);
    expect(shown.stdout).toContain("Reliable delivery");
  }, 30_000);

  it.each(["/../escape", "/guides//email", "/guides/", "/guides\\email", "/guides?email", "/guides\u0000email", "/guides/*"])(
    "rejects unsafe captured paths: %j", async (path) => {
      const root = app();
      writeFileSync(join(root, ".pagegraph/heads.json"), JSON.stringify([{ ...heads[0], path }]));
      await expect(readMarkdownCapture(root, "https://example.com")).rejects.toThrow("Invalid captured page path");
    },
  );

  it("reads and verifies the development bundle", async () => {
    const page = { ...content, path: "/guides/café and tea" };
    const decodedDocument = { ...page, hash: hashDocument(page) };
    const server = createServer((request, response) => {
      expect(request.url).toBe("/__pagegraph/markdown.json");
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ origin: "https://example.com", documents: [decodedDocument], heads: [{ ...heads[0], path: "/équipe and team" }] }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("Missing listening port");
    try { expect((await readDevMarkdownCapture(`http://127.0.0.1:${address.port}`)).documents[0]).toEqual(decodedDocument); }
    finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
  });
});

describe("claims CLI", () => {
  it("uses build settings for stored captures and development settings under --dev", async () => {
    const root = app(true);
    const config = readFileSync(join(root, "vite.config.ts"), "utf8")
      .replace('export default { plugins:', 'export default ({ command, mode }) => ({ plugins:')
      .replace('})] };', '})] });')
      .replaceAll('"https://example.com"', '(command === "build" && mode === "production" ? "https://build.example.com" : "https://dev.example.com")')
      .replace('model: "typesafe/jev"', 'model: command === "build" && mode === "production" ? "typesafe/jev" : "typesafe/jev-preview"');
    writeFileSync(join(root, "vite.config.ts"), config);
    await cache(root, 0.1);
    await cache(root, 0.9, "typesafe/jev-preview");
    const built = run(root, ["claims", "check", "--json"]);
    expect(built.status, built.stderr).toBe(0);
    expect(JSON.parse(built.stdout)).toMatchObject({ asked: 0, cached: 3 });
    const builtTwin = run(root, ["markdown", "show", "/"]);
    expect(builtTwin.status, builtTwin.stderr).toBe(0);
    expect(builtTwin.stdout).toContain("URL: https://build.example.com/");
    const server = createServer((_request, response) => {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ origin: "https://dev.example.com", documents: [document], heads }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("Missing listening port");
    const dev = `http://127.0.0.1:${address.port}`;
    try {
      const live = await runAsync(root, ["claims", "check", "--dev", dev, "--json"]);
      expect(live.status, live.stderr).toBe(1);
      expect(JSON.parse(live.stdout)).toMatchObject({ asked: 0, cached: 3 });
      expect(JSON.parse(live.stdout).findings).toHaveLength(3);
      const twin = await runAsync(root, ["markdown", "show", "/", "--dev", dev]);
      expect(twin.status, twin.stderr).toBe(0);
      expect(twin.stdout).toContain("URL: https://dev.example.com/");
    } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
  }, 60_000);

  it("keeps graph-only checks working with a Vite config that has no pagegraph plugin", () => {
    const root = app();
    writeFileSync(join(root, "vite.config.ts"), "export default { plugins: [] };\n");
    writeFileSync(join(root, "pagegraph.config.mjs"), `export default { loadGraph: async () => ({ graph: { nodes: new Map(), edges: [] }, site: { origin: "https://example.com", indexable: true, robots: { disallow: [] } }, dispose: async () => {} }) };`);
    const result = run(root, ["check", "--json"]);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, violations: [] });
    expect(JSON.parse(result.stdout).claims).toBeUndefined();
    const markdown = run(root, ["markdown", "show", "/"]);
    expect(markdown.status).toBe(1);
    expect(markdown.stderr).toContain("does not register pagegraph()");
  }, 60_000);

  it("keeps Vite config evaluation failures visible in graph-only checks", () => {
    const root = app();
    writeFileSync(join(root, "vite.config.ts"), 'throw new Error("Broken Vite settings"); export default { plugins: [] };\n');
    writeFileSync(join(root, "pagegraph.config.mjs"), `export default { loadGraph: async () => ({ graph: { nodes: new Map(), edges: [] }, site: { origin: "https://example.com", indexable: true, robots: { disallow: [] } }, dispose: async () => {} }) };`);
    const result = run(root, ["check", "--json"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Broken Vite settings");
  }, 60_000);

  it("reads live captures for markdown and claims without requiring a build", async () => {
    const root = app(true);
    await cache(root, 0.1);
    rmSync(join(root, ".pagegraph/documents"), { recursive: true });
    rmSync(join(root, ".pagegraph/heads.json"));
    const server = createServer((_request, response) => {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ origin: "https://example.com", documents: [document], heads }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("Missing listening port");
    const dev = `http://127.0.0.1:${address.port}`;
    try {
      const show = await runAsync(root, ["markdown", "show", "/", "--dev", dev]);
      expect(show.status, show.stderr).toBe(0);
      expect(show.stdout).toContain("Reliable delivery");
      const result = await runAsync(root, ["claims", "check", "--dev", dev, "--json"]);
      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({ asked: 0, cached: 3 });
    } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
  }, 60_000);

  it("pagegraph check replays claims offline and names missing answers", async () => {
    const root = app(true);
    writeFileSync(join(root, "pagegraph.config.mjs"), `export default { loadGraph: async () => ({ graph: { nodes: new Map(), edges: [] }, site: { origin: "https://example.com", indexable: true, robots: { disallow: [] } }, dispose: async () => {} }) };`);
    const missing = run(root, ["check", "--json"]);
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("pagegraph claims check");
    await cache(root, 0.1);
    const passed = run(root, ["check", "--json"]);
    expect(passed.status, passed.stderr).toBe(0);
    expect(JSON.parse(passed.stdout).claims).toMatchObject({ asked: 0, cached: 3 });
    await cache(root, 0.9);
    const failed = run(root, ["check", "--json"]);
    expect(failed.status).toBe(1);
    expect(JSON.parse(failed.stdout).ok).toBe(false);
    expect(JSON.parse(failed.stdout).claims.findings).toHaveLength(3);
  }, 90_000);

  it("refresh bypasses valid committed answers and requires model credentials", async () => {
    const root = app(true);
    await cache(root, 0.1);
    const refreshed = run(root, ["claims", "check", "--refresh", "--json"]);
    expect(refreshed.status).toBe(1);
    expect(refreshed.stderr).toContain("TYPESAFE_API_KEY");
  }, 60_000);

  it("replays committed answers without credentials and reports cached counts", async () => {
    const root = app(true);
    await cache(root, 0.1);
    const result = run(root, ["claims", "check", "--json"]);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ asked: 0, cached: 3, findings: [] });
  }, 60_000);

  it("prints cached violations as JSON and exits nonzero", async () => {
    const root = app(true);
    await cache(root, 0.9);
    const result = run(root, ["claims", "check", "--json"]);
    expect(result.status, result.stderr).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({ asked: 0, cached: 3 });
    expect(JSON.parse(result.stdout).findings[0].rule).toBe("unsupported");
  }, 60_000);
});
