import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Command from "effect/cli/Command";
import * as Flag from "effect/cli/Flag";

import { mapLimit } from "../../audit/crawl";
import { probeHttp } from "../../audit/scanners/http";
import { checkGraph, hasStructuralViolations, type CoverageRule } from "../../core/checks";
import {
  checkRenderedContent,
  renderedCheckTargets,
  type RenderedDocument,
} from "../../core/content";
import type { SeoGraph } from "../../core/graph";
import { normalizePath } from "../../core/links";
import { acquireGraph, loadSeoConfig } from "../load-config";
import { jsonFlag, printJson, printText, SeoCliError } from "../output";
import { renderViolations } from "../render";

const requireInboundFlag = Flag.String("require-inbound").pipe(
  Flag.withDescription(
    'Require at least N incoming contextual links for a path glob: "<glob>=<n>" (repeatable)',
  ),
  Flag.between(0, 128),
);

const siteFlag = Flag.String("site").pipe(
  Flag.withDescription(
    "Also fetch every declared page from this origin and check its rendered HTML (e.g. http://localhost:3000)",
  ),
  Flag.optional,
);
const allowPrivateFlag = Flag.Boolean("allow-private").pipe(
  Flag.withDescription("Allow a localhost or private --site (local development only)"),
  Flag.withDefault(false),
);
const concurrencyFlag = Flag.Int("concurrency").pipe(
  Flag.withDescription("Parallel page requests under --site"),
  Flag.withDefault(4),
);
const requestTimeoutFlag = Flag.Int("request-timeout-ms").pipe(
  Flag.withDescription("Per-page request timeout under --site, in milliseconds"),
  Flag.withDefault(30_000),
);
const maxBodyBytesFlag = Flag.Int("max-body-bytes").pipe(
  Flag.withDescription("Maximum captured bytes per page under --site"),
  Flag.withDefault(5_000_000),
);

const positive = (name: string, value: number): Effect.Effect<number, SeoCliError> =>
  Number.isSafeInteger(value) && value > 0
    ? Effect.succeed(value)
    : Effect.fail(new SeoCliError({ message: `--${name} must be a positive integer` }));

interface RenderOptions {
  readonly allowPrivate: boolean;
  readonly concurrency: number;
  readonly timeoutMs: number;
  readonly maxBodyBytes: number;
}

const fetchPage = (origin: URL, path: string, options: RenderOptions) =>
  probeHttp(
    { kind: "page-html", method: "GET", accept: "text/html", url: new URL(path, origin) },
    {
      allowPrivate: options.allowPrivate,
      timeoutMs: options.timeoutMs,
      maxBodyBytes: options.maxBodyBytes,
      captureBody: true,
      sameOrigin: origin.origin,
    },
  );

/**
 * Fetch one declared page from `origin` as a crawler would. Every way the page
 * can fail to be judged — a failed request, a non-2xx status, a non-HTML body, a
 * truncated body — becomes a document the content check reports, never a crash.
 *
 * A server error or a failed request is retried once: `--site` usually points at
 * a dev server, whose first render of a route can time out or fail while it
 * compiles. A page that fails twice is reported.
 */
const renderDocument = async (
  origin: URL,
  path: string,
  options: RenderOptions,
): Promise<RenderedDocument> => {
  const first = await fetchPage(origin, path, options);
  const transient = first.status === null || first.status >= 500;
  const probe = transient ? await fetchPage(origin, path, options) : first;
  if (!probe.ok || probe.finalUrl === null || probe.body === undefined) {
    return { path, ok: false, error: probe.error ?? `HTTP ${probe.status ?? "no response"}` };
  }
  const contentType = probe.responseHeaders["content-type"] ?? "";
  if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) {
    return { path, ok: false, error: `response is ${contentType || "untyped"}, not HTML` };
  }
  if (probe.bodyTruncated) {
    return {
      path,
      ok: false,
      error: `body exceeded ${options.maxBodyBytes} bytes; raise --max-body-bytes`,
    };
  }
  return { path, ok: true, finalPath: normalizePath(new URL(probe.finalUrl)), html: probe.body };
};

/** Fetch every rendered-check target from `site`. */
const renderSite = (
  graph: SeoGraph,
  site: string,
  options: RenderOptions,
): Effect.Effect<ReadonlyArray<RenderedDocument>, SeoCliError> =>
  Effect.gen(function* () {
    let origin: URL;
    try {
      origin = new URL(site);
    } catch {
      return yield* new SeoCliError({ message: `--site must be an absolute URL, received "${site}"` });
    }
    if (origin.protocol !== "http:" && origin.protocol !== "https:") {
      return yield* new SeoCliError({ message: `--site must be http(s), received "${site}"` });
    }
    const targets = renderedCheckTargets(graph);
    yield* Effect.logInfo(`Rendering ${targets.length} declared page(s) from ${origin.origin}…`);
    return yield* Effect.promise(() =>
      mapLimit(targets, options.concurrency, (path) => renderDocument(origin, path, options)),
    );
  });

/** Parse one `"<path-glob>=<n>"` coverage rule; both halves are user input. */
const parseCoverageRule = (value: string): Effect.Effect<CoverageRule, SeoCliError> => {
  const separator = value.lastIndexOf("=");
  if (separator <= 0) {
    return Effect.fail(
      new SeoCliError({ message: `--require-inbound must be "<path-glob>=<n>", received "${value}"` }),
    );
  }
  const path = value.slice(0, separator).trim();
  const count = Number(value.slice(separator + 1).trim());
  if (path === "") {
    return Effect.fail(
      new SeoCliError({ message: `--require-inbound must name a path glob, received "${value}"` }),
    );
  }
  if (!Number.isSafeInteger(count) || count <= 0) {
    return Effect.fail(
      new SeoCliError({
        message: `--require-inbound count must be a positive integer, received "${value}"`,
      }),
    );
  }
  return Effect.succeed({ path, minInbound: count });
};

export const checkCommand = Command.make("check", {
  json: jsonFlag,
  requireInbound: requireInboundFlag,
  site: siteFlag,
  allowPrivate: allowPrivateFlag,
  concurrency: concurrencyFlag,
  requestTimeoutMs: requestTimeoutFlag,
  maxBodyBytes: maxBodyBytesFlag,
}).pipe(
  Command.withDescription("Check the SEO graph; exit 1 on any structural violation"),
  Command.withExamples([
    { command: "pagegraph check", description: "Run every rule and print the violations" },
    { command: "pagegraph check --json", description: "Violations as JSON (exit 1 iff structural)" },
    {
      command: 'pagegraph check --require-inbound "/pricing=2"',
      description: "Also require 2 contextual links into /pricing",
    },
    {
      command: "pagegraph check --site http://localhost:3000 --allow-private",
      description: "Also check headings, structured data, robots, and canonicals in rendered HTML",
    },
  ]),
  Command.withHandler(
    Effect.fnUntraced(function* (flags) {
      const config = yield* loadSeoConfig;
      const flagRules = yield* Effect.forEach(flags.requireInbound, parseCoverageRule);
      // Flags are a per-invocation override, mirroring `--origin`: when any are
      // given they replace the config's durable policy rather than merging.
      const coverage = flagRules.length > 0 ? flagRules : (config.coverage ?? []);
      const renderOptions: RenderOptions = {
        allowPrivate: flags.allowPrivate,
        concurrency: yield* positive("concurrency", flags.concurrency),
        timeoutMs: yield* positive("request-timeout-ms", flags.requestTimeoutMs),
        maxBodyBytes: yield* positive("max-body-bytes", flags.maxBodyBytes),
      };
      const graph = yield* Effect.scoped(acquireGraph(config));
      const violations = checkGraph(
        graph,
        config.freshness === undefined
          ? { coverage }
          : { coverage, freshness: config.freshness, now: new Date() },
      );
      let rendered: { readonly site: string; readonly pages: number } | undefined;
      if (Option.isSome(flags.site)) {
        const documents = yield* renderSite(graph, flags.site.value, renderOptions);
        violations.push(...checkRenderedContent(graph, documents, config.content));
        rendered = { site: flags.site.value, pages: documents.length };
      }
      const structural = violations.filter((violation) => violation.severity === "structural");

      if (flags.json) {
        yield* printJson({
          ok: structural.length === 0,
          structural: structural.length,
          editorial: violations.length - structural.length,
          ...(rendered === undefined ? {} : { rendered }),
          violations,
        });
      } else {
        yield* printText(renderViolations(violations));
      }

      if (hasStructuralViolations(violations)) {
        return yield* new SeoCliError({
          message: `${structural.length} structural violation(s) — see the report above.`,
        });
      }
    }),
  ),
);
