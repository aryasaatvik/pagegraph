import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import * as Schema from "effect/Schema";

import { hashDocument, type PageDocument } from "./document";
import { CaptureBundle, PageDocument as PageDocumentSchema } from "./schema";

export type MarkdownCapture = Schema.Schema.Type<typeof CaptureBundle>;
export type PageHead = MarkdownCapture["heads"][number];

/** Captures name concrete URL paths whose derived files cannot escape the capture tree. */
function verifyPath(path: string): void {
  const url = new URL(path, "https://pagegraph.invalid");
  if (!path.startsWith("/") || path.startsWith("//") || /[?#\\$]/.test(path) ||
      url.origin !== "https://pagegraph.invalid" || url.pathname !== path ||
      (path !== "/" && path.endsWith("/")) ||
      path.split("/").some((part) => part === "." || part === ".." || part === "*")) {
    throw new Error(`Invalid captured page path "${path}"`);
  }
}

function verifyDocuments(documents: ReadonlyArray<PageDocument>, heads: ReadonlyArray<PageHead>): void {
  const paths = new Set<string>();
  for (const document of documents) {
    verifyPath(document.path);
    if (paths.has(document.path)) throw new Error(`Duplicate captured document path "${document.path}"`);
    paths.add(document.path);
    const { hash, ...content } = document;
    if (!/^[0-9a-f]{64}$/.test(hash) || hashDocument(content) !== hash)
      throw new Error(`Invalid captured document hash for "${document.path}"; build the app again.`);
  }
  const headPaths = new Set<string>();
  for (const head of heads) {
    verifyPath(head.path);
    if (paths.has(head.path)) throw new Error(`Duplicate captured page path "${head.path}"`);
    if (headPaths.has(head.path)) throw new Error(`Duplicate captured head path "${head.path}"`);
    headPaths.add(head.path);
  }
  if (documents.length === 0 && heads.length === 0)
    throw new Error("No captured markdown pages; build the app or use --dev <origin>.");
}

/** Read the persisted document tree and graph heads; malformed captures always fail. */
export async function readMarkdownCapture(root: string, origin: string): Promise<MarkdownCapture> {
  const directory = resolve(root, ".pagegraph/documents");
  const documents: Array<PageDocument> = [];
  const visit = async (folder: string): Promise<void> => {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const file = resolve(folder, entry.name);
      if (entry.isDirectory()) { await visit(file); continue; }
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const document = Schema.decodeUnknownSync(Schema.fromJsonString(PageDocumentSchema))(
        await readFile(file, "utf8"), { onExcessProperty: "error" },
      );
      verifyPath(document.path);
      const name = document.path === "/" ? "index" : document.path.slice(1);
      if (file !== resolve(directory, `${name}.json`))
        throw new Error(`Captured document "${document.path}" is stored at the wrong path: ${file}`);
      documents.push(document);
    }
  };
  try { await visit(directory); }
  catch (cause) {
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT")
      throw new Error(`Missing markdown captures at ${directory}; build the app or use --dev <origin>.`);
    throw cause;
  }
  const heads = Schema.decodeUnknownSync(Schema.fromJsonString(CaptureBundle.fields.heads))(
    await readFile(resolve(root, ".pagegraph/heads.json"), "utf8"), { onExcessProperty: "error" },
  );
  verifyDocuments(documents, heads);
  return { origin, documents: documents.sort((a, b) => a.path.localeCompare(b.path)), heads };
}

/** The development endpoint supplies a complete capture from the running Start app. */
export async function readDevMarkdownCapture(origin: string): Promise<MarkdownCapture> {
  const base = new URL(origin);
  if (!/^https?:$/.test(base.protocol) || base.origin !== origin)
    throw new Error(`Invalid development server origin "${origin}"; use an http(s) origin.`);
  const endpoint = new URL("/__pagegraph/markdown.json", base);
  const response = await fetch(endpoint);
  if (!response.ok) throw new Error(`GET ${endpoint} returned HTTP ${response.status}.`);
  const bundle = Schema.decodeUnknownSync(Schema.fromJsonString(CaptureBundle))(
    await response.text(), { onExcessProperty: "error" },
  );
  const canonical = new URL(bundle.origin);
  if (!/^https?:$/.test(canonical.protocol) || canonical.origin !== bundle.origin)
    throw new Error(`Invalid captured markdown origin "${bundle.origin}"`);
  verifyDocuments(bundle.documents, bundle.heads);
  return bundle;
}
