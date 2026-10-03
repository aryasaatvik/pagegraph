import { describe, expect, it, vi } from "vitest";
import { Suspense, use } from "react";
import type { ReactNode } from "react";
import { renderToReadableStream, renderToStaticMarkup } from "react-dom/server";

import {
  CaptureRequest,
  DocumentProvider,
  Section,
  T,
  createCollector,
  finishDocument,
} from "../../src/react/document";

vi.mock("virtual:pagegraph/runtime", () => ({ graph: null, site: null, markdown: null, facts: undefined }));
import { markdownRequest } from "../../src/tanstack-start/markdown";

const metadata = { title: "Native page", description: "Native capture" };
async function capture(path: string, children: ReactNode) {
  const collector = createCollector({ path, site: "https://example.com" });
  const stream = await renderToReadableStream(
    <CaptureRequest.Provider value={collector}>{children}</CaptureRequest.Provider>,
  );
  await stream.allReady;
  const html = await new Response(stream).text();
  return finishDocument(collector, metadata, html);
}
function Delayed({ ready, text }: { ready: Promise<void>; text: string }) {
  use(ready);
  return <T>{text}</T>;
}
describe("completed SSR document capture", () => {
  it("keeps normal rendering unchanged and excludes ancestor shell messages", async () => {
    const page = (
      <>
        <header>
          <T>Shared shell</T>
        </header>
        <DocumentProvider>
          <Section id="body" kind="prose">
            <T>Page body</T>
          </Section>
        </DocumentProvider>
      </>
    );
    expect(renderToStaticMarkup(page)).toBe("<header>Shared shell</header>Page body");
    const document = await capture("/page", page);
    expect(document.messages.map((message) => message.text)).toEqual(["Page body"]);
  });
  it("takes final HTML order rather than asynchronous completion order and omits fallback attempts", async () => {
    const first = new Promise<void>((resolve) => setTimeout(resolve, 15));
    const second = Promise.resolve();
    const document = await capture(
      "/page",
      <DocumentProvider>
        <Section id="body" kind="prose">
          <Suspense fallback={<T>Abandoned fallback</T>}>
            <Delayed ready={first} text="First" />
          </Suspense>
          <Suspense fallback={<T>Other fallback</T>}>
            <Delayed ready={second} text="Second" />
          </Suspense>
          <T>Last</T>
        </Section>
      </DocumentProvider>,
    );
    expect(document.messages.map((message) => message.text)).toEqual(["First", "Second", "Last"]);
    expect(
      document.sections[0]?.body.map((entry) =>
        entry.type === "message" ? entry.message.text : entry.text,
      ),
    ).toEqual(["First", "Second", "Last"]);
  });
  it("isolates concurrent requests and produces repeatable documents", async () => {
    const page = (text: string) => (
      <DocumentProvider>
        <Section id="body" kind="prose">
          <T>{text}</T>
        </Section>
      </DocumentProvider>
    );
    const [left, right, repeat] = await Promise.all([
      capture("/left", page("Left")),
      capture("/right", page("Right")),
      capture("/left", page("Left")),
    ]);
    expect(left.messages.map((message) => message.text)).toEqual(["Left"]);
    expect(right.messages.map((message) => message.text)).toEqual(["Right"]);
    expect(repeat).toEqual(left);
  });
});

describe("malformed capture request paths", () => {
  it("passes through malformed escapes without capturing", async () => {
    for (const path of ["/guides/%ZZ.md", "/guides/%E0%A4.document.json"])
      expect(await markdownRequest(new Request(`https://example.com${path}`))).toBeNull();
  });
});
