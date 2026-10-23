# Media provenance

Everything in `exports/` is rendered from source in this directory. No stock imagery, generated
imagery, music, voice, or paid generation service was used, and nothing is fetched at render time.

| Asset                                   | Source                                                                                                                                                                              | License                                                            |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Copy, script, layouts, motion           | Written for this repository                                                                                                                                                         | MIT, as the repository                                             |
| Mark (`Mark` in `src/scenes/parts.tsx`) | Drawn for this repository                                                                                                                                                           | MIT, as the repository                                             |
| On-screen code                          | Verbatim excerpts of `tests/fixtures/tanstack-start-app/src/routes/(marketing)/pricing.tsx`, `.../src/collections.ts`, and `tests/fixtures/markdown-start-app/src/routes/index.tsx` | MIT, as the repository                                             |
| On-screen output                        | `seo.head`, `renderSitemap`, `renderRobots`, `checkGraph`, and `renderViolations` output for those fixtures, rechecked by `tests/source.test.ts`                                    | MIT, as the repository                                             |
| Build, render, and motion helpers       | Adapted from the same author's CapsuleDB launch media (`media/scripts`, `motion-kit.ts`)                                                                                            | MIT                                                                |
| Bricolage Grotesque (display type)      | `@fontsource-variable/bricolage-grotesque` 5.3.0, copied into each build's assets                                                                                                   | SIL Open Font License 1.1, The Bricolage Grotesque Project Authors |
| Spline Sans Mono (code and labels)      | `@fontsource-variable/spline-sans-mono` 5.3.0, copied into each build's assets                                                                                                      | SIL Open Font License 1.1, The Spline Sans Mono Project Authors    |
| GSAP (timeline runtime)                 | `gsap` 3.15.0, bundled into each build                                                                                                                                              | GSAP Standard "no charge" license (gsap.com/standard-license)      |
| HyperFrames (compositor and renderer)   | `hyperframes` 0.8.150, a development dependency; renders with its managed headless Chrome in software (SwiftShader) mode                                                            | Apache-2.0; not distributed with the outputs                       |

## Audio

The film is silent. No original or licensed audio was available for this cut, and paid music
generation was out of scope. The [transcript](launches/introducing-pagegraph/TRANSCRIPT.md) is the
film's text alternative; a later cut that adds audio records its source and license here.

## Telemetry

The scripts run HyperFrames with `HYPERFRAMES_NO_TELEMETRY=1` and `DO_NOT_TRACK=1`. Never run
`hyperframes publish`: renders are reviewed and shipped through this repository.
