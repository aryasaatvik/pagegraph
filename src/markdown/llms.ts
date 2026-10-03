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

const begin = "<!-- pagegraph:llms:start -->";
const end = "<!-- pagegraph:llms:end -->";
/** Replace only our generated section, retaining an adopter's existing llms.txt. */
export function appendLlmsSection(
  existing: string,
  pages: ReadonlyArray<LlmsPage>,
  site: string,
): string {
  const start = existing.indexOf(begin);
  const finish = existing.indexOf(end);
  if ((start === -1) !== (finish === -1) || (finish !== -1 && finish < start))
    throw new Error("Malformed document llms.txt section markers");
  const generated = `${begin}\n${llmsMarkdown(pages, site)}${end}`;
  if (start !== -1)
    return `${existing.slice(0, start)}${generated}${existing.slice(finish + end.length)}`;
  return `${existing.trimEnd()}${existing.trim() ? "\n\n" : ""}${generated}\n`;
}
