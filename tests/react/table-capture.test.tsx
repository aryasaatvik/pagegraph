import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { documentMarkdown } from "../../src/core/index";
import {
  DocumentProvider, ForAgents, ForHumans, Section, T, createCollector, finishDocument,
} from "../../src/react/index";

function capture(children: ReactNode) {
  const collector = createCollector({ path: "/plans", site: "https://example.com" });
  const html = renderToStaticMarkup(<DocumentProvider collector={collector}>{children}</DocumentProvider>);
  return finishDocument(collector, { title: "Plans", description: "Plan comparison" }, html);
}

const invalidTable = (
  <Section kind="table" id="plans">
    <Section.Item source="plans.tsx:10"><T>Plan</T><T>Price</T></Section.Item>
    <Section.Item source="plans.tsx:20">
      <T>Free</T><ForHumans><T>Private price</T></ForHumans>
    </Section.Item>
  </Section>
);

describe("table authoring at capture", () => {
  it("rejects unequal visible widths before returning a document", () => {
    expect(() => capture(invalidTable)).toThrow(
      'Table Section "plans" on /plans needs equal, nonempty visible cell counts after excluding ForHumans; row at plans.tsx:20 has 1, expected 2',
    );
  });

  it("rejects rows with no visible cells", () => {
    expect(() => capture(
      <Section kind="table" id="empty">
        <Section.Item source="plans.tsx:30"><ForHumans><T>Private</T></ForHumans></Section.Item>
      </Section>,
    )).toThrow('Table Section "empty" on /plans needs equal, nonempty visible cell counts after excluding ForHumans');
  });

  it("accepts different human cell counts when visible rows remain rectangular", () => {
    const document = capture(
      <Section kind="table" id="plans">
        <Section.Item><T>Plan</T><T>Price</T><ForHumans><T>Private header</T></ForHumans></Section.Item>
        <Section.Item><T>Free</T><ForAgents><T>$0</T></ForAgents></Section.Item>
        <ForHumans><Section.Item><T>Private row</T></Section.Item></ForHumans>
      </Section>,
    );
    expect(documentMarkdown(document, "https://example.com")).toContain(
      "| Plan | Price |\n| --- | --- |\n| Free | $0 |",
    );
    expect(documentMarkdown(document, "https://example.com")).not.toContain("Private");
  });

  it("ignores human-only tables that never enter the public twin", () => {
    const document = capture(<ForHumans>{invalidTable}</ForHumans>);
    expect(documentMarkdown(document, "https://example.com")).toBe(
      "# Plans\n\nURL: https://example.com/plans\n",
    );
  });

  it("ignores an abandoned invalid table render when replaying completed output", () => {
    const collector = createCollector({ path: "/plans", site: "https://example.com" });
    renderToStaticMarkup(<DocumentProvider collector={collector}>{invalidTable}</DocumentProvider>, { identifierPrefix: "abandoned" });
    const html = renderToStaticMarkup(
      <DocumentProvider collector={collector}>
        <Section kind="table" id="plans"><Section.Item><T>Plan</T><T>Price</T></Section.Item></Section>
      </DocumentProvider>,
      { identifierPrefix: "completed" },
    );
    const document = finishDocument(collector, { title: "Plans", description: "Plans" }, html);
    expect(documentMarkdown(document, "https://example.com")).toContain("| Plan | Price |\n| --- | --- |");
  });
});
