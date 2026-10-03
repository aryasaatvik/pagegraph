/// <reference types="vite/client" />
/** Development and prerender capture of the application's real Start routes. */
import type { AnyRouter } from "@tanstack/react-router";
import { defineHandlerCallback } from "@tanstack/react-router/ssr/server";
import type { Register } from "@tanstack/react-start";
import { createStartHandler, StartServer } from "@tanstack/react-start/server";
import type { RequestOptions } from "@tanstack/react-start/server";
import { renderToReadableStream } from "react-dom/server";
import { facts, markdown } from "virtual:pagegraph/runtime";

import { hashDocument, type PageDocument } from "../markdown/document";
import { documentMarkdown, sectionMarkdown } from "../markdown/markdown";
import { CaptureRequest, createCollector, finishDocument } from "../react/document";
import { seoGraph } from "./server";

import { MARKDOWN_CAPTURE_PATH } from "./markdown-path";

/** Concrete graph pages declaring `staticData.markdown: "rendered"`. */
export function markdownPagePaths(): ReadonlyArray<string> {
  return [...seoGraph().nodes.values()]
    .filter((node) => node.markdown === "rendered" && !node.path.includes("$"))
    .map((node) => node.path)
    .sort((a, b) => a.localeCompare(b));
}

function metadata(router: AnyRouter, path: string): { title: string; description: string } {
  const match = router.stores.matches.get().at(-1);
  if (match?.status !== "success")
    throw new Error(`Markdown page ${path}: route did not load successfully`);
  const title = match.meta?.find((entry) => entry !== undefined && "title" in entry)?.title;
  const description = match.meta?.find((entry) => entry !== undefined && "name" in entry && entry.name === "description");
  if (typeof title !== "string" || description === undefined || !("content" in description) || typeof description.content !== "string")
    throw new Error(`Markdown page ${path}: head() must declare title and description`);
  return { title, description: description.content };
}

async function capturePage(
  path: string,
  origin: string,
  request: Request,
  options: RequestOptions<Register> | undefined,
): Promise<PageDocument> {
  let document: PageDocument | undefined;
  let failure: unknown;
  const url = new URL(request.url);
  url.pathname = path;
  url.search = "";
  const headers = new Headers(request.headers);
  headers.delete("authorization");
  headers.delete("cookie");
  headers.set("accept", "text/html");
  const htmlRequest = new Request(url, { method: "GET", headers, signal: request.signal });
  const render = defineHandlerCallback(async ({ router }) => {
    try {
      const head = metadata(router, path);
      const collector = createCollector({ path, site: origin, ...(facts === undefined ? {} : { facts }) });
      const errors: Array<unknown> = [];
      const stream = await renderToReadableStream(
        <CaptureRequest.Provider value={collector}>
          <StartServer router={router} />
        </CaptureRequest.Provider>,
        { signal: request.signal, onError: (cause) => { errors.push(cause); } },
      );
      // Only completed HTML determines record order and discards abandoned Suspense fallbacks.
      await stream.allReady;
      const html = await new Response(stream).text();
      if (errors.length > 0) throw errors[0];
      const { hash: _hash, ...captured } = finishDocument(collector, head, html);
      // Preserve human-only content for offline document consumers without adding it to the twin.
      const content = {
        ...captured,
        sections: captured.sections.map((section) => ({
          ...section,
          claimsMarkdown: sectionMarkdown(section, { includeHumans: true }),
        })),
      };
      document = { ...content, hash: hashDocument(content) };
      return new Response(null, { status: 204 });
    } catch (cause) {
      failure = cause;
      return captureFailure(path, cause);
    }
  });
  const response = await createStartHandler(render)(htmlRequest, options);
  if (document === undefined)
    throw failure ?? new Error(`Markdown page ${path}: ${response.status} ${await response.text()}`);
  return document;
}

function captureFailure(path: string, cause: unknown): Response {
  const message = `Markdown page ${path}: ${cause instanceof Error ? cause.message : String(cause)}`;
  return new Response(message, {
    status: 500,
    headers: { "x-pagegraph-error": encodeURIComponent(message), "cache-control": "no-store" },
  });
}

/**
 * Capture private documents and Markdown twins in dev or the non-deployed prerender Worker.
 * Returns `null` for ordinary requests so the application's Start handler can serve them.
 */
export async function markdownRequest(
  request: Request,
  options?: RequestOptions<Register>,
): Promise<Response | null> {
  const path = new URL(request.url).pathname.replace(/\/$/, "");
  const privatePath = path === "/__pagegraph" || path.startsWith("/__pagegraph/") || path.endsWith(".document.json");
  const enabled = import.meta.env?.DEV || process.env.TSS_PRERENDERING === "true";
  if (!enabled) return privatePath ? new Response(request.method === "HEAD" ? null : "Not found", { status: 404 }) : null;
  if (!privatePath && !path.endsWith(".md")) return null;
  if (!["GET", "HEAD"].includes(request.method))
    return privatePath ? new Response(request.method === "HEAD" ? null : "Not found", { status: 404 }) : null;
  if (markdown === null) return privatePath ? new Response(request.method === "HEAD" ? null : "Not found", { status: 404 }) : null;
  try {
    const pages = markdownPagePaths();
    let response: Response;
    if (path === MARKDOWN_CAPTURE_PATH) {
      const documents: Array<PageDocument> = [];
      for (const page of pages) documents.push(await capturePage(page, markdown.origin, request, options));
      const captured = new Set(pages);
      const heads = [...seoGraph().nodes.values()]
        .flatMap((node) => {
          const head = node.head;
          return captured.has(node.path) || node.path.includes("$") || head?.description === undefined
            ? []
            : [{ path: node.path, title: head.title, description: head.description }];
        })
        .sort((a, b) => a.path.localeCompare(b.path));
      response = Response.json({ origin: markdown.origin, documents, heads }, { headers: { "cache-control": "no-store" } });
    } else {
      const page = pages.find((candidate) => {
        const base = candidate === "/" ? "/index" : candidate;
        return `${base}.md` === path || `${base}.document.json` === path;
      });
      if (page === undefined) return privatePath ? new Response(request.method === "HEAD" ? null : "Not found", { status: 404 }) : null;
      const document = await capturePage(page, markdown.origin, request, options);
      response = path.endsWith(".document.json")
        ? Response.json(document, { headers: { "cache-control": "no-store" } })
        : new Response(documentMarkdown(document, markdown.origin), {
            headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": "no-store" },
          });
    }
    return request.method === "HEAD" ? new Response(null, response) : response;
  } catch (cause) {
    const response = captureFailure(path, cause);
    return request.method === "HEAD" ? new Response(null, response) : response;
  }
}
