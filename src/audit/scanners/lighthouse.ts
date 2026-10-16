import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type {
  FormFactor,
  LighthouseCategory,
  LighthouseMetric,
  LighthouseOpportunity,
  LighthouseRun,
} from "../model";
import { startAuditProxy, type AuditProxy } from "../proxy";
import { ScannerFailure, type Scanner, type ScannerInput } from "../scanner";

const require = createRequire(import.meta.url);
const metricIds = [
  "first-contentful-paint",
  "largest-contentful-paint",
  "total-blocking-time",
  "cumulative-layout-shift",
  "speed-index",
] as const;
type UnknownRecord = Readonly<Record<string, unknown>>;
const UnknownRecord = Schema.Record(Schema.String, Schema.Unknown);
const decodeUnknownRecord = Schema.decodeUnknownOption(UnknownRecord);
const asRecord = (value: unknown): UnknownRecord | null =>
  Option.getOrNull(decodeUnknownRecord(value));
const asString = (value: unknown): string | null => (typeof value === "string" ? value : null);
const asNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

export class LighthouseError extends Data.TaggedError("LighthouseError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const resolveLighthouse = (): {
  readonly cli: string;
  readonly packageJson: string;
} => {
  try {
    const packageJson = require.resolve("lighthouse/package.json");
    return { packageJson, cli: require.resolve("lighthouse/cli/index.js") };
  } catch (cause) {
    throw new LighthouseError({
      message:
        "Lighthouse is not installed. Install it as an optional dependency to enable browser audits.",
      cause,
    });
  }
};

const parseCategories = (value: unknown): Readonly<Record<string, LighthouseCategory>> => {
  const categories: Record<string, LighthouseCategory> = {};
  for (const [id, candidate] of Object.entries(asRecord(value) ?? {})) {
    const category = asRecord(candidate);
    if (category !== null)
      categories[id] = {
        id,
        title: asString(category.title) ?? id,
        score: asNumber(category.score),
      };
  }
  return categories;
};

const parseMetrics = (auditsValue: unknown): Readonly<Record<string, LighthouseMetric>> => {
  const metrics: Record<string, LighthouseMetric> = {};
  const audits = asRecord(auditsValue) ?? {};
  for (const id of metricIds) {
    const audit = asRecord(audits[id]);
    if (audit !== null)
      metrics[id] = {
        id,
        title: asString(audit.title) ?? id,
        numericValue: asNumber(audit.numericValue),
        numericUnit: asString(audit.numericUnit),
        displayValue: asString(audit.displayValue),
        score: asNumber(audit.score),
      };
  }
  return metrics;
};

const parseOpportunities = (auditsValue: unknown): ReadonlyArray<LighthouseOpportunity> => {
  const opportunities: Array<LighthouseOpportunity> = [];
  for (const [id, candidate] of Object.entries(asRecord(auditsValue) ?? {})) {
    const audit = asRecord(candidate);
    const details = asRecord(audit?.details);
    if (audit === null || details?.type !== "opportunity") continue;
    const savingsMs = asNumber(details.overallSavingsMs);
    const savingsBytes = asNumber(details.overallSavingsBytes);
    if ((savingsMs ?? 0) <= 0 && (savingsBytes ?? 0) <= 0) continue;
    opportunities.push({
      id,
      title: asString(audit.title) ?? id,
      displayValue: asString(audit.displayValue),
      savingsMs,
      savingsBytes,
    });
  }
  return opportunities.sort(
    (left, right) =>
      (right.savingsMs ?? 0) - (left.savingsMs ?? 0) ||
      (right.savingsBytes ?? 0) - (left.savingsBytes ?? 0),
  );
};

const parseWarnings = (value: unknown): ReadonlyArray<string> =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

export const parseLighthouseResult = (
  value: unknown,
  requestedUrl: string,
  formFactor: FormFactor,
  run: number,
): LighthouseRun => {
  const result = asRecord(value);
  if (result === null)
    throw new LighthouseError({
      message: "Lighthouse returned a non-object result",
    });
  const environment = asRecord(result.environment);
  return {
    requestedUrl,
    finalUrl: asString(result.finalDisplayedUrl) ?? asString(result.finalUrl),
    formFactor,
    run,
    lighthouseVersion: asString(result.lighthouseVersion),
    userAgent: asString(environment?.hostUserAgent),
    fetchTime: asString(result.fetchTime),
    categories: parseCategories(result.categories),
    metrics: parseMetrics(result.audits),
    opportunities: parseOpportunities(result.audits),
    warnings: parseWarnings(result.runWarnings),
    error: null,
  };
};

export const lighthouseVersion = async (): Promise<string | null> => {
  try {
    const { packageJson } = resolveLighthouse();
    const value: unknown = JSON.parse(await readFile(packageJson, "utf8"));
    return asString(asRecord(value)?.version);
  } catch {
    return null;
  }
};

export const lighthouseChromeFlags = (proxyUrl: string): string =>
  [
    "--headless=new",
    `--proxy-server=${proxyUrl}`,
    "--proxy-bypass-list=<-loopback>",
    "--disable-quic",
    "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
  ].join(" ");

export const windowsProcessTreeKill = (
  pid: number,
): { readonly command: string; readonly arguments: readonly string[] } => ({
  command: "taskkill",
  arguments: ["/pid", String(pid), "/T", "/F"],
});

export const runLighthouseProcess = async (
  cli: string,
  arguments_: ReadonlyArray<string>,
  timeoutMs: number,
  killGraceMs = 1_000,
): Promise<void> => {
  const child = spawn(process.execPath, [cli, ...arguments_], {
    detached: process.platform !== "win32",
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    if (stderr.length < 16_000) stderr += chunk;
  });
  const signal = (name: NodeJS.Signals): void => {
    if (child.pid === undefined) return;
    if (process.platform === "win32") {
      const taskkill = windowsProcessTreeKill(child.pid);
      const killer = spawn(taskkill.command, taskkill.arguments, {
        stdio: "ignore",
        windowsHide: true,
      });
      const fallback = () => {
        try {
          child.kill("SIGKILL");
        } catch {
          // The process already exited between the timeout and escalation.
        }
      };
      killer.once("error", fallback);
      killer.once("exit", (code) => {
        if (code !== 0) fallback();
      });
      return;
    }
    try {
      process.kill(-child.pid, name);
    } catch {
      child.kill(name);
    }
  };
  let timedOut = false;
  let forceKill: ReturnType<typeof setTimeout> | undefined;
  let abandon: ReturnType<typeof setTimeout> | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const exitCode = await new Promise<number>((resolveExit, reject) => {
    timeout = setTimeout(() => {
      timedOut = true;
      signal("SIGTERM");
      forceKill = setTimeout(() => signal("SIGKILL"), killGraceMs);
      abandon = setTimeout(
        () =>
          reject(
            new LighthouseError({
              message: `Lighthouse timed out after ${timeoutMs}ms and did not exit after SIGKILL`,
            }),
          ),
        killGraceMs * 2,
      );
    }, timeoutMs);
    child.once("error", reject);
    child.once("exit", (code) => resolveExit(code ?? 1));
  }).finally(() => {
    if (timeout !== undefined) clearTimeout(timeout);
    if (forceKill !== undefined) clearTimeout(forceKill);
    if (abandon !== undefined) clearTimeout(abandon);
  });
  if (timedOut)
    throw new LighthouseError({
      message: `Lighthouse timed out after ${timeoutMs}ms`,
    });
  if (exitCode !== 0)
    throw new LighthouseError({
      message: `Lighthouse exited with ${exitCode}${stderr.trim() ? `: ${stderr.trim()}` : ""}`,
    });
};

export interface LighthouseOptions {
  readonly url: URL;
  readonly formFactor: FormFactor;
  readonly run: number;
  readonly allowPrivate: boolean;
  readonly timeoutMs?: number;
}

const runLighthouseInDirectory = async (
  options: LighthouseOptions,
  directory: string,
): Promise<LighthouseRun> => {
  const version = await lighthouseVersion();
  const base = {
    requestedUrl: options.url.href,
    finalUrl: null,
    formFactor: options.formFactor,
    run: options.run,
    lighthouseVersion: version,
    userAgent: null,
    fetchTime: null,
    categories: {},
    metrics: {},
    opportunities: [],
    warnings: [],
  };
  let proxy: AuditProxy | undefined;
  try {
    const { cli } = resolveLighthouse();
    const output = join(directory, "result.json");
    proxy = await startAuditProxy({
      allowPrivate: options.allowPrivate,
      timeoutMs: options.timeoutMs ?? 180_000,
    });
    const args = [
      options.url.href,
      "--output=json",
      `--output-path=${output}`,
      "--quiet",
      "--max-wait-for-load=45000",
      `--chrome-flags=${lighthouseChromeFlags(proxy.url)}`,
    ];
    if (options.formFactor === "desktop") args.push("--preset=desktop");
    await runLighthouseProcess(cli, args, options.timeoutMs ?? 180_000);
    return parseLighthouseResult(
      JSON.parse(await readFile(output, "utf8")),
      options.url.href,
      options.formFactor,
      options.run,
    );
  } catch (error) {
    return { ...base, error: errorMessage(error) };
  } finally {
    await proxy?.close();
  }
};

export const runLighthouse = async (options: LighthouseOptions): Promise<LighthouseRun> => {
  let directory: string | undefined;
  try {
    directory = await mkdtemp(join(tmpdir(), "tanstack-seo-lighthouse-"));
    return await runLighthouseInDirectory(options, directory);
  } finally {
    if (directory !== undefined) await rm(directory, { recursive: true, force: true });
  }
};

export const runLighthouseEffect = Effect.fn("SeoAudit.runLighthouse")(function* (
  options: LighthouseOptions,
) {
  const directory = yield* Effect.acquireRelease(
    Effect.tryPromise({
      try: () => mkdtemp(join(tmpdir(), "tanstack-seo-lighthouse-")),
      catch: (cause) => new LighthouseError({ message: errorMessage(cause), cause }),
    }),
    (path) => Effect.promise(() => rm(path, { recursive: true, force: true })),
  );
  return yield* Effect.tryPromise({
    try: () => runLighthouseInDirectory(options, directory),
    catch: (cause) => new LighthouseError({ message: errorMessage(cause), cause }),
  });
});

export const makeLighthouseScanner = (
  options: Omit<LighthouseOptions, "url" | "formFactor" | "run">,
  dependencies: {
    readonly run?: (options: LighthouseOptions) => Promise<LighthouseRun>;
  } = {},
): Scanner => ({
  id: "lighthouse",
  description: "Lighthouse performance and accessibility measurements",
  scan: (input: ScannerInput) =>
    Effect.fn("SeoAudit.scanLighthouse")(function* () {
      const target = new URL(input.target.url);
      const requestedFormFactors =
        input.options.formFactors === undefined || input.options.formFactors.length === 0
          ? (["mobile"] as const)
          : input.options.formFactors;
      const requestedRuns = Math.max(1, Math.floor(input.options.runs ?? 1));
      const runs = [...new Set(requestedFormFactors)].flatMap((formFactor) =>
        Array.from({ length: requestedRuns }, (_, index) => ({
          formFactor,
          run: index + 1,
        })),
      );
      const observations = yield* Effect.forEach(
        runs,
        ({ formFactor, run }) =>
          Effect.tryPromise({
            try: () =>
              (dependencies.run ?? runLighthouse)({
                ...options,
                url: target,
                formFactor,
                run,
              }),
            catch: (cause) =>
              new ScannerFailure({
                scanner: "lighthouse",
                target: target.href,
                message: errorMessage(cause),
                cause,
              }),
          }),
        { concurrency: 1 },
      );
      const errors = observations.flatMap((observation) =>
        observation.error === null ? [] : [observation.error],
      );
      if (errors.length === observations.length) {
        return yield* new ScannerFailure({
          scanner: "lighthouse",
          target: target.href,
          message: errors[0] ?? "Every Lighthouse run failed.",
        });
      }
      return { evidence: observations };
    })(),
});
