import { describe, expect, it } from "vitest";
import {
  RouterContextProvider,
  createLink,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { createRef } from "react";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { hashDocument } from "../../src/core/index";
import { documentMarkdown } from "../../src/core/index";
import { DocumentProvider, ForHumans, Section, T, Title, createCollector, finishDocument } from "../../src/react/index";
import { CaptureAnchor } from "../../src/react/document";

const CardLink = createLink(Section.Item.Link);
const InlineLink = createLink(CaptureAnchor);

function captureRendered(children: ReactNode, path = "/solutions/saas") {
  const collector = createCollector({ path, site: "https://example.com" });
  const router = createRouter({
    routeTree: createRootRoute(),
    history: createMemoryHistory({ initialEntries: [path] }),
    isServer: true,
  });
  const html = renderToStaticMarkup(
    <RouterContextProvider router={router}>
      <DocumentProvider collector={collector}>
        <Section kind="cards" id="links">
          {children}
        </Section>
      </DocumentProvider>
    </RouterContextProvider>,
  );
  return {
    html,
    document: finishDocument(
      collector,
      { title: "More guides", description: "Related pages" },
      html,
    ),
  };
}
function capture(children: ReactNode) {
  return captureRendered(children).document;
}

describe("linked items", () => {
  it("records the native whole-card anchor destination with its styled heading in place", () => {
    const { html, document } = captureRendered(
      <Section.Item>
        <Section.Item.Link href="../email">
          <div>
            <h3>
              <Title>
                Send <strong>email</strong> with <code>send()</code>
              </Title>
            </h3>
          </div>
          <p>
            <T>Read the guide.</T>
          </p>
        </Section.Item.Link>
      </Section.Item>,
    );
    expect(html).toContain('<a href="../email">');
    expect(document.sections[0]?.items[0]?.href).toBe("https://example.com/email");
    expect(documentMarkdown(document, "https://example.com")).toContain(
      "- [Send email with `send()`](https://example.com/email): Read the guide.",
    );
    const { hash, ...content } = document;
    expect(hashDocument(content)).toBe(hash);
  });
  it("renders ordinary anchor attributes and accepts native ref and event props", () => {
    const html = renderToStaticMarkup(
      <Section.Item>
        <Section.Item.Link
          href="/email"
          className="guide-card"
          aria-label="Open email guide"
          target="_blank"
          rel="noreferrer"
          download="guide.html"
          ref={createRef<HTMLAnchorElement>()}
          onClick={(event) => event.currentTarget.focus()}
        >
          <h3>
            <Title>Email guide</Title>
          </h3>
          <T>Read it.</T>
        </Section.Item.Link>
      </Section.Item>,
    );
    expect(html).toBe(
      '<a href="/email" class="guide-card" aria-label="Open email guide" target="_blank" rel="noreferrer" download="guide.html"><h3>Email guide</h3>Read it.</a>',
    );
  });
  it("updates the rendered destination, recorded URL and document hash when the link changes", () => {
    const card = (href: string) => (
      <Section.Item>
        <Section.Item.Link href={href}>
          <Title>Email guide</Title>
          <T>Read it.</T>
        </Section.Item.Link>
      </Section.Item>
    );
    const first = captureRendered(card("/email"));
    const second = captureRendered(card("/other"));
    expect(first.html).toContain('href="/email"');
    expect(second.html).toContain('href="/other"');
    expect(first.document.sections[0]?.items[0]?.href).toBe("https://example.com/email");
    expect(second.document.sections[0]?.items[0]?.href).toBe("https://example.com/other");
    expect(second.document.hash).not.toBe(first.document.hash);
    expect(documentMarkdown(second.document, "https://example.com")).toContain(
      "- [Email guide](https://example.com/other): Read it.",
    );
  });
  it("captures TanStack params, search and hash from the resolved anchor", () => {
    const { html, document } = captureRendered(
      <Section.Item>
        <CardLink to="/guides/$id" params={{ id: "email" }} search={{ q: "x" }} hash="more">
          <h3>
            <Title>Email guide</Title>
          </h3>
          <T>Read the guide.</T>
        </CardLink>
      </Section.Item>,
    );
    expect(html).toContain('href="/guides/email?q=x#more"');
    expect(document.sections[0]?.items[0]?.href).toBe("https://example.com/guides/email?q=x#more");
    expect(documentMarkdown(document, "https://example.com")).toContain(
      "- [Email guide](https://example.com/guides/email?q=x#more): Read the guide.",
    );
    expect(document.messages.map((message) => message.tree)).toEqual([
      ["Email guide"],
      ["Read the guide."],
    ]);
  });
  it("uses TanStack relative resolution against the supplied from location", () => {
    const { html, document } = captureRendered(
      <Section.Item>
        <CardLink from="/guides/current" to="../email" search={{ q: "x" }} hash="more">
          <Title>Email guide</Title>
          <T>Read it.</T>
        </CardLink>
      </Section.Item>,
    );
    expect(html).toContain('href="/guides/email?q=x#more"');
    expect(document.sections[0]?.items[0]?.href).toBe("https://example.com/guides/email?q=x#more");
  });
  it("flattens a matching title anchor instead of nesting Markdown links", () => {
    const document = capture(
      <Section.Item
        title={
          <T>
            <a href="../email">
              <em>Email</em> <code>guide</code>
            </a>
          </T>
        }
      >
        <Section.Item.Link href="../email">
          <T>Read it.</T>
        </Section.Item.Link>
      </Section.Item>,
    );
    expect(documentMarkdown(document, "https://example.com")).toContain(
      "- [Email `guide`](https://example.com/email): Read it.",
    );
  });
  it("rejects title links to a different destination instead of silently losing one", () => {
    const document = capture(
      <Section.Item
        title={
          <T>
            <a href="/other">Other guide</a>
          </T>
        }
      >
        <Section.Item.Link href="../email">
          <T>Read it.</T>
        </Section.Item.Link>
      </Section.Item>,
    );
    expect(() => documentMarkdown(document, "https://example.com")).toThrow(
      /destination|nested|link/i,
    );
  });
  it("requires a visible title for a linked card", () => {
    const document = capture(
      <Section.Item>
        <Section.Item.Link href="/email">
          <T>Read it.</T>
        </Section.Item.Link>
      </Section.Item>,
    );
    expect(() => documentMarkdown(document, "https://example.com")).toThrow(/title/i);
  });
  it("keeps human-only linked items out of the twin", () => {
    const document = capture(
      <ForHumans>
        <Section.Item>
          <Section.Item.Link href="/private">
            <Title>Hidden guide</Title>
            <T>Private hint.</T>
          </Section.Item.Link>
        </Section.Item>
      </ForHumans>,
    );
    const markdown = documentMarkdown(document, "https://example.com");
    expect(markdown).not.toContain("Hidden guide");
    expect(markdown).not.toContain("/private");
  });
  it("fails an unsafe item destination during capture", () => {
    expect(() =>
      capture(
        <Section.Item>
          <Section.Item.Link href="javascript:alert(1)">
            <Title>Guide</Title>
          </Section.Item.Link>
        </Section.Item>,
      ),
    ).toThrow("Unsafe copy link protocol");
  });
  it("rejects a whole-card link outside an item", () => {
    expect(() =>
      capture(
        <Section.Item.Link href="/email">
          <Title>Email guide</Title>
        </Section.Item.Link>,
      ),
    ).toThrow("Section.Item.Link outside Section.Item");
  });
  it("rejects a whole-card link without a resolved href", () => {
    expect(() =>
      capture(
        <Section.Item>
          <Section.Item.Link>
            <Title>Email guide</Title>
          </Section.Item.Link>
        </Section.Item>,
      ),
    ).toThrow("Link requires a resolved href");
  });
  it("rejects destination props on the item instead of accepting a second URL source", () => {
    expect(() =>
      capture(
        <Section.Item {...{ href: "/wrong" }}>
          <Section.Item.Link href="/right">
            <Title>Guide</Title>
          </Section.Item.Link>
        </Section.Item>,
      ),
    ).toThrow("does not accept href");
  });
  it("rejects two whole-card links even when they have the same destination", () => {
    expect(() =>
      capture(
        <Section.Item>
          <Section.Item.Link href="/email">
            <Title>Email guide</Title>
          </Section.Item.Link>
          <Section.Item.Link href="/email">
            <T>Read it.</T>
          </Section.Item.Link>
        </Section.Item>,
      ),
    ).toThrow("Duplicate Section.Item.Link");
  });
  it("retains ordinary inline body links alongside a whole-card destination", () => {
    const document = capture(
      <Section.Item>
        <Section.Item.Link href="/email">
          <Title>Email guide</Title>
        </Section.Item.Link>
        <T>
          Read <a href="/reference">the reference</a>.
        </T>
      </Section.Item>,
    );
    expect(documentMarkdown(document, "https://example.com")).toContain(
      "- [Email guide](https://example.com/email): Read [the reference](https://example.com/reference).",
    );
  });
  it("retains standalone router body links with params, search and hash", () => {
    const { html, document } = captureRendered(
      <InlineLink to="/guides/$id" params={{ id: "email" }} search={{ q: "x" }} hash="more">
        <T>Read the guide.</T>
      </InlineLink>,
    );
    expect(html).toContain('href="/guides/email?q=x#more"');
    expect(document.sections[0]?.items).toEqual([]);
    expect(documentMarkdown(document, "https://example.com")).toContain(
      "[Read the guide.](https://example.com/guides/email?q=x#more)",
    );
  });
  it("retains standalone router body links resolved relative to from", () => {
    const { html, document } = captureRendered(
      <InlineLink from="/guides/current" to="../email" search={{ q: "x" }} hash="more">
        <T>Read the guide.</T>
      </InlineLink>,
    );
    expect(html).toContain('href="/guides/email?q=x#more"');
    expect(documentMarkdown(document, "https://example.com")).toContain(
      "[Read the guide.](https://example.com/guides/email?q=x#more)",
    );
  });
});
