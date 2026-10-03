import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const cli = fileURLToPath(new URL("../../src/cli/bin.ts", import.meta.url));

/**
 * `check --site` fetches every declared page from a live origin, so the fixture
 * is a real local HTTP server. The CLI runs as an async child process: a
 * synchronous spawn would block the event loop that serves the fixture.
 */
const html = (path: string, main: string, head = ""): string =>
  `<!doctype html><html><head><title>${path} page | Example</title><link rel="canonical" href="https://example.com${path}">${head}</head><body><main>${main}</main></body></html>`;

const PAGES: Record<string, string> = {
  "/pricing": html("/pricing", "<h1>Pricing page</h1><h2>Plans</h2><p>Growth is $19 a month.</p>"),
  "/about": html("/about", "<h2>About</h2><h4>Team</h4>"),
  "/compare": html("/compare", "<h1>Compare page</h1>", '<meta name="robots" content="noindex, follow">'),
};

let server: Server;
let site: string;
/** Requests seen per path, so a test can prove a transient failure is retried. */
const hits = new Map<string, number>();

beforeAll(async () => {
  server = createServer((request, response) => {
    const count = (hits.get(request.url ?? "") ?? 0) + 1;
    hits.set(request.url ?? "", count);
    if (request.url === "/pricing" && count === 1) {
      // A dev server's cold first render.
      response.writeHead(503, { "content-type": "text/plain" });
      response.end("compiling");
      return;
    }
    const body = PAGES[request.url ?? ""];
    if (body === undefined) {
      response.writeHead(404, { "content-type": "text/plain" });
      response.end("not found");
      return;
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(body);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Fixture did not bind");
  site = `http://127.0.0.1:${address.port}`;
});

const temporaryDirectories: Array<string> = [];

afterAll(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

const CONFIG = (extra: string): string => `const SITEMAP = { priority: 0.5, changeFrequency: "monthly" };
const node = (path, policy = {}, instance) => ({
  path,
  kind: "page",
  source: instance ? "blog" : "route",
  policy: { kind: "page", sitemap: SITEMAP, ...policy },
  ...(instance ? { instance } : {}),
});

export default {
  origin: "https://example.com",
  disallow: [],
  ${extra}
  loadGraph: async () => ({
    graph: {
      nodes: new Map([
        ["/pricing", node("/pricing", { modifiedAt: "2026-09-01" })],
        ["/about", node("/about")],
        ["/compare", node("/compare", { sitemap: false, robots: "noindex, follow" })],
        ["/blog/old", node("/blog/old", {}, { title: "Old", publishedAt: "2020-01-01" })],
      ]),
      edges: [],
    },
    dispose: async () => {},
  }),
};
`;

const configDirectory = (extra = ""): string => {
  const directory = mkdtempSync(join(tmpdir(), "pagegraph-content-"));
  temporaryDirectories.push(directory);
  writeFileSync(join(directory, "pagegraph.config.mjs"), CONFIG(extra));
  return directory;
};

interface CliResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

const run = (args: ReadonlyArray<string>, cwd: string): Promise<CliResult> =>
  new Promise((resolve, reject) => {
    const child = spawn("bun", [cli, ...args], { cwd });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.once("error", reject);
    child.once("close", (status) => resolve({ status, stdout, stderr }));
  });

interface Report {
  readonly ok: boolean;
  readonly rendered?: { readonly site: string; readonly pages: number };
  readonly violations: ReadonlyArray<{ rule: string; path?: string; severity: string }>;
}

describe("pagegraph check --site", () => {
  it("checks every declared page's rendered HTML and fails on structural findings", async () => {
    const result = await run(["check", "--site", site, "--allow-private", "--json"], configDirectory());
    expect(result.status).toBe(1);
    const report = JSON.parse(result.stdout) as Report;
    expect(report.rendered).toEqual({ site, pages: 4 });
    // /pricing answered 503 once and passed on the retry.
    expect(hits.get("/pricing")).toBe(2);
    expect(report.violations.map((violation) => [violation.rule, violation.path])).toEqual([
      ["missing-h1", "/about"],
      ["heading-level-skip", "/about"],
      ["rendered-page-unavailable", "/blog/old"],
    ]);
  }, 30_000);

  it("refuses a private --site without --allow-private", async () => {
    const result = await run(["check", "--site", site, "--json"], configDirectory());
    expect(result.status).toBe(1);
    const report = JSON.parse(result.stdout) as Report;
    expect(report.violations.filter((violation) => violation.rule === "rendered-page-unavailable")).toHaveLength(4);
  }, 30_000);

  it("leaves the declared-graph check unchanged without --site", async () => {
    const result = await run(["check", "--json"], configDirectory());
    expect(result.status).toBe(0);
    expect((JSON.parse(result.stdout) as Report).rendered).toBeUndefined();
  }, 30_000);

  it("adds editorial stale-page findings under a freshness policy", async () => {
    const result = await run(["check", "--json"], configDirectory("freshness: { maxAgeDays: 365 },"));
    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout) as Report;
    expect(report.violations).toEqual([
      expect.objectContaining({ rule: "stale-page", path: "/blog/old", severity: "editorial" }),
    ]);
  }, 30_000);

  it("rejects a malformed content policy in pagegraph.config", async () => {
    const result = await run(["check"], configDirectory('content: { minWords: [{ path: "/**" }] },'));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("must default-export defineSeoConfig");
  }, 30_000);
});

describe("pagegraph stale", () => {
  it("lists stale pages oldest first and counts undated ones", async () => {
    const result = await run(["stale", "--max-age-days", "365"], configDirectory());
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/Stale \(1, unchanged for more than 365 days/);
    expect(result.stdout).toMatch(/\d+d {2}2020-01-01 {2}\/blog\/old {2}\(blog\)/);
    expect(result.stdout).toContain("1 sitemap page(s) declare no date");
  }, 30_000);

  it("reads the limit from pagegraph.config and emits JSON", async () => {
    const result = await run(["stale", "--json"], configDirectory("freshness: { maxAgeDays: 365 },"));
    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout) as { stale: Array<{ path: string }>; undated: Array<string>; maxAgeDays: number };
    expect(report).toMatchObject({ maxAgeDays: 365, undated: ["/about"] });
    expect(report.stale.map((entry) => entry.path)).toEqual(["/blog/old"]);
  }, 30_000);

  it("requires a limit from the flag or the config", async () => {
    const result = await run(["stale"], configDirectory());
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--max-age-days");
  }, 30_000);
});
