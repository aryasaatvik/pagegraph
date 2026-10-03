import { existsSync } from "node:fs";
import { mkdir, readFile, rename, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Argument from "effect/cli/Argument";
import * as Command from "effect/cli/Command";
import * as Flag from "effect/cli/Flag";

import { resolveClaimsDocuments } from "../../decide/families/claims";
import { readDevMarkdownCapture, readMarkdownCapture } from "../../markdown/documents";
import { createMarkdownLock } from "../../markdown/lock";
import { documentMarkdown, sectionMarkdown } from "../../markdown/markdown";
import { loadPagegraphSettings, type EvaluateAppGraphOptions } from "../../tanstack-start/load";
import { acquireLoadedGraph, loadSeoConfigOptional } from "../load-config";
import { jsonFlag, printJson, printText, SeoCliError } from "../output";

export const devFlag = Flag.String("dev").pipe(
  Flag.optional, Flag.withDescription("Read captures from a running development-server origin"),
);

/** Locate the app's Vite settings, including when invoked from a nested directory. */
export function findViteRoot(start = process.cwd()): string | undefined {
  let directory = resolve(start);
  while (true) {
    if (["ts", "js", "mts", "mjs", "cts", "cjs"].some((extension) => existsSync(join(directory, `vite.config.${extension}`))))
      return directory;
    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

export const cliOperation = <A>(operation: () => Promise<A>) => Effect.tryPromise({
  try: operation,
  catch: (cause) => new SeoCliError({ message: cause instanceof Error ? cause.message : String(cause) }),
});

export const markdownSettings = Effect.fn("CLI.markdownSettings")(function* (dev: Option.Option<string> = Option.none()) {
  const config = yield* loadSeoConfigOptional;
  if (config !== undefined) {
    const loaded = yield* Effect.scoped(acquireLoadedGraph(
      config, Option.isSome(dev) ? { command: "serve", mode: "development" } : undefined,
    ));
    const settings = loaded.pagegraph;
    const markdown = settings?.options.markdown;
    if (settings === undefined || markdown === undefined)
      return yield* new SeoCliError({ message: "Markdown capture is not configured in the graph loader's app." });
    const { root, options, facts } = settings;
    return { root, options, markdown, facts };
  }
  const root = findViteRoot();
  if (root === undefined) return yield* new SeoCliError({ message: "No Vite config found; configure pagegraph() in the app's Vite config." });
  const settingsOptions: EvaluateAppGraphOptions = Option.isSome(dev) ? { root, command: "serve", mode: "development" } : { root };
  const settings = yield* cliOperation(() => loadPagegraphSettings(settingsOptions));
  const { options, facts } = settings;
  if (options.markdown === undefined)
    return yield* new SeoCliError({ message: "Markdown capture is not configured in pagegraph() in the Vite config." });
  return { root: settings.root, options, markdown: options.markdown, facts };
});

export const markdownCapture = (root: string, origin: string, dev: Option.Option<string>) =>
  cliOperation(() => Option.isSome(dev) ? readDevMarkdownCapture(dev.value) : readMarkdownCapture(root, origin));

const showCommand = Command.make("show", { path: Argument.String("path"), dev: devFlag, json: jsonFlag }).pipe(
  Command.withDescription("Print a captured page's markdown twin"),
  Command.withHandler(Effect.fnUntraced(function* ({ path, dev, json }) {
    const { root, markdown: settings } = yield* markdownSettings(dev);
    const capture = yield* markdownCapture(root, settings.origin, dev);
    const documents = yield* Effect.try({ try: () => resolveClaimsDocuments(capture.documents, capture.heads), catch: (cause) => new SeoCliError({ message: String(cause) }) });
    const document = documents.find((page) => page.path === path);
    if (document === undefined) return yield* new SeoCliError({ message: `No captured markdown page "${path}"; build the app or use --dev <origin>.` });
    const markdown = yield* Effect.try({ try: () => documentMarkdown(document, capture.origin), catch: (cause) => new SeoCliError({ message: String(cause) }) });
    yield* json ? printJson({ path, markdown }) : printText(markdown.trimEnd());
  })),
);

const findCommand = Command.make("find", { text: Argument.String("text"), dev: devFlag, json: jsonFlag }).pipe(
  Command.withDescription("Find pages and sections containing case-insensitive text"),
  Command.withHandler(Effect.fnUntraced(function* ({ text, dev, json }) {
    const { root, markdown: settings } = yield* markdownSettings(dev);
    const capture = yield* markdownCapture(root, settings.origin, dev);
    const query = text.toLowerCase();
    const matches = yield* Effect.try({ try: () => resolveClaimsDocuments(capture.documents, capture.heads).flatMap((document) => [
      ...(`${document.title}\n${document.description}`.toLowerCase().includes(query) ? [{ path: document.path, section: "head", text: `${document.title}\n${document.description}` }] : []),
      ...document.sections.flatMap((section) => {
        const markdown = sectionMarkdown(section, { includeHumans: true });
        return markdown.toLowerCase().includes(query) ? [{ path: document.path, section: section.id, text: markdown.trimEnd() }] : [];
      }),
    ]), catch: (cause) => new SeoCliError({ message: String(cause) }) });
    yield* json ? printJson({ matches, total: matches.length }) : printText(matches.length ? matches.map((match) => `${match.path} › ${match.section}\n${match.text}`).join("\n\n") : "No matching markdown pages or sections.");
  })),
);

const lockCommand = Command.make("lock", {
  check: Flag.Boolean("check").pipe(Flag.withDefault(false)), dev: devFlag, json: jsonFlag,
}).pipe(
  Command.withDescription("Write or verify .pagegraph/markdown.lock.json"),
  Command.withHandler(Effect.fnUntraced(function* ({ check, dev, json }) {
    const { root, markdown: settings } = yield* markdownSettings(dev);
    const capture = yield* markdownCapture(root, settings.origin, dev);
    const documents = yield* Effect.try({ try: () => resolveClaimsDocuments(capture.documents, capture.heads), catch: (cause) => new SeoCliError({ message: String(cause) }) });
    const file = resolve(root, ".pagegraph/markdown.lock.json");
    yield* cliOperation(async () => {
      const data = createMarkdownLock(documents);
      if (check) {
        let previous: unknown;
        try { previous = JSON.parse(await readFile(file, "utf8")); }
        catch { throw new Error("Markdown lock is missing or invalid; run pagegraph markdown lock."); }
        if (JSON.stringify(previous) !== JSON.stringify(data))
          throw new Error("Markdown lock is out of date; run pagegraph markdown lock.");
      } else {
        await mkdir(dirname(file), { recursive: true });
        const temporary = await mkdtemp(join(dirname(file), ".markdown-lock-"));
        try {
          const staged = join(temporary, "lock.json");
          await writeFile(staged, `${JSON.stringify(data, null, 2)}\n`);
          await rename(staged, file);
        } finally { await rm(temporary, { recursive: true, force: true }); }
      }
    });
    yield* json ? printJson({ lock: ".pagegraph/markdown.lock.json", pages: documents.length, checked: check }) : printText(`${check ? "Verified" : "Wrote"} .pagegraph/markdown.lock.json (${documents.length} page(s)).`);
  })),
);

export const markdownCommandGroup = Command.make("markdown").pipe(
  Command.withDescription("Inspect captured markdown and its reviewable lock"),
  Command.withSubcommands([showCommand, findCommand, lockCommand]),
);
