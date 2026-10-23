import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { checkGraph, type Violation } from "../../src/core/checks";
import type { RouteSeo } from "../../src/core/declare";
import {
  buildSeoGraph,
  type OgImageResolver,
  type SeoCollection,
  type SeoGraph,
} from "../../src/core/graph";
import { renderRobots, renderSitemap } from "../../src/core/projections";
import { renderViolations } from "../../src/cli/render";
import type { SeoHead } from "../../src/react/create-seo";
import { coverageMessage } from "../../src/vite/route-config";
import { repository } from "../scripts/projects";
import {
  authoredSection,
  checkReport,
  collectionEntry,
  coverageFailure,
  fixtureApp,
  fixtureOrigin,
  fixtureRobots,
  graphEdges,
  graphPages,
  humansOnly,
  install,
  llmsEntry,
  markdownApp,
  markdownTwin,
  pricingHead,
  pricingLines,
  pricingRoute,
  pricingSitemap,
  rename,
  repositoryUrl,
} from "../src/scenes/source";

const read = (file: string) => readFileSync(join(repository, file), "utf8");
const fixture = (file: string) => join(repository, fixtureApp, file);

/**
 * The `staticData` object a route file declares, evaluated. Route files cannot be imported directly
 * (they use the app's `@/` alias), so the property is found in the parsed source and only its
 * initializer runs, with each `define` key replaced by its string value as Vite would.
 */
function staticDataIn(
  file: string,
  text: string,
  define: Readonly<Record<string, string>> = {},
): { seo: RouteSeo } {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: Array<ts.ObjectLiteralElementLike> = [];
  const visit = (node: ts.Node): void => {
    if (ts.isObjectLiteralExpression(node))
      for (const property of node.properties)
        if (property.name !== undefined && property.name.getText(source) === "staticData")
          found.push(property);
    ts.forEachChild(node, visit);
  };
  visit(source);
  const [property, ...others] = found;
  if (property === undefined || others.length > 0)
    throw new Error(`${file}: expected one staticData property, found ${found.length}`);
  if (!ts.isPropertyAssignment(property) || !ts.isObjectLiteralExpression(property.initializer))
    throw new Error(`${file}: staticData must be an object literal`);

  const substitute: ts.TransformerFactory<ts.SourceFile> = (context) => (root) => {
    const replace = (node: ts.Node): ts.Node =>
      ts.isPropertyAccessExpression(node) && Object.hasOwn(define, node.getText(root))
        ? ts.factory.createStringLiteral(define[node.getText(root)] ?? "")
        : ts.visitEachChild(node, replace, context);
    return ts.visitEachChild(root, replace, context);
  };
  const { outputText, diagnostics = [] } = ts.transpileModule(
    `export default ${property.initializer.getText(source)};`,
    {
      fileName: file,
      reportDiagnostics: true,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      transformers: { before: [substitute] },
    },
  );
  if (diagnostics.length > 0)
    throw new Error(
      `${file}: staticData does not parse: ${ts.flattenDiagnosticMessageText(diagnostics[0]?.messageText, "\n")}`,
    );
  const exports: { default?: { seo: RouteSeo } } = {};
  try {
    // oxlint-disable-next-line no-new-func -- evaluates a fixture's object literal, not input.
    new Function("exports", outputText)(exports);
  } catch (cause) {
    throw new Error(`${file}: staticData does not evaluate on its own`, { cause });
  }
  if (exports.default === undefined) throw new Error(`${file}: staticData evaluated to nothing`);
  return exports.default;
}

/** A fixture route's `staticData`, with the fixture's `define` for `VITE_BRAND`. */
function staticDataOf(file: string): { seo: RouteSeo } {
  const path = join(fixtureApp, "src/routes", file);
  return staticDataIn(path, read(path), {
    "import.meta.env.VITE_BRAND": "Example",
  });
}

interface RouteShape {
  readonly options: { readonly path?: string; readonly staticData?: { seo: RouteSeo } };
  readonly children?: ReadonlyArray<RouteShape>;
}

/** The fixture's route tree as `buildSeoGraph` walks it, with `/pricing` optionally renamed. */
function fixtureGraph(pricingPath: string): Promise<SeoGraph> {
  const page = (path: string, file: string): RouteShape => ({
    options: { path, staticData: staticDataOf(file) },
  });
  const routeTree: RouteShape = {
    options: { staticData: staticDataOf("__root.tsx") },
    children: [
      { options: {}, children: [page("/", "(marketing)/index.tsx")] },
      page(pricingPath, "(marketing)/pricing.tsx"),
      page("/blog/$slug", "(marketing)/blog/$slug.tsx"),
      { options: {}, children: [page("/help", "_docs/help.tsx")] },
      page("/terms", "(legal)/terms.tsx"),
    ],
  };
  return Promise.all([
    import(fixture("src/collections.ts")) as Promise<{
      collections: () => ReadonlyArray<SeoCollection>;
    }>,
    import(fixture("src/og-image.ts")) as Promise<{ ogImage: OgImageResolver }>,
  ]).then(([{ collections }, { ogImage }]) =>
    // The fixture's `pagegraph()` options: its built origin and image resolver.
    buildSeoGraph({
      routeTree: routeTree as never,
      collections: collections(),
      origin: fixtureOrigin,
      ogImage,
    }),
  );
}

describe("staticData extraction", () => {
  const route = (staticData: string) => `import { createFileRoute } from "@tanstack/react-router";
import { seo } from "@/seo";

export const Route = createFileRoute("/x")({
  ${staticData}
  head: seo.head,
});`;

  test("delimits the object by syntax, not by brace characters", () => {
    const text = route(`staticData: {
    // A closing brace in a comment: }
    seo: {
      kind: "page",
      crumb: "}",
      head: { title: \`\${"}"} | \${import.meta.env.VITE_BRAND}\`, description: "/* { */" },
    },
  },`);
    expect(staticDataIn("x.tsx", text, { "import.meta.env.VITE_BRAND": "Example" })).toEqual({
      seo: { kind: "page", crumb: "}", head: { title: "} | Example", description: "/* { */" } },
    });
  });

  test.each([
    ["no", "", "expected one staticData property, found 0"],
    ["two", 'staticData: { seo: { kind: "page" } }, other: { staticData: {} },', "found 2"],
    ["a non-literal", "staticData: shared,", "staticData must be an object literal"],
    ["an unevaluable", "staticData: { seo: shared },", "staticData does not evaluate on its own"],
  ])("rejects %s staticData", (_, staticData, message) => {
    expect(() => staticDataIn("x.tsx", route(staticData))).toThrow(message);
  });
});

describe("on-screen code matches the repository", () => {
  test.each([pricingRoute, collectionEntry, authoredSection])(
    "$file excerpt is verbatim",
    (excerpt) => {
      expect(read(excerpt.file)).toContain(excerpt.code);
    },
  );

  test("highlighted lines are the fields the outputs read", () => {
    const lines = pricingRoute.code.split("\n");
    const at = ([from, to]: readonly [number, number]) => lines.slice(from, to + 1).join("\n");
    expect(at(pricingLines.link)).toMatch(/^\s+link: \{/);
    expect(at(pricingLines.crumb)).toMatch(/^\s+crumb: /);
    expect(at(pricingLines.sitemap)).toMatch(/^\s+sitemap: \{/);
    expect(at(pricingLines.head)).toMatch(/^\s+head: \{\n[\s\S]+\n\s+faqs: .+\n\s+\},$/);
    expect(at(pricingLines.render)).toBe("  head: seo.head,");
  });

  test("the rename edits the excerpt's own route path", () => {
    expect(pricingRoute.code).toContain(rename.from);
    expect(rename.from.replace("pricing", "plans")).toBe(rename.to);
    expect(collectionEntry.code).toContain(`related: ["${rename.path.from}"]`);
  });

  test("install line and repository match package.json", () => {
    const pkg = JSON.parse(read("package.json")) as {
      name: string;
      version: string;
      repository: { url: string };
    };
    expect(install).toBe(`bun add ${pkg.name}`);
    expect(pkg.repository.url).toContain(repositoryUrl);
    // The CTA says "Pre-1.0"; a 1.0 release must update the film.
    expect(pkg.version).toMatch(/^0\./);
  });
});

describe("derived output matches what pagegraph renders", () => {
  test("seo.head renders the pricing declaration's head rows", async () => {
    const { seo } = (await import(fixture("src/seo.ts"))) as {
      seo: { head: (ctx: unknown) => SeoHead };
    };
    const declaration = staticDataOf("(marketing)/pricing.tsx").seo;
    const match = {
      id: "/pricing",
      routeId: "/(marketing)/pricing",
      pathname: "/pricing",
      staticData: { seo: declaration },
    };
    const head = seo.head({ match, matches: [match] });
    const meta = head.meta as unknown as ReadonlyArray<Record<string, unknown>>;
    const content = (key: string, name: string) =>
      meta.find((entry) => entry[key] === name)?.["content"];
    const jsonLd = meta
      .flatMap((entry) => (entry["script:ld+json"] === undefined ? [] : [entry["script:ld+json"]]))
      .map((document) => (document as { "@type": string })["@type"]);

    const rendered: Record<string, unknown> = {
      title: meta.find((entry) => "title" in entry)?.["title"],
      description: content("name", "description"),
      canonical: head.links.find((link) => link.rel === "canonical")?.href,
      "og:image": content("property", "og:image"),
      "twitter:card": content("name", "twitter:card"),
      "JSON-LD": jsonLd.join(", "),
    };
    expect(rendered).toEqual(Object.fromEntries(pricingHead.map((row) => [row.name, row.value])));
    expect(head.links[0]?.href.startsWith(fixtureOrigin)).toBe(true);
  });

  test("sitemap and robots lines come from the fixture graph", async () => {
    const graph = await fixtureGraph("/pricing");
    const sitemap = renderSitemap(graph, { origin: fixtureOrigin, indexable: true });
    expect(sitemap).toContain(pricingSitemap.map((line) => `    ${line}`).join("\n"));
    expect(read(`${fixtureApp}/vite.config.ts`)).toContain(
      'robots: { disallow: ["/app"], contentSignal: "search=yes" },',
    );
    const robots = renderRobots(graph, {
      origin: fixtureOrigin,
      indexable: true,
      disallow: ["/app"],
      contentSignal: "search=yes",
    });
    for (const line of fixtureRobots) expect(robots).toContain(line);
  });

  test("graph pages and edges match the fixture graph and the plugin test", async () => {
    const graph = await fixtureGraph("/pricing");
    const pages = [...graph.nodes.keys()].filter((path) => !path.includes("$"));
    expect(pages.toSorted()).toEqual([...graphPages].toSorted());
    expect(graph.edges).toEqual(graphEdges.map((edge) => ({ ...edge })));

    // The plugin test evaluates the real app through Vite and asserts the same graph.
    const pluginTest = read("tests/tanstack-start/plugin.test.ts");
    expect(pluginTest).toContain(
      `expect(pageHeads(graph).map((head) => head.path)).toEqual([\n${graphPages.map((path) => `      "${path}",`).join("\n")}\n    ]);`,
    );
    for (const edge of [graphEdges[0], graphEdges[2]])
      expect(pluginTest).toContain(
        `expect(graph.edges).toContainEqual({ from: "${edge.from}", to: "${edge.to}", type: "${edge.type}" });`,
      );
  });

  test("the check report is what checkGraph reports after the rename", async () => {
    const violations: ReadonlyArray<Violation> = checkGraph(await fixtureGraph(rename.path.to));
    const structural = violations.filter((violation) => violation.severity === "structural");
    const editorial = violations.filter((violation) => violation.severity === "editorial");
    expect(renderViolations(structural)).toStartWith(checkReport.structural);
    expect(renderViolations(violations).split("\n").at(-1)).toBe(checkReport.summary);
    expect(
      `Editorial (${editorial.length}): ${[...new Set(editorial.map((violation) => violation.rule))].join(", ")} warnings trimmed`,
    ).toBe(checkReport.trimmed);
    // Before the rename, the same graph has no structural violation.
    expect(
      checkGraph(await fixtureGraph("/pricing")).filter(
        (violation) => violation.severity === "structural",
      ),
    ).toEqual([]);
  });

  test("the coverage gate fails with the quoted message", () => {
    expect(coverageMessage(["(marketing)/plans.tsx ((marketing) page)"])).toContain(
      `1 page(s) ${coverageFailure}.`,
    );
  });

  test("the Markdown twin and llms.txt lines are the ones the build test asserts", () => {
    const buildTest = read("tests/tanstack-start/build.test.ts");
    for (const line of markdownTwin)
      expect(buildTest).toContain(`expect(twin).toContain(${JSON.stringify(line)});`);
    expect(buildTest).toContain(`expect(twin).not.toContain("${humansOnly.replace(/\.$/, "")}");`);
    expect(buildTest).toContain(
      `expect(llms).toContain(${JSON.stringify(llmsEntry.replace(/^- /, ""))});`,
    );
    expect(read("src/markdown/llms.ts")).toContain("`- [${document.title");
    // The facts the section resolves.
    expect(read(`${markdownApp}/src/facts.ts`)).toContain(
      'defineFacts({ emails: fact.number(3000), runtime: fact.text("workerd") })',
    );
  });
});
