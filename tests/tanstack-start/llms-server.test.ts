import { describe, expect, it, vi } from "vitest";

vi.mock("virtual:pagegraph/runtime", () => ({
  graph: {
    nodes: [
      { path: "/", kind: "page", source: "route", policy: { kind: "page" }, markdown: "rendered", head: { title: "Home", description: "Welcome" } },
      { path: "/guides/email", kind: "page", source: "guides", policy: { kind: "page" }, markdown: "rendered", llms: "Guides", head: { title: "Email", description: "Send email" } },
      { path: "/reference", kind: "page", source: "route", policy: { kind: "page" }, markdown: "source", llms: "Reference", head: { title: "API", description: "Reference docs" } },
      { path: "/guides/$id", kind: "page", source: "route", policy: { kind: "page" }, markdown: "rendered", llms: "Templates", head: { title: "Template", description: "Not a page" } },
      { path: "/about", kind: "page", source: "route", policy: { kind: "page" }, head: { title: "About", description: "Unlisted" } },
    ],
    edges: [],
  },
  site: { origin: "https://html.example", indexable: true },
  markdown: { origin: "https://documents.example" },
  facts: undefined,
}));

import { llmsSection, llmsTxt } from "../../src/tanstack-start/server";

describe("graph llms.txt serving", () => {
  it("lists rendered twins and explicitly grouped source pages using the document origin", () => {
    const section = llmsSection();
    expect(section).toContain("## Pages\n\n- [Home](https://documents.example/index.md): Welcome");
    expect(section).toContain("## Guides\n\n- [Email](https://documents.example/guides/email.md): Send email");
    expect(section).toContain("## Reference\n\n- [API](https://documents.example/reference.md): Reference docs");
    expect(section).not.toContain("Template");
    expect(section).not.toContain("About");
  });

  it("composes additional sections into a native Start GET handler", async () => {
    const response = llmsTxt({ sections: ["## External docs\n\n- [SDK](https://sdk.example): SDK docs"] })();
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    const text = await response.text();
    expect(text).toContain(llmsSection().trimEnd());
    expect(text).toContain("\n\n## External docs\n\n- [SDK](https://sdk.example): SDK docs\n");
  });
});
