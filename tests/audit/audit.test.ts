import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type * as Tracer from "effect/Tracer";
import { describe, expect, it } from "vitest";

import { Audit, InvalidTarget } from "../../src/audit/audit";
import { AuditLayer } from "../../src/audit/layers";
import { ScannerRegistry, ScannerRegistryLive } from "../../src/audit/scanner-registry";
import { ScannerFailure, scanner, type Scanner } from "../../src/audit/scanner";

const runAudit = (scanners: readonly Scanner[], targets: readonly string[]) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const audit = yield* Audit.Service;
      return yield* audit.run({ targets });
    }).pipe(Effect.provide(AuditLayer(scanners))),
  );

const healthyEvidence = {
  status: 200,
  title: "A sufficiently descriptive page title",
  description: "A sufficiently descriptive meta description for this page.",
  canonical: "https://example.test/",
};

describe("Audit and Scanner services", () => {
  it("substitutes a value-level scanner through the registry layer", async () => {
    const custom = scanner({
      id: "fixture",
      description: "A test scanner",
      scan: () => Effect.succeed({ evidence: healthyEvidence }),
    });

    const registry = await Effect.runPromise(
      Effect.gen(function* () {
        const value = yield* ScannerRegistry.Service;
        return { all: value.all(), found: value.get("fixture") };
      }).pipe(Effect.provide(ScannerRegistryLive([custom]))),
    );

    expect(registry.all).toEqual([custom]);
    expect(registry.found).toBe(custom);
  });

  it("preserves target/scanner ordering while running pairs concurrently", async () => {
    const calls: string[] = [];
    const first = scanner({
      id: "first",
      scan: ({ target }) =>
        Effect.sync(() => {
          calls.push(`first:${target.url}`);
          return { evidence: healthyEvidence };
        }),
    });
    const second = scanner({
      id: "second",
      scan: ({ target }) =>
        Effect.sync(() => {
          calls.push(`second:${target.url}`);
          return { evidence: healthyEvidence };
        }),
    });
    const targets = ["https://one.test/", "https://two.test/"];

    const report = await runAudit([first, second], targets);

    expect(report.targets).toEqual(targets);
    expect(report.results.map((result) => `${result.scanner}:${result.target}`)).toEqual([
      "first:https://one.test/",
      "second:https://one.test/",
      "first:https://two.test/",
      "second:https://two.test/",
    ]);
    expect(calls).toHaveLength(4);
  });

  it("records an attributed scanner failure while completing the other results", async () => {
    const healthy = scanner({
      id: "healthy",
      scan: () => Effect.succeed({ evidence: healthyEvidence }),
    });
    const broken = scanner({
      id: "broken",
      scan: ({ target }) =>
        Effect.fail(
          new ScannerFailure({
            scanner: "broken",
            target: target.url,
            message: "fixture scanner failed",
          }),
        ),
    });

    const report = await runAudit([healthy, broken], ["https://example.test/"]);

    expect(report.results).toEqual([
      expect.objectContaining({
        scanner: "healthy",
        status: "ok",
        findings: [],
      }),
      expect.objectContaining({
        scanner: "broken",
        status: "error",
        error: "fixture scanner failed",
      }),
    ]);
    expect(report.warnings).toEqual([
      "broken failed for https://example.test/: fixture scanner failed",
    ]);
  });

  it("fails target validation before invoking scanners", async () => {
    let invoked = false;
    const custom = scanner({
      id: "fixture",
      scan: () => {
        invoked = true;
        return Effect.succeed({ evidence: healthyEvidence });
      },
    });

    await expect(runAudit([custom], ["file:///tmp/private"])).rejects.toMatchObject({
      _tag: "InvalidTarget",
      target: "file:///tmp/private",
    } satisfies Partial<InvalidTarget>);
    expect(invoked).toBe(false);
  });

  it("keeps scanner spans parented under the audit and caller spans", async () => {
    let observed: Tracer.Span | undefined;
    const custom = scanner({
      id: "fixture",
      scan: () =>
        Effect.map(Effect.orDie(Effect.currentSpan), (span) => {
          observed = span;
          return { evidence: healthyEvidence };
        }),
    });

    await Effect.runPromise(
      Effect.gen(function* () {
        const audit = yield* Audit.Service;
        yield* audit.run({ targets: ["https://example.test/"] });
      }).pipe(Effect.provide(AuditLayer([custom])), Effect.withSpan("test-root")),
    );

    expect(observed?.name).toBe("Audit.runScanner");
    const auditSpan = observed === undefined ? undefined : Option.getOrUndefined(observed.parent);
    expect(auditSpan?._tag).toBe("Span");
    if (auditSpan?._tag !== "Span") throw new Error("Expected an internal audit span");
    expect(auditSpan.name).toBe("Audit.run");
    const rootSpan = Option.getOrUndefined(auditSpan.parent);
    expect(rootSpan?._tag).toBe("Span");
    if (rootSpan?._tag !== "Span") throw new Error("Expected an internal root span");
    expect(rootSpan.name).toBe("test-root");
  });
});
