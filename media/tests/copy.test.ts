import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repository } from "../scripts/projects";
import { visibleStrings } from "../scripts/strings";
import { buildEntries, runtimeEntries } from "../src/scenes/runtime-still/markup";

describe("claim audit", () => {
  const strings = [...visibleStrings().values()].flat();
  const copy = strings.join("\n");

  test("no ranking, speed, adoption, universality, or drift-free claims", () => {
    for (const phrase of [
      /\bguarantee/i,
      /\bboost/i,
      /\bfast(?:er|est)?\b/i,
      /\bblazing\b/i,
      /\bproduction[- ]ready\b/i,
      /\bdownloads?\b/i,
      /\btrusted by\b/i,
      /\bzero[- ]config/i,
      /\bnothing drifts\b/i,
      /\bnever (?:drift|break)/i,
      /\b(?:any|every|all) frameworks?\b/i,
      /\buniversal\b/i,
      /\bautomatic(?:ally)?\b/i,
    ]) {
      expect({ phrase: phrase.source, found: phrase.test(copy) }).toEqual({
        phrase: phrase.source,
        found: false,
      });
    }
  });

  test("rankings appear only as a denial", () => {
    for (const line of strings.filter((text) => /rank/i.test(text)))
      expect(line).toMatch(/\bnone of them measures search rankings\b/i);
  });

  test("opt-in gates say so", () => {
    for (const line of strings.filter((text) => /enforceCoverageIn|claims replays/.test(text)))
      expect(line).toMatch(/^(?:Opt in: |With routeConfig\.enforceCoverageIn, )/);
  });

  test("every visible character is in both bundled fonts", () => {
    // Bricolage Grotesque and Spline Sans Mono (latin subsets) lack arrows, check marks, and
    // crosses; those are drawn as SVG. Anything else outside this set would fall back to a system font.
    const missing = [...new Set(copy.replace(/[\n\x20-\x7e—·]/g, ""))];
    expect(missing).toEqual([]);
  });
});

describe("package entries", () => {
  const pkg = JSON.parse(readFileSync(join(repository, "package.json"), "utf8")) as {
    name: string;
    bin: Record<string, string>;
    exports: Record<string, Record<string, string>>;
  };
  const entry = (key: string) => (key === "." ? pkg.name : `${pkg.name}${key.slice(1)}`);
  const exports = Object.entries(pkg.exports);

  test("runtime entries are exactly the exports without a build-only stub", () => {
    expect(runtimeEntries.map((item): string => item.entry).toSorted()).toEqual(
      exports
        .filter(([, conditions]) => conditions["workerd"] === undefined)
        .map(([key]) => entry(key))
        .toSorted(),
    );
  });

  test("build entries are exactly the stubbed exports, plus the bin", () => {
    const stubbed = exports.filter(
      ([, conditions]) =>
        conditions["workerd"] !== undefined &&
        conditions["workerd"] === conditions["worker"] &&
        conditions["worker"] === conditions["browser"] &&
        conditions["browser"]?.includes("/build-only/"),
    );
    expect(stubbed).toHaveLength(
      exports.filter(([, conditions]) => conditions["workerd"] !== undefined).length,
    );
    expect(buildEntries.map((item): string => item.entry).toSorted()).toEqual(
      [...stubbed.map(([key]) => entry(key)), `${Object.keys(pkg.bin)[0]} (bin)`].toSorted(),
    );
  });
});
