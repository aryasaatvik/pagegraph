/**
 * A small robots.txt matcher with RFC 9309 semantics: the rules of the groups
 * that name `User-agent: *` are matched against a URL path by prefix, `*`
 * matches any run of characters, a trailing `$` anchors the end, the longest
 * matching pattern wins, and Allow wins a tie. Pure; used by the
 * `robots-blocks-sitemap-url` check.
 */

export interface RobotsRule {
  readonly type: "allow" | "disallow";
  /** The pattern exactly as written after the colon. */
  readonly pattern: string;
}

/** The `Allow`/`Disallow` rules that apply to a crawler with no specific group. */
export function parseWildcardRules(robotsTxt: string): Array<RobotsRule> {
  const rules: Array<RobotsRule> = [];
  let agents: Array<string> = [];
  let collectingAgents = false;
  for (const raw of robotsTxt.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (field === "user-agent") {
      if (!collectingAgents) agents = [];
      agents.push(value.toLowerCase());
      collectingAgents = true;
      continue;
    }
    collectingAgents = false;
    if ((field !== "allow" && field !== "disallow") || value === "") continue;
    if (agents.includes("*")) rules.push({ type: field, pattern: value });
  }
  return rules;
}

/**
 * One spelling per path: non-ASCII characters become UTF-8 percent escapes and
 * escape hex digits are uppercase, so "/guides/café" and "/guides/caf%c3%a9" compare
 * equal, as RFC 9309 requires.
 */
const canonicalize = (value: string): string =>
  value
    .replace(/\P{ASCII}/gu, (character) => encodeURIComponent(character))
    .replace(/%[0-9a-f]{2}/gi, (escape) => escape.toUpperCase());

const patternToRegExp = (pattern: string): RegExp => {
  const anchored = pattern.endsWith("$");
  const body = canonicalize(anchored ? pattern.slice(0, -1) : pattern)
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`);
};

/**
 * The rule that decides whether `path` may be crawled, or undefined when no
 * rule matches (crawling is allowed). The result is a `disallow` rule exactly
 * when the path is blocked.
 */
export function decidingRule(
  rules: ReadonlyArray<RobotsRule>,
  path: string,
): RobotsRule | undefined {
  const target = canonicalize(path);
  let best: RobotsRule | undefined;
  for (const rule of rules) {
    if (!patternToRegExp(rule.pattern).test(target)) continue;
    if (
      best === undefined ||
      canonicalize(rule.pattern).length > canonicalize(best.pattern).length ||
      (canonicalize(rule.pattern).length === canonicalize(best.pattern).length &&
        rule.type === "allow")
    ) {
      best = rule;
    }
  }
  return best;
}
