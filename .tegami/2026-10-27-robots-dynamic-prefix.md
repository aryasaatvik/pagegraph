---
packages:
  pagegraph:
    type: patch
---

### Disallow only the directory of a dynamic route

A disallowed route group with a dynamic route now yields a directory prefix: `/s/$formKey`
produces `Disallow: /s/` instead of `Disallow: /s`. The old prefix also blocked `/solutions`,
`/senders`, and `/sitemap.xml`, because robots.txt rules match by prefix. Static pages such as
`/signup` and `alwaysDisallow` entries are unchanged. A dynamic route at the site root
(`/$slug`) in a disallowed group now fails the build, since its prefix would block every path.

`pagegraph check` has a new structural rule, `robots-blocks-sitemap-url`. It fails when the
rendered robots.txt disallows a sitemap page, `/sitemap.xml`, or `/llms.txt` for `User-agent: *`
and names the URL and the matching rule. Sites that currently block their own sitemap URLs will
fail the check until the `Disallow` is narrowed.
