import { fileURLToPath } from "node:url";

import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";

import type { LighthouseRun } from "../../src/audit/model";
import { makeHttpScanner } from "../../src/audit/scanners/http";
import {
  makeLighthouseScanner,
  runLighthouseProcess,
  windowsProcessTreeKill,
} from "../../src/audit/scanners/lighthouse";

const emptyLighthouseRun = (
  formFactor: LighthouseRun["formFactor"],
  run: number,
): LighthouseRun => ({
  requestedUrl: "https://example.test/",
  finalUrl: "https://example.test/",
  formFactor,
  run,
  lighthouseVersion: "fixture",
  userAgent: null,
  fetchTime: null,
  categories: {},
  metrics: {},
  opportunities: [],
  warnings: [],
  error: null,
});

describe("scanner failure regressions", () => {
  it("attributes a total HTTP acquisition failure to the scanner", async () => {
    const http = makeHttpScanner({
      allowPrivate: false,
      timeoutMs: 100,
      maxBodyBytes: 1_024,
      resolve: async () => {
        throw new Error("fixture DNS failure");
      },
    });

    await expect(
      Effect.runPromise(
        http.scan({
          target: { url: "https://unreachable.test/" },
          options: {},
        }),
      ),
    ).rejects.toMatchObject({
      _tag: "ScannerFailure",
      scanner: "http",
      message: expect.stringContaining("fixture DNS failure"),
    });
  });

  it("runs every requested Lighthouse form factor and repetition", async () => {
    const calls: Array<string> = [];
    const lighthouse = makeLighthouseScanner(
      { allowPrivate: false },
      {
        run: async (options) => {
          calls.push(`${options.formFactor}:${options.run}`);
          return emptyLighthouseRun(options.formFactor, options.run);
        },
      },
    );

    const observation = await Effect.runPromise(
      lighthouse.scan({
        target: { url: "https://example.test/" },
        options: { formFactors: ["mobile", "desktop"], runs: 2 },
      }),
    );

    expect(calls).toEqual(["mobile:1", "mobile:2", "desktop:1", "desktop:2"]);
    expect(observation.evidence).toHaveLength(4);
  });

  it("defaults an explicitly empty form-factor list to mobile", async () => {
    const calls: Array<string> = [];
    const lighthouse = makeLighthouseScanner(
      { allowPrivate: false },
      {
        run: async (options) => {
          calls.push(`${options.formFactor}:${options.run}`);
          return emptyLighthouseRun(options.formFactor, options.run);
        },
      },
    );

    await Effect.runPromise(
      lighthouse.scan({
        target: { url: "https://example.test/" },
        options: { formFactors: [] },
      }),
    );

    expect(calls).toEqual(["mobile:1"]);
  });

  it("escalates a Lighthouse timeout from SIGTERM to SIGKILL", async () => {
    const fixture = fileURLToPath(new URL("../fixtures/ignore-term.mjs", import.meta.url));
    const startedAt = performance.now();

    await expect(runLighthouseProcess(fixture, [], 25, 25)).rejects.toThrow(
      "Lighthouse timed out after 25ms",
    );
    expect(performance.now() - startedAt).toBeLessThan(1_000);
  });

  it("uses recursive forced termination for Windows process trees", () => {
    expect(windowsProcessTreeKill(4312)).toEqual({
      command: "taskkill",
      arguments: ["/pid", "4312", "/T", "/F"],
    });
  });
});
