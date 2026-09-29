---
packages:
  pagegraph:
    type: minor
---

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
content dates already do. A date that does not parse now fails `check`. Set
`freshness: { maxAgeDays }` to report stale pages in `check`, and run
`pagegraph stale` to list pages to refresh, oldest first.
