---
packages:
  pagegraph:
    type: minor
---

### Make agent workflow runs recoverable and bounded

Large `executor_execute` results are saved in JSON under each run's `tool-results/` directory, and
truncated previews tell the agent how to read the full result. Agent presets now guide workflows to
return only needed fields and rows and to read large artifacts in chunks.

`workflows.repositoryRoot` optionally sets the read boundary for repository tools and `context.files`.
It defaults to the config directory's Git top level, falling back to the config directory. Context
file paths resolve from this read root, so existing app-relative paths may need a repository-relative
prefix. Writes remain bounded to the application root. Run artifacts under `runsDirectory` are
readable to support recovery.

Workflow commands accept `--from <run-dir|run-id>` to resume recorded agent session and research
state while skipping recorded completed calls. Resume verifies that repository HEAD and file
contents still match the checkpoint; completed runs return their recorded output without provider
calls. An action that started without recording completion is refused because replay could repeat
edits. Incomplete runs from before progress checkpoints were recorded cannot be resumed. Missing
model-provider credentials, `TYPESAFE_API_KEY`, or required Executor configuration are reported
before the first paid model turn.

After three rejected submissions, valid items are retained; rejected items and their indices and
validation reasons are recorded in `research.json` and `run.json`.
