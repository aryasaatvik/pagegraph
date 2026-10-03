---
packages:
  pagegraph:
    type: minor
---

### Run read-only workflows on Pi

**Breaking:** Replace `workflows.opencode` with `workflows.agent` in `pagegraph.config.ts`.
Rename `configDirectory` to `presetDirectory`; keep `defaultModel`, optional per-workflow `models`,
and optional `timeoutMs` under `workflows.agent`. Model IDs use `provider/id`, and Pi reads model
credentials from its provider-specific environment variables. Use `--preset-directory` in place
of `--opencode-config` for CLI overrides.

**Breaking:** Workflow runs, research checkpoints, and failure artifacts use `schemaVersion: 2`.
Update artifact readers to use `agent` in place of `opencode` and inspect `agent.runtime`:
`pi` records contain the model, messages, and usage with total cost; `opencode` records contain
the model, session ID, and transcript.

`research.*`, `analyze.*`, and `plan.architecture` run in-process on Pi 1.0.0. Pi composes the SEO
agent instructions, `AGENTS.md`, and each workflow's skill and Executor reference from the configured
preset directory. Missing preset files fail with their paths. Repository tools are read-only and
reject paths outside the project root, including symlink escapes. `improve.*` workflows use OpenCode
with the same preset directory.

Pi submits structured state through `submit_result`. Acceptance requires valid workflow state,
at least one Executor catalog search, and a completed relevant Executor call. Invalid submissions
receive validation or evidence guidance in the agent loop; three rejected submissions fail the run.
Research declines Executor approval requests and respects the per-run deadline.

Pi workflows require a configured Executor toolset. The default factory reports
"Executor tools are not configured" until the toolset is supplied.
