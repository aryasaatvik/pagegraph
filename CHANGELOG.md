## pagegraph@0.15.1

### Capture Markdown in dev when Vite pre-bundles dependencies

`pagegraph()` now keeps `pagegraph` and `pagegraph/react` out of dependency pre-bundling, next to
the runtime entries. A pre-bundled copy gave pages their own document context and `defineFacts`
registry, so every dev capture (`/__pagegraph/markdown.json`, `<page>.md`, `claims check --dev`)
failed with `recorded no <Section>` or `Unknown document fact`.

## pagegraph@0.15.0

### Review improve workflow edits and apply them later

Improve workflows (`content`, `metadata`, `schema`, `links`) now submit structured edits instead of
writing files. Each edit names the file, the exact `oldText` it replaces (or none for a new file),
the `newText`, a reason, and evidence; `reviewItems` carry changes a human must make, with their
path, reason, and evidence. PageGraph rejects a submission whose edits do not apply to the current
files, so the agent corrects them in the same turn.

Every improve run writes `edits.json` and a human-readable `review.md` to its run directory. Jev
decisions that land in review, including link suggestions, appear there as review items instead of
being dropped.

`--dry-run` records the edits without changing source files. The new `pagegraph apply <run>` applies
them later, skipping and reporting any edit whose target text no longer matches; `--only <ids>`
applies a subset and `--check` reports without writing. Write mode applies the same recorded edits
during the run.

Breaking: the `edit_file` and `write_file` agent tools are removed, along with the action result's
`files` and `outcome` fields; `run.json` reports `outcome`, `edits`, and `reviewItems` for improve
runs. Custom presets that mention those tools should describe structured edits instead.

### Resolve and check per-page social images

Declare `staticData.seo.head.image: { url, width?, height?, alt? }` or a collection entry's
`image`. Existing `article.image` remains supported. Share an `ogImage(node)` resolver between
`pagegraph()` and `createSeo` to supply images when a page has no declared image. Page images
win over article images, then the resolver supplies the fallback. Resolved images are absolute
URLs in `node.head.image` and `pageHeads`, and render Open Graph image metadata and Twitter
large-image cards.

`pagegraph check` now fails sitemap-eligible pages without an image or whose same-origin image
asset is missing under `public/`. Configure `ogImage.severity` (`structural`, `editorial`, or
`off`) and `ogImage.publicDirectory` in `pagegraph.config.ts`. Remote images are not fetched.
Consumers own image rendering and must generate local assets before running the check.

### Make agent workflow runs recoverable and bounded

Large `executor_execute` results are saved in JSON under each run's `tool-results/` directory, and
truncated previews tell the agent how to read the full result. Agent presets now guide workflows to
return only needed fields and rows and to read large artifacts in chunks.

`workflows.repositoryRoot` optionally sets the read boundary for repository tools and `context.files`.
It defaults to the config directory's Git top level, falling back to the config directory. Context
file paths resolve from this read root, so existing app-relative paths may need a repository-relative
prefix. Writes remain bounded to the application root. Run artifacts under `runsDirectory` are
readable to support recovery.

Workflow commands accept `--from <run-dir|run-id>` to resume recorded agent session and research
state while skipping recorded completed calls. Resume verifies that repository HEAD and file
contents still match the checkpoint; completed runs return their recorded output without provider
calls. An action that started without recording completion is refused because replay could repeat
edits. Incomplete runs from before progress checkpoints were recorded cannot be resumed. Missing
model-provider credentials, `TYPESAFE_API_KEY`, or required Executor configuration are reported
before the first paid model turn.

After three rejected submissions, valid items are retained; rejected items and their indices and
validation reasons are recorded in `research.json` and `run.json`.

## pagegraph@0.14.1

### Show Executor tool types for every search hit

`executor_search` with details no longer fails when a hit is an MCP-backed tool whose schema has no
TypeScript definitions. A hit whose schema cannot be loaded keeps its search result and reports
`types unavailable: <reason>`, while the other hits still return their input and result types.

## pagegraph@0.14.0

### Run read-only workflows on Pi

**Breaking:** Replace `workflows.opencode` with `workflows.agent` in `pagegraph.config.ts`.
Rename `configDirectory` to `presetDirectory`; keep `defaultModel`, optional per-workflow `models`,
and optional `timeoutMs` under `workflows.agent`. Model IDs use `provider/id`, and Pi reads model
credentials from its provider-specific environment variables. Use `--preset-directory` in place
of `--opencode-config` for CLI overrides.

**Breaking:** Workflow runs, research checkpoints, and failure artifacts use `schemaVersion: 2`.
Update artifact readers to use `agent` in place of `opencode` and inspect `agent.runtime`:
`pi` records contain the model, messages, and usage with total cost; `opencode` records contain
the model, session ID, and transcript.

`research.*`, `analyze.*`, and `plan.architecture` run in-process on Pi 1.0.0. Pi composes the SEO
agent instructions, `AGENTS.md`, and each workflow's skill and Executor reference from the configured
preset directory. Missing preset files fail with their paths. Repository tools are read-only and
reject paths outside the project root, including symlink escapes. `improve.*` workflows use OpenCode
with the same preset directory.

Pi submits structured state through `submit_result`. Acceptance requires valid workflow state,
at least one Executor catalog search, and a completed relevant Executor call. Invalid submissions
receive validation or evidence guidance in the agent loop; three rejected submissions fail the run.
Research declines Executor approval requests and respects the per-run deadline.

Research connects to Executor through `@pi-ext/executor`: set `EXECUTOR_BASE_URL`, plus
`EXECUTOR_CLIENT_ID[_FILE]` and `EXECUTOR_CLIENT_SECRET[_FILE]` when Cloudflare Access fronts the
server. Only provider calls that succeeded count as evidence.

### Run improve workflows on Pi

**Breaking:** Every workflow now runs on Pi. Improve workflows continue the research conversation
and apply source changes with guarded `edit_file` and `write_file` tools. Dry-run actions expose
only read tools and describe intended changes. Writes stay inside the repository and exclude
`.git`, `node_modules`, workflow runs, and agent presets. There is no shell tool.

OpenCode, its SDK install, patched client, preset JSON, and permission rules are removed.
Schema-version-2 artifacts now record `agent.runtime` as the literal `pi`.

**Breaking:** `pagegraph init` writes `.pagegraph/agent`. To migrate an existing preset, move
`.pagegraph/opencode` to `.pagegraph/agent`, delete `opencode.jsonc`, and set
`workflows.agent.presetDirectory: ".pagegraph/agent"` in `pagegraph.config.ts`.
The preset uses `executor_search` and `executor_execute` for live tools and `submit_result`
for structured workflow results.

`improve links` can read served target-page sentences with `fetch_page`, restricted to
suggestion-report origins and subject to robots rules and response size limits.

Together with the Pi research runner, these changes make up release 0.14.0.

## pagegraph@0.13.0

### Capture rendered Markdown through TanStack Start

Declare `staticData.markdown: "rendered"` to publish Markdown twins from authored React pages,
with optional `staticData.llms` groups. Collection instances inherit their route's declarations.
The `pagegraph()` plugin accepts a canonical Markdown origin and a facts module, and exposes
`prerenderPages` for Start. The non-deployed `pagegraph/tanstack-start/prerender-worker` captures
pages through the compiled Start server and writes public twins plus private documents and heads.

Use `markdownRequest` from `pagegraph/tanstack-start/markdown` before the Start handler for dev
and prerender capture. Private paths return 404 in production. `pagegraph/tanstack-start/react`
exports a capture-aware `Link`; `llmsTxt` and `llmsSection` on the server entry compose graph-derived
links without rendering pages. Development rendering catches missing route opt-ins.

### Author page documents alongside React markup

`pagegraph/react` adds `DocumentProvider`, `T`, `Title`, `Section` (including `Section.Item`
and `Section.Item.Link`), `Fact`, `Visual`, `ForAgents`, and `ForHumans`. Normal rendering preserves
layout; a collector records authored messages, sections, linked items, resolved facts, and audience
from completed HTML. `CaptureAnchor` supplies the anchor boundary for router integrations, and
`messageText` extracts static text for head metadata without executing components.

`pagegraph` adds plain document types, fact definitions, section kinds, markdown writers, pure
llms.txt string builders, and `createMarkdownLock`. Content and document hashes preserve the
original authored-document format. Both runtime entries remain Effect-free and Node-free.
Augment the root `Register` interface with `facts: typeof facts` to check `Fact` ids.

`pagegraph/oxlint` adds the `pagegraph` plugin's `no-bare-text` and `t-children` rules for imports
from `pagegraph/react`. It is a build-only entry with throwing Worker and browser stubs.

### Gate claims and inspect captured Markdown

**Breaking:** Rename `seo.config.ts` to `pagegraph.config.ts` (also `.js` and `.mjs`).
The CLI rejects the old filename with migration guidance. Keep CLI policies and the graph loader
in this file; configure site identity, robots, Markdown, and claims through the Vite plugin.
Remove top-level `origin`, `disallow`, `contentSignal`, and `directives` from the CLI config.
`tanstackStartGraph` supplies the plugin's site; a generic `viteGraphLoader` requires a `site`
option, and custom graph loaders return `site: { origin, indexable, robots }` with the graph.

Add `claims: { rules, model, cutoff?, context?, excludeHeads? }` to `pagegraph()` with probability
rules built against `claimsInput` from `pagegraph/claims`. Run `pagegraph claims check` to ask for
missing answers, review them, and commit `.pagegraph/decisions/claims/`. `--refresh` replaces answers;
`--dev <origin>` checks live captured documents. Builds and `pagegraph check` replay committed
answers without model calls and fail on missing answers or violations.

Use `pagegraph markdown show <path>` to print a twin and `pagegraph markdown find <text>` to search
pages and sections. `pagegraph markdown lock` writes `.pagegraph/markdown.lock.json`;
`--check` verifies it without writing.

## pagegraph@0.12.0

### Build the graph inside a TanStack Start app with `pagegraph()`

`pagegraph/tanstack-start` adds a Vite plugin that builds the SEO graph in the app's own Vite
pipeline — aliases, `define`s, and content plugins such as Fumadocs apply — and ships it to the
server runtime as data. `robots.txt` and `sitemap.xml` are one line each:

```ts
// vite.config.ts
pagegraph({ origin, indexable, robots: { contentSignal }, collections: "src/lib/seo/collections.ts", routeConfig });

// src/routes/robots[.]txt.ts
import { robotsTxt } from "pagegraph/tanstack-start/server";
export const Route = createFileRoute("/robots.txt")({ server: { handlers: { GET: robotsTxt } } });
```

The plugin evaluates each route file that declares `staticData`, never the generated route tree, so
a route that imports server-only modules no longer needs a stub; an app-only route that cannot
evaluate in Node fails with its file name and goes in `exclude`. `routeConfig` takes the
`seoRouteConfig` options and adds the derived robots exclusions. `tanstackStartGraph({ root })`
gives `seo.config.ts` and `loadPageHeads` the same graph, and `contentCollection` maps any pages
with a `url` (Fumadocs `getPages()`) to a collection.

### Declare a page's head once

A static route declares its head in `staticData.seo.head` and renders it with `head: seo.head`; the
graph, `pageHeads`, and `pagegraph check` read the same title, description, and FAQs. A route's
`titleTemplate` (`"%s | Example Blog"`) applies to the title `seoHead` renders and to the route's
collection pages. `createSeo({ transformHead })` post-processes every rendered head.

### Fail loud when a runtime bundle imports build code

`pagegraph/config`, `pagegraph/vite`, `pagegraph/audit`, and `pagegraph/tanstack-start` resolve to a
stub under the `workerd`, `worker`, and `browser` export conditions that throws at import with the
entry's name, instead of crashing on a native binding when a request first runs. The README opens
with what runs where.

### Keep every workflow failure

Workflows drop `null` from model JSON before decoding, give the repair turn every schema issue at
once, and write `failure.json` with the stage, OpenCode session id, transcript, and cause chain for
every error after a run starts. The error message ends with the artifact path and a next step.

### Breaking changes

- `selectPageHeadNodes`, `pageHeads`, `PageHead`, and `PageHeadsOptions` are exported from
  `pagegraph`, not `pagegraph/config`. `loadPageHeads` stays in `pagegraph/config`.
- `pageHeads` reads `node.head` (a declared `staticData.seo.head`, or a collection page through its
  route's `titleTemplate`) instead of `node.instance`.
- `PageSeoInstance` is `SeoPageHead` and `FAQItem` is `SeoFaq`.
- `@tanstack/router-generator` is an optional peer: install it with `pagegraph/vite` or
  `pagegraph/tanstack-start`.
- `research-failure.json` is replaced by `failure.json`.
- `seo.config.ts` `disallow` is optional; with `tanstackStartGraph` the robots policy comes from the
  plugin and must not be repeated.

Migrating a TanStack Start app: replace the hand-written graph module and `viteGraphLoader` with
`pagegraph()` plus a collections module, move `seoRouteConfig` options to `routeConfig`, serve
robots and sitemap with `robotsTxt`/`sitemapXml`, move static heads into `staticData.seo.head` with
`head: seo.head`, and move hand-appended title suffixes into `titleTemplate`. The
[TanStack Start cookbook](https://github.com/aryasaatvik/pagegraph/blob/main/examples/tanstack-start/README.md)
has before/after snippets for each step.

## pagegraph@0.11.0

### Load page heads from `pagegraph/config`

Graph loaders created by `viteGraphLoader` accept an input that is passed to the entry export.
`pagegraph/config` exports `selectPageHeadNodes`, `pageHeads`, and `loadPageHeads`, which return
`{ path, title, description }` for indexable pages, honor caller excludes, fail with the page path
when a selected page lacks a title or description, and dispose the loader for the caller.

### Run the OpenCode host from an isolated install

`improve` and `research` workflows load the pinned OpenCode host from their own verified Bun
install, so a consumer's Effect or Drizzle overrides no longer change its runtime. Failures keep the
HTTP operation, status, and body, research keeps its transcript, and a discovery-only run gets one
recovery turn.

### Require stable Effect 4

The Effect peer dependencies are `^4.0.0`.

## pagegraph@0.10.1

### Accept angle-bracket placeholders in FAQ answers

`faq-not-visible` no longer reports a plain-text JSON-LD answer that contains
placeholders such as `samva-<id>._domainkey` when the page renders them escaped.
Answers with real HTML markup are still compared by their text.

## pagegraph@0.10.0

### Check rendered content and page freshness

`pagegraph check --site <url>` fetches every declared page from a running
server and checks its server-rendered HTML. Indexable pages need exactly one
H1, a self-referencing canonical, and robots meta that matches the declaration.
FAQ answers and offer prices in JSON-LD must also appear in the visible text.
Skipped heading levels, an H1 that shares no term with the title, and pages
under a configured `content.minWords` floor are reported as warnings.
`pagegraph audit` now reports the heading and structured-data findings for every
HTML page it audits.

Routes can declare `modifiedAt`, which becomes the sitemap's `<lastmod>` just as
content dates already do. Dates must now be ISO 8601 (`2026-09-29`, or a
date-time with an offset): `check` fails on any other form, and the sitemap
refuses to render one instead of guessing its day. Set
`freshness: { maxAgeDays }` to report stale pages in `check`, and run
`pagegraph stale` to list pages to refresh, oldest first.

## pagegraph@0.9.0

### Find better internal linking opportunities

PageGraph now finds sitemap pages that links alone miss and suggests useful
contextual links backed by exact page text. Use `links candidates --site` to
review ranked suggestions, then pass them to `improve links --suggestions` to
approve edits.

## pagegraph@0.8.4

### Preserve workflow evidence and diagnose interrupted research

Selected pages retain their surrounding link relationships, and Executor evidence requires actual
completed provider invocations. Research instructions inspect current tool schemas and respect the
requested scope. OpenCode completions support configurable deadlines, bounded interruption, and
activity diagnostics. Validated research is saved before decision inference so downstream failures
retain useful evidence. Git mutation checks handle nested project roots and changed submodules.

## pagegraph@0.8.3

### Attribute Executor evidence from structured search results

PageGraph now recognizes tool identifiers returned in Executor search-result `path` fields, including
JSON-encoded output, so valid provider calls satisfy the workflow evidence gate. Discovery stays
limited to those structured fields, preventing unrelated dotted metadata from authorizing a call.

## pagegraph@0.8.2

### Recover incomplete workflow results

When an OpenCode turn collects Executor evidence but omits its final workflow JSON, PageGraph now
runs one tool-free repair turn within the original deadline. Repair restores the session's prior
permissions, and deadline failures report the configured timeout instead of an opaque transport
error.

## pagegraph@0.8.1

### Wait for Executor activation

Workflow commands now wait for the configured Executor plugin to appear in OpenCode's plugin
registry before starting a run. Registry failures still propagate immediately, and a bounded timeout
keeps missing or misconfigured Executor installations fail-closed.

## pagegraph@0.8.0

### Run page-backed SEO workflows

Combine PageGraph's deterministic route graph with an embedded OpenCode agent, project-owned
configuration, live Executor tools, and Jev decisions. The new workflow-oriented CLI covers keyword,
competitor, and authority research; SERP, content, and AI-search analysis; architecture planning; and
content, metadata, schema, and internal-link improvements.

- `pagegraph init` scaffolds a customizable `.pagegraph/opencode` preset with one SEO agent,
  workflow-specific skills, and editable Executor starter recipes.
- `research`, `analyze`, and `plan` workflows collect evidence without changing project files.
- `improve` workflows require a clean Git tree, support `--dry-run`, leave edits uncommitted, and
  record the resulting file changes.
- Every run persists its graph, project context, OpenCode session, live-tool evidence, Jev answers,
  Git provenance, and model provenance under `.pagegraph/runs`.

This release replaces the low-level public decision commands and input-oriented exports with the
smaller workflow surface. OpenCode owns model authentication and configuration; an Executor plugin
provides live SEO integrations discovered at runtime.

## pagegraph@0.7.0

### Answer SEO decisions with Jev

Add a reusable decision runner and five typed decision families, answered in one
TypeSafe System One call per input. Confident answers produce a plan; answers
inside the confidence band go to a review queue. Nothing is applied automatically.

- `pagegraph decide serp` — classify the SERP format and score our page's fit,
  intent, and title (aligned | mismatch | review).
- `pagegraph decide content` — score the content rubric and place page value on
  thin | adequate | strong (pass | flag | review).
- `pagegraph decide fit` — choose the best existing page for a query, or flag
  cannibalization or a gap (map | cannibalized | gap | review).
- `pagegraph decide meta` — rank supplied title/description candidates
  (choose:<id> | review).
- `pagegraph decide authority` — judge a link target's legitimacy, spam, and
  outreach worth, plus its fit (accept | spam | review).
- `pagegraph decide links` (and the retained `links decide`) — real reason,
  anchor present, direction (A→B / B→A / both), and relevance, with top-K
  per-source budget selection.

Shared flags: `--model`, `--threshold`, `--concurrency`, `--cache`, `--review-out`,
and `--budget` for links. Every record carries the model id and an input hash.

## pagegraph@0.6.1

### Assert contextual coverage on the rendered graph

`pagegraph links verify` now closes the loop between declared and served links:

- `links verify <url> --emit-rendered <path>` writes the crawl's raw edge set as a
  versioned `links-rendered` artifact that preserves each anchor's `region`
  (`body` vs `nav`/`footer`/`header`) and the provenance a gate needs — `origin`,
  `seed`, the rendered page paths, and the crawl's `limit`, `truncated`,
  `bodyTruncated`, and `failures`. It is also a drop-in input for
  `links candidates --rendered`.
- `links verify --rendered <path>` replays a saved artifact instead of crawling, so
  one crawl can be asserted repeatedly without re-fetching.
- `links verify --assert-coverage` evaluates the `seo.config.ts` `coverage` rules
  against the anchors a crawler actually receives. Only same-origin body-region
  anchors count, matching `check`'s `related`-only semantics; the rule universe
  stays the declared graph's sitemap-eligible pages. An unmet rule exits 1, and the
  command refuses to assert — rather than reporting a false pass — on a truncated
  crawl, a page that failed to fetch, a truncated body, a missing `coverage`
  policy, or an origin mismatch.

The default `--json` summary is unchanged; the `coverage` block appears only under
`--assert-coverage`.

## pagegraph@0.6.0

### Verify and plan contextual links

Add `pagegraph links`, three commands over the link graph:

- `links verify <url>` crawls served HTML and reports homepage depth, rendered
  orphans, and the declared-vs-rendered gap. Anchor extraction honors `<base href>`,
  and the crawl dedupes redirect targets and surfaces truncated bodies.
- `links candidates` proposes reviewable, section-clustered contextual links from
  the declared graph, excluding anchors already rendered, with an optional
  `--decide` pass.
- `links decide` answers real-reason and anchor-present probabilities for a
  candidate set through TypeSafe System One (Jev), routing below-threshold
  answers to human review.

`pagegraph check` also gains `--require-inbound` (with a configurable policy) so a
sitemap-eligible page must have at least N incoming contextual edges.

## pagegraph@0.5.1

### Bundle Effect into the CLI

The published `pagegraph` binary now bundles `effect` and `@effect/platform-bun`. It no longer asks
consumers to install optional Effect peers, and no longer breaks when the consumer resolves a
different Effect RC — the `effect/unstable/cli` constructors rename between RCs (`Flag.boolean` →
`Flag.Boolean` at rc.113). The library entries remain Effect-free.

## pagegraph@0.5.0

### Compare timestamped SEO audits

Add `pagegraph diff <before.json> <after.json>` with deterministic human and JSON
output, schema validation, and regression-aware exit behavior. Structural
findings, scanner failures, and lost coverage fail the command, while editorial
changes and volatile scanner evidence remain non-blocking.

## pagegraph@0.4.1

### Default optional CLI switches

Treat omitted boolean switches as `false` so `pagegraph audit` and the shared `--json` option work without requiring unrelated flags.

## pagegraph@0.4.0

### Audit any website from the CLI

Add a framework-independent `pagegraph audit` command and public audit toolkit with composable Effect scanners, pure SEO rules, hardened network validation, Lighthouse evidence, and versioned human or JSON reports.

## pagegraph@0.3.0

### Compose any schema.org entity

Add custom site and page JSON-LD with typed helpers, stable entity references, graph composition,
and an optional transform for extending, replacing, suppressing, or expanding generated schemas.
Existing JSON-LD generators continue to work unchanged.

## pagegraph@0.2.1

### Add organization legal identity fields

Organization JSON-LD can now include a legal name and structured postal address, making business identity details easier for search engines and agents to understand.

## pagegraph@0.2.0

### Add Content-Signal to robots.txt

`renderRobots` now takes `contentSignal` (the preference list), extra `directives`, and a `transform` for a last-mile override. The same fields live on `seo.config.ts` so `pagegraph robots` prints the same file as the route. Preview hosts still omit the origin-wide group lines. No default signal.

## pagegraph@0.1.0

### Initial release

Route-declared SEO for TanStack Router: declare once on the route, then derive
the sitemap, robots.txt, breadcrumbs, JSON-LD, cross-link graph, Vite coverage
gate, and CLI from that graph.
