import type { IncomingMessage } from "node:http";
import { request as requestHttp } from "node:http";
import { request as requestHttps } from "node:https";
import { isIP } from "node:net";
import { checkServerIdentity } from "node:tls";

import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { networkHostname, pinnedLookup, resolveTargetUrl } from "../network";
import { ScannerFailure, type Scanner } from "../scanner";

/** Hosted services are intentionally opt-in: a generic SEO audit never sends URLs to them. */
export interface HostedScannerOrigins {
  readonly isitagentready: string;
  readonly isAgentic: string;
}

export const defaultHostedScannerOrigins: HostedScannerOrigins = {
  isitagentready: "https://isitagentready.com",
  isAgentic: "https://is-agentic.com",
};

export interface HostedScannerOptions {
  readonly allowPrivate: boolean;
  /** Whether a private target URL may be disclosed to the hosted service. Defaults to false. */
  readonly allowPrivateTargets?: boolean;
  readonly timeoutMs: number;
  readonly maxBodyBytes: number;
  readonly origins: HostedScannerOrigins;
}

export interface HostedScannerReport {
  readonly scanner: "isitagentready" | "is-agentic";
  readonly target: string;
  readonly requestedUrl: string;
  readonly reportUrl: string | null;
  readonly scannedAt: string | null;
  readonly score: number | null;
  readonly scoreLabel: string | null;
  readonly level: number | null;
  readonly levelName: string | null;
  readonly summary: string | null;
  readonly checks: ReadonlyArray<{
    readonly id: string;
    readonly category: string | null;
    readonly status: string;
    readonly message: string | null;
  }>;
  readonly findings: ReadonlyArray<{
    readonly result: string;
    readonly tier: string | null;
    readonly name: string;
    readonly details: string | null;
    readonly recommendation: string | null;
  }>;
  readonly totalMs: number;
  readonly error: string | null;
}

export class HostedScannerError extends Data.TaggedError("HostedScannerError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
const userAgent = "TanStackSeoAudit/1.0";

const IsitagentreadyCheck = Schema.Struct({
  status: Schema.String,
  message: Schema.optionalKey(Schema.String),
});
const IsitagentreadyPayload = Schema.Struct({
  scannedAt: Schema.optionalKey(Schema.String),
  scanned_at: Schema.optionalKey(Schema.String),
  level: Schema.optionalKey(Schema.Finite),
  levelName: Schema.optionalKey(Schema.String),
  level_name: Schema.optionalKey(Schema.String),
  checks: Schema.optionalKey(
    Schema.Record(Schema.String, Schema.Record(Schema.String, IsitagentreadyCheck)),
  ),
  nextLevel: Schema.optionalKey(
    Schema.Struct({
      name: Schema.optionalKey(Schema.String),
      requirements: Schema.optionalKey(
        Schema.Array(
          Schema.Struct({
            check: Schema.optionalKey(Schema.String),
            description: Schema.optionalKey(Schema.String),
            prompt: Schema.optionalKey(Schema.String),
          }),
        ),
      ),
    }),
  ),
  next_level: Schema.optionalKey(
    Schema.Struct({
      name: Schema.optionalKey(Schema.String),
      requirements: Schema.optionalKey(
        Schema.Array(
          Schema.Struct({
            check: Schema.optionalKey(Schema.String),
            description: Schema.optionalKey(Schema.String),
            prompt: Schema.optionalKey(Schema.String),
          }),
        ),
      ),
    }),
  ),
});
const IsAgenticPayload = Schema.Struct({
  score: Schema.optionalKey(Schema.Finite),
  score_label: Schema.optionalKey(Schema.String),
  report_url: Schema.optionalKey(Schema.String),
  scanned_at: Schema.optionalKey(Schema.String),
  score_breakdown: Schema.optionalKey(
    Schema.Struct({
      essential: Schema.optionalKey(
        Schema.Struct({ earned: Schema.Finite, available: Schema.Finite }),
      ),
      recommended: Schema.optionalKey(
        Schema.Struct({ earned: Schema.Finite, available: Schema.Finite }),
      ),
    }),
  ),
  issues: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        result: Schema.String,
        tier: Schema.optionalKey(Schema.String),
        name: Schema.String,
        details: Schema.optionalKey(Schema.String),
        recommendation: Schema.optionalKey(Schema.String),
      }),
    ),
  ),
});
const SseEvent = Schema.Struct({ type: Schema.String });
const IsitagentreadyJson = Schema.fromJsonString(IsitagentreadyPayload);
const IsAgenticJson = Schema.fromJsonString(IsAgenticPayload);
const SseEventJson = Schema.fromJsonString(SseEvent);
const decodeIsitagentready = Schema.decodeUnknownSync(IsitagentreadyPayload);
const decodeIsAgentic = Schema.decodeUnknownSync(IsAgenticPayload);
const decodeIsitagentreadyJson = Schema.decodeUnknownEffect(IsitagentreadyJson);
const decodeIsAgenticJson = Schema.decodeUnknownEffect(IsAgenticJson);
const decodeSseEventJson = Schema.decodeUnknownOption(SseEventJson);

const enabledChecks = [
  "robotsTxt",
  "sitemap",
  "linkHeaders",
  "dnsAid",
  "markdownNegotiation",
  "robotsTxtAiRules",
  "contentSignals",
  "webBotAuth",
  "apiCatalog",
  "oauthDiscovery",
  "oauthProtectedResource",
  "authMd",
  "mcpServerCard",
  "agentSkills",
  "webMcp",
  "ard",
  "x402",
  "mpp",
  "ucp",
  "acp",
] as const;
const encodeRequest = Schema.encodeSync(
  Schema.fromJsonString(
    Schema.Struct({
      url: Schema.String,
      enabledChecks: Schema.Array(Schema.Literals(enabledChecks)),
    }),
  ),
);

export const parseSseDataFrames = (
  buffer: string,
): {
  readonly events: ReadonlyArray<{ readonly type: string }>;
  readonly rest: string;
} => {
  let rest = buffer.replaceAll("\r\n", "\n");
  const events: Array<{ readonly type: string }> = [];
  let boundary = rest.indexOf("\n\n");
  while (boundary !== -1) {
    const frame = rest.slice(0, boundary);
    rest = rest.slice(boundary + 2);
    const data = frame
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (data.length > 0) {
      const event = Option.getOrNull(decodeSseEventJson(data));
      if (event !== null) events.push(event);
    }
    boundary = rest.indexOf("\n\n");
  }
  return { events, rest };
};

const pinnedResponse = async (request: {
  readonly method: "GET" | "POST";
  readonly url: URL;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly allowPrivate: boolean;
  readonly timeoutMs: number;
}): Promise<IncomingMessage> => {
  const addresses = await resolveTargetUrl(request.url, request.allowPrivate);
  const transport = request.url.protocol === "https:" ? requestHttps : requestHttp;
  const hostname = networkHostname(request.url.hostname);
  const headers: Record<string, string | number> = {
    ...request.headers,
    host: request.url.host,
    "user-agent": userAgent,
  };
  if (request.body !== undefined) headers["content-length"] = Buffer.byteLength(request.body);
  return new Promise((resolve, reject) => {
    const outgoing = transport({
      hostname,
      port: request.url.port || undefined,
      path: `${request.url.pathname}${request.url.search}`,
      method: request.method,
      headers,
      agent: false,
      lookup: pinnedLookup(addresses),
      signal: AbortSignal.timeout(request.timeoutMs),
      ...(request.url.protocol === "https:"
        ? {
            servername: isIP(hostname) === 0 ? hostname : undefined,
            checkServerIdentity: (
              _host: string,
              certificate: Parameters<typeof checkServerIdentity>[1],
            ) => checkServerIdentity(hostname, certificate),
          }
        : undefined),
    });
    outgoing.once("response", resolve);
    outgoing.once("error", reject);
    outgoing.end(request.body);
  });
};

const readBody = async (response: IncomingMessage, maxBodyBytes: number): Promise<string> => {
  const chunks: Array<Uint8Array> = [];
  let length = 0;
  for await (const chunk of response) {
    const value = new Uint8Array(chunk);
    if (length + value.byteLength > maxBodyBytes) {
      response.destroy();
      throw new Error("Hosted scanner response exceeded byte limit");
    }
    chunks.push(value);
    length += value.byteLength;
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const body = new TextDecoder().decode(bytes);
  if (body.trim().length === 0) throw new Error("Hosted scanner returned an empty body");
  return body;
};

const consumeStream = async (response: IncomingMessage, maxBodyBytes: number): Promise<void> => {
  let buffer = "";
  let length = 0;
  let complete = false;
  const decoder = new TextDecoder();
  try {
    for await (const chunk of response) {
      const value = new Uint8Array(chunk);
      length += value.byteLength;
      if (length > maxBodyBytes) throw new Error("Hosted scanner stream exceeded byte limit");
      // Keep decoder state across chunks: SSE payloads may split a UTF-8
      // codepoint at any byte boundary.
      buffer += decoder.decode(value, { stream: true });
      const parsed = parseSseDataFrames(buffer);
      buffer = parsed.rest;
      if (parsed.events.some((event) => event.type === "error"))
        throw new Error("is-agentic scan failed");
      if (
        parsed.events.some(
          (event) => event.type === "scan_complete" || event.type === "scan_archived",
        )
      ) {
        complete = true;
        response.destroy();
        break;
      }
    }
  } catch (cause) {
    if (complete) return;
    throw cause;
  }
  buffer += decoder.decode();
  if (!complete) throw new Error("is-agentic scan ended before a report was available");
};

const originHeader = (
  origin: string,
  path: string,
): { readonly origin: string; readonly referer: string } => {
  const base = origin.replace(/\/$/, "");
  return { origin: base, referer: `${base}${path}` };
};
const complete = (
  parsed: Omit<HostedScannerReport, "requestedUrl" | "totalMs" | "error">,
  requestedUrl: string,
  startedAt: number,
): HostedScannerReport => ({
  ...parsed,
  requestedUrl,
  totalMs: Math.round((performance.now() - startedAt) * 10) / 10,
  error: null,
});
const failed = (
  scanner: HostedScannerReport["scanner"],
  target: URL,
  requestedUrl: string,
  startedAt: number,
  error: unknown,
): HostedScannerReport => ({
  scanner,
  target: target.href,
  requestedUrl,
  reportUrl: null,
  scannedAt: null,
  score: null,
  scoreLabel: null,
  level: null,
  levelName: null,
  summary: null,
  checks: [],
  findings: [],
  totalMs: Math.round((performance.now() - startedAt) * 10) / 10,
  error: errorMessage(error),
});

const parseIsitagentready = (
  payload: unknown,
  target: URL,
  origin: string,
): Omit<HostedScannerReport, "requestedUrl" | "totalMs" | "error"> => {
  const record = decodeIsitagentready(payload);
  const checks = Object.entries(record.checks ?? {}).flatMap(([category, group]) =>
    Object.entries(group).map(([id, check]) => ({
      id,
      category,
      status: check.status,
      message: check.message ?? null,
    })),
  );
  const passed = checks.filter((check) => check.status === "pass").length;
  const failedCount = checks.filter((check) => check.status === "fail").length;
  const level = record.level ?? null;
  const levelName = record.levelName ?? record.level_name ?? null;
  const next = record.nextLevel ?? record.next_level;
  const findings = (next?.requirements ?? []).flatMap((requirement) => {
    const name = requirement.check ?? requirement.description;
    return name === undefined
      ? []
      : [
          {
            result: "missing",
            tier: next?.name ?? null,
            name,
            details: requirement.description ?? null,
            recommendation: requirement.prompt ?? null,
          },
        ];
  });
  return {
    scanner: "isitagentready",
    target: target.href,
    reportUrl: `${origin.replace(/\/$/, "")}/${target.hostname}`,
    scannedAt: record.scannedAt ?? record.scanned_at ?? null,
    score: null,
    scoreLabel: null,
    level,
    levelName,
    summary:
      level === null && levelName === null
        ? `${passed} pass, ${failedCount} fail`
        : `Level ${level ?? "?"} ${levelName ?? ""}`.trim() +
          `, ${passed} pass, ${failedCount} fail`,
    checks,
    findings,
  };
};

const parseIsAgentic = (
  payload: unknown,
  target: URL,
): Omit<HostedScannerReport, "requestedUrl" | "totalMs" | "error"> => {
  const record = decodeIsAgentic(payload);
  const findings = (record.issues ?? []).map((issue) => ({
    result: issue.result,
    tier: issue.tier ?? null,
    name: issue.name,
    details: issue.details ?? null,
    recommendation: issue.recommendation ?? null,
  }));
  const failedCount = findings.filter((finding) => finding.result === "failed").length;
  const partial = findings.filter((finding) => finding.result === "partial").length;
  const bucket = (
    label: string,
    value: { readonly earned: number; readonly available: number } | undefined,
  ) => (value === undefined ? null : `${label} ${value.earned}/${value.available}`);
  return {
    scanner: "is-agentic",
    target: target.href,
    reportUrl: record.report_url ?? null,
    scannedAt: record.scanned_at ?? null,
    score: record.score ?? null,
    scoreLabel: record.score_label ?? null,
    level: null,
    levelName: null,
    summary: [
      record.score_label,
      bucket("Essential", record.score_breakdown?.essential),
      bucket("Recommended", record.score_breakdown?.recommended),
      `${failedCount} failed, ${partial} partial`,
    ]
      .filter((part): part is string => part !== null && part !== undefined && part.length > 0)
      .join(", "),
    checks: [],
    findings,
  };
};

const scanIsAgentic = Effect.fn("SeoAudit.scanHostedIsAgentic")(function* (
  target: URL,
  options: HostedScannerOptions,
) {
  const requested = new URL("/api/scan/stream", options.origins.isAgentic);
  requested.searchParams.set("target", target.href);
  requested.searchParams.set("force", "1");
  const headers = originHeader(options.origins.isAgentic, `/scan/${target.hostname}`);
  const response = yield* Effect.tryPromise({
    try: () =>
      pinnedResponse({
        method: "GET",
        url: requested,
        headers: {
          accept: "text/event-stream",
          "cache-control": "no-cache",
          pragma: "no-cache",
          ...headers,
        },
        allowPrivate: options.allowPrivate,
        timeoutMs: options.timeoutMs,
      }),
    catch: (cause) => new HostedScannerError({ message: errorMessage(cause), cause }),
  });
  const status = response.statusCode ?? 0;
  if (status < 200 || status >= 300) {
    const retry = response.headers["retry-after"];
    response.destroy();
    return yield* new HostedScannerError({
      message: `is-agentic.com scan stream returned HTTP ${status}${typeof retry === "string" ? `, retry after ${retry}s` : ""}`,
    });
  }
  yield* Effect.tryPromise({
    try: () => consumeStream(response, options.maxBodyBytes),
    catch: (cause) => new HostedScannerError({ message: errorMessage(cause), cause }),
  });
  const report = new URL("/api/v1/report", options.origins.isAgentic);
  report.searchParams.set("url", target.href);
  let lastError = new HostedScannerError({
    message: "is-agentic report is not available yet",
  });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const reportResponse = yield* Effect.tryPromise({
      try: () =>
        pinnedResponse({
          method: "GET",
          url: report,
          headers: { accept: "application/json" },
          allowPrivate: options.allowPrivate,
          timeoutMs: options.timeoutMs,
        }),
      catch: (cause) => new HostedScannerError({ message: errorMessage(cause), cause }),
    });
    const reportStatus = reportResponse.statusCode ?? 0;
    const body = yield* Effect.tryPromise({
      try: () => readBody(reportResponse, options.maxBodyBytes),
      catch: (cause) => new HostedScannerError({ message: errorMessage(cause), cause }),
    });
    if (reportStatus >= 200 && reportStatus < 300) {
      const payload = yield* decodeIsAgenticJson(body).pipe(
        Effect.mapError((cause) => new HostedScannerError({ message: errorMessage(cause), cause })),
      );
      return { requested, parsed: parseIsAgentic(payload, target) };
    }
    lastError = new HostedScannerError({
      message: `is-agentic report returned HTTP ${reportStatus}`,
    });
    yield* Effect.sleep(`${250 * (attempt + 1)} millis`);
  }
  return yield* lastError;
});

const scanIsitagentready = Effect.fn("SeoAudit.scanHostedIsitagentready")(function* (
  target: URL,
  options: HostedScannerOptions,
) {
  const requested = new URL("/api/scan", options.origins.isitagentready);
  const headers = originHeader(options.origins.isitagentready, `/${target.hostname}`);
  const response = yield* Effect.tryPromise({
    try: () =>
      pinnedResponse({
        method: "POST",
        url: requested,
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          ...headers,
        },
        body: encodeRequest({
          url: target.href,
          enabledChecks: [...enabledChecks],
        }),
        allowPrivate: options.allowPrivate,
        timeoutMs: options.timeoutMs,
      }),
    catch: (cause) => new HostedScannerError({ message: errorMessage(cause), cause }),
  });
  const status = response.statusCode ?? 0;
  if (status < 200 || status >= 300) {
    response.destroy();
    return yield* new HostedScannerError({
      message: `isitagentready.com returned HTTP ${status}`,
    });
  }
  const body = yield* Effect.tryPromise({
    try: () => readBody(response, options.maxBodyBytes),
    catch: (cause) => new HostedScannerError({ message: errorMessage(cause), cause }),
  });
  const payload = yield* decodeIsitagentreadyJson(body).pipe(
    Effect.mapError((cause) => new HostedScannerError({ message: errorMessage(cause), cause })),
  );
  return {
    requested,
    parsed: parseIsitagentready(payload, target, options.origins.isitagentready),
  };
});

/** Opt-in hosted scanners. Results are attributed failures, never fatal audit failures. */
export const scanHosted = async (
  target: URL,
  options: HostedScannerOptions,
): Promise<ReadonlyArray<HostedScannerReport>> => {
  const output: Array<HostedScannerReport> = [];
  const readyStartedAt = performance.now();
  try {
    const result = await Effect.runPromise(scanIsitagentready(target, options));
    output.push(complete(result.parsed, result.requested.href, readyStartedAt));
  } catch (error) {
    output.push(
      failed(
        "isitagentready",
        target,
        new URL("/api/scan", options.origins.isitagentready).href,
        readyStartedAt,
        error,
      ),
    );
  }
  const agenticStartedAt = performance.now();
  try {
    const result = await Effect.runPromise(scanIsAgentic(target, options));
    output.push(complete(result.parsed, result.requested.href, agenticStartedAt));
  } catch (error) {
    output.push(
      failed(
        "is-agentic",
        target,
        new URL("/api/scan/stream", options.origins.isAgentic).href,
        agenticStartedAt,
        error,
      ),
    );
  }
  return output;
};

export const makeHostedScanner = (options: HostedScannerOptions): Scanner => ({
  id: "hosted",
  description: "Opt-in external agent-readiness reports",
  scan: (input) =>
    Effect.fn("SeoAudit.scanHosted")(function* () {
      const target = new URL(input.target.url);
      if (options.allowPrivateTargets !== true) {
        yield* Effect.tryPromise({
          try: () => resolveTargetUrl(target, false),
          catch: (cause) =>
            new ScannerFailure({
              scanner: "hosted",
              target: target.href,
              message: "Hosted scanners only accept public target URLs.",
              cause,
            }),
        });
      }
      const evidence = yield* Effect.tryPromise({
        try: () => scanHosted(target, options),
        // Individual hosted service failures are already represented in the
        // report. This boundary only captures an unexpected orchestration error.
        catch: (cause) =>
          new ScannerFailure({
            scanner: "hosted",
            target: target.href,
            message: errorMessage(cause),
            cause,
          }),
      });
      if (evidence.every((report) => report.error !== null)) {
        return yield* new ScannerFailure({
          scanner: "hosted",
          target: target.href,
          message: evidence.map((report) => report.error).join("; "),
        });
      }
      return { evidence };
    })(),
});
