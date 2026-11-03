---
packages:
  pagegraph:
    type: minor
---

## Effect 4.1.2 runtime compatibility

Upgrade the bundled CLI's Effect, TypeSafe AI, and platform runtime to 4.1.2. Programmatic build and audit consumers now require Effect peers compatible with 4.1.2; other library entries and the bundled CLI keep these peers optional. Preserve existing decision-cache keys and validate Effect's image-location answers, including the selected image in their cache identity.
