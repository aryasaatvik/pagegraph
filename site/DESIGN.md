# pagegraph.arya.sh design

The site and the launch media in `media/` share one identity: ink on near-white, one link-blue
accent, red only where a check fails. Tokens live in `src/styles.css` (site) and
`media/src/styles.css` (media); change both together.

## Register

- **Landing (`/`)**: brand register. Centred hero, then sections that alternate between the light
  canvas and one black band. The memorable element is the graph window: this site's own SeoGraph,
  read from the build at prerender, beside the selected page's declaration and what the build
  derives from it.
- **Docs, changelog, 404**: product register. Three columns (nav, article, on-page contents) on
  desktop; one column on phones with the nav after the article.

## Colour

| Token               | Light                                                   | Dark                                        | Use                                            |
| ------------------- | ------------------------------------------------------- | ------------------------------------------- | ---------------------------------------------- |
| `--canvas`          | `#fafafa`                                               | `#111111`                                   | Page ground                                    |
| `--card`            | `#ffffff`                                               | `#171717`                                   | Windows, code panels, tables, cards            |
| `--inset`           | `#f4f4f4`                                               | `#1f1f1f`                                   | Inline code, hover fills                       |
| `--hairline`        | `#ebebeb`                                               | `#262626`                                   | Dividers                                       |
| `--hairline-strong` | `#d4d4d4`                                               | `#3a3a3a`                                   | Crumb edges, stronger dividers                 |
| `--ink`             | `#171717`                                               | `#ededed`                                   | Text, primary button                           |
| `--body`            | `#4d4d4d`                                               | `#a1a1a1`                                   | Secondary text                                 |
| `--mute`            | `#6b6b6b`                                               | `#8f8f8f`                                   | Labels, captions (4.5:1 on canvas)             |
| `--link`            | `#1a3fd1`                                               | `#8fb0ff`                                   | Related edges, selected page, mark root, links |
| `--fail`            | `#d32020`                                               | `#ff6166`                                   | Failing check output only                      |
| `--band`            | `#0a0a0a`                                               | `#000000`                                   | The CI-gate band (always dark)                 |
| Code                | str `#0b6e4f`, num `#a3500b`, key `#1a3fd1`, kw ink 600 | str `#6fd3a8`, num `#f0b072`, key `#8fb0ff` | Hand-set code on the landing page              |

Docs code uses Shiki's `github-light` / `github-dark` through `--shiki-light` / `--shiki-dark`.
Blue means "a link": never use it for emphasis or decoration. Red never appears outside failure
output. No lime, no gradients, no glow.

## Type

- **Bricolage Grotesque** (variable, from Fontsource) for prose and headings. Display weight 600 at
  most, tracking `-0.045em` at the hero, `-0.035em` on section headings, sentence case, headlines end
  with a full stop.
- **Spline Sans Mono** for code, paths, and the graph labels. Never for body copy or eyebrow labels.
- Scale: hero `clamp(40px, 6.2vw, 64px)`, section `clamp(28px, 3.4vw, 36px)`, docs H1 40px, docs H2
  24px, body 16px (17-19px for ledes).

## Shape and depth

- Radius: 999px for buttons and the install pill, 12px for windows and panels, 8px for cards and
  code blocks, 4-6px for inline code and nav items.
- Depth is a 1px ring (`--ring`) plus, on raised panels, a soft stacked shadow (`--lift`,
  `--float`). Dark mode drops the shadows and keeps the ring.

## Motion

One page-load moment: the graph's edges draw in (700ms, 22ms stagger) and nodes fade in by depth.
Choosing a page swaps the declaration panel. `prefers-reduced-motion: reduce` shows the finished
graph with no animation.

## Content rules

- Every claim on the site traces to `.agents/marketing/truth.md`.
- The landing page's prose sits inside PageGraph's `Section`, `Title`, and `T` so `/index.md` is the
  same page for agents; visuals are `Visual` with a `describe` sentence.
- Images from `media/exports` are copied into `public/media` at build (`scripts/sync-media.ts`);
  the repository keeps one copy of each binary.

**Registry overrides:** `serif-on-dashboards` and `overused-font` do not apply (Bricolage Grotesque
and Spline Sans Mono are the project's launch faces). Mono labels inside the graph window are
data, not eyebrows.
