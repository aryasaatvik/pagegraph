---
packages:
  pagegraph:
    type: minor
---

### Run improve workflows on Pi

**Breaking:** Every workflow now runs on Pi. Improve workflows continue the research conversation
and apply source changes with guarded `edit_file` and `write_file` tools. Dry-run actions expose
only read tools and describe intended changes. Writes stay inside the repository and exclude
`.git`, `node_modules`, workflow runs, and agent presets. There is no shell tool.

OpenCode, its SDK install, patched client, preset JSON, and permission rules are removed.
Schema-version-2 artifacts now record `agent.runtime` as the literal `pi`.

**Breaking:** `pagegraph init` writes `.pagegraph/agent`. To migrate an existing preset, move
`.pagegraph/opencode` to `.pagegraph/agent`, delete `opencode.jsonc`, and set
`workflows.agent.presetDirectory: ".pagegraph/agent"` in `pagegraph.config.ts`.
The preset uses `executor_search` and `executor_execute` for live tools and `submit_result`
for structured workflow results.

`improve links` can read served target-page sentences with `fetch_page`, restricted to
suggestion-report origins and subject to robots rules and response size limits.

Together with the Pi research runner, these changes make up release 0.14.0.
