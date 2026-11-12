---
packages:
  pagegraph:
    type: patch
---

### Fix consumer build diagnostics

Generate sourcemaps for authored document source locations so Vite and Rolldown can trace edited
modules back to their original source. Preserve the resolved environment in the build-only
Cloudflare Markdown prerender Worker so production prerender preview loads its configuration
without a missing-environment warning. Consumer configuration stays the same.
