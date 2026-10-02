import { pageHeads, type PageHead, type PageHeadsOptions } from "../core/page-heads";
import type { SeoGraphLoader } from "./vite-graph-loader";

/** Acquire, extract and release a graph on both success and metadata failure. Bind loader input in a closure. */
export async function loadPageHeads(loader: SeoGraphLoader, options: PageHeadsOptions = {}): Promise<Array<PageHead>> {
  const loaded = await loader();
  try {
    return pageHeads(loaded.graph, options);
  } finally {
    await loaded.dispose();
  }
}
