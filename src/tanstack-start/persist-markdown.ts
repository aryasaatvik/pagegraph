import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import * as Schema from "effect/Schema";

import type { PageDocument } from "../markdown/document";
import { hashDocument } from "../markdown/document";
import { CaptureBundle, PageDocument as PageDocumentSchema } from "../markdown/schema";
import { documentMarkdown } from "../markdown/markdown";

import { MARKDOWN_CAPTURE_PATH } from "./markdown-path";

/** File names must remain inside the package's capture and the client's output trees. */
function documentName(path: string): string {
  const parsed = new URL(path, "https://pagegraph.invalid");
  if (!path.startsWith("/") || path.startsWith("//") || /[?#\\$]/.test(path) ||
      parsed.pathname !== path || parsed.origin !== "https://pagegraph.invalid" ||
      (path !== "/" && path.endsWith("/")) || path.split("/").some((part) => part === "." || part === ".." || part === "*")) {
    throw new Error(`Invalid captured document path "${path}"`);
  }
  return path === "/" ? "index" : path.slice(1);
}

function verifyDocument(document: PageDocument): string {
  const name = documentName(document.path);
  const { hash, ...content } = document;
  if (!/^[0-9a-f]{64}$/.test(hash) || hashDocument(content) !== hash)
    throw new Error(`Invalid captured document hash for "${document.path}"`);
  return name;
}

/** Only valid captures at their derived paths belong to pagegraph; preserve unrelated files. */
async function pruneDocuments(directory: string, paths: ReadonlySet<string>): Promise<void> {
  const visit = async (folder: string): Promise<void> => {
    const entries = await readdir(folder, { withFileTypes: true });
    for (const entry of entries) {
      const file = resolve(folder, entry.name);
      if (entry.isDirectory()) { await visit(file); continue; }
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const contents = await readFile(file, "utf8");
      let document: PageDocument;
      let name: string;
      try {
        document = Schema.decodeUnknownSync(Schema.fromJsonString(PageDocumentSchema))(contents, { onExcessProperty: "error" });
        name = verifyDocument(document);
      } catch { continue; }
      if (file === resolve(directory, `${name}.json`) && !paths.has(document.path)) await unlink(file);
    }
  };
  await visit(directory);
}

/** Documents, twins, and graph heads are persisted before prerender onSuccess returns. */
export async function persistMarkdownCapture(html: string, root: string, clientOutDir: string): Promise<void> {
  const bundle = Schema.decodeUnknownSync(Schema.fromJsonString(CaptureBundle))(html, { onExcessProperty: "error" });
  const origin = new URL(bundle.origin);
  if ((origin.protocol !== "https:" && origin.protocol !== "http:") || origin.origin !== bundle.origin)
    throw new Error(`Invalid captured markdown origin "${bundle.origin}"`);
  const active = new Set<string>();
  const destinations = new Set<string>();
  const names = bundle.documents.map((document) => {
    if (active.has(document.path)) throw new Error(`Duplicate captured document path "${document.path}"`);
    active.add(document.path);
    const name = verifyDocument(document);
    if (destinations.has(name)) throw new Error(`Captured document paths share the output name "${name}"`);
    destinations.add(name);
    return name;
  });
  await unlink(resolve(clientOutDir, MARKDOWN_CAPTURE_PATH.slice(1)));
  const directory = resolve(root, ".pagegraph/documents");
  await mkdir(directory, { recursive: true });
  for (const [index, document] of bundle.documents.entries()) {
    const name = names[index];
    const destination = resolve(directory, `${name}.json`);
    const twin = resolve(clientOutDir, `${name}.md`);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, JSON.stringify(document));
    await mkdir(dirname(twin), { recursive: true });
    await writeFile(twin, documentMarkdown(document, bundle.origin));
  }
  await pruneDocuments(directory, active);
  await writeFile(resolve(root, ".pagegraph/heads.json"), `${JSON.stringify(bundle.heads)}\n`);
}
