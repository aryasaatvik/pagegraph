import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { hashDocument } from "../../src/markdown/document";
import type { PageDocument } from "../../src/markdown/document";
import { MARKDOWN_CAPTURE_PATH, persistMarkdownCapture } from "../../src/tanstack-start/persist-markdown";
import { pagegraph } from "../../src/tanstack-start/plugin";

const roots: Array<string> = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
const document = (path: string): PageDocument => {
  const content = { path, title: "Captured title", description: "Captured description", sections: [], messages: [], facts: [] };
  return { ...content, hash: hashDocument(content) };
};
const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), "pagegraph-capture-"));
  roots.push(root);
  const out = join(root, "public-output");
  const capture = join(out, MARKDOWN_CAPTURE_PATH);
  await mkdir(dirname(capture), { recursive: true });
  await writeFile(capture, "private capture");
  return { root, out, capture, documents: join(root, ".pagegraph/documents") };
};
const bundle = (documents: ReadonlyArray<PageDocument>) => JSON.stringify({ origin: "https://example.com", documents,
  heads: [{ path: "/plain", title: "Plain title", description: "Plain description" }] });

describe("Markdown prerender persistence", () => {
  it("exposes one private Start page only when rendered Markdown is configured", () => {
    expect(pagegraph({ origin: "https://example.com" }).prerenderPages).toEqual([]);
    const pages = pagegraph({ origin: "https://example.com", markdown: { origin: "https://example.com" } }).prerenderPages;
    expect(pages).toHaveLength(1);
    expect(pages[0]?.path).toBe("/__pagegraph/markdown.json");
    expect(pages[0]?.sitemap).toEqual({ exclude: true });
    expect(pages[0]?.prerender.onSuccess).toBeTypeOf("function");
  });

  it("writes nested documents and public twins, persists heads, and removes the capture file", async () => {
    const { root, out, capture, documents } = await fixture();
    const home = document("/");
    const guide = document("/guides/first");
    await persistMarkdownCapture(bundle([home, guide]), root, out);
    expect(JSON.parse(await readFile(join(documents, "index.json"), "utf8"))).toEqual(home);
    expect(JSON.parse(await readFile(join(documents, "guides/first.json"), "utf8"))).toEqual(guide);
    expect(await readFile(join(out, "index.md"), "utf8")).toContain("# Captured title");
    expect(await readFile(join(out, "guides/first.md"), "utf8")).toContain("https://example.com/guides/first");
    expect(JSON.parse(await readFile(join(root, ".pagegraph/heads.json"), "utf8"))).toEqual([
      { path: "/plain", title: "Plain title", description: "Plain description" },
    ]);
    await expect(readFile(capture)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("prunes only valid stale captures at their derived path and preserves unrelated files", async () => {
    const { root, out, documents } = await fixture();
    await mkdir(documents, { recursive: true });
    const stale = document("/stale");
    await writeFile(join(documents, "stale.json"), JSON.stringify(stale));
    await writeFile(join(documents, "misplaced.json"), JSON.stringify(stale));
    await writeFile(join(documents, "malformed.json"), "not JSON");
    await writeFile(join(documents, "unrelated.json"), JSON.stringify({ memo: "retain" }));
    await writeFile(join(documents, "changed.json"), JSON.stringify({ ...document("/changed"), title: "Tampered" }));
    const outside = join(root, "outside.json");
    await writeFile(outside, JSON.stringify(document("/linked")));
    await symlink(outside, join(documents, "linked.json"));
    await persistMarkdownCapture(bundle([document("/")]), root, out);
    await expect(readFile(join(documents, "stale.json"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(join(documents, "misplaced.json"), "utf8")).toBe(JSON.stringify(stale));
    expect(await readFile(join(documents, "malformed.json"), "utf8")).toBe("not JSON");
    expect(await readFile(join(documents, "unrelated.json"), "utf8")).toBe('{"memo":"retain"}');
    expect(await readFile(join(documents, "changed.json"), "utf8")).toContain("Tampered");
    expect(await readFile(outside, "utf8")).toBe(JSON.stringify(document("/linked")));
  });

  it("validates the entire bundle before deleting or writing files", async () => {
    const { root, out, capture } = await fixture();
    for (const path of ["/../outside", "/$slug", "/foo?query=1", "/foo/", "//elsewhere"]) {
      await expect(persistMarkdownCapture(bundle([document(path)]), root, out)).rejects.toThrow("Invalid captured document path");
    }
    await expect(persistMarkdownCapture(bundle([{ ...document("/"), hash: "wrong" }]), root, out)).rejects.toThrow("Invalid captured document hash");
    await expect(persistMarkdownCapture(bundle([document("/"), document("/")]), root, out)).rejects.toThrow("Duplicate captured document path");
    await expect(persistMarkdownCapture(bundle([document("/"), document("/index")]), root, out)).rejects.toThrow("share the output name");
    await expect(persistMarkdownCapture('{"origin":"https://example.com","documents":[]}', root, out)).rejects.toThrow();
    expect(await readFile(capture, "utf8")).toBe("private capture");
  });
});
