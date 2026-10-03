import type { PageDocument } from "./document";

export interface LlmsPage {
  document: Pick<PageDocument, "path" | "title" | "description">;
  llms?: string;
}
export function llmsSection(path: string): string {
  const segment = path.split("/").find(Boolean);
  return segment === undefined
    ? "Pages"
    : segment.replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
export function llmsMarkdown(pages: ReadonlyArray<LlmsPage>, site: string): string {
  const groups = new Map<string, Array<LlmsPage>>();
  for (const page of [...pages].sort((a, b) => a.document.path.localeCompare(b.document.path))) {
    const group = page.llms ?? llmsSection(page.document.path);
    const entries = groups.get(group) ?? [];
    entries.push(page);
    groups.set(group, entries);
  }
  return [...groups]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([group, entries]) =>
        `## ${group}\n\n${entries.map(({ document }) => `- [${document.title.replaceAll("]", "\\]")}](${new URL(`${document.path === "/" ? "/index" : document.path}.md`, site).href}): ${document.description.replace(/\s+/g, " ")}`).join("\n")}\n`,
    )
    .join("\n");
}
