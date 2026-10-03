import { describe, expect, it } from "vitest";

import type { PageDocument } from "../../src/markdown/document";
import { createMarkdownLock } from "../../src/markdown/lock";

const message = (hash: string, source: string) => ({
  hash,
  tree: [],
  text: "Copy",
  source,
  facts: [],
  audience: "all" as const,
});

const document = (
  path: string,
  hash: string,
  messages: PageDocument["messages"] = [],
): PageDocument => ({
  path,
  hash,
  title: "Title",
  description: "Description",
  sections: [],
  messages,
  facts: [],
});

describe("copy lock", () => {
  it("builds the exact v1 shape with stable page and message ordering", () => {
    const lock = createMarkdownLock([
      document("/z", "b".repeat(64), [message("f".repeat(16), "z.tsx:8")]),
      document("/a", "a".repeat(64), [
        message("e".repeat(16), "a.tsx:9"),
        message("c".repeat(16), "a.tsx:3"),
      ]),
    ]);

    expect(Object.keys(lock)).toEqual(["version", "pages"]);
    expect(lock).toEqual({
      version: 1,
      pages: {
        "/a": {
          document: "a".repeat(64),
          messages: { ["c".repeat(16)]: "a.tsx:3", ["e".repeat(16)]: "a.tsx:9" },
        },
        "/z": { document: "b".repeat(64), messages: { ["f".repeat(16)]: "z.tsx:8" } },
      },
    });
    expect(JSON.parse(JSON.stringify(lock))).toEqual(lock);
  });

  it("rejects duplicate page paths", () => {
    expect(() =>
      createMarkdownLock([document("/same", "a".repeat(64)), document("/same", "b".repeat(64))]),
    ).toThrow('Duplicate copy page path "/same"');
  });

  it("rejects malformed document and message hashes at the schema boundary", () => {
    expect(() => createMarkdownLock([document("/bad", "not-a-hash")])).toThrow();
    expect(() =>
      createMarkdownLock([document("/bad", "a".repeat(64), [message("not-a-hash", "page.tsx:1")])]),
    ).toThrow();
  });

  it("chooses a stable source when a message hash occurs more than once", () => {
    const hash = "c".repeat(16);
    const one = createMarkdownLock([
      document("/same", "a".repeat(64), [
        message(hash, "second.tsx:2"),
        message(hash, "first.tsx:1"),
      ]),
    ]);
    const two = createMarkdownLock([
      document("/same", "a".repeat(64), [
        message(hash, "first.tsx:1"),
        message(hash, "second.tsx:2"),
      ]),
    ]);
    expect(one.pages["/same"]?.messages[hash]).toBe("first.tsx:1");
    expect(two).toEqual(one);
  });
});


describe("untyped lock input", () => {
  it("preserves final source string validation diagnostics", () => {
    const malformed = {
      ...document("/bad", "a".repeat(64)),
      messages: [{ ...message("b".repeat(16), "src"), source: 3 }],
    };
    expect(() => Reflect.apply(createMarkdownLock, undefined, [[malformed]]))
      .toThrow('Expected string\n  at ["pages"]["/bad"]["messages"]["bbbbbbbbbbbbbbbb"]');
  });
  it("rejects document hashes that only coerce to valid strings", () => {
    const malformed = {
      ...document("/bad", "a".repeat(64)),
      hash: { toString: () => "a".repeat(64) },
    };
    expect(() => Reflect.apply(createMarkdownLock, undefined, [[malformed]]))
      .toThrow('Expected string\n  at ["pages"]["/bad"]["document"]');
  });
});
