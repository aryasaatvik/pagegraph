# pagegraph launch media

A private tool that renders pagegraph's launch film, README infographics, and share cards with
HyperFrames. It is not part of the npm package: the root `files` list publishes only `dist`,
`package.json`, `README.md`, and `LICENSE`, and this directory has its own dependencies and
lockfile.

`src/scenes/source.ts` holds every on-screen excerpt and derived output. `tests/source.test.ts`
fails when an excerpt no longer matches the repository file it quotes, or when pagegraph's own
functions (`seo.head`, `renderSitemap`, `renderRobots`, `checkGraph`) no longer produce the output
the film shows. The tests import the root `src/`, so install the root dependencies first.

## Commands

Use the pinned Bun from the root `packageManager`. From `media/`:

```sh
bun install --frozen-lockfile
bun run typecheck
bun run test
```

CI installs this directory from its lockfile and runs `typecheck` and `test` on every pull request.
It does not build or render.
