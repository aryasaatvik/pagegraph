import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { defineSectionKind, documentMarkdown } from "../../src/core/index";
import {
  DocumentProvider, ForAgents, ForHumans, Section, T, Visual, createCollector, finishDocument,
} from "../../src/react/index";

it("writes implicit all-audience sections alongside explicit sections in replay order", () => {
  const collector = createCollector({ path: "/guide", site: "https://example.com" });
  const html = renderToStaticMarkup(
    <DocumentProvider collector={collector}>
      <T>Introduction.</T>
      <Visual describe="Overview diagram." />
      <Section kind="prose" id="details"><T>Details.</T></Section>
      <ForHumans><T>Human hint.</T></ForHumans>
      <T>Closing note.</T>
      <ForAgents><T>Agent hint.</T></ForAgents>
    </DocumentProvider>,
  );
  const document = finishDocument(collector, { title: "Guide", description: "Guide" }, html);
  expect(document.sections.map(({ kind }) => kind)).toEqual([
    "for-all", "prose", "for-humans", "for-all", "for-agents",
  ]);
  expect(documentMarkdown(document, "https://example.com")).toBe(
    "# Guide\n\nURL: https://example.com/guide\n\nIntroduction.\n\nOverview diagram.\n\nDetails.\n\nClosing note.\n\nAgent hint.\n",
  );
});

it("reserves the implicit all-audience kind alongside the other built-in audience kinds", () => {
  expect(() => defineSectionKind({ kind: "for-all", markdown: () => "Hijacked" }))
    .toThrow('Cannot redefine document section kind "for-all"');
});
