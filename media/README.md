# pagegraph launch media

A private tool that renders pagegraph's launch film, README infographics, and share cards with
HyperFrames. It is not part of the npm package: the root `files` list publishes only `dist`,
`package.json`, `README.md`, and `LICENSE`, and this directory has its own dependencies and
lockfile.

The story, timings, and claim boundaries live in
[`launches/introducing-pagegraph/SCRIPT.md`](launches/introducing-pagegraph/SCRIPT.md); the film's
text alternative is [`TRANSCRIPT.md`](launches/introducing-pagegraph/TRANSCRIPT.md). Asset sources
and licenses are in [`PROVENANCE.md`](PROVENANCE.md).

## Outputs

`exports/` holds the tracked deliverables:

| File                          | Size                                   |
| ----------------------------- | -------------------------------------- |
| `pagegraph-launch.mp4`        | 1920×1080, 60 s, 30 fps, H.264, silent |
| `pagegraph-launch-poster.jpg` | 1920×1080                              |
| `route-declaration.png`       | 1920×1080                              |
| `drift-gates.png`             | 1920×1080                              |
| `what-runs-where.png`         | 1920×1080                              |
| `og.png`                      | 1200×630                               |
| `github-social-preview.png`   | 1280×640                               |

## How it is built

- `src/scenes/<id>/markup.tsx` renders a scene once with `renderToStaticMarkup`. Its sibling
  `motion.ts` receives a paused GSAP timeline and the scene root; offsets start at the scene's own
  zero, and `data-a` attributes name what moves. `parts.tsx` holds the shared primitives and
  `source.ts` every on-screen excerpt and derived output.
- `src/cuts.ts` places the seven beats in the 60-second film and lists every still with its
  canvas size. Cards are laid out at their own size, never scaled or letterboxed.
- `scripts/build.ts` bundles the motion runtime, copies GSAP and the two fonts, and writes one
  HyperFrames composition per shot. Composition and page backgrounds are both painted.
- `scripts/render.ts` renders the film. `scripts/stills.ts` renders each still through the same
  compositor as a lossless PNG sequence and keeps its settled frame, then extracts the poster from
  the finished film. Both render in software (`--no-browser-gpu`) so repeated renders match.

All motion lives on GSAP timelines with 2D transforms. CSS transitions and animations, timers,
clocks, and randomness are forbidden; the build and `tests/film.test.ts` reject them.

## Tests

- `tests/source.test.ts` fails when an excerpt no longer matches the repository file it quotes, or
  when pagegraph's own functions (`seo.head`, `buildSeoGraph`, `renderSitemap`, `renderRobots`,
  `checkGraph`, `renderViolations`, `coverageMessage`) stop producing the output the film shows.
  It imports the root `src/`, so install the root dependencies first.
- `tests/copy.test.ts` audits visible copy for unsupported claims and characters the bundled fonts
  lack, and checks the runtime and build entries against `package.json` exports.
- `tests/layout.test.ts` bounds every code and terminal panel by the mono advance at each render
  size and requires every name a motion animates to exist in its scene.
- `tests/geometry.test.ts` lays each still out in headless Chrome with the bundled fonts and fails
  when a text line leaves its block, passes the header's right edge, or an element clips its
  content. It uses HyperFrames' managed Chrome, else a system Chrome; set `CHROME_PATH` to choose.
- `tests/film.test.ts` pins the 60-second timeline, the poster frame, and card sizes.

## Commands

Use the pinned Bun from the root `packageManager`. From `media/`:

```sh
bun install --frozen-lockfile
bun run typecheck
bun run test
bun run build
bun run hyperframes lint launches/introducing-pagegraph
bun run hyperframes check launches/introducing-pagegraph
bun run render       # film, then stills, cards, and poster into exports/
bun run stills       # stills, cards, and poster only (needs the rendered film)
bun run frames       # review frames and a contact sheet from the finished MP4
bun run copy:audit   # every visible string, by scene
bun run scene hook   # build one scene alone under .build/scenes/
bun run preview      # HyperFrames studio
```

Judge the film from frames extracted from the MP4 (`bun run frames` writes them to
`.build/review/`), not from browser snapshots, which composite differently. Set
`HYPERFRAMES_NO_TELEMETRY=1` when calling `hyperframes` directly; the scripts already do.

CI installs this directory from its lockfile and runs `typecheck` and `test` on every pull request,
so a quoted excerpt or derived output that drifts fails there. It does not build or render;
regenerate `exports/` locally when the film or stills change.

After changing media, run the root `bun run format:check` (it covers this directory) and
`git diff --check`.
