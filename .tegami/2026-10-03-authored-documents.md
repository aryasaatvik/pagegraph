---
packages:
  pagegraph:
    type: minor
---

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
