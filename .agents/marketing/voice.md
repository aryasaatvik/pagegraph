# Marketing voice

How PageGraph sounds. [Truth](truth.md) decides what may be said and wins on conflict; [positioning](positioning.md) decides which story to tell.

## Principles

1. **Plain and specific.** A developer should know in five seconds what PageGraph does and what to type next. Name the file, the function or the command.
2. **Developer to developer.** Short sentences, active voice, concrete nouns, plain verbs. Direct and calm. Take a side, never be cute.
3. **Show the code first.** A route declaration or a `pagegraph check` result says more than an adjective. Use fenced code with a language tag.
4. **Name the problem, then the outcome, then the proof.** The problem is SEO facts that drift when a route changes. The outcome is one declaration. The proof is a check that fails.
5. **Be honest about the shelf.** Say what other tools do well and what PageGraph does not do: TanStack only for the plugin, no hosted service, no live monitoring. Win on specifics.
6. **Claim only what ships.** Every claim has a row in [truth.md](truth.md). If it is not there, leave it out.
7. **Present tense.** Describe what the product does now. History belongs in the changelog.

## Style rules

- **Sentence case** for every heading, title, button and label.
- **No em dashes in marketing copy.** Use a period or a comma. Docs may use one per page at most.
- **No exclamation marks.**
- **No emoji.**
- **Product names.** `PageGraph` in prose. `pagegraph` in code font for the npm package, the CLI binary and import paths. Never "Page Graph" or "pagegraph" as a bare prose name.
- **Commands and options** are always in code font: `pagegraph check`, `staticData.seo`, `--site`.
- Prefer "route", "page", "declaration", "sitemap", "head" over invented nouns. Use "graph" once the reader knows what it is.
- Numbers only from [truth.md](truth.md) or the README. Never round up.
- Write for a skimmer: one idea per sentence, lists for parallel items, no paragraph over five sentences.

## Banned words and phrases

Do not use these in any public copy:

- streamline, seamless, seamlessly, unleash, unlock, supercharge, turbocharge, elevate, empower
- leverage (as a verb), harness, robust, powerful, cutting-edge, state-of-the-art, next-generation, world-class
- game-changing, revolutionary, magic, effortless, effortlessly, frictionless, blazing, lightning-fast
- best-in-class, enterprise-grade, all-in-one, end-to-end solution, holistic, synergy
- "boost your rankings", "rank higher", "dominate search", "10x"
- "in today's fast-paced world", "take your SEO to the next level", "welcome to"
- "simply", "just" used to minimize effort; "easy" and "easily" unless a step count backs it

## Words to prefer

| Instead of               | Write                                                        |
| ------------------------ | ------------------------------------------------------------ |
| leverages the route tree | reads your routes                                            |
| seamless integration     | one Vite plugin and one config file                          |
| robust validation        | `pagegraph check` exits 1 on structural violations           |
| supercharge SEO          | derive the head, sitemap and robots.txt from one declaration |
| comprehensive audit      | audit a URL, or compare two audits                           |

## Headlines

- The home headline is the approved line in [truth.md](truth.md): "Declare SEO on the route. PageGraph derives the rest."
- Every other page's title says the task or the thing: "Gate CI with pagegraph check", "Check rules", "The graph".
- Docs open with one lead sentence that says what the page does, then sections. No H1 in the body; the layout renders the title.

## Checks before publishing

- Every claim maps to a row in truth.md.
- No banned word, no em dash, no exclamation mark.
- Commands and package names are in code font and match the published version.
- The page says what PageGraph does not do where a reader might assume it.
