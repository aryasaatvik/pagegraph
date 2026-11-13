---
packages:
  pagegraph:
    type: patch
---

### Make the Organization contact point optional

`organization.contactPoint` in `createSeo` is now optional. When it is absent, the Organization
JSON-LD omits `contactPoint` instead of requiring a site to publish a support email. Configurations
that set it render the same output as before.
