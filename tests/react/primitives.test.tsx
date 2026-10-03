/** Copy identity must survive fact changes, while captures preserve resolved values and audience. */
import { describe, expect, it } from "vitest";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { defineFacts, fact } from "../../src/core/index";
import { DocumentProvider, Fact, ForAgents, ForHumans, Section, T, Title, Visual, messageText, createCollector, finishDocument } from "../../src/react/index";
import { CaptureAnchor } from "../../src/react/document";

const facts = defineFacts({
  attempts: fact.number(8),
  events: fact.list(["sent", "received"]),
  price: fact.money(0.5, { per: "1,000 emails" }),
  label: fact.text("Available"),
});
declare module "../../src/core/index" {
  interface Register {
    facts: typeof facts;
  }
}

function capture(value: number, source = "page.tsx:4") {
  const collector = createCollector({
    path: "/features/email",
    site: "https://example.com",
    facts: { ...facts, attempts: fact.number(value) },
  });
  const html = renderToStaticMarkup(
    <DocumentProvider collector={collector}>
      <Section kind="hero" id="hero">
        <T source={source}>
          Try <strong>email</strong> with <Fact id="attempts" /> attempts.
        </T>
      </Section>
    </DocumentProvider>,
  );
  return finishDocument(collector, { title: "Email", description: "Send email" }, html);
}

describe("copy primitives", () => {
  it("renders deeply placed titles once and binds each to its nearest section or item", () => {
    function Layout() {
      return (
        <Section kind="cards" id="features">
          <header>
            <div>
              <h2 className="heading">
                <Title source="page.tsx:3">Features</Title>
              </h2>
            </div>
          </header>
          <Section.Item source="card.tsx:1">
            <div>
              <h3>
                <Title source="card.tsx:2">
                  Try <Fact id="attempts" /> attempts
                </Title>
              </h3>
            </div>
            <T>Body</T>
          </Section.Item>
        </Section>
      );
    }
    const ordinary = renderToStaticMarkup(<Layout />);
    const collector = createCollector({ path: "/features", site: "https://example.com", facts });
    const html = renderToStaticMarkup(
      <DocumentProvider collector={collector}>
        <Layout />
      </DocumentProvider>,
    );
    expect(html.replace(/<template data-copy-record="[^"]*"><\/template>/g, "")).toBe(ordinary);
    expect(ordinary).toBe(
      '<header><div><h2 class="heading">Features</h2></div></header><div><h3>Try 8 attempts</h3></div>Body',
    );
    const document = finishDocument(collector, { title: "Features", description: "Cards" }, html);
    expect(document.messages.map(({ text, source }) => [text, source])).toEqual([
      ["Features", "page.tsx:3"],
      ["Try 8 attempts", "card.tsx:2"],
      ["Body", "<inline>:1"],
    ]);
    expect(document.sections[0]?.title?.text).toBe("Features");
    expect(document.sections[0]?.body).toEqual([]);
    expect(document.sections[0]?.items[0]?.title?.text).toBe("Try 8 attempts");
    expect(document.sections[0]?.items[0]?.body).toHaveLength(1);
    expect(document.sections[0]?.items[0]?.cells.map(({ text }) => text)).toEqual([
      "Try 8 attempts",
      "Body",
    ]);
    expect(document.facts).toEqual(["attempts"]);
    expect(
      messageText(
        <Title>
          Try <Fact id="attempts" />
        </Title>,
      ),
    ).toBe("Try 8");
  });
  it.each([
    [
      "section prop",
      <Section key="section-prop" kind="prose" id="intro" title={<T>Prop</T>}>
        <Title>Visible</Title>
      </Section>,
      'Section "intro"',
    ],
    [
      "two section titles",
      <Section key="duplicate-section-titles" kind="prose" id="intro">
        <Title>First</Title>
        <Title>Second</Title>
      </Section>,
      'Section "intro"',
    ],
    [
      "item prop",
      <Section key="item-prop" kind="cards" id="cards">
        <Section.Item source="item.tsx:1" title={<T>Prop</T>}>
          <Title>Visible</Title>
        </Section.Item>
      </Section>,
      "Section.Item at item.tsx:1",
    ],
    [
      "two item titles",
      <Section key="duplicate-item-titles" kind="cards" id="cards">
        <Section.Item source="item.tsx:1">
          <Title>First</Title>
          <Title>Second</Title>
        </Section.Item>
      </Section>,
      "Section.Item at item.tsx:1",
    ],
  ])("rejects duplicate title ownership: %s", (_name, children, owner) => {
    const collector = createCollector({ path: "/duplicate", site: "https://example.com" });
    expect(() => {
      const html = renderToStaticMarkup(
        <DocumentProvider collector={collector}>{children}</DocumentProvider>,
      );
      finishDocument(collector, { title: "Duplicate", description: "Title ownership" }, html);
    }).toThrow(`Duplicate copy title for ${owner} on /duplicate`);
  });
  it("requires an enclosing section only during capture and rejects layout inside titles", () => {
    expect(
      renderToStaticMarkup(
        <h2>
          <Title>Standalone heading</Title>
        </h2>,
      ),
    ).toBe("<h2>Standalone heading</h2>");
    function captureInvalid(children: ReactNode) {
      const collector = createCollector({ path: "/orphan", site: "https://example.com" });
      const html = renderToStaticMarkup(
        <DocumentProvider collector={collector}>{children}</DocumentProvider>,
      );
      return finishDocument(collector, { title: "Invalid", description: "Invalid copy" }, html);
    }
    expect(() => captureInvalid(<Title>Orphan</Title>)).toThrow("Title outside Section on /orphan");
    expect(() =>
      captureInvalid(
        <Section kind="prose" id="intro">
          <Title>
            <div>Layout</div>
          </Title>
        </Section>,
      ),
    ).toThrow("found div");
    expect(() =>
      captureInvalid(
        <Section kind="prose" id="nested">
          <Title>
            <Title>Nested title</Title>
          </Title>
        </Section>,
      ),
    ).toThrow("found a component");
  });
  it("captures only a Visual's description without executing its children", () => {
    function Artifact(): never {
      throw new Error("Visual children must not execute during capture");
    }
    const collector = createCollector({ path: "/visual", site: "https://example.com" });
    const html = renderToStaticMarkup(
      <DocumentProvider collector={collector}>
        <Section kind="prose" id="intro">
          <Visual describe="Delivery diagram">
            <Artifact />
          </Visual>
          <Visual>
            <Artifact />
          </Visual>
        </Section>
      </DocumentProvider>,
    );
    expect(html.replace(/<template data-copy-record="[^"]*"><\/template>/g, "")).toBe("");
    const document = finishDocument(collector, { title: "Visual", description: "Diagram" }, html);
    expect(document.messages).toEqual([]);
    expect(document.sections[0]?.body).toEqual([
      { type: "visual", text: "Delivery diagram", source: "<inline>:1", audience: "all" },
    ]);
  });
  it("leaves layout and human children unchanged in ordinary HTML", () => {
    const html = renderToStaticMarkup(
      <Section kind="prose" id="intro" title={<T>Not an extra heading</T>}>
        <p>
          <T>
            <em>Email</em> costs <Fact id="price" />.
          </T>
        </p>
        <ForAgents>
          <T>Agent-only</T>
        </ForAgents>
        <ForHumans>
          <T>Human-only</T>
        </ForHumans>
        <Visual describe="Diagram">
          <b>Visible artifact</b>
        </Visual>
      </Section>,
    );
    expect(html).toBe(
      "<p><em>Email</em> costs $0.50 per 1,000 emails.</p>Human-only<b>Visible artifact</b>",
    );
  });
  it("extracts static text for head without executing a React component", () => {
    const answer = (
      <T>
        Use <code>send()</code>
        <br />
        <a href="/docs">docs</a> for <Fact id="events" list />.
      </T>
    );
    expect(messageText(answer)).toBe("Use send()\ndocs for sent and received.");
    expect(
      messageText(answer, {
        format: "markdown",
        site: "https://example.com",
        path: "/features/email",
      }),
    ).toBe("Use `send()`  \n[docs](https://example.com/docs) for sent and received.");
    function Computed(): never {
      throw new Error("must not execute");
    }
    expect(() =>
      messageText(
        <T>
          <Computed />
        </T>,
      ),
    ).toThrow("found a component");
  });
  it("normalizes copy link destinations and rejects unsafe protocols", () => {
    expect(() =>
      messageText(
        <T>
          <a>Label</a>
        </T>,
        { format: "markdown" },
      ),
    ).toThrow("An anchor in T needs a string href");
    expect(
      messageText(
        <T>
          <a href={"/docs(a)\\b\n"}>docs</a>
        </T>,
        {
          format: "markdown",
          site: "https://example.com",
        },
      ),
    ).toBe("[docs](https://example.com/docs%28a%29%5Cb%0A)");
    expect(() =>
      messageText(
        <T>
          {/* oxlint-disable-next-line react/jsx-no-script-url -- This negative test proves unsafe links are rejected. */}
          <a href="javascript:alert(1)">bad</a>
        </T>,
      ),
    ).toThrow('Unsafe copy link protocol "javascript:"');
    expect(() =>
      renderToStaticMarkup(
        <DocumentProvider collector={createCollector({ path: "/", site: "https://example.com" })}>
          <CaptureAnchor href="data:text/html,bad">bad</CaptureAnchor>
        </DocumentProvider>,
      ),
    ).toThrow('Unsafe copy link protocol "data:"');
    expect(
      messageText(
        <T>
          <a href="mailto:support@example.com">email</a>
        </T>,
        { format: "markdown" },
      ),
    ).toBe("[email](mailto:support@example.com)");
    expect(
      messageText(
        <T>
          <a href="tel:+18005550123">call</a>
        </T>,
        { format: "markdown" },
      ),
    ).toBe("[call](tel:+18005550123)");
    expect(
      messageText(
        <T>
          <a href="https://docs.example.com/start">guide</a>
        </T>,
        { format: "markdown" },
      ),
    ).toBe("[guide](https://docs.example.com/start)");
  });
  it("hashes authored structure rather than resolved facts or source positions", () => {
    const first = capture(8);
    const changedFact = capture(9);
    const movedSource = capture(8, "elsewhere.tsx:30");
    expect(first.messages[0]?.hash).toMatch(/^[a-f0-9]{16}$/);
    expect(first.messages[0]?.hash).toBe(changedFact.messages[0]?.hash);
    expect(first.hash).not.toBe(changedFact.hash);
    expect(first.hash).toBe(movedSource.hash);
    expect(first.messages[0]?.tree).toContainEqual({ fact: "attempts", text: "8" });
    expect(first.facts).toEqual(["attempts"]);
    expect(first.messages[0]?.text).toBe("Try email with 8 attempts.");
  });
  it("records composed items, visual descriptions and both audiences in order", () => {
    const collector = createCollector({ path: "/", site: "https://example.com", facts });
    function Card() {
      return (
        <Section.Item title={<T source="card.tsx:1">Events</T>}>
          <T source="card.tsx:2">
            <Fact id="events" list /> reach your app.
          </T>
        </Section.Item>
      );
    }
    const html = renderToStaticMarkup(
      <DocumentProvider collector={collector}>
        <Section kind="cards" id="cards" title={<T source="page.tsx:1">Features</T>}>
          <Card />
          <Visual describe="Event diagram" source="page.tsx:5">
            <T>This artifact is not copy</T>
          </Visual>
          <ForHumans>
            <T>Scroll down</T>
          </ForHumans>
        </Section>
        <ForAgents>
          <T>Agent guide</T>
        </ForAgents>
      </DocumentProvider>,
    );
    const document = finishDocument(collector, { title: "Features", description: "Product" }, html);
    expect(document.messages.map((message) => [message.text, message.audience])).toEqual([
      ["Features", "all"],
      ["Events", "all"],
      ["sent and received reach your app.", "all"],
      ["Scroll down", "humans"],
      ["Agent guide", "agents"],
    ]);
    expect(document.sections.map((section) => section.kind)).toEqual(["cards", "for-agents"]);
    expect(document.sections[0]?.items[0]?.title?.source).toBe("card.tsx:1");
    expect(document.sections[0]?.body[0]).toEqual({
      type: "visual",
      text: "Event diagram",
      source: "page.tsx:5",
      audience: "all",
    });
  });
  it("rejects missing facts, layout inside T and captures without a Section", () => {
    expect(() =>
      messageText(
        <T>
          <div>Layout</div>
        </T>,
      ),
    ).toThrow("found div");
    expect(() =>
      messageText(
        <T>
          <Fact id="attempts" />
        </T>,
        { facts: {} },
      ),
    ).toThrow('Unknown copy fact "attempts"');
    const collector = createCollector({ path: "/broken", site: "https://example.com" });
    const html = renderToStaticMarkup(
      <DocumentProvider collector={collector}>
        <ForAgents>
          <T>Not a section</T>
        </ForAgents>
      </DocumentProvider>,
    );
    expect(() =>
      finishDocument(collector, { title: "Broken", description: "Missing" }, html),
    ).toThrow("Copy page /broken recorded no <Section>");
  });
  it("accepts a real custom Section kind with a for- prefix", () => {
    const collector = createCollector({ path: "/partners", site: "https://example.com" });
    const html = renderToStaticMarkup(
      <DocumentProvider collector={collector}>
        <Section kind="for-partners" id="partners">
          <T>Partner content</T>
        </Section>
      </DocumentProvider>,
    );
    expect(
      finishDocument(collector, { title: "Partners", description: "For partners" }, html).sections,
    ).toHaveLength(1);
  });
});

// @ts-expect-error Registered fact ids reject typos.
const typo = <Fact id="attemps" />;
void typo;

it("captures Section evidence without changing ordinary HTML", () => {
  const content = (evidence?: boolean) => (
    <Section kind="prose" id="sources" {...(evidence === undefined ? {} : { evidence })}>
      <p>
        <T>Primary pricing source.</T>
      </p>
    </Section>
  );
  expect(renderToStaticMarkup(<DocumentProvider>{content(true)}</DocumentProvider>)).toBe(
    renderToStaticMarkup(<DocumentProvider>{content()}</DocumentProvider>),
  );
  const collector = createCollector({ path: "/compare/example", site: "https://example.com" });
  const html = renderToStaticMarkup(
    <DocumentProvider collector={collector}>{content(true)}</DocumentProvider>,
  );
  const document = finishDocument(collector, { title: "Compare", description: "Compare" }, html);
  expect(document.sections[0]?.evidence).toBe(true);
});
