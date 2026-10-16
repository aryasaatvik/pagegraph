import { createServer, type Server } from "node:http";

import * as Effect from "effect/Effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Audit } from "../../src/audit/audit";
import { AuditLayer } from "../../src/audit/layers";
import { ScannerFailure, scanner } from "../../src/audit/scanner";

let server: Server;
let target: string;

beforeAll(async () => {
  server = createServer((request, response) => {
    if (request.url === "/") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(
        "<!doctype html><html><head><title>Fixture documentation page</title><meta name=description content='A local fixture page with enough descriptive copy for audit rules.'><link rel=canonical href='http://127.0.0.1/'></head><body><h1>Fixture</h1></body></html>",
      );
      return;
    }
    response.writeHead(404, { "content-type": "text/plain" });
    response.end("not found");
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Fixture did not bind");
  target = `http://127.0.0.1:${address.port}/`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

describe("local HTTP audit fixture", () => {
  it("scans a real local HTTP page and emits a structured report", async () => {
    const http = scanner({
      id: "http-fixture",
      scan: ({ target: requestTarget }) =>
        Effect.tryPromise({
          try: async () => {
            const response = await fetch(requestTarget.url);
            const body = await response.text();
            return {
              evidence: {
                status: response.status,
                body,
                title: "Fixture documentation page",
                description: "A local fixture page with enough descriptive copy for audit rules.",
                canonical: requestTarget.url,
              },
            };
          },
          catch: (cause) =>
            new ScannerFailure({
              scanner: "http-fixture",
              target: requestTarget.url,
              message: cause instanceof Error ? cause.message : String(cause),
              cause,
            }),
        }),
    });

    const report = await Effect.runPromise(
      Effect.gen(function* () {
        const audit = yield* Audit.Service;
        return yield* audit.run({
          targets: [target],
          options: { concurrency: 1 },
        });
      }).pipe(Effect.provide(AuditLayer([http]))),
    );

    expect(report.schemaVersion).toBe(1);
    expect(report.targets).toEqual([target]);
    expect(report.results).toEqual([
      expect.objectContaining({
        scanner: "http-fixture",
        target,
        status: "ok",
      }),
    ]);
    expect(report.findings).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(report.results[0]?.evidence).toEqual(
      expect.objectContaining({
        status: 200,
        body: expect.stringContaining("<h1>Fixture</h1>"),
      }),
    );
  });
});
