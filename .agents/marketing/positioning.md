# Marketing positioning

Who PageGraph is for, the story it tells them, and the proof behind each point. [Truth](truth.md) decides what may be claimed and wins on conflict; [voice](voice.md) decides how it sounds.

## Category

**Internal category:** route-declared SEO for TanStack. Use it in planning and rules.

**Public vocabulary:** "SEO for TanStack Start", "head tags", "sitemap", "robots.txt", "JSON-LD", "CI check". Developers search these words. Do not lead with "graph" as a headline noun; it is the mechanism, explained after the outcome.

**Definition (the sentence a search overview can quote).** Open key pages with it or a faithful variant:

> PageGraph is an npm library for TanStack Start and TanStack Router. Each route declares its SEO once, and PageGraph derives the head tags, sitemap, robots.txt, JSON-LD and a CI check from that declaration.

## Audience

**Primary: developers on TanStack Start or TanStack Router who own their app's SEO.** They are usually the same people who write the routes, so SEO lives in code review, not in a marketing tool.

- Trigger: a route is renamed or a page is added, and the sitemap, canonical, breadcrumb or a `related` link now points somewhere stale. Or a launch review finds a page with no description.
- Job: change a page in one place and have every SEO surface follow, with CI telling them when something is broken.

**Secondary:** teams that need to audit a site they do not build with TanStack. `pagegraph audit` is framework-independent and works on any URL.

### Anti-audience

- Teams on Next.js, Astro or another framework who want a plugin for it. Say plainly that the plugin is TanStack only, and point them to `pagegraph audit`.
- Marketers looking for a hosted dashboard, rank tracking or a crawler service. PageGraph has none of these.

## The problem

SEO facts are repeated across places that are edited separately: the route's head, the sitemap, the JSON-LD, the cards other pages render for it, and the internal links. When a route renames or a description changes, the copies drift, and nothing fails until a crawler or a reviewer notices.

## Alternatives, honestly

| Alternative                                                                | What it does well                                                               | Where it leaves a gap                                                                                                                     |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Hand-written head per route, plus a sitemap generator such as next-sitemap | No new concept. Works with any framework. Fine for a small site.                | The head, sitemap and JSON-LD are separate copies. Nothing ties a renamed route to a `related` link or breadcrumb.                        |
| Crawler audits after deploy (hosted or CLI)                                | See the site as a crawler does, across any stack. Catch what shipped.           | They find problems after they are live. They do not know what you declared, so they cannot say a page disagrees with its own declaration. |
| PageGraph                                                                  | One declaration per route. Checks run before deploy and again on rendered HTML. | TanStack Start and Router only for the plugin. A convention to learn. Not a monitor of a live site over time.                             |

PageGraph also covers the second row for any site: `pagegraph audit` is framework-independent. Say so, and do not claim it replaces a dedicated monitoring product.

## Differentiation

1. **One declaration, many outputs.** The head, sitemap, robots.txt, breadcrumbs, JSON-LD and checks read the same `staticData.seo`. (Truth: What it is.)
2. **Failures before deploy.** `pagegraph check` is a CI gate, and the opt-in coverage gate fails `vite build` on an undeclared page. (Truth: The gates.)
3. **Renames become compile errors.** Typed paths check `related` and `redirectTo` against the real route tree. (Truth: What it is.)
4. **Checks the rendered page, not only the declaration.** `check --site` verifies server-rendered HTML: one H1, canonical, robots meta, visible FAQ answers and prices. (Truth: The gates.)
5. **Runs in your repo.** No account or hosted service. Runtime entries have zero runtime dependencies beyond their peers. (Truth: Runtime and packaging; What it is not.)

## Proof points

Each proof point on the site must map to a row in [truth.md](truth.md). Prefer showing code over describing it.

| Proof                                                           | Truth source                     | Best surface               |
| --------------------------------------------------------------- | -------------------------------- | -------------------------- |
| A real route declaration beside the head it produces            | What it is                       | Home hero or first section |
| The one-line `robots.txt` and `sitemap.xml` routes              | What it is                       | Quick start                |
| `pagegraph check` output failing on a dead `related` edge       | The gates                        | Home, CI guide             |
| The structural vs editorial split                               | The gates; check rules reference | Concepts, check rules      |
| `check --site` catching a FAQ answer missing from rendered text | The gates                        | CI guide                   |
| "This site is built with it"                                    | What it is                       | Footer and the hero sub    |
| Entry table with the zero-dependency guarantee                  | Runtime and packaging            | Entries reference          |

Do not invent a terminal transcript. Capture real output from this site or the example app, and keep it current with the published version.

## Pages and the job each does

- **Home:** the outcome, one real declaration, the install command, links to the quick start.
- **Docs:** one Diataxis job per page (tutorial, how-to, reference, explanation). Marketing claims do not appear in docs; docs state facts.
- **Not-for pages:** a short, honest note that the plugin is TanStack only.
