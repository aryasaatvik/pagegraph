# Contributing

Use Bun 1.4.4, pinned in `package.json`, and Node.js 24 for the packed-consumer checks.

```sh
bun install --frozen-lockfile
bun run check
bun run build
bun run test:artifact
```

The install-time `prepare` hook builds the package so local consumers can resolve its exports.

| Command           | Contract                                                                                                                                                               |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `check`           | Check formatting, lint, source/tests/automation types, and normal offline tests.                                                                                       |
| `build`           | Build the supported library entries, declarations, and standalone CLI.                                                                                                 |
| `test:artifact`   | Pack (including the prepack build), install an isolated consumer, and verify exports, types, CLI behavior, and runtime import boundaries. Requires registry downloads. |
| `release:check`   | Run `check` and `test:artifact` serially; all publication gates.                                                                                                       |
| `release:version` | Prepare Tegami version metadata. Review manifest, changelog, and publish-lock changes.                                                                                 |
| `release:publish` | Run the gated Tegami CI version-PR/publication route used by the Publish workflow.                                                                                     |

`format` writes formatting; `format:check`, `lint`, `typecheck`, and `test` can also run separately.
Normal tests use temporary fixtures, local servers, and scripted model responses rather than live
provider accounts. Keep generated fixture output out of commits.

## Releases

Add a release note with `bun run tegami`, which opens Tegami's changelog editor, or write a Markdown
file under `.tegami/` by hand:

```md
---
packages:
  pagegraph:
    type: patch
---

### What changed for users
```

Every push to `main` runs the serialized Publish workflow. Pending notes produce a version PR;
ordinary code PRs and version PRs run the same full CI. The Actions bot opens the version PR, so
GitHub holds its CI run until a maintainer approves it. When version metadata lands, Tegami
preflights pending packages and its `afterPreflight` hook runs `release:check` at that checkout
before publication. A failed gate aborts publication.
The existing npm trusted-publishing route then publishes, pushes tags, and creates GitHub releases.

Use `release:check` for validation. Do not run `release:publish`, `tegami publish`, status, or dry-run
commands as routine checks: publication can write to npm/GitHub and preflight can invoke the gate.
