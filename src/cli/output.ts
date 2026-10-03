/**
 * Shared surfaces for the `pagegraph` CLI. The three output planes:
 *  - **data** → stdout via {@link printJson} / {@link printText}. Under `--json`
 *    this is the *only* thing on stdout: no ANSI, no status, valid JSON.
 *  - **status** → stderr via Effect leveled logging (`Effect.logInfo` /
 *    `Effect.logDebug`), routed off stdout by `Logger.LogToStderr` in `main.ts`
 *    and gated by the built-in `--log-level` flag.
 *  - **diagnostics** → stderr; expected failures surface as {@link SeoCliError},
 *    printed by the entrypoint with a non-zero exit.
 */

import * as Console from "effect/Console";
import * as Data from "effect/Data";
import * as Option from "effect/Option";
import * as Flag from "effect/cli/Flag";

/** Expected, user-facing CLI failure — message to stderr, process exits non-zero. */
export class SeoCliError extends Data.TaggedError("SeoCliError")<{
  readonly message: string;
}> {}

/** Machine-readable output. When set, stdout is exactly the JSON payload. */
export const jsonFlag = Flag.Boolean("json").pipe(
  Flag.withDescription("Emit the payload as JSON on stdout (no status, no color)"),
  Flag.withDefault(false),
);

/**
 * Absolute origin the sitemap/robots projection is rendered under. It carries no
 * static default: the fallback comes from the loaded graph's site, which is not
 * known until the graph is acquired. Resolve it with {@link originOf}.
 */
export const originFlag = Flag.String("origin").pipe(
  Flag.withDescription("Absolute origin for URLs (default: origin from the loaded graph)"),
  Flag.optional,
);

/** The `--origin` flag when given, else the origin in the loaded graph's site identity. */
export const originOf = (flag: Option.Option<string>, configured: string): string =>
  Option.getOrElse(flag, () => configured);

/**
 * `--indexable` / `--no-indexable`. When omitted, the loaded graph's site identity
 * decides; a non-indexable host yields a disallow-all robots.txt with no Sitemap line.
 */
export const indexableFlag = Flag.Boolean("indexable").pipe(
  Flag.withDescription("Render as an indexable host; --no-indexable = disallow-all robots.txt"),
  Flag.optional,
);

/** The `--indexable` flag when given, else the graph host's indexability. */
export const indexableOf = (flag: Option.Option<boolean>, configured: boolean): boolean =>
  Option.getOrElse(flag, () => configured);

/** Data plane: pretty-printed JSON on stdout. */
export const printJson = (value: unknown) => Console.log(JSON.stringify(value, null, 2));

/** Data plane: a block of already-formatted text on stdout. */
export const printText = (text: string) => Console.log(text);
