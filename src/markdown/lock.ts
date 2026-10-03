import type { PageDocument } from "./document";

/** Stable, reviewable snapshot of document and message hashes with source locations. */
export interface MarkdownLock {
  readonly version: 1;
  readonly pages: Readonly<Record<string, {
    readonly document: string;
    readonly messages: Readonly<Record<string, string>>;
  }>>;
}

const compare = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);

/** Build the v1 lock without changing document hashes, message hashes, or sources. */
export function createMarkdownLock(documents: ReadonlyArray<PageDocument>): MarkdownLock {
  const pages: Record<string, { document: string; messages: Record<string, string> }> =
    Object.create(null);

  for (const document of [...documents].sort((left, right) => compare(left.path, right.path))) {
    if (Object.hasOwn(pages, document.path))
      throw new Error(`Duplicate copy page path "${document.path}"`);
    if (!/^[0-9a-f]{64}$/.test(document.hash))
      throw new Error(`Invalid copy document hash "${document.hash}" on "${document.path}"`);

    const messages: Record<string, string> = Object.create(null);
    for (const message of [...document.messages].sort(
      (left, right) => compare(left.hash, right.hash) || compare(left.source, right.source),
    )) {
      if (!/^[0-9a-f]{16}$/.test(message.hash))
        throw new Error(`Invalid copy message hash "${message.hash}" on "${document.path}"`);
      if (!Object.hasOwn(messages, message.hash)) messages[message.hash] = message.source;
    }
    pages[document.path] = { document: document.hash, messages };
  }

  // Typed callers supply strings, but the lock remains a validating runtime boundary.
  for (const [path, page] of Object.entries(pages)) {
    if (typeof page.document !== "string")
      throw new Error(`Expected string\n  at ["pages"][${JSON.stringify(path)}]["document"]`);
    for (const [hash, source] of Object.entries(page.messages)) {
      if (typeof source !== "string")
        throw new Error(`Expected string\n  at ["pages"][${JSON.stringify(path)}]["messages"][${JSON.stringify(hash)}]`);
    }
  }
  return { version: 1, pages };
}
