/** Twins must preserve section meaning without copying presentation or human-only hints. */
import { describe, expect, it } from "vitest";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { BodyEntry, SectionDocument } from "../../src/markdown/document";
import { DocumentProvider, ForAgents, ForHumans, Section, T, Title, Visual, createCollector, finishDocument } from "../../src/react/document";
import { appendLlmsSection, defineSectionKind, documentMarkdown, llmsMarkdown, sectionMarkdown } from "../../src/markdown/index";

const custom = defineSectionKind({
  kind: "cost-table",
  markdown: (section, md) =>
    md.heading(2, section.title) + md.table(section.items.map((row) => row.cells)),
});
const privateProbe = defineSectionKind({
  kind: "private-probe",
  markdown: (section) => {
    const body = (entries: ReadonlyArray<BodyEntry>) =>
      entries
        .map((entry) => (entry.type === "message" ? entry.message.text : entry.text))
        .join("|");
    return [
      section.claimsMarkdown,
      section.title?.text,
      body(section.body),
      ...section.items.flatMap((item) => [
        item.title?.text,
        body(item.body),
        ...item.cells.map((cell) => cell.text),
      ]),
    ]
      .filter(Boolean)
      .join("|");
  },
});
const customHeading = defineSectionKind({
  kind: "heading-probe",
  markdown: (section, md) => md.heading(4, section.title),
});
function renderedMarkdown(children: ReactNode): string {
  const collector = createCollector({ path: "/guide", site: "https://example.com" });
  const html = renderToStaticMarkup(<DocumentProvider collector={collector}>{children}</DocumentProvider>);
  return documentMarkdown(
    finishDocument(collector, { title: "Guide", description: "Guide copy" }, html),
    "https://example.com",
  );
}
const emphasizedTitle = (
  <T>
    <em>
      Send <strong>email</strong>
    </em>{" "}
    <strong>
      with <em>confidence</em>
    </strong>{" "}
    <a href="/reference">
      <strong>
        <em>using</em> <code>send()</code>
      </strong>
    </a>
  </T>
);
const titleMarkdown = "Send email with confidence [using `send()`](https://example.com/reference)";
function page() {
  const collector = createCollector({ path: "/solutions/saas", site: "https://example.com" });
  const html = renderToStaticMarkup(
    <DocumentProvider collector={collector}>
      <Section kind="hero" id="hero">
        <Title>
          Email, <em>in one call.</em>
        </Title>
        <T>Use your domain.</T>
        <Visual describe="A delivery diagram">
          <div>Presentation</div>
        </Visual>
      </Section>
      <Section kind="prose" id="prose" title={<T>Overview</T>}>
        <T>Product overview.</T>
      </Section>
      <Section kind="steps" id="steps" title={<T>Setup</T>}>
        <Section.Item>
          <h3>
            <Title>Verify</Title>
          </h3>
          <T>Add a domain.</T>
        </Section.Item>
      </Section>
      <Section kind="cards" id="cards" title={<T>Features</T>}>
        <Section.Item title={<T>Events</T>}>
          <T>Receive delivery events.</T>
        </Section.Item>
      </Section>
      <Section kind="faq" id="faq" title={<T>Questions</T>}>
        <Section.Item title={<T>Can I move?</T>}>
          <T>Yes.</T>
        </Section.Item>
      </Section>
      <Section kind="table" id="table">
        <Section.Item title={<T>Plan</T>}>
          <T>Price</T>
        </Section.Item>
        <Section.Item title={<T>Free</T>}>
          <T>$0</T>
        </Section.Item>
      </Section>
      <Section kind="code" id="code" language="ts">
        <T>
          <code>{'send("hello")'}</code>
        </T>
      </Section>
      <Section kind="cta" id="cta">
        <T>
          <a href="../../signup">Start</a>
        </T>
      </Section>
      <Section kind={custom} id="custom" title={<T>Costs</T>}>
        <Section.Item title={<T>Item</T>}>
          <T>Cost</T>
        </Section.Item>
      </Section>
      <ForAgents>
        <T>Read the API guide.</T>
      </ForAgents>
      <ForHumans>
        <T>Scroll to compare.</T>
      </ForHumans>
    </DocumentProvider>,
  );
  return finishDocument(
    collector,
    { title: "Email for SaaS", description: "Send product email." },
    html,
  );
}

describe("markdown twins", () => {
  const linkedDocument = (href: string): SectionDocument => ({
    kind: "cards",
    id: "linked-document",
    body: [],
    source: "document.json:1",
    audience: "all",
    items: [
      {
        href,
        title: {
          hash: "title",
          tree: ["Reference"],
          text: "Reference",
          source: "document.json:2",
          facts: [],
          audience: "all",
        },
        body: [],
        cells: [],
        source: "document.json:2",
        audience: "all",
      },
    ],
  });
  it("escapes linked card destinations from serialized documents", () => {
    expect(sectionMarkdown(linkedDocument("https://example.com/reference(v2)"))).toBe(
      "- [Reference](https://example.com/reference%28v2%29)\n\n",
    );
  });
  it("rejects unsafe linked card destinations from serialized documents", () => {
    expect(() => sectionMarkdown(linkedDocument("javascript:alert(1)"))).toThrow(
      'Unsafe copy link protocol "javascript:"',
    );
  });
  it("renders linked cards with one outer link while retaining code and body emphasis", () => {
    expect(
      renderedMarkdown(
        <Section kind="cards" id="linked">
          <Section.Item
            title={
              <T>
                <strong>
                  <em>Read</em>{" "}
                  <a href="/reference">
                    <em>
                      <code>send()</code>
                    </em>
                  </a>
                </strong>
              </T>
            }
          >
            <Section.Item.Link href="/reference">
              <T>
                Read the <em>API guide</em>.
              </T>
            </Section.Item.Link>
          </Section.Item>
        </Section>,
      ),
    ).toContain("- [Read `send()`](https://example.com/reference): Read the *API guide*.");
  });
  it("rejects linked card titles with a different inline destination", () => {
    expect(() =>
      renderedMarkdown(
        <Section kind="cards" id="linked">
          <Section.Item
            source="cards.tsx:12"
            title={
              <T>
                <em>
                  <a href="/pricing">Price</a>
                </em>
              </T>
            }
          >
            <Section.Item.Link href="/reference">
              <T>Read the guide.</T>
            </Section.Item.Link>
          </Section.Item>
        </Section>,
      ),
    ).toThrow(
      'Linked item in section "linked" at cards.tsx:12 targets "https://example.com/reference" but its title links to "https://example.com/pricing"',
    );
  });
  it.each([undefined, <T key="blank"> </T>])(
    "rejects linked cards without a visible title",
    (title) => {
      expect(() =>
        renderedMarkdown(
          <Section kind="cards" id="linked">
            <Section.Item source="cards.tsx:12" title={title}>
              <Section.Item.Link href="/reference">
                <T>Read the guide.</T>
              </Section.Item.Link>
            </Section.Item>
          </Section>,
        ),
      ).toThrow(
        'Linked item in section "linked" at cards.tsx:12 targeting "https://example.com/reference" needs a visible title',
      );
    },
  );
  it("rejects linked cards whose title is only visible to humans", () => {
    expect(() =>
      renderedMarkdown(
        <Section kind="cards" id="linked">
          <Section.Item source="cards.tsx:12">
            <Section.Item.Link href="/reference">
              <ForHumans>
                <Title>Private title</Title>
              </ForHumans>
              <T>Read the guide.</T>
            </Section.Item.Link>
          </Section.Item>
        </Section>,
      ),
    ).toThrow(
      'Linked item in section "linked" at cards.tsx:12 targeting "https://example.com/reference" needs a visible title',
    );
  });
  it.each([
    ["hero", "#"],
    ["prose", "##"],
    ["faq", "##"],
    [customHeading, "####"],
  ] as const)(
    "removes nested emphasis from %s headings authored with title props",
    (kind, prefix) => {
      const text = renderedMarkdown(
        <Section kind={kind} id="heading" title={<T>{emphasizedTitle}</T>}>
          <T>Body.</T>
        </Section>,
      );
      expect(text).toContain(`${prefix} ${titleMarkdown}\n`);
      expect(text).not.toContain("*email*");
    },
  );
  it.each([
    ["hero", "#"],
    ["prose", "##"],
    ["faq", "##"],
    [customHeading, "####"],
  ] as const)("removes nested emphasis from %s Title headings", (kind, prefix) => {
    const text = renderedMarkdown(
      <Section kind={kind} id="heading">
        <Title>{emphasizedTitle}</Title>
        <T>Body.</T>
      </Section>,
    );
    expect(text).toContain(`${prefix} ${titleMarkdown}\n`);
  });
  it("removes emphasis from FAQ question headings", () => {
    expect(
      renderedMarkdown(
        <Section kind="faq" id="questions">
          <Section.Item title={<T>{emphasizedTitle}</T>}>
            <T>Answer.</T>
          </Section.Item>
          <Section.Item>
            <Title>{emphasizedTitle}</Title>
            <T>Another answer.</T>
          </Section.Item>
        </Section>,
      ),
    ).toContain(`### ${titleMarkdown}\n\nAnswer.\n\n### ${titleMarkdown}\n\nAnother answer.`);
  });
  it.each([
    ["steps", "1.", ""],
    ["cards", "-", ":"],
  ] as const)(
    "keeps a single bold wrapper on %s labels and body emphasis intact",
    (kind, prefix, suffix) => {
      expect(
        renderedMarkdown(
          <Section kind={kind} id="items">
            <Section.Item title={<T>{emphasizedTitle}</T>}>
              <T>
                Keep <em>body emphasis</em> and <strong>body weight</strong>.
              </T>
            </Section.Item>
            <Section.Item>
              <Title>{emphasizedTitle}</Title>
              <T>Another body.</T>
            </Section.Item>
          </Section>,
        ),
      ).toContain(
        `${prefix} **${titleMarkdown}**${suffix} Keep *body emphasis* and **body weight**.\n${kind === "steps" ? "2." : "-"} **${titleMarkdown}**${suffix} Another body.`,
      );
    },
  );
  it("serializes every built-in kind and custom rows with absolute links", () => {
    expect(documentMarkdown(page(), "https://example.com")).toBe(
      `# Email, in one call.\n\nURL: https://example.com/solutions/saas\n\nUse your domain.\n\nA delivery diagram\n\n## Overview\n\nProduct overview.\n\n## Setup\n\n1. **Verify** Add a domain.\n\n## Features\n\n- **Events**: Receive delivery events.\n\n## Questions\n\n### Can I move?\n\nYes.\n\n| Plan | Price |\n| --- | --- |\n| Free | $0 |\n\n\`\`\`ts\nsend("hello")\n\`\`\`\n\n[Start](https://example.com/signup)\n\n## Costs\n\n| Item | Cost |\n| --- | --- |\n\nRead the API guide.\n`,
    );
  });
  it("filters all human-only fields and private claim markdown from public custom serializers", () => {
    const collector = createCollector({ path: "/probe", site: "https://example.com" });
    const html = renderToStaticMarkup(
      <DocumentProvider collector={collector}>
        <Section kind={privateProbe} id="probe">
          <T>Public body</T>
          <Visual describe="Public visual" />
          <ForHumans>
            <T>Human body</T>
            <Visual describe="Human visual" />
          </ForHumans>
          <Section.Item>
            <T>Public cell</T>
            <ForHumans>
              <T>Human cell</T>
            </ForHumans>
          </Section.Item>
        </Section>
      </DocumentProvider>,
    );
    const document = finishDocument(collector, { title: "Probe", description: "Privacy" }, html);
    const sourceSection = document.sections[0];
    if (sourceSection === undefined) throw new Error("Probe section was not captured");
    const withPrivateClaim = {
      ...document,
      sections: [{ ...sourceSection, claimsMarkdown: "Private claim text" }],
    };
    const section = withPrivateClaim.sections[0];
    if (section === undefined) throw new Error("Probe section was not copied");
    expect(sectionMarkdown(section)).toBe("Public body|Public visual|Public cell|Public cell");
    expect(sectionMarkdown(section, { includeHumans: true })).toContain(
      "Human body|Human visual|Public cell|Human cell",
    );
  });
  it("retains existing llms content and replaces generated sections idempotently", () => {
    const document = page();
    const text = llmsMarkdown([{ document }], "https://example.com");
    expect(text).toBe(
      "## Solutions\n\n- [Email for SaaS](https://example.com/solutions/saas.md): Send product email.\n",
    );
    const first = appendLlmsSection(
      "# Site\n\nExisting docs.\n",
      [{ document }],
      "https://example.com",
    );
    expect(appendLlmsSection(first, [{ document }], "https://example.com")).toBe(first);
    const override = appendLlmsSection(
      first,
      [{ document, llms: "Guides" }],
      "https://example.com",
    );
    expect(override).toContain("# Site\n\nExisting docs.");
    expect(override).toContain("## Guides");
    expect(override).not.toContain("## Solutions");
  });
});

describe("card descriptions", () => {
  it("omits the separator for a linked card without a description", () => {
    const markdown = renderedMarkdown(
      <Section kind="cards" id="links">
        <Title>Links</Title>
        <Section.Item>
          <Section.Item.Link href="/pricing">
            <Title>Pricing</Title>
          </Section.Item.Link>
        </Section.Item>
        <Section.Item>
          <Section.Item.Link href="/docs">
            <Title>Docs</Title>
            <T>Read the guide.</T>
          </Section.Item.Link>
        </Section.Item>
      </Section>,
    );
    expect(markdown).toContain("- [Pricing](https://example.com/pricing)\n");
    expect(markdown).toContain("- [Docs](https://example.com/docs): Read the guide.");
    expect(markdown).not.toContain("[Pricing](https://example.com/pricing):");
  });
});
