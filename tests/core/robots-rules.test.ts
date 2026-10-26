import { describe, expect, it } from "vitest";

import { decidingRule, parseWildcardRules } from "../../src/core/robots-rules";

const verdict = (robots: string, path: string) =>
  decidingRule(parseWildcardRules(robots), path)?.type ?? "none";

describe("robots matcher", () => {
  it("matches by prefix", () => {
    const robots = "User-agent: *\nDisallow: /s\n";
    expect(verdict(robots, "/s")).toBe("disallow");
    expect(verdict(robots, "/s/form")).toBe("disallow");
    expect(verdict(robots, "/solutions")).toBe("disallow");
    expect(verdict(robots, "/pricing")).toBe("none");
  });

  it("stops a trailing-slash prefix at the segment boundary", () => {
    const robots = "User-agent: *\nDisallow: /s/\n";
    expect(verdict(robots, "/s/form")).toBe("disallow");
    expect(verdict(robots, "/solutions")).toBe("none");
    expect(verdict(robots, "/sitemap.xml")).toBe("none");
  });

  it("lets the longest match win and Allow win a tie", () => {
    const robots =
      "User-agent: *\nAllow: /\nDisallow: /app\nAllow: /app/public\nDisallow: /x\nAllow: /x\n";
    expect(verdict(robots, "/app/private")).toBe("disallow");
    expect(verdict(robots, "/app/public/a")).toBe("allow");
    expect(verdict(robots, "/x")).toBe("allow");
    expect(verdict(robots, "/other")).toBe("allow");
  });

  it("supports * and the $ end anchor", () => {
    const robots = "User-agent: *\nDisallow: /*.pdf$\nDisallow: /a*/private\n";
    expect(verdict(robots, "/files/report.pdf")).toBe("disallow");
    expect(verdict(robots, "/files/report.pdf.html")).toBe("none");
    expect(verdict(robots, "/abc/private/x")).toBe("disallow");
    expect(verdict(robots, "/b/private")).toBe("none");
  });

  it("reads only groups that name *, ignores comments and empty Disallow", () => {
    const robots =
      "User-agent: Googlebot\nDisallow: /g\n\nUser-agent: bing\nUser-agent: *\nDisallow: /w # note\nDisallow:\n";
    expect(verdict(robots, "/g")).toBe("none");
    expect(verdict(robots, "/w/x")).toBe("disallow");
    expect(verdict(robots, "/")).toBe("none");
  });
});
