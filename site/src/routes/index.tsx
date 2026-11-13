import { createFileRoute } from "@tanstack/react-router";
import { DocumentProvider, Section, T, Title, Visual } from "pagegraph/react";
import { Link } from "pagegraph/tanstack-start/react";

import { CopyCommand } from "../components/copy-command";
import { GraphWindow } from "../components/graph-window";
import { REPO_URL } from "../components/site-chrome";
import { getGraphView } from "../lib/graph-view";
import { seo } from "../lib/seo";

export const Route = createFileRoute("/")({
  staticData: {
    markdown: "rendered",
    llms: "Pages",
    seo: {
      kind: "page",
      crumb: "Home",
      sitemap: { priority: 1, changeFrequency: "weekly" },
      related: ["/docs/quick-start"],
      modifiedAt: "2026-11-13",
      head: {
        title: "PageGraph: route-declared SEO for TanStack Start",
        description:
          "Head tags, sitemap, robots.txt, JSON-LD and a CI gate for TanStack Start, from one declaration per route.",
      },
    },
  },
  loader: () => getGraphView(),
  head: seo.head,
  component: Home,
});

const declaration = `export const Route = createFileRoute("/(docs)/docs/quick-start")({
  staticData: {
    seo: {
      kind: "page",
      crumb: "Quick start",
      sitemap: { priority: 0.9, changeFrequency: "monthly" },
      related: ["/docs/guides/ci-check", "/docs/reference/cli"],
      modifiedAt: "2026-11-13",
      head: {
        title: "Quick start",
        description: "Add route-declared SEO to a TanStack Start app.",
      },
    },
    markdown: "rendered",
  },
  head: seo.head,
});`;

/** Lines of the declaration that carry a numbered output, by 1-based line number. */
const marks: Record<number, string> = { 5: "1", 6: "2", 7: "3", 9: "4", 14: "5" };

function Code({ source }: { source: string }) {
  return (
    <pre>
      <code>
        {source.split("\n").map((line, index) => (
          <span className="ln" data-m={marks[index + 1]} key={index}>
            {line}
            {"\n"}
          </span>
        ))}
      </code>
    </pre>
  );
}

const checkOutput = `$ pagegraph check
Structural (2):

  ✗ [dead-edge]  /blog/launch
      related edge from "/blog/launch" points at "/pricing",
      which is not a node in the graph.
  ✗ [robots-blocks-sitemap-url]  /solutions
      Disallow: /s blocks a sitemap page.

2 structural, 0 editorial

$ pagegraph check
✓ No violations. The SEO graph is clean.`;

function Terminal() {
  return (
    <pre>
      {checkOutput.split("\n").map((line, index) => (
        <span
          key={index}
          className={
            line.startsWith("$")
              ? "c"
              : line.includes("✗") || line.startsWith("2 structural")
                ? "bad"
                : line.startsWith("✓")
                  ? "ok"
                  : undefined
          }
        >
          {line}
          {"\n"}
        </span>
      ))}
    </pre>
  );
}

function Home() {
  const view = Route.useLoaderData();
  return (
    <DocumentProvider>
      <section className="hero">
        <div className="wrap">
          <Section kind="hero" id="hero">
            <h1>
              <Title>Declare SEO on the route. PageGraph derives the rest.</Title>
            </h1>
            <p className="lede">
              <T>
                Head tags, sitemap, robots.txt, JSON-LD and a CI gate for TanStack Start, from one
                declaration per route. This site is built with it.
              </T>
            </p>
            <div className="cta">
              <Link className="btn primary" to="/docs/$" params={{ _splat: "quick-start" }}>
                <T>Start the tutorial</T>
              </Link>
              <Visual describe="Install with: bun add pagegraph">
                <CopyCommand command="bun add pagegraph" />
              </Visual>
            </div>
          </Section>
          <figure className="stage" aria-labelledby="stage-cap">
            <Visual
              describe={`This site's own route graph: ${view.nodes.length} pages, ${view.crumbEdges} breadcrumb edges and ${view.related.length} related links, read from the build.`}
            >
              <GraphWindow view={view} />
            </Visual>
            <figcaption className="caption" id="stage-cap">
              This is the graph PageGraph built for this site: {view.nodes.length} pages,{" "}
              {view.related.length} related links. Choose a page to see what it declares and what
              the build derives. The same graph writes <a href="/sitemap.xml">sitemap.xml</a> and{" "}
              <a href="/robots.txt">robots.txt</a>.
            </figcaption>
          </figure>
        </div>
      </section>

      <section className="sec" aria-labelledby="one">
        <div className="wrap">
          <Section kind="prose" id="one-declaration">
            <h2 id="one">
              <Title>One object on the route. Every output reads it.</Title>
            </h2>
            <p className="sub">
              <T>
                <code>staticData.seo</code> holds the crawl policy and the head together. The
                rendered head, the graph and the checks read the same object, so the page and the
                sitemap cannot disagree.
              </T>
            </p>
          </Section>
          <div className="two">
            <Visual describe="An example route declaration for /docs/quick-start, with crumb, sitemap, related, head and markdown fields.">
              <div className="code">
                <div className="file">src/routes/(docs)/docs/quick-start.tsx</div>
                <Code source={declaration} />
              </div>
            </Visual>
            <Section kind="steps" id="derived" title={<T>What one declaration derives</T>}>
              <ol className="derive">
                <Section.Item>
                  <li>
                    <span className="m" aria-hidden="true">
                      1
                    </span>
                    <b>
                      <Title>A breadcrumb</Title>
                    </b>
                    <p>
                      <T>
                        <code>crumb</code> becomes a BreadcrumbList: Home › Docs › Quick start.
                      </T>
                    </p>
                  </li>
                </Section.Item>
                <Section.Item>
                  <li>
                    <span className="m" aria-hidden="true">
                      2
                    </span>
                    <b>
                      <Title>A sitemap entry</Title>
                    </b>
                    <p>
                      <T>
                        <code>sitemap</code> and <code>modifiedAt</code> become the page's{" "}
                        <code>&lt;url&gt;</code> with its <code>&lt;lastmod&gt;</code>.
                      </T>
                    </p>
                  </li>
                </Section.Item>
                <Section.Item>
                  <li>
                    <span className="m" aria-hidden="true">
                      3
                    </span>
                    <b>
                      <Title>Typed links</Title>
                    </b>
                    <p>
                      <T>
                        A renamed <code>related</code> target is a type error. A target with no link
                        card fails the check.
                      </T>
                    </p>
                  </li>
                </Section.Item>
                <Section.Item>
                  <li>
                    <span className="m" aria-hidden="true">
                      4
                    </span>
                    <b>
                      <Title>The head</Title>
                    </b>
                    <p>
                      <T>
                        <code>seo.head</code> renders the title, description, canonical, Open Graph
                        tags and JSON-LD.
                      </T>
                    </p>
                  </li>
                </Section.Item>
                <Section.Item>
                  <li>
                    <span className="m" aria-hidden="true">
                      5
                    </span>
                    <b>
                      <Title>A Markdown twin for agents</Title>
                    </b>
                    <p>
                      <T>
                        The page is captured as <code>/docs/quick-start.md</code> and listed in{" "}
                        <code>/llms.txt</code>.
                      </T>
                    </p>
                  </li>
                </Section.Item>
              </ol>
            </Section>
          </div>
        </div>
      </section>

      <section className="band" aria-labelledby="gate">
        <div className="wrap">
          <Section kind="prose" id="ci-gate">
            <h2 id="gate">
              <Title>Drift fails the build, not the crawl.</Title>
            </h2>
            <p className="sub">
              <T>
                <code>pagegraph check</code> reads the same graph through{" "}
                <code>pagegraph.config.ts</code>. Broken declarations exit 1 in CI, before a crawler
                finds them.
              </T>
            </p>
          </Section>
          <div className="two">
            <Visual describe="Example pagegraph check output: two structural violations, then a clean run.">
              <div className="term" role="region" aria-label="Example pagegraph check output">
                <div className="file">Terminal</div>
                <Terminal />
              </div>
            </Visual>
            <Section kind="cards" id="severities" title={<T>What the check reports</T>}>
              <ul className="sev">
                <Section.Item>
                  <li>
                    <b>
                      <Title>Structural</Title> <em className="f">exit 1</em>
                    </b>
                    <span>
                      <T>
                        Dead or duplicate edges, path collisions, a redirect or a noindex page in
                        the sitemap, a published URL that robots.txt blocks.
                      </T>
                    </span>
                  </li>
                </Section.Item>
                <Section.Item>
                  <li>
                    <b>
                      <Title>Editorial</Title> <em className="w">reported</em>
                    </b>
                    <span>
                      <T>
                        Duplicate titles and descriptions, descriptions too long for results, and
                        pages older than your freshness policy.
                      </T>
                    </span>
                  </li>
                </Section.Item>
                <Section.Item>
                  <li>
                    <b>
                      <Title>Rendered</Title>
                    </b>
                    <span>
                      <T>
                        With <code>--site</code>, it fetches every declared page and checks the HTML
                        a crawler receives: one H1, the canonical, robots meta, visible FAQ answers
                        and prices.
                      </T>
                    </span>
                  </li>
                </Section.Item>
              </ul>
            </Section>
          </div>
          <figure className="plate">
            <img
              src="/media/drift-gates.png"
              width={1920}
              height={1080}
              loading="lazy"
              alt="Where a broken declaration surfaces: typed paths at type check, the Vite build's evaluation, coverage and claims gates, pagegraph check's structural and editorial rules, and pagegraph links verify on the served site."
            />
            <figcaption>
              Where a broken declaration surfaces, from type check to the served site.
            </figcaption>
          </figure>
          <div className="filmrow">
            <Section kind="prose" id="film">
              <h2>
                <Title>Rename one route. Every copy has to follow.</Title>
              </h2>
              <p className="sub">
                <T>
                  A silent, 60-second film of the problem and the fix, drawn from the repository's
                  test fixture.
                </T>
              </p>
            </Section>
            <figure className="plate" style={{ margin: 0 }}>
              <video
                className="film"
                controls
                preload="none"
                poster="/media/pagegraph-launch-poster.jpg"
                aria-describedby="film-cap"
                width={1920}
                height={1080}
              >
                <source src="/media/pagegraph-launch.mp4" type="video/mp4" />
              </video>
              <figcaption id="film-cap">
                No sound.{" "}
                <a
                  href={`${REPO_URL}/blob/main/media/launches/introducing-pagegraph/TRANSCRIPT.md`}
                >
                  Read the transcript
                </a>
                .
              </figcaption>
            </figure>
          </div>
        </div>
      </section>

      <section className="sec" aria-labelledby="where">
        <div className="wrap">
          <Section kind="prose" id="entries">
            <h2 id="where">
              <Title>Each entry runs in one place.</Title>
            </h2>
            <p className="sub">
              <T>
                Runtime entries have no dependencies beyond their listed peers. Build entries
                resolve to a stub under <code>workerd</code>, so a Worker bundle that reaches one
                fails at import instead of on its first request.
              </T>
            </p>
          </Section>
          <Visual describe="A table of six of PageGraph's entry points and where each runs; the full list is on /docs/reference/entries.">
            <div className="table">
              <div className="scroll">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Entry</th>
                      <th scope="col">Runs in</th>
                      <th scope="col">For</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="grp">
                      <th colSpan={3} scope="colgroup">
                        Runtime
                      </th>
                    </tr>
                    <tr>
                      <td>pagegraph</td>
                      <td>Worker, SSR, browser</td>
                      <td>Build the graph, render sitemap and robots, run checks</td>
                    </tr>
                    <tr>
                      <td>pagegraph/react</td>
                      <td>Worker, SSR, browser</td>
                      <td>
                        <code>seo.head</code>, breadcrumbs, JSON-LD
                      </td>
                    </tr>
                    <tr>
                      <td>pagegraph/tanstack-start/server</td>
                      <td>Start server routes</td>
                      <td>
                        <code>robotsTxt</code>, <code>sitemapXml</code>, <code>llmsTxt</code>
                      </td>
                    </tr>
                    <tr className="grp">
                      <th colSpan={3} scope="colgroup">
                        Build
                      </th>
                    </tr>
                    <tr>
                      <td>pagegraph/tanstack-start</td>
                      <td>vite.config.ts</td>
                      <td>The Vite plugin that builds the graph</td>
                    </tr>
                    <tr>
                      <td>pagegraph/config</td>
                      <td>pagegraph.config.ts</td>
                      <td>CLI policy and the graph loader</td>
                    </tr>
                    <tr>
                      <td>pagegraph</td>
                      <td>CLI, on Bun</td>
                      <td>
                        <code>check</code>, <code>graph</code>, <code>audit</code>,{" "}
                        <code>links verify</code>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </Visual>
          <p className="more">
            <Link className="btn secondary" to="/docs/$" params={{ _splat: "reference/entries" }}>
              <T>See all 13 entries</T>
            </Link>
          </p>
        </div>
      </section>

      <section className="sec" aria-labelledby="qs">
        <div className="wrap">
          <Section kind="steps" id="quick-start">
            <h2 id="qs">
              <Title>Five steps to a checked graph.</Title>
            </h2>
            <p className="sub">
              <T>The tutorial adds PageGraph to an existing TanStack Start app.</T>
            </p>
            <ol className="steps">
              {[
                [
                  "Bind your site",
                  "Origin, name and organization, once. Route files never see them.",
                  "lib/seo.ts",
                ],
                [
                  "Declare each page",
                  "Crawl policy and head together, on the route.",
                  "staticData.seo",
                ],
                [
                  "Add the plugin",
                  "It builds the graph inside your Vite pipeline.",
                  "vite.config.ts",
                ],
                ["Serve robots and sitemap", "One line each, as server routes.", "robots[.]txt.ts"],
                ["Gate CI", "The CLI reads the same graph.", "pagegraph check"],
              ].map(([title, body, code]) => (
                <Section.Item key={title}>
                  <li>
                    <b>
                      <Title>{title}</Title>
                    </b>
                    <span>
                      <T>{body}</T>
                    </span>
                    <code>{code}</code>
                  </li>
                </Section.Item>
              ))}
            </ol>
            <p className="more">
              <Link className="btn primary" to="/docs/$" params={{ _splat: "quick-start" }}>
                <T>Start the tutorial</T>
              </Link>
            </p>
          </Section>
        </div>
      </section>

      <section className="sec" aria-labelledby="self">
        <div className="wrap self">
          <Section kind="prose" id="built-with">
            <h2 id="self">
              <Title>Read this site's own output.</Title>
            </h2>
            <p className="sub">
              <T>
                Each file comes from the declarations in <code>site/src/routes</code>. CI runs{" "}
                <code>pagegraph check</code> on every push.
              </T>
            </p>
          </Section>
          <nav className="files" aria-label="This site's generated files">
            <a href="/sitemap.xml">
              /sitemap.xml<span>{view.nodes.length} URLs</span>
            </a>
            <a href="/robots.txt">
              /robots.txt<span>Crawl rules</span>
            </a>
            <a href="/llms.txt">
              /llms.txt<span>Docs index for agents</span>
            </a>
            <a href="/index.md">
              /index.md<span>This page in Markdown</span>
            </a>
            <a href={`${REPO_URL}/tree/main/site`}>
              site/<span>Source on GitHub</span>
            </a>
          </nav>
        </div>
      </section>
    </DocumentProvider>
  );
}
