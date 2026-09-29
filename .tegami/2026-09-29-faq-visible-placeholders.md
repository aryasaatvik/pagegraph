---
packages:
  pagegraph:
    type: patch
---

### Accept angle-bracket placeholders in FAQ answers

`faq-not-visible` no longer reports a plain-text JSON-LD answer that contains
placeholders such as `samva-<id>._domainkey` when the page renders them escaped.
Answers with real HTML markup are still compared by their text.
