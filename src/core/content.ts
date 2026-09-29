/**
 * Content checks over server-rendered HTML: headings, structured data against
 * visible text, word count, and declared-vs-rendered robots and canonical.
 *
 * These run on rendered documents, not on the route graph, because the facts
 * they judge do not exist in a declaration: headings come from components, JSON-LD
 * and the `<title>` are composed by `head()` at render time, and the visible text
 * is whatever the page's components produce. The graph supplies the other half —
 * which pages are indexable and what their canonical path and robots policy are —
 * so the declared-vs-rendered rules can say "this page drifted from its
 * declaration".
 *
 * Like `inspectHtml`, this is pure string scanning of rendered output with no
 * HTML-parsing dependency, and it keeps the core entry zero-dependency. It reads
 * server-rendered markup, which is what a crawler receives before any script runs;
 * text a client inserts after hydration is invisible here, and is reported as such.
 */

import type { Severity, Violation } from "./checks";
import { globToRegExp } from "./checks";
import type { SeoGraph, SeoNode } from "./graph";
import { inspectHtml } from "./inspect-html";
import { normalizePath } from "./links";
import { isSitemapEligible } from "./projections";

export interface Heading {
  readonly level: number;
  readonly text: string;
}

/** A JSON-LD object that carries an `@type`, found at any depth of any block. */
export type JsonLdNode = Readonly<Record<string, unknown>>;

/** What a rendered document says, reduced to the fields the content rules read. */
export interface PageContent {
  readonly title: string | undefined;
  readonly description: string | undefined;
  readonly robots: string | undefined;
  readonly canonical: string | undefined;
  /** Every H1 in the body, in document order, by accessible text. */
  readonly h1: ReadonlyArray<string>;
  /** Headings in the main content region (`<main>`, else the body without nav and footer). */
  readonly outline: ReadonlyArray<Heading>;
  /** Words of visible text in the main content region. */
  readonly wordCount: number;
  /** Visible body text with whitespace collapsed; scripts, styles, and templates removed. */
  readonly text: string;
  /** Every typed JSON-LD node on the page, flattened out of arrays, `@graph`, and nesting. */
  readonly jsonLd: ReadonlyArray<JsonLdNode>;
}

export type ContentRuleName =
  | "missing-h1"
  | "multiple-h1"
  | "empty-h1"
  | "heading-level-skip"
  | "h1-title-mismatch"
  | "faq-not-visible"
  | "offer-price-not-visible"
  | "webpage-head-mismatch"
  | "thin-content";

export interface ContentFinding {
  readonly rule: ContentRuleName;
  readonly severity: Severity;
  readonly message: string;
  readonly fix: string;
}

export interface ContentCheckOptions {
  /** Minimum words of main-region text; omit to skip the `thin-content` rule. */
  readonly minWords?: number | undefined;
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  hellip: "…",
  middot: "·",
  bull: "•",
  copy: "©",
  reg: "®",
  trade: "™",
  times: "×",
  euro: "€",
  pound: "£",
};

const decodeEntities = (value: string): string =>
  value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
    if (code.startsWith("#")) {
      const point =
        code[1] === "x" || code[1] === "X"
          ? Number.parseInt(code.slice(2), 16)
          : Number.parseInt(code.slice(1), 10);
      return Number.isInteger(point) && point > 0 && point <= 0x10ffff
        ? String.fromCodePoint(point)
        : entity;
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? entity;
  });

/** Elements whose contents a reader never sees as page text. */
const INVISIBLE = /<(script|style|template|noscript|svg)\b[\s\S]*?<\/\1\s*>/gi;
const COMMENT = /<!--[\s\S]*?-->/g;

const withoutInvisible = (html: string): string =>
  html.replace(COMMENT, " ").replace(INVISIBLE, " ");

const textOf = (html: string): string =>
  decodeEntities(html.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();

const attributeOf = (tag: string, name: string): string | undefined => {
  const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(
    tag,
  );
  const value = match?.[1] ?? match?.[2] ?? match?.[3];
  return value === undefined ? undefined : decodeEntities(value);
};

const bodyOf = (html: string): string => {
  const body = /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(html);
  if (body) return body[1]!;
  return html.replace(/<head\b[^>]*>[\s\S]*?<\/head>/i, " ");
};

/**
 * The main content region: `<main>` when the page has one, otherwise the body
 * without its `<nav>` and `<footer>` blocks. Site chrome repeats on every page,
 * so counting its headings or words would judge the layout, not the page.
 */
const mainRegionOf = (body: string): string => {
  const main = /<main\b[^>]*>([\s\S]*?)<\/main\s*>/i.exec(body);
  if (main) return main[1]!;
  return body.replace(/<(nav|footer)\b[\s\S]*?<\/\1\s*>/gi, " ");
};

const HEADING = /<h([1-6])\b([^>]*)>([\s\S]*?)<\/h\1\s*>/gi;

/**
 * A heading's accessible text: its content, else its `aria-label`, else the
 * `alt` of images inside it (a logo H1).
 */
const headingText = (attributes: string, inner: string): string => {
  const text = textOf(inner);
  if (text !== "") return text;
  const label = attributeOf(attributes, "aria-label")?.trim();
  if (label) return label;
  return [...inner.matchAll(/<img\b[^>]*>/gi)]
    .map((image) => attributeOf(image[0], "alt")?.trim() ?? "")
    .filter(Boolean)
    .join(" ");
};

const headingsOf = (html: string): Array<Heading> =>
  [...html.matchAll(HEADING)].map((match) => ({
    level: Number(match[1]),
    text: headingText(match[2]!, match[3]!),
  }));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  // NOTE: This zero-dependency core entry cannot import Effect; JSON-LD is untyped input narrowed field by field below.
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Every object with an `@type`, at any depth — offers nest in products, questions in FAQ pages. */
const collectTyped = (value: unknown, into: Array<JsonLdNode>): void => {
  if (Array.isArray(value)) {
    for (const entry of value) collectTyped(entry, into);
    return;
  }
  if (!isRecord(value)) return;
  if (value["@type"] !== undefined) into.push(value);
  for (const child of Object.values(value)) collectTyped(child, into);
};

const JSON_LD = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi;

/** Parse every JSON-LD block. A block that does not parse is `inspectHtml`'s finding, not ours. */
const jsonLdOf = (html: string): Array<JsonLdNode> => {
  const nodes: Array<JsonLdNode> = [];
  for (const match of html.matchAll(JSON_LD)) {
    let parsed: unknown;
    // NOTE: JSON.parse boundary: an unparseable block is skipped here; inspectHtml reports it.
    try {
      parsed = JSON.parse(match[1]!.trim());
    } catch {
      continue;
    }
    collectTyped(parsed, nodes);
  }
  return nodes;
};

/**
 * Text normalized for "does this appear on the page" comparisons: Unicode-folded,
 * lowercased, and reduced to runs of letters and digits. Punctuation, quotes,
 * dashes, and markup spacing differ freely between JSON-LD and rendered copy
 * without changing what a reader sees.
 */
export const matchText = (value: string): string =>
  value
    .normalize("NFKC")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .join(" ");

const countWords = (text: string): number => {
  const normalized = matchText(text);
  return normalized === "" ? 0 : normalized.split(" ").length;
};

/** Reduce a rendered HTML document to the fields the content rules read. Pure. */
export const extractPageContent = (html: string): PageContent => {
  const head = inspectHtml("", 200, html);
  const body = withoutInvisible(bodyOf(html));
  const main = mainRegionOf(body);
  return {
    title: head.title,
    description: head.description,
    robots: head.robots,
    canonical: head.canonical,
    h1: headingsOf(body)
      .filter((heading) => heading.level === 1)
      .map((heading) => heading.text),
    outline: headingsOf(main),
    wordCount: countWords(textOf(main)),
    text: textOf(body),
    jsonLd: jsonLdOf(html),
  };
};

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

const typesOf = (node: JsonLdNode): Array<string> => {
  const type = node["@type"];
  if (typeof type === "string") return [type];
  if (Array.isArray(type)) return type.filter((entry): entry is string => typeof entry === "string");
  return [];
};

const hasType = (node: JsonLdNode, types: ReadonlySet<string>): boolean =>
  typesOf(node).some((type) => types.has(type));

const stringField = (node: JsonLdNode, field: string): string | undefined => {
  const value = node[field];
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
};

/** Tags Google allows in an FAQ answer; anything else in angle brackets is text. */
const ANSWER_TAG = /<\/?(?:h[1-6]|p|br|ol|ul|li|div|a|b|strong|i|em)(?:\s[^>]*)?\/?>/i;

/**
 * JSON-LD text is either HTML using the tags Google allows in answers, compared by
 * its text, or plain text that may hold angle-bracket placeholders such as
 * `samva-<id>._domainkey`, compared literally.
 */
const isVisible = (visible: string, candidate: string): boolean => {
  const needle = matchText(ANSWER_TAG.test(candidate) ? textOf(candidate) : decodeEntities(candidate));
  return needle === "" || ` ${visible} `.includes(` ${needle} `);
};

const clip = (value: string, max = 80): string =>
  value.length > max ? `${value.slice(0, max - 1)}…` : value;

const STOPWORDS = new Set(
  "a an and are as at be but by can for from get has have how in into is it its more not of on or our per than that the their this to use via vs was what when who why will with you your".split(
    " ",
  ),
);

/**
 * Terms that carry meaning, reduced to a crude stem: stopwords drop, a plural
 * `s` folds, and long words compare by their first six letters, so
 * "Authentication" and "Authenticate" or "templates" and "template" agree. The
 * rule only asks whether any term is shared, so a lenient stem errs toward
 * silence, never toward a false warning.
 */
const significantTerms = (value: string): Set<string> =>
  new Set(
    matchText(value)
      .split(" ")
      .filter((term) => term !== "" && !STOPWORDS.has(term) && (term.length > 2 || /\d/.test(term)))
      .map((term) => (term.length > 3 && term.endsWith("s") ? term.slice(0, -1) : term))
      .map((term) => term.slice(0, 6)),
  );

/** schema.org `WebPage` and the subtypes whose `name`/`description` describe the page itself. */
const WEB_PAGE_TYPES: ReadonlySet<string> = new Set([
  "WebPage",
  "AboutPage",
  "CheckoutPage",
  "CollectionPage",
  "ContactPage",
  "FAQPage",
  "ItemPage",
  "MedicalWebPage",
  "ProfilePage",
  "QAPage",
  "RealEstateListing",
  "SearchResultsPage",
]);

const OFFER_TYPES: ReadonlySet<string> = new Set(["Offer", "AggregateOffer"]);
const FAQ_TYPES: ReadonlySet<string> = new Set(["FAQPage"]);

const asArray = (value: unknown): Array<unknown> =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];

/** Parse a schema.org price (`19`, `"19.00"`, `"1,000"`); undefined when it is not a number. */
const parsePrice = (value: unknown): number | undefined => {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string") return undefined;
  const cleaned = value.replace(/[^\d.]/g, "");
  if (cleaned === "" || !/^\d*\.?\d+$/.test(cleaned)) return undefined;
  return Number(cleaned);
};

const pricesOf = (offer: JsonLdNode): Array<number> =>
  [
    offer["price"],
    offer["lowPrice"],
    offer["highPrice"],
    ...asArray(offer["priceSpecification"]).flatMap((spec) =>
      isRecord(spec) ? [spec["price"], spec["minPrice"], spec["maxPrice"]] : [],
    ),
  ].flatMap((value) => {
    const price = parsePrice(value);
    return price === undefined ? [] : [price];
  });

/**
 * Whether a price appears as a number in the visible text: `19` matches `$19`,
 * `19.00`, and `19/mo`; `1000` matches `1,000`; `0.5` matches `0.50`. A price of
 * zero also matches the word "free".
 */
export const priceIsVisible = (price: number, text: string): boolean => {
  if (price === 0 && /\bfree\b/i.test(text)) return true;
  const [whole, fraction = ""] = String(price).split(".");
  const grouped = whole!.replace(/\B(?=(\d{3})+(?!\d))/g, "[,.\\u00a0 ]?");
  const decimals = fraction === "" ? "(?:[.,]0+)?" : `[.,]${fraction}0*`;
  return new RegExp(`(?<![\\d.,])${grouped}${decimals}(?![\\d]|[.,]\\d)`).test(text);
};

/**
 * Whether a JSON-LD `name` agrees with the rendered `<title>`. A title usually
 * wraps the page name in a site-name affix ("Pricing | Example"), so either
 * containing the other counts as agreement.
 */
const namesAgree = (a: string, b: string): boolean => {
  const left = matchText(a);
  const right = matchText(b);
  if (left === "" || right === "") return true;
  return ` ${left} `.includes(` ${right} `) || ` ${right} `.includes(` ${left} `);
};

interface ContentRule {
  readonly name: ContentRuleName;
  readonly severity: Severity;
  readonly evaluate: (
    content: PageContent,
    options: ContentCheckOptions,
  ) => ReadonlyArray<{ readonly message: string; readonly fix: string }>;
}

/**
 * Every content rule, in one place. Heading-count and structured-data rules that
 * Google treats as eligibility or policy problems are structural; outline and
 * wording smells are editorial.
 */
const CONTENT_RULES: ReadonlyArray<ContentRule> = [
  {
    name: "missing-h1",
    severity: "structural",
    evaluate: (content) =>
      content.h1.length === 0
        ? [
            {
              message: "Page has no H1.",
              fix: "Render exactly one <h1> that names the page's topic.",
            },
          ]
        : [],
  },
  {
    name: "multiple-h1",
    severity: "structural",
    evaluate: (content) =>
      content.h1.length > 1
        ? [
            {
              message: `Page has ${content.h1.length} H1s: ${content.h1.map((text) => `"${clip(text, 40)}"`).join(", ")}.`,
              fix: "Keep one <h1> for the page topic; demote the others to <h2>.",
            },
          ]
        : [],
  },
  {
    name: "empty-h1",
    severity: "structural",
    evaluate: (content) =>
      content.h1.some((text) => text === "")
        ? [
            {
              message: "An H1 has no text, aria-label, or image alt.",
              fix: "Give the <h1> visible text that names the page's topic.",
            },
          ]
        : [],
  },
  {
    // The outline starts under the page's H1, so a first heading of h3 is a
    // skip just as h2 → h4 is. Going back up any number of levels is fine.
    name: "heading-level-skip",
    severity: "editorial",
    evaluate: (content) => {
      const skips: Array<string> = [];
      let previous = 1;
      for (const heading of content.outline) {
        if (heading.level > previous + 1) {
          skips.push(`h${previous} → h${heading.level} "${clip(heading.text, 40)}"`);
        }
        previous = heading.level;
      }
      return skips.length === 0
        ? []
        : [
            {
              message: `Heading levels skip ${skips.length} time(s): ${skips.slice(0, 3).join("; ")}${skips.length > 3 ? "; …" : ""}.`,
              fix: "Nest headings one level at a time; style a heading with CSS, not by choosing a deeper level.",
            },
          ];
    },
  },
  {
    name: "h1-title-mismatch",
    severity: "editorial",
    evaluate: (content) => {
      const [h1] = content.h1;
      if (content.h1.length !== 1 || !h1 || !content.title) return [];
      const title = significantTerms(content.title);
      const shared = [...significantTerms(h1)].some((term) => title.has(term));
      return shared
        ? []
        : [
            {
              message: `H1 "${clip(h1, 60)}" shares no significant term with the title "${clip(content.title, 60)}".`,
              fix: "Make the H1 and <title> describe the same topic; a searcher who clicks the title should recognize the page.",
            },
          ];
    },
  },
  {
    name: "faq-not-visible",
    severity: "structural",
    evaluate: (content) => {
      const visible = matchText(content.text);
      return content.jsonLd
        .filter((node) => hasType(node, FAQ_TYPES))
        .flatMap((faq) => asArray(faq["mainEntity"]))
        .filter(isRecord)
        .flatMap((question) => {
          const name = stringField(question, "name");
          const answers = asArray(question["acceptedAnswer"])
            .filter(isRecord)
            .flatMap((answer) => {
              const text = stringField(answer, "text");
              return text === undefined ? [] : [text];
            });
          const missing = [
            ...(name !== undefined && !isVisible(visible, name) ? ["question"] : []),
            ...(answers.some((answer) => !isVisible(visible, answer)) ? ["answer"] : []),
          ];
          return missing.length === 0
            ? []
            : [
                {
                  message: `FAQPage ${missing.join(" and ")} for "${clip(name ?? "(unnamed)", 70)}" is not in the rendered page text.`,
                  fix: "Render every FAQ question and answer in the server HTML, or drop the entry from the FAQPage JSON-LD.",
                },
              ];
        });
    },
  },
  {
    name: "offer-price-not-visible",
    severity: "structural",
    evaluate: (content) =>
      content.jsonLd
        .filter((node) => hasType(node, OFFER_TYPES))
        .flatMap((offer) => {
          const hidden = pricesOf(offer).filter((price) => !priceIsVisible(price, content.text));
          if (hidden.length === 0) return [];
          const currency = stringField(offer, "priceCurrency");
          const label = stringField(offer, "name") ?? typesOf(offer).join(", ");
          return [
            {
              message: `${label} price ${hidden.map((price) => `${price}${currency ? ` ${currency}` : ""}`).join(", ")} does not appear in the rendered page text.`,
              fix: "Show the offer's price in the server-rendered copy, or correct the JSON-LD price.",
            },
          ];
        }),
  },
  {
    name: "webpage-head-mismatch",
    severity: "editorial",
    evaluate: (content) =>
      content.jsonLd
        .filter((node) => hasType(node, WEB_PAGE_TYPES))
        .flatMap((page) => {
          const findings: Array<{ message: string; fix: string }> = [];
          const name = stringField(page, "name");
          if (name !== undefined && content.title && !namesAgree(name, content.title)) {
            findings.push({
              message: `${typesOf(page).join(", ")} name "${clip(name, 60)}" does not match the title "${clip(content.title, 60)}".`,
              fix: "Derive the JSON-LD name from the same value as the <title>.",
            });
          }
          const description = stringField(page, "description");
          if (
            description !== undefined &&
            content.description &&
            matchText(description) !== matchText(content.description)
          ) {
            findings.push({
              message: `${typesOf(page).join(", ")} description differs from the meta description.`,
              fix: "Derive the JSON-LD description from the same value as the meta description.",
            });
          }
          return findings;
        }),
  },
  {
    name: "thin-content",
    severity: "editorial",
    evaluate: (content, options) =>
      options.minWords !== undefined && content.wordCount < options.minWords
        ? [
            {
              message: `Main content has ${content.wordCount} words (min ${options.minWords}).`,
              fix: "Answer the page's search intent in more depth, or merge it into a stronger page.",
            },
          ]
        : [],
  },
];

/** Run every content rule against one rendered page. Graph-independent; pure. */
export const checkPageContent = (
  content: PageContent,
  options: ContentCheckOptions = {},
): Array<ContentFinding> =>
  CONTENT_RULES.flatMap((rule) =>
    rule.evaluate(content, options).map((raw) => ({
      rule: rule.name,
      severity: rule.severity,
      message: raw.message,
      fix: raw.fix,
    })),
  );

// ---------------------------------------------------------------------------
// Rendered pages against the declared graph
// ---------------------------------------------------------------------------

/** A word-count floor for sitemap-eligible pages matching a path glob. */
export interface WordCountRule {
  /** Path glob: `*` matches within a segment, `**` matches across segments. */
  readonly path: string;
  readonly minWords: number;
}

/** Project policy for rendered content checks. */
export interface ContentPolicy {
  /** Word-count floors; a page matching several rules must meet the highest. */
  readonly minWords?: ReadonlyArray<WordCountRule> | undefined;
}

/** One declared page as the server rendered it, or why it could not be read. */
export type RenderedDocument =
  | {
      readonly path: string;
      readonly ok: true;
      /** Path of the final response URL, after redirects, encoded or not. */
      readonly finalPath: string;
      readonly html: string;
    }
  | { readonly path: string; readonly ok: false; readonly error: string };

const declaresNoindex = (node: SeoNode): boolean =>
  node.policy.robots?.toLowerCase().includes("noindex") === true;

/**
 * The declared pages a rendered check fetches: every sitemap-eligible page,
 * plus concrete pages that declare `noindex` so the rendered robots meta can be
 * held to that declaration. Param templates and redirects render no page of
 * their own.
 */
export const renderedCheckTargets = (graph: SeoGraph): Array<string> =>
  [...graph.nodes.values()]
    .filter(
      (node) =>
        isSitemapEligible(node) ||
        (declaresNoindex(node) &&
          node.policy.redirectTo === undefined &&
          !node.path.includes("$")),
    )
    .map((node) => node.path);

const PATH_BASE = "https://pagegraph.invalid";

/**
 * A path as a URL serializes it (`/café` → `/caf%C3%A9`), trailing slash
 * dropped. Declared paths, response URLs, and canonicals are compared in this
 * one form, or a page with non-ASCII segments would read as redirected.
 */
const urlPath = (value: string): string | undefined => {
  try {
    return normalizePath(new URL(value, PATH_BASE));
  } catch {
    return undefined;
  }
};

/**
 * Judge rendered documents against the declared graph. Every indexable page must
 * render, stay on its path, keep a self-referencing canonical and indexable
 * robots meta, and pass {@link checkPageContent}; a page that declares `noindex`
 * must render a `noindex` robots meta.
 *
 * Robots are read from the `<meta name="robots">` tag only. An `X-Robots-Tag`
 * header is usually host policy (preview hosts noindex everything), so holding
 * pages to it would fail every local run for a reason no declaration controls.
 */
export function checkRenderedContent(
  graph: SeoGraph,
  documents: ReadonlyArray<RenderedDocument>,
  policy: ContentPolicy = {},
): Array<Violation> {
  const violations: Array<Violation> = [];
  const push = (
    rule: string,
    severity: Severity,
    path: string,
    message: string,
    fix: string,
  ): void => {
    violations.push({ rule, severity, path, message, fix });
  };

  const wordRules = (policy.minWords ?? []).map((rule) => ({
    rule,
    matcher: globToRegExp(rule.path),
  }));
  const eligible = [...graph.nodes.values()].filter(isSitemapEligible).map((node) => node.path);
  for (const { rule, matcher } of wordRules) {
    if (!eligible.some((path) => matcher.test(path))) {
      violations.push({
        severity: "structural",
        rule: "content-rule-unmatched",
        message: `Word-count rule "${rule.path}" matches no sitemap-eligible page.`,
        fix: "Point the rule at a sitemap-eligible path, or drop it.",
      });
    }
  }

  for (const document of documents) {
    const node = graph.nodes.get(document.path);
    if (node === undefined) continue;
    const declaredPath = urlPath(document.path);
    if (!document.ok) {
      push(
        "rendered-page-unavailable",
        "structural",
        document.path,
        `Could not read the rendered page: ${document.error}.`,
        "Serve the declared page with a 2xx HTML response.",
      );
      continue;
    }
    if (urlPath(document.finalPath) !== declaredPath) {
      push(
        "rendered-page-unavailable",
        "structural",
        document.path,
        `Rendered page redirects to "${document.finalPath}".`,
        "Declare the redirect with `redirectTo`, or serve the page at its declared path.",
      );
      continue;
    }

    const content = extractPageContent(document.html);
    const renderedNoindex = content.robots?.toLowerCase().includes("noindex") === true;
    const indexable = isSitemapEligible(node);

    if (!indexable) {
      if (!renderedNoindex) {
        push(
          "rendered-robots-mismatch",
          "structural",
          document.path,
          `Declared robots "${node.policy.robots}" but the rendered page has ${content.robots ? `robots "${content.robots}"` : "no robots meta"}.`,
          "Render the declared robots value in the page's <meta name=\"robots\">.",
        );
      }
      continue;
    }

    if (renderedNoindex) {
      push(
        "rendered-robots-mismatch",
        "structural",
        document.path,
        `Page is in the sitemap but renders robots "${content.robots}".`,
        "Drop the noindex from the rendered head, or declare the page noindex and remove its sitemap policy.",
      );
    }

    const canonical = content.canonical === undefined ? undefined : urlPath(content.canonical);
    if (canonical !== declaredPath) {
      push(
        "rendered-canonical-mismatch",
        "structural",
        document.path,
        content.canonical === undefined
          ? "Rendered page has no canonical link."
          : `Rendered canonical "${content.canonical}" does not point at "${document.path}".`,
        "Render a self-referencing canonical for every indexable page.",
      );
    }

    const floors = wordRules.filter(({ matcher }) => matcher.test(document.path));
    const minWords =
      floors.length === 0 ? undefined : Math.max(...floors.map(({ rule }) => rule.minWords));
    for (const finding of checkPageContent(content, { minWords })) {
      push(finding.rule, finding.severity, document.path, finding.message, finding.fix);
    }
  }
  return violations;
}
