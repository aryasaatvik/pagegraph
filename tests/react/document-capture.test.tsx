import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  CaptureRequest, DocumentProvider, Section, T, createCollector, finishDocument, useCapturePage,
} from "../../src/react/index";

const metadata = { title: "Page", description: "Authored page" };

describe("document capture replay", () => {
  it("gets its collector from CaptureRequest and keeps ancestor layout outside the page", () => {
    const collector = createCollector({ path: "/page", site: "https://example.com" });
    function PagePath() {
      return <T>{useCapturePage()}</T>;
    }
    const html = renderToStaticMarkup(
      <CaptureRequest.Provider value={collector}>
        <T>Ancestor layout</T>
        <DocumentProvider>
          <Section kind="prose" id="intro"><PagePath /></Section>
        </DocumentProvider>
      </CaptureRequest.Provider>,
    );
    expect(finishDocument(collector, metadata, html).messages.map(({ text }) => text)).toEqual(["/page"]);
    expect(() => finishDocument(collector, metadata, html)).toThrow("Document capture already completed for /page");
  });

  it("replays only completed HTML markers, in completed output order", () => {
    const collector = createCollector({ path: "/page", site: "https://example.com" });
    renderToStaticMarkup(
      <DocumentProvider collector={collector}>
        <Section kind="prose" id="abandoned"><T>Abandoned attempt</T></Section>
      </DocumentProvider>,
      { identifierPrefix: "abandoned" },
    );
    const html = renderToStaticMarkup(
      <DocumentProvider collector={collector}>
        <Section kind="prose" id="completed"><T>First</T><T>Second</T></Section>
      </DocumentProvider>,
      { identifierPrefix: "completed" },
    );
    const document = finishDocument(collector, metadata, html);
    expect(document.sections.map(({ id }) => id)).toEqual(["completed"]);
    expect(document.messages.map(({ text }) => text)).toEqual(["First", "Second"]);
  });

  it("rejects a marker that has no recorded render", () => {
    const collector = createCollector({ path: "/page", site: "https://example.com" });
    expect(() => finishDocument(collector, metadata, '<template data-document-record="missing"></template>'))
      .toThrow("Unknown document record on /page");
  });
});
