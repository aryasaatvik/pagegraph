import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { launchDir } from "../scripts/projects";
import { film } from "../src/cuts";
import { tagline } from "../src/scenes/reveal/markup";
import {
  authoredSection,
  checkReport,
  dedent,
  install,
  llmsEntry,
  markdownTwin,
  pricingHead,
  pricingRoute,
  pricingSitemap,
  repositoryUrl,
} from "../src/scenes/source";

const transcript = readFileSync(join(launchDir, "TRANSCRIPT.md"), "utf8");
const script = readFileSync(join(launchDir, "SCRIPT.md"), "utf8");

/** The text alternative must say what the film shows, not an older cut. */
describe("transcript and script follow the film", () => {
  test("code and output appear in the transcript as shown on screen", () => {
    for (const text of [
      pricingRoute.code,
      dedent(authoredSection.code),
      markdownTwin.join("\n"),
      llmsEntry,
      checkReport.structural,
      checkReport.trimmed,
      checkReport.summary,
      ...pricingSitemap,
      ...pricingHead.map((row) => row.value),
      ...tagline,
      install,
      repositoryUrl,
    ])
      expect(transcript).toContain(text);
  });

  test("section timestamps match the beats", () => {
    const stamps = [...transcript.matchAll(/^## (\d+):(\d{2}) /gm)].map(
      ([, minutes, seconds]) => Number(minutes) * 60 + Number(seconds),
    );
    expect(stamps).toEqual(film.shots.map((shot) => shot.start));
  });

  test("script beat ranges match the beats", () => {
    const ranges = [...script.matchAll(/^\| (\d+)–(\d+)s +\|/gm)].map(([, from, to]) => [
      Number(from),
      Number(to),
    ]);
    expect(ranges).toEqual(film.shots.map((shot) => [shot.start, shot.start + shot.duration]));
  });
});
