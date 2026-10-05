---
packages:
  pagegraph:
    type: minor
---

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
