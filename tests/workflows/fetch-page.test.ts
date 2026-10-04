import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createFetchPageTool } from "../../src/workflows/run";

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    // The cancellation test leaves a response open; close waits for open connections.
    server.closeAllConnections();
  })));
});

const servedSite = async (robots = "User-agent: *\nDisallow: /private") => {
  const visited: string[] = [];
  const server = createServer((request, response) => {
    visited.push(request.url ?? "");
    response.setHeader("Content-Type", request.url === "/robots.txt" ? "text/plain" : "text/html");
    if (request.url === "/robots.txt") response.end(robots);
    else if (request.url === "/large") response.end(`<p>${"Large body. ".repeat(200)}</p>`);
    else if (request.url === "/slow") response.write("<main>");
    else if (request.url === "/redirect") { response.writeHead(302, { location: "https://other.example/pricing" }); response.end(); }
    else response.end("<main><p>Pricing options include usage based plans for teams.</p></main>");
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Test server did not bind a TCP port");
  return { origin: `http://127.0.0.1:${address.port}`, visited };
};

describe("fetch_page", () => {
  it("returns extracted sentences with query strings using the report's bounded HTTP path", async () => {
    const { origin, visited } = await servedSite();
    const tool = await createFetchPageTool({ origin, maxBodyBytes: 200 }, true);
    const result = await tool.execute("read", { url: `${origin}/pricing?language=en` });
    expect(result.content).toEqual([{ type: "text", text: JSON.stringify(["Pricing options include usage based plans for teams."]) }]);
    expect(visited).toEqual(["/robots.txt", "/pricing?language=en"]);
  });

  it("rejects external origins before making HTTP requests", async () => {
    const { origin, visited } = await servedSite();
    const tool = await createFetchPageTool({ origin, maxBodyBytes: 200 }, true);
    await expect(tool.execute("read", { url: "https://other.example/pricing" })).rejects.toThrow("suggestion report origin");
    expect(visited).toEqual([]);
  });

  it("refuses robots-disallowed pages before fetching their content", async () => {
    const { origin, visited } = await servedSite();
    const tool = await createFetchPageTool({ origin, maxBodyBytes: 200 }, true);
    await expect(tool.execute("read", { url: "/private" })).rejects.toThrow("robots-disallowed");
    expect(visited).toEqual(["/robots.txt"]);
  });

  it("refuses truncated served pages", async () => {
    const { origin } = await servedSite();
    const tool = await createFetchPageTool({ origin, maxBodyBytes: 200 }, true);
    await expect(tool.execute("read", { url: "/large" })).rejects.toThrow("Could not verify current served copy");
  });

  it("refuses unverifiable truncated robots policies", async () => {
    const { origin, visited } = await servedSite("User-agent: *\n" + "Disallow: /private\n".repeat(100));
    const tool = await createFetchPageTool({ origin, maxBodyBytes: 200 }, true);
    await expect(tool.execute("read", { url: "/pricing" })).rejects.toThrow("Could not verify current robots policy");
    expect(visited).toEqual(["/robots.txt"]);
  });

  it("refuses redirects away from the suggestion origin", async () => {
    const { origin, visited } = await servedSite();
    const tool = await createFetchPageTool({ origin, maxBodyBytes: 200 }, true);
    await expect(tool.execute("read", { url: "/redirect" })).rejects.toThrow("Could not verify current served copy");
    expect(visited).toEqual(["/robots.txt", "/redirect"]);
  });

  it("cancels an in-flight page request when the workflow aborts", async () => {
    const { origin, visited } = await servedSite();
    const tool = await createFetchPageTool({ origin, maxBodyBytes: 200 }, true);
    const controller = new AbortController();
    const started = Date.now();
    setTimeout(() => controller.abort(new Error("workflow deadline")), 100);
    await expect(tool.execute("read", { url: "/slow" }, controller.signal)).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(visited).toEqual(["/robots.txt", "/slow"]);
  });
});
