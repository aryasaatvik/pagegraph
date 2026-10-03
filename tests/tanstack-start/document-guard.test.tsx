import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterContextProvider,
} from "@tanstack/react-router";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DocumentProvider, Section, T, createCollector, finishDocument } from "../../src/react/document";
import { Link } from "../../src/tanstack-start/react";
import { documentMarkdown } from "../../src/markdown/markdown";

async function route(markdown?: "rendered" | "source") {
  const root = createRootRoute();
  const page = createRoute({ getParentRoute: () => root, path: "/page", staticData: { markdown } });
  const router = createRouter({
    routeTree: root.addChildren([page]),
    history: createMemoryHistory({ initialEntries: ["/page"] }),
    isServer: true,
  });
  await router.load();
  return router;
}

afterEach(() => vi.unstubAllEnvs());

describe("DocumentProvider route declaration", () => {
  it("rejects undeclared and source-only routes in development with and without capture", async () => {
    vi.stubEnv("DEV", true);
    for (const markdown of [undefined, "source"] as const) {
      const router = await route(markdown);
      for (const collector of [undefined, createCollector({ path: "/page", site: "https://example.com" })]) {
        expect(() => renderToStaticMarkup(
          <RouterContextProvider router={router}>
            <DocumentProvider collector={collector}><Section kind="prose" id="body"><T>Page</T></Section></DocumentProvider>
          </RouterContextProvider>,
        )).toThrow('requires staticData.markdown: "rendered"');
      }
    }
  });

  it("leaves production rendering unchanged for undeclared routes", async () => {
    vi.stubEnv("DEV", false);
    const router = await route();
    expect(renderToStaticMarkup(
      <RouterContextProvider router={router}>
        <DocumentProvider><Section kind="prose" id="body"><T>Page</T></Section></DocumentProvider>
      </RouterContextProvider>,
    )).toBe("Page");
  });

  it("captures resolved real router Link destinations only inside the document", async () => {
    vi.stubEnv("DEV", true);
    const router = await route("rendered");
    const collector = createCollector({ path: "/page", site: "https://example.com" });
    const html = renderToStaticMarkup(
      <RouterContextProvider router={router}>
        <Link to="/outside"><T>Shell</T></Link>
        <DocumentProvider collector={collector}>
          <Section kind="prose" id="body">
            <Link to="/guides/$id" params={{ id: "email" }} search={{ q: "x" }} hash="more"><T>Guide</T></Link>
          </Section>
        </DocumentProvider>
      </RouterContextProvider>,
    );
    const document = finishDocument(collector, { title: "Page", description: "Guide links" }, html);
    expect(html).toContain('href="/outside"');
    expect(html).toContain('href="/guides/email?q=x#more"');
    expect(documentMarkdown(document, "https://example.com")).toContain("[Guide](https://example.com/guides/email?q=x#more)");
    expect(document.messages.map((message) => message.text)).toEqual(["Guide"]);
  });
});
