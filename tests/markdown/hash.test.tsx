import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { contentHash, stableJson } from "../../src/markdown/hash";
import { hashDocument } from "../../src/markdown/document";
import { defineFacts, fact } from "../../src/markdown/facts";
import { DocumentProvider, Fact, Section, T, createCollector, finishDocument } from "../../src/react/document";

// Computed with the original @samva/copy functions under Bun in the read-only
// Samva checkout. These values preserve committed document and message locks.
const vectors = [
  [null, "74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b"],
  ["", "12ae32cb1ec02d01eda3581b127c1fee3b0dc53572ed6baf239721a03d82e126"],
  ["नमस्ते 🌏", "0abff69c5e1d711cd4024fa660e064cdb3221704ee6eaa45c5061e73bfa3ebbb"],
  [{ z: [1, true, null], a: { beta: "β", alpha: -0 } }, "54195103dc25f0baa43be4356614b9f4b37860a87adc39c1181aa4426f2e88f2"],
  ["x".repeat(1000), "fa0831df6ae1d266cfba38a70a6774843977f9f70bd53b12ac2d5d70eb1c5404"],
] as const;

describe("original content hashes", () => {
  it.each(vectors)("pins SHA-256 for %j", (value, expected) => {
    expect(contentHash(value)).toBe(expected);
  });
  it("pins authored message truncation and source-independent document canonicalization", () => {
    const facts = defineFacts({ attempts: fact.number(1234) });
    const collector = createCollector({ path: "/guide", site: "https://example.com", facts });
    const html = renderToStaticMarkup(
      <DocumentProvider collector={collector}>
        <Section kind="prose" id="intro" source="page.tsx:1">
          <T source="page.tsx:2">Hello <strong>world</strong>{" "}<Fact id="attempts" /></T>
        </Section>
      </DocumentProvider>,
    );
    const document = finishDocument(collector, { title: "Guide", description: "Example" }, html);
    expect(document.messages[0]?.hash).toBe("73c6828cfa94e847");
    expect(document.hash).toBe("b9cab072483fa2df9e29cb54e7d552163fa0dd58176af04bb96e1ffe8b09dbc8");
    const { hash: _hash, ...withoutHash } = document;
    expect(hashDocument({
      ...withoutHash,
      messages: document.messages.map((message) => ({ ...message, source: "moved.tsx:99" })),
      sections: document.sections.map((section) => ({
        ...section, source: "moved.tsx:98",
        body: section.body.map((entry) => entry.type === "message"
          ? { ...entry, message: { ...entry.message, source: "moved.tsx:99" } }
          : { ...entry, source: "moved.tsx:99" }),
      })),
    })).toBe(document.hash);
  });
  it("sorts object keys while retaining array order and rejecting non-JSON values", () => {
    expect(stableJson({ z: 2, a: 1 })).toBe('{"a":1,"z":2}');
    expect(contentHash({ z: 2, a: 1 })).toBe(contentHash({ a: 1, z: 2 }));
    expect(contentHash([1, 2])).not.toBe(contentHash([2, 1]));
    for (const value of [undefined, NaN, Infinity, 1n, () => undefined]) {
      expect(() => contentHash(value)).toThrow(`Copy content is not JSON: ${String(value)}`);
    }
  });
});
