import { createServer, type Server } from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import {
  defaultHostedScannerOrigins,
  parseSseDataFrames,
  scanHosted,
  type HostedScannerOrigins,
} from "../../src/audit/scanners/hosted";

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          ),
      ),
  );
});

describe("opt-in hosted SEO scanners", () => {
  it("retains incomplete SSE frames and parses CRLF events", () => {
    expect(parseSseDataFrames('data: {"ty')).toEqual({
      events: [],
      rest: 'data: {"ty',
    });
    expect(parseSseDataFrames('data: {"type":"scan_complete"}\r\n\r\n')).toEqual({
      events: [{ type: "scan_complete" }],
      rest: "",
    });
  });

  it("runs both hosted services and preserves report failures as data", async () => {
    const server = createServer((request, response) => {
      if (request.url === "/api/scan") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            checks: { essential: { robots: { status: "pass" } } },
          }),
        );
        return;
      }
      if (request.url?.startsWith("/api/scan/stream")) {
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.write('data: {"type":"scan_');
        response.end('complete"}\n\n');
        return;
      }
      if (request.url?.startsWith("/api/v1/report")) {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            score: 95,
            score_label: "Strong",
            issues: [{ result: "partial", name: "404 guidance" }],
          }),
        );
        return;
      }
      response.writeHead(404);
      response.end();
    });
    servers.push(server);
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("fixture did not bind");
    const origin = `http://127.0.0.1:${address.port}`;
    const origins: HostedScannerOrigins = {
      ...defaultHostedScannerOrigins,
      isitagentready: origin,
      isAgentic: origin,
    };

    const reports = await scanHosted(new URL("http://127.0.0.1:43210/"), {
      allowPrivate: true,
      timeoutMs: 2_000,
      maxBodyBytes: 16_000,
      origins,
    });

    expect(reports).toEqual([
      expect.objectContaining({ scanner: "isitagentready", error: null }),
      expect.objectContaining({
        scanner: "is-agentic",
        score: 95,
        scoreLabel: "Strong",
        findings: [expect.objectContaining({ result: "partial", name: "404 guidance" })],
        error: null,
      }),
    ]);
  });
});
