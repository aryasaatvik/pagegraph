---
packages:
  "npm:pagegraph": minor
---

### Use OpenRouter for Jev decisions with Pagegraph attribution

Jev now prefers OPENROUTER_API_KEY and falls back to TYPESAFE_API_KEY when no OpenRouter key is set.
OpenRouter decisions and workflow agent calls identify the Pagegraph app for rankings and analytics.
Set openrouter.referer and openrouter.title in pagegraph.config.ts to override the identity.
Existing committed claims answers remain valid when switching providers.
